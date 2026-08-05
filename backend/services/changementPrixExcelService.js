// backend/services/changementPrixExcelService.js
//
// Génère le rapport Excel des changements de prix de vente — portage fidèle de
// la feuille "Prix de Vente" du script Python (openpyxl) : en-tête vert #4CAF50,
// texte blanc gras centré, largeur de colonnes automatique. Feuille de secours
// « Aucune donnée disponible » si aucun changement.
import ExcelJS from "exceljs";

// Colonnes = même ordre que le DataFrame Python final (df_prix_vente), suivi de
// deux colonnes ajoutées pour la promo (En promo / Prix promo TTC).
const HEADERS = [
  "Date",
  "Prix de vente initial",
  "Prix de vente actuel",
  "Designation",
  "Fournisseur",
  "Gencod",
  "PVTETTC",
  "KL",
  "VOL",
  "NART",
  "Deprécié",
  "En promo",
  "Prix promo TTC",
];

/**
 * @param {Object} p
 * @param {Array}  p.rows - lignes renvoyées par verifService.getChangementsPrix
 * @returns {Promise<Buffer>} buffer du fichier .xlsx
 */
export const genererExcelChangementPrix = async ({ rows }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools - Changement de prix de vente";
  wb.created = new Date();

  const ws = wb.addWorksheet("Prix de Vente", {
    properties: { tabColor: { argb: "FF4CAF50" } },
  });

  // ── Cas vide : bandeau rouge centré, comme le Python. ──
  if (!rows || rows.length === 0) {
    ws.mergeCells("A1:M1");
    const cell = ws.getCell("A1");
    cell.value = "Aucune donnée disponible";
    cell.font = { bold: true, size: 18, color: { argb: "FFFF0000" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 30;
    return wb.xlsx.writeBuffer();
  }

  // ── En-tête ──
  ws.addRow(HEADERS);
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF4CAF50" },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 25;

  // ── Données ──
  for (const r of rows) {
    ws.addRow([
      r.date,
      r.prixInitial,
      r.prixActuel,
      r.designation,
      r.fournisseur,
      r.gencod,
      r.pvtettc,
      r.kl,
      r.vol,
      r.nart,
      r.deprecie ? "Oui" : "Non",
      r.enPromo ? "Oui" : "Non",
      r.enPromo ? r.pvpromo : null,
    ]);
  }

  // Format nombre (séparateur milliers) pour les colonnes de prix.
  // B/C = prix verif, G = PVTETTC, M = prix promo TTC.
  ["B", "C", "G", "M"].forEach((col) => {
    ws.getColumn(col).numFmt = "#,##0";
  });

  // Largeur automatique (approximation de l'ajustement openpyxl : max longueur
  // du contenu * 1.1 + marge).
  ws.columns.forEach((column) => {
    let max = 10;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value == null ? 0 : String(cell.value).length;
      if (len > max) max = len;
    });
    column.width = (max + 2) * 1.1;
  });

  // Fige la ligne d'en-tête.
  ws.views = [{ state: "frozen", ySplit: 1 }];

  return wb.xlsx.writeBuffer();
};

export default { genererExcelChangementPrix };
