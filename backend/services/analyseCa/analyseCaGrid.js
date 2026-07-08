// backend/services/analyseCa/analyseCaGrid.js
//
// Grille commune aux onglets "hiérarchiques" de l'analyse CA (Classes,
// Sous_Classes, Locates, Groupes, Familles, Sous_Familles, Rayons) :
// même structure 24 colonnes, mêmes styles openpyxl (_write_sheet des scripts
// Python), seuls varient le nom de la colonne "code", le libellé et le jeu de
// colonnes "nombre d'articles" (orange).
//
// Ce module expose :
//  - helpers de calcul (round, evolPct, finaliserLignes)
//  - writeGridSheet(workbook, options) qui écrit une feuille complète.

export const r0 = (n) => Math.round(n);
export const r1 = (n) => Math.round(n * 10) / 10;
export const r2 = (n) => Math.round(n * 100) / 100;

// Évolution % : (n - n1)/n1 × 100 ; 100 si n1 == 0 et n > 0 ; sinon 0
export function evolPct(n, n1) {
  if (n1 !== 0) return ((n - n1) / n1) * 100;
  return n > 0 ? 100 : 0;
}

// Colonnes fixes (identiques pour toutes les grilles)
const MONEY_COLS = new Set([
  "CA_N", "CA_N1", "MARGE_N", "MARGE_N1", "PRIX_MOY_N", "PRIX_MOY_N1",
]);
const PCT_COLS = new Set([
  "EVOL_CA", "PART_CA", "PART_CUMULEE", "EVOL_QTE",
  "PCT_MARGE_N", "PCT_MARGE_N1", "EVOL_MARGE",
]);

/**
 * À partir de lignes contenant CA_N/CA_N1/COUT_N/COUT_N1/QTE_N/QTE_N1,
 * calcule marges, taux, évolutions, part de CA, prix moyens, tri CA_N desc,
 * rang et part cumulée. Mute et retourne le tableau.
 */
export function finaliserLignes(rows) {
  const totalCa = rows.reduce((s, r) => s + r.CA_N, 0);
  for (const r of rows) {
    r.MARGE_N = r.CA_N - r.COUT_N;
    r.MARGE_N1 = r.CA_N1 - r.COUT_N1;
    r.PCT_MARGE_N = r.CA_N !== 0 ? (r.MARGE_N / r.CA_N) * 100 : 0;
    r.PCT_MARGE_N1 = r.CA_N1 !== 0 ? (r.MARGE_N1 / r.CA_N1) * 100 : 0;
    r.EVOL_CA = evolPct(r.CA_N, r.CA_N1);
    r.EVOL_QTE = evolPct(r.QTE_N, r.QTE_N1);
    r.EVOL_MARGE = evolPct(r.MARGE_N, r.MARGE_N1);
    r.PART_CA = totalCa > 0 ? (r.CA_N / totalCa) * 100 : 0;
    r.PRIX_MOY_N = r.QTE_N > 0 ? r.CA_N / r.QTE_N : 0;
    r.PRIX_MOY_N1 = r.QTE_N1 > 0 ? r.CA_N1 / r.QTE_N1 : 0;
  }
  rows.sort((a, b) => b.CA_N - a.CA_N);
  let cumul = 0;
  rows.forEach((r, i) => {
    cumul += r.PART_CA;
    r.PART_CUMULEE = cumul;
    r.RANG = i + 1;
  });
  return rows;
}

/**
 * Écrit une feuille "grille" complète.
 * @param {ExcelJS.Workbook} workbook
 * @param {object} o
 * @param {string} o.sheetName
 * @param {string} o.tabColor            couleur d'onglet ARGB (FF......)
 * @param {Array}  o.rows                lignes finalisées
 * @param {string[]} o.colOrder          ordre des colonnes
 * @param {object} o.headers             clé -> libellé d'en-tête (avec \n)
 * @param {object} o.widths              clé -> largeur
 * @param {string} o.titleText           titre (date ajoutée automatiquement)
 * @param {string} [o.codeCol]           colonne "code" bleu pâle (optionnelle)
 * @param {string} [o.labelCol]          colonne libellé bleu/gauche (déf. colOrder[2])
 * @param {number} [o.freezeXSplit]      nb colonnes figées (déf. 3 -> gel D3)
 * @param {string[]} o.articleCountCols  colonnes "nb articles" (orange, int)
 */
