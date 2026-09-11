// filialesService.js
// -----------------------------------------------------------------------------
// Analyse Filiales — consolidation maison-mère / filiales par réseau.
//
// ⚠️ PORTAGE FIDÈLE du script Python de référence (`analyse_filiale/main.py`,
// documenté dans son `ALGORITHME.md`). Ce script produit les fichiers Excel qui
// font foi : toute divergence ici est un bug, pas une amélioration. Avant de
// modifier `consolidate()`, relire la doc du script.
//
// Mapping SQLite (script) -> DBF (cette application) :
//   numero_article          -> NART
//   designation             -> DESIGN
//   reference_fournisseur   -> REFER
//   designation_fournisseur -> DESIFRN     (⚠️ PAS `DESIGN2` : ce champ
//                                          n'existe PAS chez MQ, KQ ni SIT,
//                                          et il est vide chez HD et DQ —
//                                          le prendre revient à désactiver
//                                          la règle de clé ci-dessous.)
//   prix_vente_ht           -> PVTE
//   stock                   -> STOCK        (le champ STOCK, PAS la somme S1..S5)
//   en_commande             -> ENCDE
//   ean13                   -> GENCOD
//   ean_renvoi              -> GENDOUBL     (contient un NUMÉRO D'ARTICLE)
//   gisement_1              -> GISM1
//   ventes_m0..m11          -> V1..V12
//   fournisseurs.nom        -> fourniss.NOM   (jointure par FOURN)
//   fournisseurs.adresse_1  -> fourniss.AD1   (= trigramme de la mère)
//
// LE RAPPROCHEMENT SE FAIT EN TROIS PASSES, chacune ne comblant que ce que la
// précédente a laissé vide — un rapprochement acquis n'est jamais écrasé :
//   1. NART         : la filiale porte la référence de la mère dans DESIFRN,
//                     sous la forme « 110002 - LIBELLE ». Clé = partie avant le
//                     premier « - » ; si DESIFRN est vide, repli sur REFER.
//                     ⚠️ Repli EXCLUSIF, comme le script : DESIFRN rempli mais
//                     non concluant n'essaie PAS REFER. C'est ce qui écarte
//                     SITEC 400045 (DESIFRN « PISTOLET TYPE SQUELETTE PRO »,
//                     REFER « 111499 ») : le libellé fournisseur fait foi.
//   2. GENCODE      : EAN-13 strict, dans le périmètre réseau de la filiale.
//   3. GENCODE-HORS : même clé, sur tout l'assortiment de la filiale. C'est la
//                     passe la plus productive.
//
// ⚠️ NE JAMAIS RELÂCHER LE FILTRE EAN-13. Le champ contient « xxx », « * »,
// « SLN » et de la notation scientifique : un filtre plus permissif produit des
// milliers de faux rapprochements.
//
// ⚠️ LE NART N'EST PAS UNE CLÉ DE RAPPROCHEMENT. C'est une référence interne à
// chaque société : mesuré le 11/09/2026, QC et MQ partagent 16 569 NART dont
// 3,7 % seulement désignent le même produit.
// -----------------------------------------------------------------------------

import Entreprise from "../models/EntrepriseModel.js";
import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";

// Définition des 3 réseaux (mère + filiales) — identique au CONFIG du script.
const RESEAUX = {
  DQ: { mere: "DQ", filiales: ["PB", "LB", "BB", "VKP", "QK"] },
  QC: { mere: "QC", filiales: ["MQ", "KQ", "HD", "SIT"] },
  LD: {
    mere: "LD",
    filiales: ["DQ", "PB", "LB", "BB", "VKP", "QK", "QC", "MQ", "KQ", "HD", "SIT"],
  },
};

// Libellés d'affichage différents du code (CONFIG["filiales_labels"]).
const LABELS = { SIT: "SITEC", HD: "WELDOM" };

// Résolution des codes réseau vers le nomDossierDBF réel (repris de config.py).
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

// Couleurs par entité — ENTITY_COLORS du script, à l'identique.
export const ENTITY_COLORS = {
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
  SITEC: "538135",
  AW: "FF69B4",
  AVB: "8B4513",
  FMB: "20B2AA",
  RESEAU: "FFD966",
};

// Colonnes reprises d'une filiale, dans l'ordre (FIL_COLS du script).
const FIL_COLS = ["NART", "STOCK", "PVTE", "VTE_AN", "CA_AN", "EN_COMMANDE"];

