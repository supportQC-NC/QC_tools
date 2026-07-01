// filialesService.js
// -----------------------------------------------------------------------------
// Analyse Filiales — consolidation maison-mère / filiales par réseau.
// Reproduit la logique du script Python "Analyse Filiale" mais en lisant les
// fichiers DBF (via articleService + fournissCacheService) au lieu de SQLite.
//
// Mapping DBF :
//   numero_article        -> NART
//   designation           -> DESIGN
//   reference_fournisseur -> REFER
//   designation_fournisseur -> DESIGN2
//   prix_vente_ht         -> PVTE           (PVTETTC = TTC, ATVA = % TGC)
//   stock                 -> S1+…+S5
//   ventes_m0..m11        -> V1..V12
//   gisement_1 (mère)     -> EMPLACE
//   fournisseur.nom       -> fourniss.NOM   (jointure par FOURN)
//   fournisseur.adresse_1 -> fourniss.AD1   (= trigramme de la mère pour le réseau)
//
// Règle réseau : une FILIALE ne garde que les articles dont le fournisseur a
// AD1 == trigramme de la maison-mère. Matching filiale↔mère : clé = 1ʳᵉ partie de
// DESIGN2 avant " - " (sinon REFER), comparée au NART de la mère.
//
// Réseaux figés (comme le script) : DQ, QC, LD. Entités = entreprise.trigramme.
// -----------------------------------------------------------------------------

import Entreprise from "../models/EntrepriseModel.js";
import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";

// Définition des 3 réseaux (mère + filiales) — codes = trigrammes
const RESEAUX = {
  DQ: { mere: "DQ", filiales: ["PB", "LB", "BB", "VKP", "QK"] },
  QC: { mere: "QC", filiales: ["MQ", "KQ", "HD", "SIT"] },
  LD: {
    mere: "LD",
    filiales: ["DQ", "PB", "LB", "BB", "VKP", "QK", "QC", "MQ", "KQ", "HD", "SIT"],
  },
};

// Libellés d'affichage différents du code
const LABELS = { SIT: "SITEC", HD: "WELDOM" };

// Résolution des codes réseau vers le nomDossierDBF réel (repris de config.py).
// Les trigrammes des entreprises ne correspondent pas toujours au code réseau
// (ex : HD = dossier "homedepot", trigramme réel "WEL") -> on résout par dossier.
const CODE_TO_DOSSIER = {
  DQ: "ducosquincaillerie",
  PB: "paitabricolage",
  LB: "lebroussard",
  BB: "bourailbricolage",
  VKP: "quincaillerievkp",
  QK: "quincailleriekoumac",
  QC: "qc",
  MQ: "meare",
  KQ: "quinckone",
  HD: "homedepot",
  SIT: "sitec",
  LD: "ld",
};

// Couleurs par entité (reprises du script) pour l'en-tête groupé
const ENTITY_COLORS = {
  DQ: "4472C4",
  PB: "ED7D31",
  LB: "70AD47",
  BB: "FF0000",
  VKP: "7030A0",
  QK: "00B0F0",
  QC: "1F7A3C",
  LD: "2E75B6",
  MQ: "C55A11",
  KQ: "833C00",
  HD: "BF9000",
  WELDOM: "BF9000",
  SIT: "538135",
  SITEC: "538135",
  RESEAU: "FFD966",
};

class FilialesService {
  constructor() {
    this.cache = new Map(); // reseau -> { data, builtAt }
    this.cacheTTL = 10 * 60 * 1000;
    this.locks = new Map();
    this.progress = new Map(); // reseau -> { phase, pct, message, done, error }
  }

  // --- Helpers ---------------------------------------------------------------

  safeTrim(v) {
    if (v === null || v === undefined) return "";
    return String(v).trim();
  }

