// backend/services/analyseCa/clientInterneSheet.js
//
// Onglet "Client_Interne" (#9966CC) — transcription fidèle de
// analyse_ca_clients_interne.py (classe AnalyseCAClientInterne, version active).
//
// Source : datasets INTERNES (detailsNInterne / detailsN1Interne préparés par
// le socle : TIERS ≥ seuil ∈ tiers internes autorisés, exclusions articles +
// PVTE aberrante déjà appliquées).
//  - CA_LIGNE = QTE × PVTE × (1 − POURC/100) ; CHARGE_LIGNE = QTE × PREV.
//  - agrégat par (TIERS, NOM) : CA_N/CHARGE_N (somme, round2). NOM = nom_client
//    (jointure TIERS) sinon "CLIENT INCONNU".
//  - fusion N/N-1 (outer), évolutions valeur + %.
//  - tri CA_N décroissant, colonne RANG, ligne TOTAL.
//
// 11 colonnes A..K + mise en forme propre. QUIRKS openpyxl reproduits
// (insert_rows(1) du titre ne décale ni CF, ni autofiltre, ni gel, ni hauteurs).

const HEADERS = [
  "#", "Code Tiers", "Nom Client", "CA N\n(XPF)", "Charges N\n(XPF)",
  "CA N-1\n(XPF)", "Charges N-1\n(XPF)", "Évol. CA\nValeur (XPF)", "Évol. CA\n(%)",
  "Évol. Charges\nValeur (XPF)", "Évol. Charges\n(%)",
];

const r2 = (n) => Math.round(n * 100) / 100;

function evolPct(n, n1) {
  if (n1 !== 0) return ((n - n1) / n1) * 100;
  return n > 0 ? 100 : 0;
}

function agregat(details) {
  const map = new Map(); // tiers -> {tiers, nom, ca, charge}
  for (const l of details) {
    const tiers = l.TIERS_ID;
    const nom = l.nom_client || "CLIENT INCONNU";
    const ca = l.QTE * l.PVTE * (1 - l.POURC / 100);
    const charge = l.QTE * l.PREV;
    if (!map.has(tiers)) map.set(tiers, { tiers, nom, ca: 0, charge: 0 });
    const a = map.get(tiers);
    a.ca += ca;
    a.charge += charge;
  }
  for (const a of map.values()) {
    a.ca = r2(a.ca);
    a.charge = r2(a.charge);
  }
  return map;
}

/**
 * Ajoute l'onglet Client_Interne au classeur.
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets }
 */