// EAN-13 strict : treize chiffres, rien d'autre.
const RE_GENCODE_VALIDE = /^[0-9]{13}$/;
const MAX_PROFONDEUR_RENVOI = 5;

class FilialesService {
  constructor() {
    this.cache = new Map(); // reseau -> { data, builtAt }
    this.cacheTTL = 10 * 60 * 1000;
    this.locks = new Map();
    this.progress = new Map();
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

  /** Ne garde que les EAN-13 stricts ; toute autre valeur devient "". */
  normalizeGencode(v) {
    const s = this.safeTrim(v);
    return RE_GENCODE_VALIDE.test(s) ? s : "";
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

  // --- Renvois ---------------------------------------------------------------

  /**
   * Résout les renvois d'une entité (resolve_renvois du script).
   *
   * GENDOUBL porte, malgré son nom, un NUMÉRO D'ARTICLE et non un code-barres :
   * c'est la fiche active vers laquelle l'article courant est renvoyé. La fiche
   * source est généralement morte (stock et ventes à zéro), la cible porte
   * l'activité. On résout donc les renvois AVANT de croiser.
   *
   * Pose sur chaque ligne :
   *   NART_ACTIF  : numéro de la fiche active équivalente (l'article lui-même
   *                 s'il n'est pas renvoyé, ou si la cible est introuvable) ;
   *   GENCODE_RES : gencode retenu — celui de l'article, sinon celui de sa fiche
   *                 active, sinon celui d'une source qui pointe vers lui.
   *
   * Les chaînes A -> B -> C sont suivies jusqu'à MAX_PROFONDEUR_RENVOI. Un cycle
   * ou une cible hors périmètre laisse l'article sur lui-même.
   */
  resolveRenvois(rows) {
    const aDesRenvois = rows.some((r) => r.RENVOI_VERS);
    if (!aDesRenvois) {
      rows.forEach((r) => {
        r.NART_ACTIF = r.NART;
        r.GENCODE_RES = r.GENCODE;
      });
      return;
    }

    const cible = new Map();
    const connus = new Set();
    const genParNart = new Map();
    rows.forEach((r) => {
      if (!cible.has(r.NART)) cible.set(r.NART, r.RENVOI_VERS);
      connus.add(r.NART);
      if (!genParNart.has(r.NART)) genParNart.set(r.NART, r.GENCODE);
    });

    // Seuls les articles effectivement renvoyés sont parcourus.
    const actif = new Map();
    for (const r of rows) {
      if (!r.RENVOI_VERS || actif.has(r.NART)) continue;
      const vu = new Set([r.NART]);
      let courant = cible.get(r.NART) || "";
      let dest = r.NART;
      for (let i = 0; i < MAX_PROFONDEUR_RENVOI; i += 1) {
        if (!courant || vu.has(courant) || !connus.has(courant)) break;
        dest = courant;
        vu.add(courant);
        courant = cible.get(courant) || "";
      }
      if (dest !== r.NART) actif.set(r.NART, dest);
    }

    // Gencode hérité d'une source : fiche active sans code-barres alors qu'une
    // ancienne fiche en portait un.
    const genSource = new Map();
    actif.forEach((dest, source) => {
      const g = genParNart.get(source) || "";
      if (g && !genSource.has(dest)) genSource.set(dest, g);
    });

    rows.forEach((r) => {
      r.NART_ACTIF = actif.get(r.NART) || r.NART;
      let g = r.GENCODE;
      if (!g) g = genParNart.get(r.NART_ACTIF) || "";
      if (!g) g = genSource.get(r.NART) || "";
      r.GENCODE_RES = g;
    });
  }

  // --- Extraction d'une entité ----------------------------------------------

  /**
   * Extrait les articles d'une entité (extract_entity du script).
   *
   * @param {boolean} isMere            maison-mère : aucun filtre, + GISEMENT.
   * @param {string}  mereTrigramme     trigramme de la mère (filtre réseau).
   * @param {boolean} perimetreReseau   filiale : ne garder que les articles
   *        achetés à la centrale (fourniss.AD1 == trigramme mère). À false, on
   *        ramène tout l'assortiment, pour le rattrapage GENCODE-HORS.
   */
  async extractEntity(entreprise, mereTrigramme, isMere, perimetreReseau = true) {
    const [artCache, fourCache] = await Promise.all([
      articleService.getArticles(entreprise),
      fournissCacheService.getFournisseurs(entreprise),
    ]);

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

      // Périmètre réseau = INNER JOIN + WHERE UPPER(adresse_1) = UPPER(mère).
      // Sans fournisseur, l'article ne peut pas satisfaire la jointure interne.
      if (!isMere && perimetreReseau) {
        if (!fourn) return;
        if (this.safeTrim(fourn.AD1).toUpperCase() !== mereUpper) return;
      }

      const vteAn = this.venteAn(a);
      const pvte = this.num(a.PVTE);

      rows.push({
        // GISEMENT ne concerne que la mère (gisement_1 -> GISM1).
        GISEMENT: isMere ? this.safeTrim(a.GISM1) : "",
        NART: this.safeTrim(a.NART),
        DESIGN: this.safeTrim(a.DESIGN),
        NOM_FOUR: fourn ? this.safeTrim(fourn.NOM) : "",
        // ⚠️ Le champ STOCK du DBF, pas la somme S1..S5 : c'est celui que lit le
        // script de référence (articles.stock).
        STOCK: this.num(a.STOCK),
        PVTE: pvte,
        REF_FOURN: this.safeTrim(a.REFER),
        DESIG_FOURN: this.safeTrim(a.DESIFRN),
        EN_COMMANDE: this.num(a.ENCDE),
        GENCODE: this.normalizeGencode(a.GENCOD),
        RENVOI_VERS: this.safeTrim(a.GENDOUBL),
        VTE_AN: vteAn,
        CA_AN: pvte * vteAn,
      });
    });

    this.resolveRenvois(rows);
    return rows;
  }

