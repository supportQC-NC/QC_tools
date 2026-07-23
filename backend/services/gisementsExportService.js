// backend/services/gisementsExportService.js
//
// Génère un classeur Excel des GISEMENTS (GISM1..GISM5) ou des GROUPES (famille)
// à partir du fichier article.dbf d'une entreprise (via le cache article).
//
// Dimension "gisements" (3 modes) :
//   - "articles"  : 1 ligne/article, NART/DESIGN/GENCOD/GROUPE + GISM1..GISM5 + PLACE
//   - "distinct"  : codes de gisement dédupliqués (GISM1..5) + nb articles + niveaux + libellé
//   - "parNiveau" : un onglet par niveau (GISM1..GISM5), codes distincts + nb + libellé
//
// Dimension "groupes" (2 modes) :
//   - "articles"  : 1 ligne/article, NART/DESIGN/GENCOD/GROUPE + libellé
//   - "distinct"  : codes GROUPE dédupliqués + nb articles + libellé
//
// Le libellé provient d'un fichier de config (voir libelleConfigService /
// gisementsService) ; NON BLOQUANT si absent (colonne libellé vide).

import ExcelJS from "exceljs";
import articleCacheService from "./articleService.js";

const GISM_FIELDS = ["GISM1", "GISM2", "GISM3", "GISM4", "GISM5"];

// Modes valides par dimension.
export const EXPORT_MODES = {
  gisements: ["articles", "distinct", "parNiveau"],
  groupes: ["articles", "distinct"],
};

export const DIMENSIONS = ["gisements", "groupes"];

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const libOf = (libelleMap, code) =>
  libelleMap ? libelleMap.get(safeTrim(code).toUpperCase()) || "" : "";

const styleHeader = (row) => {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
  row.alignment = { vertical: "middle" };
  row.height = 20;
};

// ── GISEMENTS ────────────────────────────────────────────────────────────────
const gisFeuilleArticles = (wb, records) => {
  const ws = wb.addWorksheet("Articles");
  ws.columns = [
    { header: "NART", key: "nart", width: 14 },
    { header: "DESIGN", key: "design", width: 40 },
    { header: "GENCOD", key: "gencod", width: 16 },
    { header: "GROUPE", key: "groupe", width: 12 },
    { header: "GISM1", key: "gism1", width: 12 },
    { header: "GISM2", key: "gism2", width: 12 },
    { header: "GISM3", key: "gism3", width: 12 },
    { header: "GISM4", key: "gism4", width: 12 },
    { header: "GISM5", key: "gism5", width: 12 },
    { header: "PLACE", key: "place", width: 12 },
  ];
  styleHeader(ws.getRow(1));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of records) {
    ws.addRow({
      nart: safeTrim(r.NART), design: safeTrim(r.DESIGN), gencod: safeTrim(r.GENCOD),
      groupe: safeTrim(r.GROUPE), gism1: safeTrim(r.GISM1), gism2: safeTrim(r.GISM2),
      gism3: safeTrim(r.GISM3), gism4: safeTrim(r.GISM4), gism5: safeTrim(r.GISM5),
      place: safeTrim(r.PLACE),
    });
  }
  ws.autoFilter = { from: "A1", to: "J1" };
  return records.length;
};

const gisFeuilleDistinct = (wb, records, libelleMap) => {
  const agg = new Map(); // code -> { articles:Set, niveaux:Set }
  records.forEach((r, idx) => {
    GISM_FIELDS.forEach((champ) => {
      const code = safeTrim(r[champ]);
      if (!code) return;
      let e = agg.get(code);
      if (!e) { e = { articles: new Set(), niveaux: new Set() }; agg.set(code, e); }
      e.articles.add(idx);
      e.niveaux.add(champ);
    });
  });

  const ws = wb.addWorksheet("Gisements distincts");
  ws.columns = [
    { header: "GISEMENT", key: "code", width: 18 },
    { header: "LIBELLE", key: "libelle", width: 32 },
    { header: "NB ARTICLES", key: "nb", width: 14 },
    { header: "NIVEAUX", key: "niveaux", width: 28 },
  ];
  styleHeader(ws.getRow(1));
  ws.views = [{ state: "frozen", ySplit: 1 }];

  [...agg.entries()]
    .map(([code, e]) => ({
      code,
      libelle: libOf(libelleMap, code),
      nb: e.articles.size,
      niveaux: GISM_FIELDS.filter((n) => e.niveaux.has(n)).join(", "),
    }))
    .sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }))
    .forEach((l) => ws.addRow(l));
  ws.autoFilter = { from: "A1", to: "D1" };
  return agg.size;
};

