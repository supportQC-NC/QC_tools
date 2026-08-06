// backend/services/balancesExcelService.js
//
// Export Excel des balances clients (encours + clients à bloquer). 2 feuilles :
// « Balances » (toutes) et « À bloquer ». exceljs.
import ExcelJS from "exceljs";

const HEADERS = [
  { h: "TIERS", k: "tiers", w: 10, num: true },
  { h: "Client", k: "nom", w: 34 },
  { h: "Vendeur", k: "vendeur", w: 18 },
  { h: "Catégorie", k: "categorie", w: 16 },
  { h: "Solde", k: "solde", w: 14, num: true },
  { h: "M-1", k: "m1", w: 12, num: true },
  { h: "M-2", k: "m2", w: 12, num: true },
  { h: "M-3", k: "m3", w: 12, num: true },
  { h: "3M+", k: "m3plus", w: 12, num: true },
];

const remplirFeuille = (ws, rows) => {
  const headerRow = ws.addRow(HEADERS.map((c) => c.h));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D28D9" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  headerRow.height = 22;

  for (const r of rows) {
    const row = ws.addRow(HEADERS.map((c) => (r[c.k] == null ? "" : r[c.k])));
    HEADERS.forEach((c, i) => {
      if (c.num) row.getCell(i + 1).numFmt = "#,##0";
    });
  }
  HEADERS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.w;
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
};

export const genererExcelBalances = async ({ rows }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools - Balances clients";
  wb.created = new Date();

  remplirFeuille(wb.addWorksheet("Balances"), rows || []);
  remplirFeuille(
    wb.addWorksheet("À bloquer"),
    (rows || []).filter((r) => r.aBloquer),
  );

  return wb.xlsx.writeBuffer();
};

export default { genererExcelBalances };