  // --- Index gencode d'une filiale ------------------------------------------

  /**
   * Index de croisement d'une filiale : un gencode -> les données à afficher
   * (_index_gencode du script).
   *
   * Les fiches renvoyées sont redirigées vers leur fiche active (celle qui porte
   * le stock et les ventes) ; si la cible est hors du périmètre extrait, la
   * fiche d'origine est conservée. Un gencode présent plusieurs fois n'est
   * retenu qu'une fois, pour ne pas dupliquer de lignes mère.
   */
  indexGencode(rowsFil) {
    const parNart = new Map();
    rowsFil.forEach((r) => {
      if (!parNart.has(r.NART)) parNart.set(r.NART, r);
    });

    const index = new Map();
    rowsFil.forEach((r) => {
      if (!r.GENCODE_RES) return;
      if (index.has(r.GENCODE_RES)) return; // premier gagnant
      const aff = parNart.get(r.NART_ACTIF) || r; // cible hors périmètre -> source
      const cellule = {};
      FIL_COLS.forEach((c) => {
        cellule[c] = aff[c];
      });
      index.set(r.GENCODE_RES, cellule);
    });
    return index;
  }

  // --- Consolidation --------------------------------------------------------

  /**
   * Clé de rapprochement NART d'un article de filiale (passe 1 du script).
   * ⚠️ Repli EXCLUSIF sur REFER : seulement si DESIFRN est VIDE.
   */
  cleNart(r) {
    const desig = r.DESIG_FOURN;
    if (desig) return desig.split(/\s*-\s*/)[0].trim();
    return r.REF_FOURN;
  }

  /**
   * Reproduit le `merge(how="left")` de pandas, y compris sa DUPLICATION : si
   * deux fiches filiale portent la même clé, la ligne mère est dupliquée. Le
   * script l'accepte (31 781 articles DQ -> 31 958 lignes) ; s'en écarter
   * donnerait un fichier différent de la référence.
   */
  jointureGauche(lignes, cleDroite, indexDroite, poser) {
    const sortie = [];
    for (const ligne of lignes) {
      const correspondances = indexDroite.get(cleDroite(ligne));
      if (!correspondances || correspondances.length === 0) {
        sortie.push(ligne);
        continue;
      }
      correspondances.forEach((droite, i) => {
        const copie = i === 0 ? ligne : { ...ligne };
        poser(copie, droite);
        sortie.push(copie);
      });
    }
    return sortie;
  }