const gisFeuillesParNiveau = (wb, records, libelleMap) => {
  let total = 0;
  GISM_FIELDS.forEach((champ) => {
    const compte = new Map();
    records.forEach((r) => {
      const code = safeTrim(r[champ]);
      if (code) compte.set(code, (compte.get(code) || 0) + 1);
    });
    const ws = wb.addWorksheet(champ);
    ws.columns = [
      { header: "GISEMENT", key: "code", width: 18 },
      { header: "LIBELLE", key: "libelle", width: 32 },
      { header: "NB ARTICLES", key: "nb", width: 14 },
    ];
    styleHeader(ws.getRow(1));
    ws.views = [{ state: "frozen", ySplit: 1 }];
    [...compte.entries()]
      .map(([code, nb]) => ({ code, libelle: libOf(libelleMap, code), nb }))
      .sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }))
      .forEach((l) => ws.addRow(l));
    ws.autoFilter = { from: "A1", to: "C1" };
    total += compte.size;
  });
  return total;
};

// ── GROUPES (famille) ────────────────────────────────────────────────────────
const grpFeuilleArticles = (wb, records, libelleMap) => {
  const ws = wb.addWorksheet("Articles");
  ws.columns = [
    { header: "NART", key: "nart", width: 14 },
    { header: "DESIGN", key: "design", width: 40 },
    { header: "GENCOD", key: "gencod", width: 16 },
    { header: "GROUPE", key: "groupe", width: 12 },
    { header: "LIBELLE", key: "libelle", width: 32 },
  ];
  styleHeader(ws.getRow(1));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of records) {
    const groupe = safeTrim(r.GROUPE);
    ws.addRow({
      nart: safeTrim(r.NART), design: safeTrim(r.DESIGN), gencod: safeTrim(r.GENCOD),
      groupe, libelle: libOf(libelleMap, groupe),
    });
  }
  ws.autoFilter = { from: "A1", to: "E1" };
  return records.length;
};

const grpFeuilleDistinct = (wb, records, libelleMap) => {
  const compte = new Map();
  records.forEach((r) => {
    const code = safeTrim(r.GROUPE);
    if (code) compte.set(code, (compte.get(code) || 0) + 1);
  });
  const ws = wb.addWorksheet("Groupes distincts");
  ws.columns = [
    { header: "GROUPE", key: "code", width: 14 },
    { header: "LIBELLE", key: "libelle", width: 32 },
    { header: "NB ARTICLES", key: "nb", width: 14 },
  ];
  styleHeader(ws.getRow(1));
  ws.views = [{ state: "frozen", ySplit: 1 }];
  [...compte.entries()]
    .map(([code, nb]) => ({ code, libelle: libOf(libelleMap, code), nb }))
    .sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }))
    .forEach((l) => ws.addRow(l));
  ws.autoFilter = { from: "A1", to: "C1" };
  return compte.size;
};

/**
 * Construit le classeur Excel pour une dimension + un mode.
 * @param {object} p
 * @param {object} p.entreprise
 * @param {"articles"|"distinct"|"parNiveau"} p.mode
 * @param {"gisements"|"groupes"} [p.dimension]
 * @param {Map<string,string>} [p.libelleMap]  code(maj) -> libellé
 * @returns {Promise<{ workbook, filename, count, total }>}
 */
export const buildExportWorkbook = async ({
  entreprise,
  mode,
  dimension = "gisements",
  libelleMap = new Map(),
}) => {
  if (!DIMENSIONS.includes(dimension)) {
    throw new Error(`Dimension inconnue : ${dimension}`);
  }
  if (!EXPORT_MODES[dimension].includes(mode)) {
    throw new Error(`Mode « ${mode} » invalide pour la dimension ${dimension}.`);
  }

  const cacheArt = await articleCacheService.getArticles(entreprise);
  const records = cacheArt.records || [];

  const wb = new ExcelJS.Workbook();
  wb.creator = "Outil Quincaillerie";
  wb.created = new Date();

  let count = 0;
  if (dimension === "gisements") {
    if (mode === "articles") count = gisFeuilleArticles(wb, records);
    else if (mode === "distinct") count = gisFeuilleDistinct(wb, records, libelleMap);
    else count = gisFeuillesParNiveau(wb, records, libelleMap);
  } else {
    if (mode === "articles") count = grpFeuilleArticles(wb, records, libelleMap);
    else count = grpFeuilleDistinct(wb, records, libelleMap);
  }

  const trig =
    safeTrim(entreprise?.trigramme) || safeTrim(entreprise?.nomDossierDBF) || "societe";
  const filename = `${dimension}_${mode}_${trig}.xlsx`;

  return { workbook: wb, filename, count, total: records.length };
};

export default { buildExportWorkbook, EXPORT_MODES, DIMENSIONS };