  num(v) {
    if (v === null || v === undefined || v === "") return 0;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  venteAn(a) {
    let s = 0;
    for (let i = 1; i <= 12; i += 1) s += this.num(a[`V${i}`]);
    return s;
  }

  stockTotal(a) {
    return (
      this.num(a.S1) + this.num(a.S2) + this.num(a.S3) + this.num(a.S4) + this.num(a.S5)
    );
  }

  // clé de matching filiale -> NART mère
  matchKey(a) {
    const desig2 = this.safeTrim(a.DESIGN2);
    if (desig2) return desig2.split(/\s*-\s*/)[0].trim();
    return this.safeTrim(a.REFER);
  }

  label(code) {
    return LABELS[code] || code;
  }

  yieldLoop() {
    return new Promise((resolve) => setImmediate(resolve));
  }

  setProgress(key, phase, pct, message, extra = {}) {
    this.progress.set(key, {
      phase,
      pct: Math.round(pct),
      message,
      done: false,
      error: false,
      updatedAt: Date.now(),
      ...extra,
    });
  }

  getProgress(key) {
    return (
      this.progress.get(key) || {
        phase: "idle",
        pct: 0,
        message: "",
        done: false,
        error: false,
      }
    );
  }

  getReseaux() {
    return Object.entries(RESEAUX).map(([code, def]) => ({
      code,
      mere: def.mere,
      filiales: def.filiales.map((f) => ({
        code: f,
        label: this.label(f),
        color: ENTITY_COLORS[this.label(f)] || ENTITY_COLORS[f] || "70AD47",
      })),
    }));
  }

  // --- Extraction d'une entité (mère ou filiale) -----------------------------

  async extractEntity(entreprise, mereTrigramme, isMere) {
    const [artCache, fourCache] = await Promise.all([
      articleService.getArticles(entreprise),
      fournissCacheService.getFournisseurs(entreprise),
    ]);

    // Map FOURN -> fournisseur (pour NOM + AD1)
    const fournByCode = new Map();
    (fourCache.records || []).forEach((r) => {
      if (r.FOURN !== undefined && r.FOURN !== null) {
        fournByCode.set(String(r.FOURN).trim(), r);
      }
    });

    const mereUpper = mereTrigramme.toUpperCase();
    const rows = [];

    (artCache.records || []).forEach((a) => {
      const fourn =
        a.FOURN !== undefined && a.FOURN !== null
          ? fournByCode.get(String(a.FOURN).trim())
          : null;
      const ad1 = fourn ? this.safeTrim(fourn.AD1).toUpperCase() : "";

      // Filiale : ne garder que les articles du réseau (AD1 == trigramme mère)
      if (!isMere && ad1 !== mereUpper) return;

      const vteAn = this.venteAn(a);
      const pvte = this.num(a.PVTE);

      rows.push({
        NART: this.safeTrim(a.NART),
        DESIGN: this.safeTrim(a.DESIGN),
        DESIGN2: this.safeTrim(a.DESIGN2),
        REFER: this.safeTrim(a.REFER),
        NOM_FOUR: fourn ? this.safeTrim(fourn.NOM) : "",
        EMPLACE: this.safeTrim(a.EMPLACE),
        STOCK: this.stockTotal(a),
        PVTE: pvte,
        VTE_AN: vteAn,
        CA_AN: pvte * vteAn,
      });
    });

    return rows;
  }

  // --- Construction de la consolidation d'un réseau --------------------------

  async buildReseau(reseauCode) {
    const def = RESEAUX[reseauCode];
    if (!def) throw new Error(`Réseau inconnu : ${reseauCode}`);

    const key = reseauCode;
    const mereTri = def.mere;

    // Résolution trigramme/dossier -> entreprise
    this.setProgress(key, "init", 3, "Recherche des entreprises…");
    const entreprises = await Entreprise.find({});
    const byTri = new Map();
    const byDossier = new Map();
    entreprises.forEach((e) => {
      if (e.trigramme) byTri.set(String(e.trigramme).toUpperCase(), e);
      if (e.nomDossierDBF) {
        byDossier.set(String(e.nomDossierDBF).toLowerCase(), e);
      }
    });

    // Trouve l'entreprise d'un code réseau : d'abord par dossier DBF (fiable),
    // sinon par trigramme (repli).
    const resolveEntity = (code) => {
      const dossier = CODE_TO_DOSSIER[code];
      if (dossier && byDossier.has(dossier.toLowerCase())) {
        return byDossier.get(dossier.toLowerCase());
      }
      return byTri.get(code.toUpperCase()) || null;
    };

    const totalEntites = 1 + def.filiales.length;
    let done = 0;
    const stepPct = () => 5 + (done / totalEntites) * 70;
    const warnings = [];

    // Mère
    const mereEnt = resolveEntity(mereTri);
    if (!mereEnt) {
      throw new Error(
        `Maison-mère "${mereTri}" introuvable (ni dossier "${
          CODE_TO_DOSSIER[mereTri] || "?"
        }" ni trigramme ${mereTri}).`,
      );
    }
    this.setProgress(key, "mere", stepPct(), `Extraction maison-mère ${mereTri}…`);
    let mereRows;
    try {
      mereRows = await this.extractEntity(mereEnt, mereTri, true);
    } catch (err) {
      throw new Error(
        `Lecture des données de la maison-mère ${mereTri} impossible : ${err.message}`,
      );
    }
    done += 1;
    await this.yieldLoop();

    // Filiales
    const filialesData = []; // { code, label, color, rows, present, error }
    for (let i = 0; i < def.filiales.length; i += 1) {
      const code = def.filiales[i];
      const lbl = this.label(code);
      this.setProgress(
        key,
        "filiale",
        stepPct(),
        `Extraction filiale ${lbl}…`,
      );
      const ent = resolveEntity(code);
      let rows = [];
      let filError = null;
      if (ent) {
        try {
          // eslint-disable-next-line no-await-in-loop
          rows = await this.extractEntity(ent, mereTri, false);
        } catch (err) {
          filError = err.message;
          warnings.push(`Filiale ${lbl} ignorée (lecture DBF) : ${err.message}`);
        }
      } else {
        warnings.push(`Filiale ${lbl} absente (aucune entreprise ${code}).`);
      }
      filialesData.push({
        code,
        label: lbl,
        color: ENTITY_COLORS[lbl] || ENTITY_COLORS[code] || "70AD47",
        present: Boolean(ent) && !filError,
        error: filError,
        rows,
      });
      done += 1;
      // eslint-disable-next-line no-await-in-loop
      await this.yieldLoop();
    }

    // Consolidation
    this.setProgress(key, "conso", 80, "Consolidation par article…");

    // Index filiale : clé de matching -> agrégat (somme si plusieurs articles)
    const filialeIndex = filialesData.map((fil) => {
      const map = new Map();
      fil.rows.forEach((r) => {
        const k = this.matchKey(r);
        if (!k) return;
        if (!map.has(k)) {
          map.set(k, {
            NART: r.NART,
            STOCK: r.STOCK,
            PVTE: r.PVTE,
            VTE_AN: r.VTE_AN,
            CA_AN: r.CA_AN,
          });
        } else {
          const agg = map.get(k);
          agg.STOCK += r.STOCK;
          agg.VTE_AN += r.VTE_AN;
          agg.CA_AN += r.CA_AN;
          // PVTE / NART : on garde le premier
        }
      });
      return { ...fil, index: map };
    });

    const rows = mereRows.map((m) => {
      const filialesCells = {};
      let vteFiliales = 0;
      let presentDansReseau = false;

      filialeIndex.forEach((fil) => {
        const match = fil.index.get(m.NART);
        if (match) {
          presentDansReseau = true;
          vteFiliales += match.VTE_AN;
          filialesCells[fil.code] = {
            NART: match.NART,
            STOCK: match.STOCK,
            PVTE: match.PVTE,
            VTE_AN: match.VTE_AN,
            CA_AN: match.CA_AN,
          };
        } else {
          filialesCells[fil.code] = null;
        }
      });

      const vteMere = m.VTE_AN;
      const vteHorsReseau = vteMere - vteFiliales;
      const pctReseau = vteMere !== 0 ? vteFiliales / vteMere : null;

      return {
        gisement: m.EMPLACE,
        nart: m.NART,
        design: m.DESIGN,
        nomFour: m.NOM_FOUR,
        stock: m.STOCK,
        pvte: m.PVTE,
        vteAn: vteMere,
        caAn: m.CA_AN,
        vteHorsReseau,
        pctReseau,
        filtre: presentDansReseau ? "O" : "N",
        filiales: filialesCells,
      };
    });

    this.setProgress(key, "finalize", 95, "Finalisation…");

    // Totaux
    const totaux = {
      nbArticles: rows.length,
      nbDansReseau: rows.filter((r) => r.filtre === "O").length,
      caMere: rows.reduce((s, r) => s + r.caAn, 0),
      vteMere: rows.reduce((s, r) => s + r.vteAn, 0),
      vteHorsReseau: rows.reduce((s, r) => s + r.vteHorsReseau, 0),
    };

    return {
      reseau: reseauCode,
      mere: mereTri,
      mereColor: ENTITY_COLORS[mereTri] || "4472C4",
      reseauColor: ENTITY_COLORS.RESEAU,
      filiales: filialesData.map((f) => ({
        code: f.code,
        label: f.label,
        color: f.color,
        present: f.present,
        error: f.error || null,
      })),
      warnings,
      totaux,
      generatedAt: new Date().toISOString(),
      rows,
    };
  }

  // --- Cache -----------------------------------------------------------------

  async getReseau(reseauCode) {
    const cached = this.cache.get(reseauCode);
    if (cached && Date.now() - cached.builtAt < this.cacheTTL) {
      return cached.data;
    }
    if (this.locks.has(reseauCode)) return this.locks.get(reseauCode);

    const promise = (async () => {
      try {
        const data = await this.buildReseau(reseauCode);
        this.cache.set(reseauCode, { data, builtAt: Date.now() });
        this.setProgress(reseauCode, "done", 100, "Terminé", { done: true });
        this.locks.delete(reseauCode);
        return data;
      } catch (err) {
        this.setProgress(reseauCode, "error", 100, err.message || "Erreur", {
          error: true,
          done: true,
        });
        this.locks.delete(reseauCode);
        throw err;
      }
    })();
    this.locks.set(reseauCode, promise);
    return promise;
  }

  invalidate(reseauCode) {
    if (reseauCode) this.cache.delete(reseauCode);
    else this.cache.clear();
  }
}

const filialesService = new FilialesService();
export default filialesService;