  /**
   * Consolide la mère et ses filiales.
   *
   * @returns {{rows: object[], rattrapages: Record<string, number>}}
   *   `rattrapages` compte, par passe et par filiale, ce que chaque passe a
   *   comblé — ce sont exactement les compteurs que journalise le script de
   *   référence, et c'est par eux que l'on compare les deux implémentations.
   */
  consolidate(mereRows, filiales, filialesFull, mereNom) {
    const labelsFil = filiales.map((f) => this.label(f.code));

    // Colonnes mère.
    let result = mereRows.map((m) => ({
      GISEMENT: m.GISEMENT,
      nart: m.NART,
      design: m.DESIGN,
      nomFour: m.NOM_FOUR,
      stock: m.STOCK,
      pvte: m.PVTE,
      vteAn: m.VTE_AN,
      caAn: m.CA_AN,
      // Clé de croisement gencode de la mère. Les fiches mère renvoyées sont
      // EXCLUES : leur fiche active figure dans le même rapport et porte déjà le
      // rapprochement — l'y attacher aussi créerait un doublon aux ventes nulles.
      _gencode: m.NART_ACTIF === m.NART ? m.GENCODE_RES : "",
      filiales: {},
      origines: { NART: false, GENCODE: false, "GENCODE-HORS": false },
    }));

    // ---- PASSE 1 : NART ----------------------------------------------------
    filiales.forEach((fil) => {
      const lbl = this.label(fil.code);
      if (!fil.rows.length) return;

      const parCle = new Map();
      fil.rows.forEach((r) => {
        const k = this.cleNart(r);
        if (!k) return;
        if (!parCle.has(k)) parCle.set(k, []);
        parCle.get(k).push(r);
      });

      result = this.jointureGauche(
        result,
        (ligne) => ligne.nart,
        parCle,
        (ligne, r) => {
          const cellule = {};
          FIL_COLS.forEach((c) => {
            cellule[c] = r[c];
          });
          ligne.filiales = { ...ligne.filiales, [lbl]: cellule };
          ligne.origines = { ...ligne.origines, NART: true };
        },
      );
    });

    // ---- PASSES 2 et 3 : rattrapage par GENCODE ----------------------------
    const passes = [
      ["GENCODE", filiales],
      ["GENCODE-HORS", filialesFull],
    ];

    // Compteurs de rattrapage, par passe et par filiale : ce sont exactement
    // ceux que journalise le script de référence, ce qui permet de comparer
    // ligne à ligne les deux implémentations.
    const rattrapages = {};

    passes.forEach(([passe, source]) => {
      source.forEach((fil) => {
        const lbl = this.label(fil.code);
        if (!fil.rows || !fil.rows.length) return;
        const index = this.indexGencode(fil.rows);
        if (index.size === 0) return;

        let n = 0;
        result.forEach((ligne) => {
          // Chaque passe ne comble QUE ce que les précédentes ont laissé vide.
          if (ligne.filiales[lbl]) return;
          if (!ligne._gencode) return;
          const trouve = index.get(ligne._gencode);
          if (!trouve) return;
          ligne.filiales[lbl] = { ...trouve };
          ligne.origines[passe] = true;
          n += 1;
        });
        if (n) rattrapages[`${passe} ${lbl}`] = n;
      });
    });

    // ---- Colonnes dérivées -------------------------------------------------
    result.forEach((ligne) => {
      const presents = labelsFil.filter((lbl) => ligne.filiales[lbl]);
      ligne.filtre = presents.length > 0 ? "O" : "N";

      // ORIGINE : concaténation des passes ayant abouti, dans l'ordre de
      // priorité, séparées par « + ».
      ligne.origine = ["NART", "GENCODE", "GENCODE-HORS"]
        .filter((p) => ligne.origines[p])
        .join("+");
      delete ligne.origines;

      const vteFiliales = presents.reduce(
        (s, lbl) => s + this.num(ligne.filiales[lbl].VTE_AN),
        0,
      );
      ligne.vteHorsReseau = ligne.vteAn - vteFiliales;
      ligne.pctReseau =
        ligne.vteAn !== 0
          ? (ligne.vteAn - ligne.vteHorsReseau) / ligne.vteAn
          : null;

      // Cellules vides explicites, pour que le front et l'export voient la
      // même grille que le script.
      labelsFil.forEach((lbl) => {
        if (!ligne.filiales[lbl]) ligne.filiales[lbl] = null;
      });
      delete ligne._gencode;
    });

    return { rows: result, rattrapages };
  }

  // --- Construction d'un réseau ---------------------------------------------

