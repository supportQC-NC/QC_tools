// backend/services/pachatHistoriqueService.js
//
// Module « Historique prix d'achat » — évolution du PACHAT d'un article par
// fournisseur, dans le temps.
//
// DEUX sources fusionnées :
//   1. DBF commandes (cmdetail + cmdref) — année EN COURS uniquement (l'ERP
//      archive/réinitialise les commandes chaque année). Lecture immédiate,
//      rétroactive sur l'année, via commandeCacheService (indexByNart O(1)).
//   2. Collection Mongo HistoriquePachat — historique PLURIANNUEL persisté par
//      historiserPachatCommandes() (à lancer périodiquement). Sans elle, on ne
//      voit que l'année courante ; avec elle, l'évolution s'étale sur les ans.
// La fusion dé-doublonne par (numcde, nl, date) — le DBF (frais) prime.
//
// ⚠️ Devise : le PACHAT d'une commande peut être en devise étrangère
// (cmdref.CDVISE) pour les fournisseurs import. On renvoie la valeur BRUTE + la
// devise sans conversion (décision produit) ; l'écran sépare visuellement.
import commandeCacheService from "./commandeService.js";
import articleCacheService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";
import HistoriquePachat from "../models/HistoriquePachatModel.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const digitsOnly = (v) => (v == null ? "" : String(v)).replace(/\D/g, "");
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Normalise une date .dbf (objet Date ou "YYYYMMDD") -> "YYYYMMDD" ("" si vide).
const toYmd = (v) => {
  if (v == null) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }
  return digitsOnly(v).slice(0, 8);
};
// "YYYYMMDD" -> Date (UTC midi pour éviter les décalages de fuseau). null sinon.
const ymdToDate = (ymd) => {
  const s = digitsOnly(ymd).slice(0, 8);
  if (s.length !== 8) return null;
  const d = new Date(
    `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T12:00:00Z`,
  );
  return Number.isNaN(d.getTime()) ? null : d;
};
const ymdToFr = (ymd) =>
  ymd && ymd.length === 8
    ? `${ymd.slice(6, 8)}/${ymd.slice(4, 6)}/${ymd.slice(0, 4)}`
    : "";

/**
 * Historique des prix d'achat d'un article (dérivé des commandes).
 * @param {Object} entreprise - document entreprise (getters cheminBase actifs)
 * @param {string} nart       - code article (NART)
 * @returns {Promise<{
 *   nart:string, article:Object|null, pachatCourant:number|null,
 *   points:Array, fournisseurs:Array, total:number
 * }>}
 */
