// backend/services/resaEntreesExcelService.js
//
// Export Excel du module « Entrées sur réservation » (une feuille, en-tête coloré).
import ExcelJS from "exceljs";

const HEADERS = [
  { h: "NART", k: "nart", w: 12 },
  { h: "Désignation", k: "design", w: 40 },
  { h: "État résa", k: "etatResa", w: 18 },
  { h: "Qté résa", k: "qteResa", w: 9, num: true },
  { h: "Qté entrée", k: "qteEntree", w: 10, num: true },
  { h: "Stock total", k: "stockTotal", w: 11, num: true },
  { h: "Client", k: "client", w: 28 },
  { h: "Tiers", k: "tiers", w: 10 },
  { h: "Vendeur", k: "vendeur", w: 22 },
  { h: "Réf résa", k: "refResa", w: 12 },
  { h: "Note", k: "texteResa", w: 26 },
  { h: "Date résa", k: "dateResa", w: 12 },
  { h: "Date entrée", k: "dateEntree", w: 12 },
];

export const genererExcelResaEntrees = async ({ rows, periodeLabel }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools - Entrées sur réservation";
  wb.created = new Date();
  const ws = wb.addWorksheet("Entrées résa", {
    properties: { tabColor: { argb: "FFEA580C" } },
  });
  const lastCol = String.fromCharCode(64 + HEADERS.length);

  ws.mergeCells(`A1:${lastCol}1`);
  const title = ws.getCell("A1");
  title.value = `Entrées sur réservation — ${periodeLabel || ""}`;
  title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC2410C" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  const headerRow = ws.addRow(HEADERS.map((c) => c.h));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEA580C" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 22;

  const vendeurTxt = (r) =>
    [r.vendeurCode, r.vendeurNom].filter((x) => x != null && x !== "").join(" — ");

  if (!rows || rows.length === 0) {
    const r = ws.addRow(["Aucune entrée sur réservation pour cette période."]);
    ws.mergeCells(`A${r.number}:${lastCol}${r.number}`);
    r.getCell(1).font = { italic: true, color: { argb: "FF999999" } };
    r.getCell(1).alignment = { horizontal: "center" };
  } else {
    for (const row of rows) {
      const r = ws.addRow(
        HEADERS.map((c) => {
          if (c.k === "vendeur") return vendeurTxt(row);
          const v = row[c.k];
          return v == null ? "" : v;
        }),
      );
      HEADERS.forEach((c, i) => {
        if (c.num) r.getCell(i + 1).numFmt = "#,##0";
      });
    }
  }

  HEADERS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.w;
  });
  ws.views = [{ state: "frozen", ySplit: 2 }];

  return wb.xlsx.writeBuffer();
};

export default { genererExcelResaEntrees };