  async buildReseau(reseauCode) {
    const def = RESEAUX[reseauCode];
    if (!def) throw new Error(`Réseau inconnu : ${reseauCode}`);

    const key = reseauCode;
    const mereTri = def.mere;

    this.setProgress(key, "init", 3, "Recherche des entreprises…");
    const entreprises = await Entreprise.find({});
    const byTri = new Map();
    const byDossier = new Map();
    entreprises.forEach((e) => {
      if (e.trigramme) byTri.set(String(e.trigramme).toUpperCase(), e);
      if (e.nomDossierDBF) byDossier.set(String(e.nomDossierDBF).toLowerCase(), e);
    });

    const resolveEntity = (code) => {
      const dossier = CODE_TO_DOSSIER[code];
      if (dossier && byDossier.has(dossier.toLowerCase())) {
        return byDossier.get(dossier.toLowerCase());
      }
      return byTri.get(code.toUpperCase()) || null;
    };

    // Chaque filiale est lue DEUX fois : périmètre réseau (passes 1 et 2) et
    // assortiment complet (passe 3). Le cache article rend la seconde lecture
    // quasi gratuite.
    const totalEtapes = 1 + def.filiales.length * 2;
    let done = 0;
    const stepPct = () => 5 + (done / totalEtapes) * 70;
    const warnings = [];

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

    const filiales = [];
    const filialesFull = [];

    for (let i = 0; i < def.filiales.length; i += 1) {
      const code = def.filiales[i];
      const lbl = this.label(code);
      const ent = resolveEntity(code);

      let rows = [];
      let rowsFull = [];
      let filError = null;

      if (ent) {
        this.setProgress(key, "filiale", stepPct(), `Extraction filiale ${lbl}…`);
        try {
          // eslint-disable-next-line no-await-in-loop
          rows = await this.extractEntity(ent, mereTri, false, true);
          done += 1;
          this.setProgress(
            key,
            "filiale",
            stepPct(),
            `Assortiment complet ${lbl}…`,
          );
          // eslint-disable-next-line no-await-in-loop
          rowsFull = await this.extractEntity(ent, mereTri, false, false);
          done += 1;
        } catch (err) {
          filError = err.message;
          warnings.push(`Filiale ${lbl} ignorée (lecture DBF) : ${err.message}`);
          done += 2;
        }
      } else {
        warnings.push(`Filiale ${lbl} absente (aucune entreprise ${code}).`);
        done += 2;
      }

      const meta = {
        code,
        label: lbl,
        color: ENTITY_COLORS[lbl] || ENTITY_COLORS[code] || "70AD47",
        present: Boolean(ent) && !filError,
        error: filError,
      };
      filiales.push({ ...meta, rows });
      filialesFull.push({ ...meta, rows: rowsFull });

      // eslint-disable-next-line no-await-in-loop
      await this.yieldLoop();
    }

    this.setProgress(key, "conso", 80, "Consolidation par article…");
    const { rows, rattrapages } = this.consolidate(
      mereRows,
      filiales,
      filialesFull,
      mereTri,
    );

    this.setProgress(key, "finalize", 95, "Finalisation…");

    // Diagnostic : ce que chaque passe a apporté, et ce qui reste de côté.
    const parOrigine = {};
    rows.forEach((r) => {
      if (!r.origine) return;
      parOrigine[r.origine] = (parOrigine[r.origine] || 0) + 1;
    });

    const diagnostic = filiales.map((fil, i) => {
      const lbl = this.label(fil.code);
      const rapproches = rows.filter((r) => r.filiales[lbl]).length;
      return {
        code: fil.code,
        label: lbl,
        articlesReseau: fil.rows.length,
        articlesTotal: filialesFull[i].rows.length,
        gencodesExploitables: filialesFull[i].rows.filter((r) => r.GENCODE_RES)
          .length,
        rapproches,
      };
    });

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
      filiales: filiales.map((f) => ({
        code: f.code,
        label: f.label,
        color: f.color,
        present: f.present,
        error: f.error || null,
      })),
      warnings,
      totaux,
      diagnostic,
      parOrigine,
      rattrapages,
      generatedAt: new Date().toISOString(),
      rows,
    };
  }

  // --- Cache ----------------------------------------------------------------

  async getReseau(reseauCode) {
    const key = reseauCode;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.builtAt < this.cacheTTL) return hit.data;

    if (this.locks.has(key)) return this.locks.get(key);

    const promesse = (async () => {
      try {
        const data = await this.buildReseau(reseauCode);
        this.cache.set(key, { data, builtAt: Date.now() });
        this.setProgress(key, "done", 100, "Terminé", { done: true });
        return data;
      } catch (err) {
        this.setProgress(key, "error", 100, err.message, {
          done: true,
          error: true,
        });
        throw err;
      } finally {
        this.locks.delete(key);
      }
    })();

    this.locks.set(key, promesse);
    return promesse;
  }

  invalidate(reseauCode) {
    if (reseauCode) this.cache.delete(reseauCode);
    else this.cache.clear();
  }
}

export const ENTITY_COLORS_EXPORT = ENTITY_COLORS;
export const FIL_COLS_EXPORT = FIL_COLS;
export default new FilialesService();