export const getPachatHistorique = async (entreprise, nartRaw) => {
  const nart = safeTrim(nartRaw);
  const nartKey = nart.toUpperCase();
  if (!nart) {
    return { nart: "", article: null, pachatCourant: null, points: [], fournisseurs: [], total: 0 };
  }

  // Fiche article (PACHAT courant + libellés). Tolérant si introuvable.
  let article = null;
  try {
    article = await articleCacheService.findByNart(entreprise, nart);
  } catch {
    article = null;
  }

  // Lignes de commande de cet article (index O(1)).
  const detailCache = await commandeCacheService.getCmdDetail(entreprise);
  const indices = detailCache.indexByNart.get(nartKey) || [];

  // Cache local des entêtes/fournisseurs pour éviter les lookups répétés.
  const refByNumcde = new Map();
  const getRef = async (numcde) => {
    const key = safeTrim(numcde).toUpperCase();
    if (!key) return null;
    if (refByNumcde.has(key)) return refByNumcde.get(key);
    let ref = null;
    try {
      ref = await commandeCacheService.findByNumcde(entreprise, key);
    } catch {
      ref = null;
    }
    refByNumcde.set(key, ref);
    return ref;
  };

  const fournNomByCode = new Map();
  const getFournNom = async (code) => {
    if (code == null || safeTrim(code) === "") return "";
    const key = String(code);
    if (fournNomByCode.has(key)) return fournNomByCode.get(key);
    let nom = "";
    try {
      const f = await fournissCacheService.findByFourn(entreprise, code);
      nom = safeTrim(f?.NOM);
    } catch {
      nom = "";
    }
    fournNomByCode.set(key, nom);
    return nom;
  };

  const points = [];
  for (const idx of indices) {
    const line = detailCache.records[idx];
    // Prix d'achat unitaire : le champ PACHAT (coût rendu local) n'est valorisé
    // qu'après réception ; tant qu'il vaut 0, on prend MONTANT (prix unitaire
    // commandé, en devise). L'ERP répercute ensuite cette valeur sur
    // article.PACHAT (vérifié : dernier MONTANT == PACHAT courant fiche).
    const pachatRendu = num(line.PACHAT); // coût local rendu (0 si non réceptionné)
    const montant = num(line.MONTANT); // prix unitaire commandé (devise)
    const valorise = pachatRendu != null && pachatRendu !== 0;
    const prix = valorise ? pachatRendu : montant;
    if (prix == null) continue; // aucune valeur de prix : ligne ignorée
    const numcde = safeTrim(line.NUMCDE);
    const ref = await getRef(numcde);

    const dateYmd = toYmd(ref?.DATCDE);
    const fournCode = ref?.FOURN ?? article?.FOURN ?? null;
    const fournisseur = await getFournNom(fournCode);

    points.push({
      numcde,
      nl: num(line.NL),
      dateYmd,
      date: ymdToFr(dateYmd),
      fournCode: num(fournCode),
      fournisseur,
      devise: safeTrim(ref?.CDVISE) || "XPF",
      prix,
      source: valorise ? "rendu" : "commande", // rendu = PACHAT réception, commande = MONTANT
      pachatRendu,
      montant,
      qte: num(line.QTE),
      etat: num(ref?.ETAT),
      numfact: safeTrim(ref?.NUMFACT),
      arrivee: ymdToFr(toYmd(ref?.ARRIVEE)),
    });
  }

  // ── Fusion avec l'historique Mongo (années précédentes) ──
  // Dé-doublonnage par (numcde, nl, date) ; le DBF (année en cours) prime.
  const seen = new Set(
    points.map((p) => `${p.numcde}|${p.nl ?? ""}|${p.dateYmd}`),
  );
  try {
    const docs = await HistoriquePachat.find({
      entreprise: entreprise._id,
      nart: nartKey,
    }).lean();
    for (const d of docs) {
      const dateYmd = toYmd(d.dateCommande);
      const key = `${safeTrim(d.numcde)}|${d.nl ?? ""}|${dateYmd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({
        numcde: safeTrim(d.numcde),
        nl: d.nl ?? null,
        dateYmd,
        date: ymdToFr(dateYmd),
        fournCode: d.fournCode ?? null,
        fournisseur: d.fournisseur || (await getFournNom(d.fournCode)),
        devise: d.devise || "XPF",
        prix: d.prix,
        source: d.source || "commande",
        pachatRendu: d.source === "rendu" ? d.prix : 0,
        montant: d.source === "commande" ? d.prix : null,
        qte: d.qte ?? null,
        etat: d.etat ?? null,
        numfact: d.numfact || "",
        arrivee: ymdToFr(toYmd(d.arrivee)),
      });
    }
  } catch {
    /* Mongo indisponible : on reste sur les données DBF. */
  }

  // Tri chronologique (les lignes sans date passent à la fin).
  points.sort((a, b) => {
    if (!a.dateYmd && !b.dateYmd) return 0;
    if (!a.dateYmd) return 1;
    if (!b.dateYmd) return -1;
    return a.dateYmd.localeCompare(b.dateYmd);
  });

  // Synthèse par fournisseur (premier/dernier prix, min/max, variation %).
  const byFourn = new Map();
  for (const p of points) {
    const key = `${p.fournCode ?? "?"}`;
    if (!byFourn.has(key)) {
      byFourn.set(key, {
        fournCode: p.fournCode,
        fournisseur: p.fournisseur,
        devise: p.devise,
        nbCommandes: 0,
        premier: null,
        dernier: null,
        dateDernier: "",
        min: Infinity,
        max: -Infinity,
      });
    }
    const g = byFourn.get(key);
    g.nbCommandes += 1;
    if (g.premier == null) g.premier = p.prix; // points déjà triés par date
    g.dernier = p.prix;
    g.dateDernier = p.date;
    if (p.prix < g.min) g.min = p.prix;
    if (p.prix > g.max) g.max = p.prix;
  }
  const fournisseurs = [...byFourn.values()].map((g) => ({
    fournCode: g.fournCode,
    fournisseur: g.fournisseur,
    devise: g.devise,
    nbCommandes: g.nbCommandes,
    premier: g.premier,
    dernier: g.dernier,
    dateDernier: g.dateDernier,
    min: g.min === Infinity ? null : g.min,
    max: g.max === -Infinity ? null : g.max,
    variationPct:
      g.premier && g.premier !== 0
        ? Math.round(((g.dernier - g.premier) / g.premier) * 1000) / 10
        : null,
  }));
  fournisseurs.sort((a, b) => b.nbCommandes - a.nbCommandes);

  return {
    nart,
    article: article
      ? {
          nart: safeTrim(article.NART) || nart,
          design: safeTrim(article.DESIGN),
          refer: safeTrim(article.REFER),
          gencod: digitsOnly(article.GENCOD),
          gism1: safeTrim(article.GISM1),
          fournCode: num(article.FOURN),
        }
      : null,
    pachatCourant: num(article?.PACHAT),
    points,
    fournisseurs,
    total: points.length,
  };
};

// Construit une Map NUMCDE(maj) -> entête (date, fournisseur, devise, arrivée…)
// depuis cmdref.
const buildRefMap = async (entreprise) => {
  const refCache = await commandeCacheService.getCmdRef(entreprise);
  const map = new Map();
  for (const rec of refCache.records) {
    const key = safeTrim(rec.NUMCDE).toUpperCase();
    if (!key) continue;
    map.set(key, {
      dateYmd: toYmd(rec.DATCDE),
      fournCode: num(rec.FOURN),
      devise: safeTrim(rec.CDVISE) || "XPF",
      arriveeYmd: toYmd(rec.ARRIVEE),
      numfact: safeTrim(rec.NUMFACT),
      etat: num(rec.ETAT),
    });
  }
  return map;
};

// Prix d'achat unitaire d'une ligne cmdetail (cf. getPachatHistorique) :
// PACHAT rendu si valorisé (>0), sinon MONTANT commandé. null si aucun.
const ligneToPrix = (line) => {
  const pachatRendu = num(line.PACHAT);
  const montant = num(line.MONTANT);
  return pachatRendu != null && pachatRendu !== 0 ? pachatRendu : montant;
};

/**
 * Liste des fournisseurs présents dans les commandes (pour le sélecteur),
 * avec nom et nombre de commandes.
 * @returns {Promise<Array<{code:number, nom:string, nbCommandes:number}>>}
 */
export const getFournisseursCommandes = async (entreprise) => {
  const refCache = await commandeCacheService.getCmdRef(entreprise);
  const counts = new Map();
  for (const rec of refCache.records) {
    const code = num(rec.FOURN);
    if (code == null) continue;
    counts.set(code, (counts.get(code) || 0) + 1);
  }
  const out = [];
  for (const [code, nbCommandes] of counts) {
    let nom = "";
    try {
      const f = await fournissCacheService.findByFourn(entreprise, code);
      nom = safeTrim(f?.NOM);
    } catch {
      nom = "";
    }
    out.push({ code, nom, nbCommandes });
  }
  out.sort((a, b) => (a.nom || "").localeCompare(b.nom || ""));
  return out;
};

/**
 * Classement des articles par évolution du prix d'achat (hausses en premier).
 * Une passe sur cmdetail : pour chaque article, série de prix triée par date
 * de commande -> premier/dernier/variation. Optionnellement scopé à un
 * fournisseur (n'évalue alors que les commandes de ce fournisseur).
 * @param {Object} entreprise
 * @param {Object} [opts]
 * @param {number} [opts.fournCode]   - filtre fournisseur (code FOURN)
 * @param {number} [opts.limit=100]   - nb max d'articles renvoyés
 * @param {number} [opts.minCommandes=2] - nb mini de commandes pour figurer
 * @param {string} [opts.sens="hausse"] - "hausse" (desc) ou "baisse" (asc)
 * @returns {Promise<{ items:Array, total:number, fournCode:number|null }>}
 */
export const getPachatEvolutions = async (
  entreprise,
  { fournCode = null, limit = 100, minCommandes = 2, sens = "hausse" } = {},
) => {
  const fournFilter =
    fournCode == null || fournCode === "" ? null : Number(fournCode);
  const refByNumcde = await buildRefMap(entreprise);
  const detailCache = await commandeCacheService.getCmdDetail(entreprise);

  // Regroupe les lignes par NART (points { dateYmd, prix, fournCode, devise }).
  // 1) DBF (année en cours).
  const byNart = new Map();
  const seen = new Set(); // `${nart}|${numcde}|${nl}|${dateYmd}` (dé-doublonnage)
  for (const line of detailCache.records) {
    const nart = safeTrim(line.NART).toUpperCase();
    if (!nart || nart.includes("!")) continue; // exclut les lignes non-article
    const prix = ligneToPrix(line);
    if (prix == null) continue;
    const numcde = safeTrim(line.NUMCDE).toUpperCase();
    const ref = refByNumcde.get(numcde);
    const lineFourn = ref?.fournCode ?? null;
    if (fournFilter != null && lineFourn !== fournFilter) continue;
    const dateYmd = ref?.dateYmd || "";
    if (!byNart.has(nart)) byNart.set(nart, []);
    byNart.get(nart).push({
      dateYmd,
      prix,
      fournCode: lineFourn,
      devise: ref?.devise || "XPF",
    });
    seen.add(`${nart}|${numcde}|${num(line.NL) ?? ""}|${dateYmd}`);
  }

  // 2) Historique Mongo (années précédentes), dé-doublonné vs DBF.
  try {
    const q = { entreprise: entreprise._id };
    if (fournFilter != null) q.fournCode = fournFilter;
    const docs = await HistoriquePachat.find(q)
      .select("nart numcde nl dateCommande prix fournCode devise")
      .lean();
    for (const d of docs) {
      const nart = safeTrim(d.nart).toUpperCase();
      if (!nart) continue;
      const dateYmd = toYmd(d.dateCommande);
      const key = `${nart}|${safeTrim(d.numcde).toUpperCase()}|${d.nl ?? ""}|${dateYmd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!byNart.has(nart)) byNart.set(nart, []);
      byNart.get(nart).push({
        dateYmd,
        prix: d.prix,
        fournCode: d.fournCode ?? null,
        devise: d.devise || "XPF",
      });
    }
  } catch {
    /* Mongo indisponible : classement sur la seule année en cours (DBF). */
  }

  // Évolution par article.
  const items = [];
  for (const [nart, ptsRaw] of byNart) {
    // Dénoise : un NART peut avoir été RECYCLÉ (produits différents au fil du
    // temps) ou porter un prix aberrant isolé -> variations absurdes. On écarte
    // les points à plus de ×10 de la médiane (dans un sens ou l'autre) pour ne
    // comparer que des prix cohérents entre eux.
    const prixTries = ptsRaw.map((p) => p.prix).sort((a, b) => a - b);
    const med = prixTries[Math.floor(prixTries.length / 2)] || 0;
    const pts =
      med > 0
        ? ptsRaw.filter((p) => p.prix >= med / 10 && p.prix <= med * 10)
        : ptsRaw;
    const pointsIgnores = ptsRaw.length - pts.length;
    if (pts.length < minCommandes) continue;
    pts.sort((a, b) => {
      if (!a.dateYmd && !b.dateYmd) return 0;
      if (!a.dateYmd) return 1;
      if (!b.dateYmd) return -1;
      return a.dateYmd.localeCompare(b.dateYmd);
    });
    const premier = pts[0].prix;
    const last = pts[pts.length - 1];
    const dernier = last.prix;
    let min = Infinity;
    let max = -Infinity;
    for (const p of pts) {
      if (p.prix < min) min = p.prix;
      if (p.prix > max) max = p.prix;
    }
    const variationPct =
      premier && premier !== 0
        ? Math.round(((dernier - premier) / premier) * 1000) / 10
        : null;
    items.push({
      nart,
      nbCommandes: pts.length,
      pointsIgnores,
      premier,
      dernier,
      variationPct,
      variationAbs: Math.round((dernier - premier) * 100) / 100,
      min,
      max,
      devise: last.devise,
      fournCode: last.fournCode,
      datePremier: ymdToFr(pts[0].dateYmd),
      dateDernier: ymdToFr(last.dateYmd),
    });
  }

  // Tri : hausses (variation desc) ou baisses (variation asc). Les variations
  // nulles (prix de base 0) passent à la fin.
  const dir = sens === "baisse" ? 1 : -1;
  items.sort((a, b) => {
    const av = a.variationPct;
    const bv = b.variationPct;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * dir;
  });

  const total = items.length;
  const top = items.slice(0, limit);

  // Enrichit uniquement le haut du classement (design + nom fournisseur).
  const fournNomByCode = new Map();
  const getFournNom = async (code) => {
    if (code == null) return "";
    if (fournNomByCode.has(code)) return fournNomByCode.get(code);
    let nom = "";
    try {
      const f = await fournissCacheService.findByFourn(entreprise, code);
      nom = safeTrim(f?.NOM);
    } catch {
      nom = "";
    }
    fournNomByCode.set(code, nom);
    return nom;
  };
  for (const it of top) {
    let design = "";
    try {
      const a = await articleCacheService.findByNart(entreprise, it.nart);
      design = safeTrim(a?.DESIGN);
    } catch {
      design = "";
    }
    it.design = design;
    it.fournisseur = await getFournNom(it.fournCode);
  }

  return { items: top, total, fournCode: fournFilter };
};

