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
// RAPPROCHEMENT (revu le 11/09/2026) — voir docs/ANALYSE_FILIALES_matching.pdf
//
// Auparavant : une clé unique (1ʳᵉ partie de DESIGN2 avant " - ", sinon REFER),
// comparée au NART de la mère ; et un filtre préalable écartant tout article de
// filiale dont le fournisseur n'avait pas AD1 == trigramme de la mère.
// Mesuré : ce filtre écartait ~70 % des articles (AD1 est un champ d'ADRESSE
// détourné, vide ou rempli d'une vraie adresse dans 7 cas sur 10), et le repli
// sur REFER n'était jamais atteint dès que DESIGN2 contenait quoi que ce soit.
//
// Désormais :
//   · le filtre AD1 n'est plus un VERROU mais un simple INDICATEUR (`reseau`) ;
//   · chaque article de filiale est indexé sous PLUSIEURS clés candidates,
//     essayées par ordre de confiance (voir matchKeys) ;
//   · les zéros de tête des codes sont neutralisés en repli ;
//   · un article de filiale ne peut servir qu'UNE SEULE ligne mère, mais une
//     ligne mère peut agréger plusieurs articles de filiale.
//
// Réseaux figés (comme le script) : DQ, QC, LD. Entités = entreprise.trigramme.
// -----------------------------------------------------------------------------