export function writeGridSheet(workbook, o) {
  const {
    sheetName, tabColor, rows, colOrder, headers, widths, titleText,
    codeCol = null, articleCountCols = [], freezeXSplit = 3,
  } = o;
  const nbCols = colOrder.length;
  const labelCol = o.labelCol || (colOrder.length > 2 ? colOrder[2] : null);
  const orangeInt = new Set([
    ...articleCountCols, "NB_FACTURES_N", "NB_FACTURES_N1",
  ]);

  const ws = workbook.addWorksheet(sheetName, {
    properties: { tabColor: { argb: tabColor } },
    views: [{ state: "frozen", xSplit: freezeXSplit, ySplit: 2 }],
  });

  const fill = (hex) => ({
    type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex}` },
  });
  const mediumGris = {
    left: { style: "medium", color: { argb: "FFD3D3D3" } },
    right: { style: "medium", color: { argb: "FFD3D3D3" } },
    top: { style: "medium", color: { argb: "FFD3D3D3" } },
    bottom: { style: "medium", color: { argb: "FFD3D3D3" } },
  };
  const mediumBleu = {
    left: { style: "medium", color: { argb: "FF2E75B6" } },
    right: { style: "medium", color: { argb: "FF2E75B6" } },
    top: { style: "medium", color: { argb: "FF2E75B6" } },
    bottom: { style: "medium", color: { argb: "FF2E75B6" } },
  };
  const colLetter = (i) => ws.getColumn(i).letter;

  // Titre
  const auj = new Date();
  const p = (x) => String(x).padStart(2, "0");
  ws.mergeCells(1, 1, 1, nbCols);
  const title = ws.getCell(1, 1);
  title.value = `${titleText} - ${p(auj.getDate())}/${p(auj.getMonth() + 1)}/${auj.getFullYear()}`;
  title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = fill("1F4E79");
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  // En-têtes
  colOrder.forEach((c, i) => {
    const cell = ws.getCell(2, i + 1);
    cell.value = headers[c];
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = fill("1F4E79");
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = mediumGris;
  });
  ws.getRow(2).height = 40;

  const MAUVE = "E6D7FF", JAUNE = "FFF9C4", ORANGE = "FFE4CC",
    VERT = "E8F5E8", BLEU = "D6E8FA", BLEU_PALE = "E8F4FD";

  // Données (lignes 3..)
  rows.forEach((rowData, rowNum) => {
    const row = rowNum + 3;
    const zebra = row % 2 === 0 ? "F8F8F8" : "FFFFFF";
    colOrder.forEach((colName, ci) => {
      const cell = ws.getCell(row, ci + 1);
      const value = rowData[colName] ?? 0;

      if (colName === "RANG") {
        cell.value = Math.trunc(value);
        cell.font = { bold: true, size: 9, color: { argb: "FF2E75B6" } };
        cell.fill = fill(zebra);
      } else if (colName === codeCol) {
        cell.value = String(value);
        cell.fill = fill(BLEU_PALE);
        cell.font = { bold: true, size: 9, color: { argb: "FF0066CC" } };
      } else if (colName === labelCol) {
        cell.value = value;
        cell.fill = fill(BLEU);
        cell.font = { bold: true, size: 9, color: { argb: "FF003D7A" } };
        cell.alignment = { horizontal: "left", vertical: "middle" };
      } else if (orangeInt.has(colName)) {
        cell.value = Math.trunc(value);
        cell.fill = fill(ORANGE);
        cell.font = { bold: true, size: 9, color: { argb: "FFCC5500" } };
      } else if (colName === "CA_N") {
        cell.value = r0(value);
        cell.fill = fill(zebra);
        cell.font = { bold: true, size: 9 };
      } else if (colName === "CA_N1") {
        cell.value = r0(value);
        cell.fill = fill("FFFFFF");
        cell.font = { bold: true, size: 9, color: { argb: "FF000000" } };
      } else if (["EVOL_CA", "EVOL_QTE", "EVOL_MARGE"].includes(colName)) {
        cell.value = r1(value);
        cell.fill = fill(MAUVE);
        cell.font = { bold: true, size: 9, color: { argb: "FF4A148C" } };
      } else if (["PRIX_MOY_N", "PRIX_MOY_N1"].includes(colName)) {
        cell.value = r0(value);
        cell.fill = fill(VERT);
        cell.font = { bold: true, size: 9, color: { argb: "FF2E7D32" } };
      } else if (colName === "MARGE_N") {
        cell.value = r0(value);
        cell.fill = fill(JAUNE);
        cell.font = { bold: true, size: 9, color: { argb: "FFE65100" } };
      } else if (colName === "PCT_MARGE_N") {
        cell.value = r1(value);
        cell.fill = fill(JAUNE);
        cell.font = { bold: true, size: 9, color: { argb: "FFE65100" } };
      } else {
        if (["QTE_N", "QTE_N1", "NB_CLIENTS_N", "NB_CLIENTS_N1"].includes(colName)) {
          cell.value = Math.trunc(value);
        } else if (colName.includes("PCT") || colName.includes("PART")) {
          cell.value = r2(value);
        } else {
          cell.value = typeof value === "number" ? r0(value) : value;
        }
        cell.fill = fill(zebra);
        cell.font = { bold: true, size: 9 };
      }

      cell.border = mediumGris;
      if (colName !== labelCol) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }

      if (MONEY_COLS.has(colName)) {
        cell.numFmt = "#,##0";
      } else if (PCT_COLS.has(colName) && typeof cell.value === "number") {
        cell.value = cell.value / 100;
        cell.numFmt = "0.0%";
      }
    });
  });

  // Ligne TOTAL (len + 3)
  const totalRow = rows.length + 3;
  const somme = (champ) => rows.reduce((s, r) => s + (r[champ] || 0), 0);
  const intSumCols = new Set([
    ...articleCountCols, "QTE_N", "QTE_N1",
    "NB_FACTURES_N", "NB_FACTURES_N1", "NB_CLIENTS_N", "NB_CLIENTS_N1",
  ]);
  colOrder.forEach((colName, ci) => {
    const cell = ws.getCell(totalRow, ci + 1);
    let v = "";
    if (colName === "RANG") v = "";
    else if (colName === labelCol) v = "TOTAL GÉNÉRAL";
    else if (intSumCols.has(colName)) v = Math.trunc(somme(colName));
    else if (["CA_N", "CA_N1", "MARGE_N", "MARGE_N1"].includes(colName)) v = r0(somme(colName));
    else if (["PART_CA", "PART_CUMULEE"].includes(colName)) v = 1;
    else if (colName === "PCT_MARGE_N" && somme("CA_N") > 0) v = somme("MARGE_N") / somme("CA_N");
    else if (colName === "PCT_MARGE_N1" && somme("CA_N1") > 0) v = somme("MARGE_N1") / somme("CA_N1");
    else if (colName === "EVOL_CA" && somme("CA_N1") > 0) v = (somme("CA_N") - somme("CA_N1")) / somme("CA_N1");
    else if (colName === "EVOL_QTE" && somme("QTE_N1") > 0) v = (somme("QTE_N") - somme("QTE_N1")) / somme("QTE_N1");
    else if (colName === "EVOL_MARGE" && somme("MARGE_N1") > 0) v = (somme("MARGE_N") - somme("MARGE_N1")) / somme("MARGE_N1");
    else if (colName === "PRIX_MOY_N" && somme("QTE_N") > 0) v = r0(somme("CA_N") / somme("QTE_N"));
    else if (colName === "PRIX_MOY_N1" && somme("QTE_N1") > 0) v = r0(somme("CA_N1") / somme("QTE_N1"));
    else v = "";

    cell.value = v;
    cell.fill = fill("2E75B6");
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.border = mediumBleu;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    if (MONEY_COLS.has(colName)) cell.numFmt = "#,##0";
    else if (PCT_COLS.has(colName)) cell.numFmt = "0.0%";
  });

  // Mise en forme conditionnelle
  const dataEnd = rows.length + 2;
  const idxOf = (c) => colOrder.indexOf(c) + 1;
  if (colOrder.includes("CA_N")) {
    const c = colLetter(idxOf("CA_N"));
    ws.addConditionalFormatting({
      ref: `${c}3:${c}${dataEnd}`,
      rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FF5B9BD5" }, showValue: true }],
    });
  }
  if (colOrder.includes("PART_CA")) {
    const c = colLetter(idxOf("PART_CA"));
    ws.addConditionalFormatting({
      ref: `${c}3:${c}${dataEnd}`,
      rules: [{ type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: { argb: "FFFFC000" }, showValue: true }],
    });
  }
  for (const ec of ["EVOL_CA", "EVOL_MARGE", "EVOL_QTE"]) {
    if (colOrder.includes(ec)) {
      const c = colLetter(idxOf(ec));
      ws.addConditionalFormatting({
        ref: `${c}3:${c}${dataEnd}`,
        rules: [{
          type: "iconSet", iconSet: "3Arrows", showValue: true, reverse: false,
          cfvo: [{ type: "num", value: -999999 }, { type: "num", value: 0 }, { type: "num", value: 0.0001 }],
        }],
      });
    }
  }
  if (colOrder.includes("PCT_MARGE_N")) {
    const c = colLetter(idxOf("PCT_MARGE_N"));
    ws.addConditionalFormatting({
      ref: `${c}3:${c}${dataEnd}`,
      rules: [{
        type: "iconSet", iconSet: "3Arrows", showValue: true, reverse: false,
        cfvo: [{ type: "percent", value: 0 }, { type: "percent", value: 20 }, { type: "percent", value: 35 }],
      }],
    });
  }

  // Largeurs + autofiltre + gel
  colOrder.forEach((c, i) => {
    ws.getColumn(i + 1).width = widths[c] ?? 12;
  });
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: dataEnd, column: nbCols } };

  return ws;
}