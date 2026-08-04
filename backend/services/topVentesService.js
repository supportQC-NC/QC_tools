// backend/services/topVentesService.js
//
// Outil « Top Ventes » (boîte à outils Commerciaux) — portage des requêtes Access
// rqTopVenteFrs / rqTopVenteRayons / rqSynthVenteFourn.
//
// Calcule, depuis article.dbf (lu via le cache), les indicateurs de vente par
// article puis les agrège par FOURNISSEUR ou par RAYON (GISM1) :
//   vente_annee = ΣV1..V12   (ventes des 12 derniers mois, champ article)
//   ca_annee    = vente_annee × PVTE
//   marge_ht    = PVTE / PREV
//   jour_rupture= ΣRUP1..RUP12
//   stock_total = ΣS1..S5 (mag = S1, dock = S2..S5)
//
// Le CA facture précis N/N-1 (tblCA_N) sera un enrichissement ultérieur.
import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";
import { readDictionnaire } from "./dictionnaireRayonsService.js";

const num = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};
const trim = (v) => (v === null || v === undefined ? "" : String(v).trim());
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

// Somme d'une série de champs préfixés (V1..V12, RUP1..RUP12, S1..S5).
const sumFields = (rec, prefix, from, to) => {
  let s = 0;
  for (let i = from; i <= to; i += 1) s += num(rec[`${prefix}${i}`]);
  return s;
};

// Indicateurs calculés pour un article.
const metrics = (rec) => {
  const venteAnnee = sumFields(rec, "V", 1, 12);
  const pvte = num(rec.PVTE);
  const prev = num(rec.PREV);
  const stockMag = num(rec.S1);
  const stockDock = sumFields(rec, "S", 2, 5);
  return {
    venteAnnee,
    venteMoisMoy: round2(venteAnnee / 12),
    pvte,
    prev,
    pvttc: num(rec.PVTETTC),
    caAnnee: round2(venteAnnee * pvte),
    coutAnnee: venteAnnee * prev,
    margeHt: prev > 0 ? round2(pvte / prev) : null,
    jourRupture: sumFields(rec, "RUP", 1, 12),
    stockMag,
    stockDock,
    stockTotal: stockMag + stockDock,
    encde: num(rec.ENCDE),
  };
};

// Map GISM1(maj) -> libellé rayon depuis le dictionnaire des rayons de la société.
const buildRayonMap = async (entreprise) => {
  try {
    const { rows } = await readDictionnaire(entreprise);
    const map = new Map();
    for (const r of rows || []) {
      const key = trim(r.gism1).toUpperCase();
      if (key) map.set(key, trim(r.libelle) || key);
    }
    return map;
  } catch {
    return new Map();
  }
};

