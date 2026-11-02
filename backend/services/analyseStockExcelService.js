// backend/services/analyseStockExcelService.js
//
// EXPORT EXCEL de l'EXPLORATEUR d'articles de l'Analyse stock : exactement ce
// que l'utilisateur voit à l'écran — mêmes filtres (recherche, code, filtre
// fournisseur, groupe, drapeau) et même tri, mais SANS pagination.
//
// Écriture EN FLUX (ExcelJS WorkbookWriter, modèle filialesExcelService) :
// jusqu'à 46 000 lignes chez QC sans filtre — un classeur monté en mémoire
// serait inutilement lourd pour une requête interactive.

import ExcelJS from "exceljs";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Colonnes : mêmes champs et même ordre que l'explorateur web.
const COLONNES = [
  { header: "NART", key: "nart", width: 10 },
  { header: "Désignation", key: "design", width: 42 },
  { header: "Fournisseur", key: "fournisseur", width: 26 },
  { header: "Groupe", key: "groupe", width: 18 },
  { header: "Code", key: "codeFiltre", width: 7 },
  { header: "Stock", key: "stock", width: 10, numFmt: "#,##0.###" },
  { header: "Valeur stock", key: "valeurStock", width: 14, numFmt: "#,##0" },
  { header: "Surstock", key: "surstock", width: 12, numFmt: "#,##0" },
  { header: "Déprécié", key: "valeurDeprec", width: 12, numFmt: "#,##0" },
  { header: "Couv. (mois)", key: "moisStock", width: 11, numFmt: "#,##0.0" },
  { header: "Vte an", key: "vteAn", width: 10, numFmt: "#,##0.###" },
  { header: "CA an", key: "caAn", width: 13, numFmt: "#,##0" },
  { header: "Marge %", key: "tauxMargePct", width: 9, numFmt: "#,##0.0" },
  { header: "Dern. vente", key: "dateVte", width: 12, numFmt: "dd/mm/yyyy" },
  { header: "Dern. arrivée", key: "dateArrive", width: 12, numFmt: "dd/mm/yyyy" },
];

// Date ISO -> Date Excel (null si absente/invalide).
const enDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Résumé humain des filtres actifs, pour la ligne de contexte du classeur.
const libelleFiltres = (f) => {
  const parts = [];
  if (f.q) parts.push(`recherche « ${f.q} »`);
  if (f.codeFiltre) parts.push(`code ${f.codeFiltre}`);
  if (f.fournisseur) parts.push(`fournisseur ${f.fournisseur}`);
  if (f.groupe) parts.push(`groupe ${f.groupe}`);
  if (f.flag) parts.push(`drapeau ${f.flag}`);
  return parts.length ? parts.join(" · ") : "aucun filtre";
};

/**
 * Écrit le classeur dans un flux Writable (la réponse HTTP).
 * @param {object} opts { societe, periode, filtres, articles }
 */
export async function ecrireExportArticles(res, opts) {
  const { societe, periode, filtres = {}, articles = [] } = opts;

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: true,
    useSharedStrings: false,
  });
  const ws = wb.addWorksheet("Articles", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 2 }],
  });
  ws.columns = COLONNES.map((c) => ({ key: c.key, width: c.width }));
  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: COLONNES.length },
  };

  // Ligne 1 : contexte (société, période d'arrêté, filtres appliqués).
  const r1 = ws.getRow(1);
  r1.getCell(1).value =
    `Analyse stock ${safeTrim(societe)} — arrêté ${safeTrim(periode)} — ` +
    `${articles.length} article${articles.length > 1 ? "s" : ""} — ${libelleFiltres(filtres)}`;
  r1.getCell(1).font = { bold: true, size: 10 };
  ws.mergeCells(1, 1, 1, COLONNES.length);
  r1.commit();

  // Ligne 2 : en-têtes.
  const r2 = ws.getRow(2);
  COLONNES.forEach((c, i) => {
    const cell = r2.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, size: 9 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "00D9E1F2" },
    };
  });
  r2.commit();

  // Données.
  for (const a of articles) {
    const row = ws.addRow({
      ...a,
      groupe: a.groupe || "",
      dateVte: enDate(a.dateVte),
      dateArrive: enDate(a.dateArrive),
    });
    COLONNES.forEach((c, i) => {
      if (c.numFmt) row.getCell(i + 1).numFmt = c.numFmt;
    });
    row.font = { size: 9 };
    row.commit();
  }

  await ws.commit();
  await wb.commit();
}

export default { ecrireExportArticles };