export function buildClientInterneSheet(workbook, ctx) {
  const { datasets } = ctx;
  const aggN = agregat(datasets.detailsNInterne);
  const aggN1 = agregat(datasets.detailsN1Interne);

  const tiersSet = new Set([...aggN.keys(), ...aggN1.keys()]);
  const rows = [];
  for (const tiers of tiersSet) {
    const n = aggN.get(tiers);
    const n1 = aggN1.get(tiers);
    const nom = (n && n.nom) || (n1 && n1.nom) || "CLIENT INCONNU";
    const caN = n ? n.ca : 0;
    const caN1 = n1 ? n1.ca : 0;
    const chN = n ? n.charge : 0;
    const chN1 = n1 ? n1.charge : 0;
    rows.push({
      TIERS: tiers,
      NOM: nom,
      CA_N: caN,
      CHARGE_N: chN,
      CA_N1: caN1,
      CHARGE_N1: chN1,
      EVOL_CA_VAL: caN - caN1,
      EVOL_CA_PCT: evolPct(caN, caN1),
      EVOL_CHARGE_VAL: chN - chN1,
      EVOL_CHARGE_PCT: evolPct(chN, chN1),
    });
  }
  rows.sort((a, b) => b.CA_N - a.CA_N);
  const n = rows.length;

  const ws = workbook.addWorksheet("Client_Interne", {
    properties: { tabColor: { argb: "FF9966CC" } },
    views: [{ state: "frozen", xSplit: 3, ySplit: 1 }], // freeze D2 (quirk)
  });

  const fill = (hex) => ({
    type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex}` },
  });
  const thinGris = {
    left: { style: "thin", color: { argb: "FFD3D3D3" } },
    right: { style: "thin", color: { argb: "FFD3D3D3" } },
    top: { style: "thin", color: { argb: "FFD3D3D3" } },
    bottom: { style: "thin", color: { argb: "FFD3D3D3" } },
  };
  const mediumBleu = {
    left: { style: "medium", color: { argb: "FF2E75B6" } },
    right: { style: "medium", color: { argb: "FF2E75B6" } },
    top: { style: "medium", color: { argb: "FF2E75B6" } },
    bottom: { style: "medium", color: { argb: "FF2E75B6" } },
  };

  // Titre A1:K1 (h30)
  ws.mergeCells("A1:K1");
  const auj = new Date();
  const p = (x) => String(x).padStart(2, "0");
  const title = ws.getCell("A1");
  title.value = `ANALYSE CLIENTS INTERNES - CA ET CHARGES - ${p(auj.getDate())}/${p(auj.getMonth() + 1)}/${auj.getFullYear()}`;
  title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = fill("1F4E79");
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  // En-têtes (row 2)
  const headerRow = ws.getRow(2);
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = fill("1F4E79");
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinGris;
  });

  const BLEU = "D6E8FA", BLEU_PALE = "E8F4FD", MAUVE = "E6D7FF", LIGHT = "F2F2F2";

  // Données (rows 3..n+2)
  rows.forEach((r, i) => {
    const excelRow = 3 + i;
    const row = ws.getRow(excelRow);
    const alt = (i + 2) % 2 === 0 ? LIGHT : "FFFFFF";
    const vals = [
      i + 1, r.TIERS, r.NOM, r.CA_N, r.CHARGE_N, r.CA_N1, r.CHARGE_N1,
      r.EVOL_CA_VAL, r.EVOL_CA_PCT, r.EVOL_CHARGE_VAL, r.EVOL_CHARGE_PCT,
    ];
    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      const letter = String.fromCharCode(65 + ci); // A..K
      cell.value = v;
      cell.border = thinGris;
      cell.font = { size: 9 };
      cell.alignment = { horizontal: "center", vertical: "middle" };

      if (letter === "A") {
        cell.fill = fill(alt);
        cell.font = { bold: true, size: 9, color: { argb: "FF2E75B6" } };
      } else if (letter === "B") {
        cell.fill = fill(BLEU_PALE);
        cell.font = { size: 9, color: { argb: "FF0066CC" } };
      } else if (letter === "C") {
        cell.fill = fill(BLEU);
        cell.font = { size: 9, color: { argb: "FF003D7A" } };
        cell.alignment = { horizontal: "left", vertical: "middle" };
      } else if (letter === "D" || letter === "E" || letter === "G") {
        cell.fill = fill(alt);
        cell.numFmt = "#,##0";
      } else if (letter === "F") {
        cell.fill = fill("FFFFFF");
        cell.numFmt = "#,##0";
      } else if (letter === "H") {
        cell.fill = fill(MAUVE);
        cell.font = { size: 9, color: { argb: "FF4A148C" } };
        cell.numFmt = "#,##0";
      } else if (letter === "I") {
        cell.fill = fill(MAUVE);
        cell.font = { size: 9, color: { argb: "FF4A148C" } };
        cell.numFmt = "0.0%";
        cell.value = v / 100;
      } else if (letter === "J") {
        cell.fill = fill(MAUVE);
        cell.font = { size: 9, color: { argb: "FF4A148C" } };
        cell.numFmt = "#,##0";
      } else if (letter === "K") {
        cell.fill = fill(MAUVE);
        cell.font = { size: 9, color: { argb: "FF4A148C" } };
        cell.numFmt = "0.0%";
        cell.value = v / 100;
      }
    });
  });

  // Ligne TOTAL (n+4, ligne n+3 vide)
  const somme = (champ) => rows.reduce((s, r) => s + r[champ], 0);
  const caNT = somme("CA_N");
  const caN1T = somme("CA_N1");
  const chNT = somme("CHARGE_N");
  const chN1T = somme("CHARGE_N1");
  const totalVals = [
    "TOTAL", "", "TOTAL GÉNÉRAL",
    caNT, chNT, caN1T, chN1T,
    caNT - caN1T,
    caN1T > 0 ? ((caNT - caN1T) / caN1T) * 100 : 0,
    chNT - chN1T,
    chN1T > 0 ? ((chNT - chN1T) / chN1T) * 100 : 0,
  ];
  const totalRow = ws.getRow(n + 4);
  totalVals.forEach((v, ci) => {
    const cell = totalRow.getCell(ci + 1);
    const letter = String.fromCharCode(65 + ci);
    cell.value = v;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = fill("2E75B6");
    cell.border = mediumBleu;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    if (["D", "E", "F", "G", "H", "J"].includes(letter)) {
      cell.numFmt = "#,##0";
    } else if (letter === "I" || letter === "K") {
      cell.numFmt = "0.0%";
      cell.value = v / 100;
    }
  });

  // Mise en forme conditionnelle (coords pré-insertion : rows 2..n+1)
  const cfEnd = n + 1;
  ws.addConditionalFormatting({
    ref: `H2:H${cfEnd}`,
    rules: [{
      type: "iconSet", iconSet: "3Arrows", showValue: true, reverse: false,
      cfvo: [
        { type: "num", value: -999999 },
        { type: "num", value: 0 },
        { type: "num", value: 0.0001 },
      ],
    }],
  });
  // Évol Charges : flèches INVERSÉES (hausse = mauvais)
  ws.addConditionalFormatting({
    ref: `J2:J${cfEnd}`,
    rules: [{
      type: "iconSet", iconSet: "3Arrows", showValue: true, reverse: true,
      cfvo: [
        { type: "num", value: 0.0001 },
        { type: "num", value: 0 },
        { type: "num", value: -999999 },
      ],
    }],
  });
  ws.addConditionalFormatting({
    ref: `D2:D${cfEnd}`,
    rules: [{
      type: "dataBar",
      cfvo: [{ type: "min" }, { type: "max" }],
      color: { argb: "FF5B9BD5" },
      showValue: true,
    }],
  });

  // Largeurs + autofiltre (pré-insertion A1:K{n+1})
  const widths = [5, 12, 35, 15, 15, 15, 15, 18, 15, 18, 15];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.autoFilter = `A1:K${n + 1}`;

  return rows;
}

export default buildClientInterneSheet;