// ────────────────────────────────────────────────────────────────────────────
// SYNTHÈSE : classement par fournisseur ou par rayon (trié CA décroissant).
// ────────────────────────────────────────────────────────────────────────────
export const getSynthese = async (entreprise, options = {}) => {
  const groupBy = options.groupBy === "rayon" ? "rayon" : "fournisseur";
  const cache = await articleService.getArticles(entreprise);
  const records = cache.records || [];

  const rayonMap = groupBy === "rayon" ? await buildRayonMap(entreprise) : null;

  // Agrégation.
  const groupes = new Map(); // key -> accumulateur
  for (const rec of records) {
    const m = metrics(rec);
    let code;
    if (groupBy === "fournisseur") {
      code = rec.FOURN;
      if (code === undefined || code === null || code === "") continue;
    } else {
      code = trim(rec.GISM1).toUpperCase() || "INCONNU";
    }
    const key = String(code);
    if (!groupes.has(key)) {
      groupes.set(key, {
        code,
        nbArticles: 0,
        venteAnnee: 0,
        caAnnee: 0,
        coutAnnee: 0,
        stockTotal: 0,
      });
    }
    const g = groupes.get(key);
    g.nbArticles += 1;
    g.venteAnnee += m.venteAnnee;
    g.caAnnee += m.caAnnee;
    g.coutAnnee += m.coutAnnee;
    g.stockTotal += m.stockTotal;
  }

  // Libellés + finalisation.
  const lignes = [];
  for (const g of groupes.values()) {
    let label = "";
    if (groupBy === "fournisseur") {
      try {
        const frs = await fournissCacheService.findByFourn(entreprise, g.code);
        label = frs ? trim(frs.NOM) : "";
      } catch {
        label = "";
      }
    } else {
      label = rayonMap.get(String(g.code).toUpperCase()) || String(g.code);
    }
    lignes.push({
      code: g.code,
      label,
      nbArticles: g.nbArticles,
      venteAnnee: round2(g.venteAnnee),
      caAnnee: round2(g.caAnnee),
      margeMoy: g.coutAnnee > 0 ? round2(g.caAnnee / g.coutAnnee) : null,
    });
  }

  lignes.sort((a, b) => b.caAnnee - a.caAnnee);

  const totaux = lignes.reduce(
    (t, l) => {
      t.caAnnee += l.caAnnee;
      t.venteAnnee += l.venteAnnee;
      t.nbArticles += l.nbArticles;
      return t;
    },
    { caAnnee: 0, venteAnnee: 0, nbArticles: 0 },
  );
  totaux.caAnnee = round2(totaux.caAnnee);
  totaux.venteAnnee = round2(totaux.venteAnnee);

  return { groupBy, totaux, nbGroupes: lignes.length, lignes };
};

// ────────────────────────────────────────────────────────────────────────────
// DÉTAIL : articles d'un fournisseur / rayon (drill-down), triable.
// ────────────────────────────────────────────────────────────────────────────
const SORT_FIELDS = new Set([
  "caAnnee",
  "venteAnnee",
  "margeHt",
  "jourRupture",
  "stockTotal",
  "pvte",
]);

export const getDetail = async (entreprise, options = {}) => {
  const type = options.type === "rayon" ? "rayon" : "fournisseur";
  const code = options.code;
  const search = trim(options.search).toLowerCase();
  const sort = SORT_FIELDS.has(options.sort) ? options.sort : "caAnnee";
  const dir = options.dir === "asc" ? 1 : -1;
  const limit = Math.min(parseInt(options.limit) || 1000, 5000);

  if (code === undefined || code === null || code === "") {
    return { total: 0, articles: [] };
  }

  const cache = await articleService.getArticles(entreprise);
  const records = cache.records || [];
  const rayonMap = await buildRayonMap(entreprise);

  const codeStr = String(code).toUpperCase();
  let rows = [];
  for (const rec of records) {
    if (type === "fournisseur") {
      if (String(rec.FOURN) !== String(code)) continue;
    } else if (trim(rec.GISM1).toUpperCase() !== codeStr) {
      continue;
    }
    if (search) {
      const hay = `${trim(rec.NART)} ${trim(rec.DESIGN)} ${trim(rec.REFER)} ${trim(
        rec.GENCOD,
      )}`.toLowerCase();
      if (!hay.includes(search)) continue;
    }
    const m = metrics(rec);
    rows.push({
      nart: trim(rec.NART),
      design: trim(rec.DESIGN),
      refer: trim(rec.REFER),
      gencod: trim(rec.GENCOD),
      fourn: rec.FOURN,
      gism1: trim(rec.GISM1),
      rayon: rayonMap.get(trim(rec.GISM1).toUpperCase()) || "",
      venteAnnee: round2(m.venteAnnee),
      venteMoisMoy: m.venteMoisMoy,
      caAnnee: m.caAnnee,
      margeHt: m.margeHt,
      jourRupture: m.jourRupture,
      pvte: m.pvte,
      prev: m.prev,
      stockMag: m.stockMag,
      stockDock: m.stockDock,
      stockTotal: m.stockTotal,
      encde: m.encde,
    });
  }

  const total = rows.length;
  rows.sort((a, b) => {
    const av = a[sort] ?? 0;
    const bv = b[sort] ?? 0;
    return (av - bv) * dir;
  });

  return { total, articles: rows.slice(0, limit) };
};

export default { getSynthese, getDetail };