import Entreprise from "../models/EntrepriseModel.js";
import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";
// Le code-barres est le SEUL identifiant réellement commun entre sociétés :
// c'est le même produit physique. L'utilitaire gère les écritures multiples
// d'un même code (UPC-A 12 chiffres / EAN-13 avec zéro de tête).
import { canoniserCodeBarres, variantesCodeBarres } from "../utils/codeBarres.js";

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

  /**
   * Normalise une clé de rapprochement : majuscules, espaces intérieurs
   * réduits. Sans ça « 12345 » et « 12345 » (double espace, fréquent en DBF)
   * ne se rejoignent pas.
   */
  normKey(v) {
    return this.safeTrim(v).toUpperCase().replace(/\s+/g, " ");
  }

  /**
   * Forme « sans zéros de tête » d'un code purement numérique.
   * ⚠️ Le NART est un C(6) et l'ERP mélange « 12345 » et « 012345 » : sans ce
   * repli, les deux ne se rejoignent jamais. N'est appliqué qu'aux codes
   * NUMÉRIQUES — dépouiller « 0RING » de son zéro n'aurait aucun sens.
   */
  normNum(v) {
    const k = this.normKey(v);
    return /^\d+$/.test(k) ? k.replace(/^0+/, "") || "0" : null;
  }

  /**
   * Clés candidates d'un article de filiale, par ordre de CONFIANCE
   * décroissante. Le rang sert à départager quand plusieurs candidats
   * rejoignent des articles mère différents.
   *
   *   1. DESIGN2 tronqué au premier séparateur — la règle historique ;
   *   2. DESIGN2 entier — 3 520 valeurs sur 4 357 n'ont AUCUN séparateur,
   *      la troncature n'y change rien mais le champ reste exploitable ;
   *   3. REFER — le code fournisseur, souvent le vrai code à six chiffres ;
   *      il était purement ignoré dès que DESIGN2 était rempli ;
   *   4. NART de la filiale — les sociétés partagent le même ERP, le code est
   *      fréquemment identique d'une société à l'autre.
   *
   * Le séparateur accepte le tiret, la barre oblique, le tiret bas et les
   * tirets longs : le DBF n'est pas régulier sur ce point.
   */
  matchKeys(a) {
    const out = [];
    const vus = new Set();
    // Le rang est SÉMANTIQUE (lié à la source du code), pas positionnel : la
    // priorité doit vouloir dire la même chose d'une ligne à l'autre.
    const pousse = (v, rang) => {
      const k = this.normKey(v);
      if (!k || vus.has(k)) return;
      vus.add(k);
      out.push({ k, rang });
    };

    // ⚠⚠ LE NART N'EST PAS UNE CLÉ DE RAPPROCHEMENT. C'est une référence
    // INTERNE à chaque société : le même code désigne des produits différents
    // d'une entité à l'autre. Mesuré le 11/09/2026 sur les bases réelles :
    // QC et MQ partagent 16 569 NART, dont 3,7 % seulement désignent le même
    // produit ; QC et KQ, 27 033 NART pour 2,8 %. Rapprocher là-dessus
    // fabriquerait des dizaines de milliers de faux appariements.
    //
    // Ce qui est légitime, et pourquoi :
    //   · REFER / DESIGN2 d'un article ACHETÉ À LA MÈRE : la mère étant le
    //     fournisseur, la filiale y a enregistré le code article de la mère.
    //     C'est tout le sens du marqueur réseau (AD1) — il désigne justement
    //     ces articles-là ;
    //   · le CODE-BARRES : seul identifiant universel, c'est le même produit
    //     physique quelle que soit la société. Traité séparément (rang 3).
    if (a.RESEAU) {
      const d2 = this.safeTrim(a.DESIGN2);
      if (d2) {
        pousse(d2.split(/\s*[-–—/_]\s*/)[0], 0); // DESIGN2 tronqué
        pousse(d2, 1);                             // DESIGN2 entier
      }
      pousse(a.REFER, 2);
    }
    // ⚠️ Hors réseau, REFER est la référence d'un AUTRE fournisseur : elle n'a
    // aucune raison de valoir le NART de la mère. Essayée un temps en dernier
    // recours, elle a été MESURÉE le 11/09/2026 sur qc→meare : 4 103
    // rapprochements pour 1,5 % de justes — « PONCEUSE EXCENTRIQUE » rapprochée
    // d'une « BÉTONNIÈRE ». Du bruit pur, écarté.
    // Hors réseau, seul le code-barres fait foi (rang 3, ajouté à l'index).
    return out;
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

      // ⚠️ AD1 n'écarte PLUS l'article. Ce champ est l'adresse ligne 1 du
      // fournisseur, détourné pour marquer l'appartenance réseau : il est vide
      // ou contient une vraie adresse pour ~70 % des articles. L'utiliser comme
      // verrou revenait à jeter les sept dixièmes du catalogue avant même de
      // tenter le moindre rapprochement. Il devient un simple indicateur.
      const estReseau = ad1 === mereUpper;

      const vteAn = this.venteAn(a);
      const pvte = this.num(a.PVTE);

      rows.push({
        NART: this.safeTrim(a.NART),
        GENCOD: this.safeTrim(a.GENCOD),
        DESIGN: this.safeTrim(a.DESIGN),
        DESIGN2: this.safeTrim(a.DESIGN2),
        REFER: this.safeTrim(a.REFER),
        NOM_FOUR: fourn ? this.safeTrim(fourn.NOM) : "",
        EMPLACE: this.safeTrim(a.EMPLACE),
        STOCK: this.stockTotal(a),
        PVTE: pvte,
        VTE_AN: vteAn,
        CA_AN: pvte * vteAn,
        RESEAU: estReseau,
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

    // Index filiale : clé candidate -> [{ i, rang }] où `i` pointe la ligne.
    // On n'agrège PLUS à l'indexation : il faut pouvoir choisir, puis marquer
    // l'article comme consommé, pour qu'il ne serve pas deux lignes mère.
    const filialeIndex = filialesData.map((fil) => {
      const exact = new Map();
      const numerique = new Map();
      let sansCle = 0;

      const ajouter = (map, k, i, rang) => {
        if (!k) return;
        if (!map.has(k)) map.set(k, []);
        map.get(k).push({ i, rang });
      };

      fil.rows.forEach((r, i) => {
        const cles = this.matchKeys(r);
        if (cles.length === 0) {
          sansCle += 1;
          return;
        }
        cles.forEach(({ k, rang }) => {
          ajouter(exact, k, i, rang);
          const n = this.normNum(k);
          // L'index « sans zéros » ne sert qu'en REPLI : on le range à part
          // pour que la forme exacte reste toujours prioritaire.
          if (n && n !== k) ajouter(numerique, n, i, rang);
        });
      });

      // Index CODE-BARRES : un même produit physique porte le même gencod d'une
      // société à l'autre, même quand les codes internes divergent. C'est le
      // rapprochement le plus fiable, mais il n'est tenté QU'EN DERNIER —
      // les codes internes, quand ils concordent, sont plus spécifiques.
      // Toutes les écritures équivalentes du code sont indexées (un UPC-A de
      // 12 chiffres et son EAN-13 à zéro de tête sont le même code).
      const gencod = new Map();
      fil.rows.forEach((r, i) => {
        if (!r.GENCOD) return;
        variantesCodeBarres(r.GENCOD).forEach((v) => {
          const c = canoniserCodeBarres(v);
          if (!c) return;
          if (!gencod.has(c)) gencod.set(c, []);
          gencod.get(c).push({ i, rang: 3 });
        });
      });

      return {
        ...fil,
        exact,
        numerique,
        gencod,
        sansCle,
        utilises: new Set(),
        nbReseau: fil.rows.filter((r) => r.RESEAU).length,
      };
    });

    const rows = mereRows.map((m) => {
      const filialesCells = {};
      let vteFiliales = 0;
      let presentDansReseau = false;

      const cleMere = this.normKey(m.NART);
      const cleMereNum = this.normNum(m.NART);

      filialeIndex.forEach((fil) => {
        // On RASSEMBLE toutes les pistes, puis le RANG tranche. Les essayer en
        // cascade ferait gagner une piste faible (le REFER d'un fournisseur
        // tiers, rang 8) sur une piste sûre (le code-barres, rang 3) au seul
        // motif qu'elle est interrogée en premier.
        const vues = new Set();
        const cands = [];
        const verser = (liste) => {
          (liste || []).forEach((e) => {
            if (vues.has(e.i)) return;
            vues.add(e.i);
            cands.push(e);
          });
        };

        verser(fil.exact.get(cleMere));
        // Forme exacte d'abord, repli « sans zéros de tête » ensuite : jamais
        // l'inverse, sinon « 012345 » et « 12345 » deviendraient équivalents
        // même quand les deux existent réellement côte à côte.
        if (cleMereNum) verser(fil.numerique.get(cleMereNum));

        if (m.GENCOD) {
          variantesCodeBarres(m.GENCOD).forEach((v) => {
            const c = canoniserCodeBarres(v);
            if (c) verser(fil.gencod.get(c));
          });
        }

        // Un article de filiale ne sert qu'UNE ligne mère. Une ligne mère peut
        // en revanche en agréger plusieurs : plusieurs références de filiale
        // pour un même article de la mère, c'est le cas normal.
        const retenus = cands.filter((c) => !fil.utilises.has(c.i));
        if (retenus.length === 0) {
          filialesCells[fil.code] = null;
          return;
        }
        // Meilleur rang = candidat le plus fiable (DESIGN2 avant REFER, etc.).
        const meilleurRang = Math.min(...retenus.map((c) => c.rang));
        const groupe = retenus.filter((c) => c.rang === meilleurRang);

        let STOCK = 0;
        let VTE_AN = 0;
        let CA_AN = 0;
        let NART = "";
        let PVTE = 0;
        let reseau = false;
        groupe.forEach((c, k) => {
          const r = fil.rows[c.i];
          fil.utilises.add(c.i);
          STOCK += r.STOCK;
          VTE_AN += r.VTE_AN;
          CA_AN += r.CA_AN;
          if (r.RESEAU) reseau = true;
          if (k === 0) {
            NART = r.NART;
            PVTE = r.PVTE;
          }
        });

        presentDansReseau = true;
        vteFiliales += VTE_AN;
        filialesCells[fil.code] = {
          NART,
          STOCK,
          PVTE,
          VTE_AN,
          CA_AN,
          reseau,
          rang: meilleurRang,
        };
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

    // Diagnostic par filiale : sans lui, un rapprochement qui échoue reste
    // invisible et passe pour un oubli. On compte ce qui est entré, ce qui a
    // servi, et ce qui n'a jamais trouvé preneur.
    const diagnostic = filialeIndex.map((fil) => ({
      code: fil.code,
      label: fil.label,
      articles: fil.rows.length,
      marquesReseau: fil.nbReseau,
      sansCle: fil.sansCle,
      rapproches: fil.utilises.size,
      orphelins: fil.rows.length - fil.utilises.size,
    }));

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
      // Diagnostic du rapprochement, par filiale : combien d'articles sont
      // entrés, combien ont trouvé leur ligne mère, combien sont restés
      // orphelins. C'est ce qui manquait pour comprendre les "articles non
      // pris en compte".
      diagnostic,
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