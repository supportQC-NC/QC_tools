// backend/services/entreesExcelService.js
//
// Export Excel de la grille « Suivi des entrées » (une feuille, en-tête coloré,
// largeur auto). Cohérent avec les autres exports du projet (exceljs).
import ExcelJS from "exceljs";

const HEADERS = [
  { h: "NART", k: "nart", w: 12 },
  { h: "Désignation", k: "design", w: 40 },
  { h: "Référence", k: "refer", w: 16 },
  { h: "Gencod", k: "gencod", w: 16 },
  { h: "Fournisseur", k: "fournisseur", w: 26 },
  { h: "N° Cde", k: "numcde", w: 12 },
  { h: "Bateau", k: "bateau", w: 12 },
  { h: "Qté", k: "qte", w: 8, num: true },
  { h: "PV TTC", k: "pvtettc", w: 12, num: true },
  { h: "Stock Mag", k: "stockMag", w: 10, num: true },
  { h: "Stock Dock", k: "stockDock", w: 10, num: true },
  { h: "Rayon", k: "gism1", w: 10 },
  { h: "Emplac.", k: "place", w: 10 },
  { h: "Date entrée", k: "dateEntree", w: 12 },
  { h: "Nouveauté", k: "nouveaute", w: 10, bool: true },
  { h: "Résa", k: "resa", w: 8, bool: true },
  { h: "Chgt prix", k: "chgPrix", w: 10, bool: true },
  { h: "Ctrl TGC", k: "pbTgc", w: 10, bool: true },
];

export const genererExcelEntrees = async ({ rows, dateFr }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools - Suivi des entrées";
  wb.created = new Date();
  const ws = wb.addWorksheet("Entrées", {
    properties: { tabColor: { argb: "FF2563EB" } },
  });

  const lastCol = String.fromCharCode(64 + HEADERS.length); // A..R

  // Titre
  ws.mergeCells(`A1:${lastCol}1`);
  const title = ws.getCell("A1");
  title.value = `Suivi des entrées — ${dateFr || ""}`;
  title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  // En-tête
  const headerRow = ws.addRow(HEADERS.map((c) => c.h));
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 22;

  if (!rows || rows.length === 0) {
    const r = ws.addRow(["Aucune entrée pour cette date."]);
    ws.mergeCells(`A${r.number}:${lastCol}${r.number}`);
    r.getCell(1).font = { italic: true, color: { argb: "FF999999" } };
    r.getCell(1).alignment = { horizontal: "center" };
  } else {
    for (const row of rows) {
      const r = ws.addRow(
        HEADERS.map((c) => {
          if (c.bool) return row[c.k] ? "X" : "";
          const v = row[c.k];
          return v == null ? "" : v;
        }),
      );
      HEADERS.forEach((c, i) => {
        if (c.num) r.getCell(i + 1).numFmt = "#,##0";
        if (c.bool) r.getCell(i + 1).alignment = { horizontal: "center" };
      });
      // Surligne la ligne si anomalie TGC
      if (row.pbTgc) {
        r.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFDE8E8" },
          };
        });
      }
    }
  }

  HEADERS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.w;
  });
  ws.views = [{ state: "frozen", ySplit: 2 }];

  return wb.xlsx.writeBuffer();
};

export default { genererExcelEntrees };
