// backend/services/rapportTgcExcelService.js
//
// Export Excel du rapport TGC mensuel (exceljs) : feuille Totaux par taux,
// feuille Détail par facture, feuille Alertes.
import ExcelJS from "exceljs";

const money = "#,##0";

const styleHeader = (row, argb) => {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  row.height = 22;
};

export const genererExcelRapportTgc = async ({ data, nomSociete }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools - Rapport TGC";
  wb.created = new Date();
  const periode = `${String(data.month).padStart(2, "0")}/${data.year}`;

  // ── Feuille 1 : Totaux par taux ──
  const wsT = wb.addWorksheet("Totaux par taux", {
    properties: { tabColor: { argb: "FF7C3AED" } },
  });
  wsT.mergeCells("A1:C1");
  wsT.getCell("A1").value = `Déclaration TGC — ${nomSociete || ""} — ${periode}`;
  wsT.getCell("A1").font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  wsT.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF6D28D9" } };
  wsT.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  wsT.getRow(1).height = 26;
  styleHeader(wsT.addRow(["Taux TGC (%)", "Base HT", "TGC"]), "FF7C3AED");
  for (const t of data.totaux) {
    const r = wsT.addRow([t.dtva, t.base, t.tgc]);
    r.getCell(2).numFmt = money;
    r.getCell(3).numFmt = money;
  }
  const totalRow = wsT.addRow(["TOTAL", data.grandTotal.base, data.grandTotal.tgc]);
  totalRow.font = { bold: true };
  totalRow.getCell(2).numFmt = money;
  totalRow.getCell(3).numFmt = money;
  wsT.columns = [{ width: 16 }, { width: 18 }, { width: 18 }];

  // ── Feuille 2 : Détail par facture ──
  const wsD = wb.addWorksheet("Détail");
  const detCols = [
    { h: "N° Facture", k: "numfact", w: 14 },
    { h: "Type", k: "typfact", w: 8 },
    { h: "Date", k: "datfact", w: 12 },
    { h: "Tiers", k: "tiers", w: 10 },
    { h: "Client", k: "nom", w: 30 },
    { h: "Taux (%)", k: "dtva", w: 10 },
    { h: "Base HT", k: "base", w: 16, num: true },
    { h: "TGC", k: "tgc", w: 16, num: true },
    { h: "Bon Cde", k: "boncde", w: 14 },
  ];
  styleHeader(wsD.addRow(detCols.map((c) => c.h)), "FF7C3AED");
  for (const row of data.detail) {
    const r = wsD.addRow(detCols.map((c) => row[c.k]));
    detCols.forEach((c, i) => {
      if (c.num) r.getCell(i + 1).numFmt = money;
    });
  }
  wsD.columns = detCols.map((c) => ({ width: c.w }));
  wsD.views = [{ state: "frozen", ySplit: 1 }];

  // ── Feuille 3 : Alertes ──
  const wsA = wb.addWorksheet("Alertes TGC");
  styleHeader(
    wsA.addRow(["N° Facture", "Date", "NART", "PV HT", "Tiers", "Client"]),
    "FFDC2626",
  );
  for (const a of data.alertes) {
    const r = wsA.addRow([a.numfact, a.datfact, a.nart, a.pvte, a.tiers, a.nom]);
    r.getCell(4).numFmt = money;
  }
  wsA.columns = [
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 10 },
    { width: 30 },
  ];

  return wb.xlsx.writeBuffer();
};

export default { genererExcelRapportTgc };