/**
 * Historise dans Mongo (HistoriquePachat) toutes les lignes de commande
 * courantes d'une société. Idempotent : upsert par (numcde, nl, nart, date) ;
 * un 2e passage n'ajoute que le nouveau et met à jour le prix d'une ligne
 * re-lue (ex. PACHAT valorisé après réception). À lancer périodiquement AVANT
 * l'archivage annuel de l'ERP pour conserver l'historique pluriannuel.
 * @returns {Promise<{ scanned:number, inserted:number, updated:number }>}
 */
export const historiserPachatCommandes = async (entreprise) => {
  const refByNumcde = await buildRefMap(entreprise);
  const detailCache = await commandeCacheService.getCmdDetail(entreprise);

  const fournNomByCode = new Map();
  const getFournNom = async (code) => {
    if (code == null) return "";
    if (fournNomByCode.has(code)) return fournNomByCode.get(code);
    let nom = "";
    try {
      const f = await fournissCacheService.findByFourn(entreprise, code);
      nom = safeTrim(f?.NOM);
    } catch {
      nom = "";
    }
    fournNomByCode.set(code, nom);
    return nom;
  };

  const ops = [];
  let scanned = 0;
  for (const line of detailCache.records) {
    const nart = safeTrim(line.NART).toUpperCase();
    if (!nart || nart.includes("!")) continue;
    const prix = ligneToPrix(line);
    if (prix == null) continue;
    const numcde = safeTrim(line.NUMCDE).toUpperCase();
    const ref = refByNumcde.get(numcde);
    const dateCommande = ymdToDate(ref?.dateYmd);
    const nl = num(line.NL) ?? 0;
    const fournCode = ref?.fournCode ?? null;
    const pachatRendu = num(line.PACHAT);
    const valorise = pachatRendu != null && pachatRendu !== 0;
    const fournisseur = await getFournNom(fournCode);
    ops.push({
      updateOne: {
        filter: { entreprise: entreprise._id, nart, numcde, nl, dateCommande },
        update: {
          $set: {
            prix,
            source: valorise ? "rendu" : "commande",
            fournCode,
            fournisseur,
            devise: ref?.devise || "XPF",
            qte: num(line.QTE),
            design: safeTrim(line.DESIGN),
            numfact: ref?.numfact || "",
            arrivee: ymdToDate(ref?.arriveeYmd),
            etat: ref?.etat ?? null,
          },
        },
        upsert: true,
      },
    });
    scanned += 1;
  }

  // bulkWrite par lots (les cmdetail prod peuvent être volumineux).
  let inserted = 0;
  let updated = 0;
  const CHUNK = 1000;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const res = await HistoriquePachat.bulkWrite(ops.slice(i, i + CHUNK), {
      ordered: false,
    });
    inserted += res.upsertedCount || 0;
    updated += res.modifiedCount || 0;
  }
  return { scanned, inserted, updated };
};

export default {
  getPachatHistorique,
  getFournisseursCommandes,
  getPachatEvolutions,
  historiserPachatCommandes,
};
