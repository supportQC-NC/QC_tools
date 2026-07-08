// backend/services/analyseCa/rayonsSheet.js
//
// Onglet "Rayons" (#FF6B6B) — transcription fidèle de analyse_ca_rayon.py
// (classe AnalyseRayonsGISM1, version active).
//
// Source : details EXTERNES N / N-1 + référentiel articles (GISM1, stock,
// dépréciation) + dictionnaire rayons (GISM1 -> libellé + métrage).
//  - jointure détail NART -> articles.GISM1 ("INCONNU" si absent).
//  - agrégat par GISM1 : CA/COUT/MARGE/QTE (somme, arrondis 2 déc.).
//  - stock par GISM1 (TOUS articles, non filtrés) : STOCK = Σ STOCK×PREV ;
//    NBR_ART_DEPREC = nb DEPREC>0 ; VALEUR_DEPREC = Σ val. des dépréciés ;
//    TAUX_DEPREC = VALEUR_DEPREC / STOCK × 100.
//  - dictionnaire : LBL_RAYON (défaut GISM1), METRAGE (défaut 0) ;
//    CA_METRE = CA / METRAGE (si METRAGE > 0). Dictionnaire absent -> dégrade
//    (libellé = code, métrage 0).
//  - tri CA desc, FILTRE CA > 0 (rayons actifs uniquement).
//
// 13 colonnes A..M avec mise en forme propre + ligne TOTAL À FORMULES Excel.
// QUIRKS openpyxl reproduits (insert_rows(1) du titre ne décale ni la mise en
// forme conditionnelle, ni l'autofiltre, ni le gel, ni les hauteurs).

const HEADERS = [
  "LBL_RAYON", "CODE_RAYON", "CA", "MARGE", "R/H",
  "STOCK", "MARGE_VAL", "R/H_2", "NBR_ART_DEPREC",
  "VALEUR_DEPREC", "TAUX_DEPREC", "METRAGE", "CA_METRE",
];

const r2 = (n) => Math.round(n * 100) / 100;

function evolPct(n, n1) {
  if (n1 !== 0) return ((n - n1) / n1) * 100;
  return n > 0 ? 100 : 0;
}

function agregatVentes(details, articleByNart) {
  const map = new Map(); // gism -> {ca, cout, marge, qte}
  for (const l of details) {
    const art = articleByNart.get(String(l.NART).toUpperCase());
    const gism = art && art.GISM1 ? art.GISM1 : "INCONNU";
    const ca = l.QTE * l.PVTE * (1 - l.POURC / 100);
    const cout = l.QTE * l.PREV;
    if (!map.has(gism)) map.set(gism, { ca: 0, cout: 0, marge: 0, qte: 0 });
    const a = map.get(gism);
    a.ca += ca;
    a.cout += cout;
    a.marge += ca - cout;
    a.qte += l.QTE;
  }
  for (const a of map.values()) {
    a.ca = r2(a.ca);
    a.cout = r2(a.cout);
    a.marge = r2(a.marge);
    a.qte = r2(a.qte);
  }
  return map;
}

/**
 * Ajoute l'onglet Rayons au classeur.
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets, dictionnaire }  (dictionnaire : Map|null)
 */
export function buildRayonsSheet(workbook, ctx) {
  const { datasets, dictionnaire } = ctx;
  const { articleByNart } = datasets;

  const aggN = agregatVentes(datasets.detailsN, articleByNart);
  const aggN1 = agregatVentes(datasets.detailsN1, articleByNart);

  // Stock par GISM1 (TOUS les articles, non filtrés)
  const stockParGism = new Map();
  for (const a of datasets.articles) {
    const gism = a.GISM1 || "";
    const valStock = a.STOCK * a.PREV;
    if (!stockParGism.has(gism)) {
      stockParGism.set(gism, { stock: 0, nbDeprec: 0, valDeprec: 0, nbTotal: 0 });
    }
    const s = stockParGism.get(gism);
    s.stock += valStock;
    s.nbTotal += 1;
    if (a.DEPREC > 0) {
      s.nbDeprec += 1;
      s.valDeprec += valStock;
    }
  }
  for (const s of stockParGism.values()) {
    s.stock = r2(s.stock);
    s.valDeprec = r2(s.valDeprec);
  }

  // Fusion (outer) ventes N / N-1 / stock
  const gisms = new Set([
    ...aggN.keys(), ...aggN1.keys(), ...stockParGism.keys(),
  ]);
  const rows = [];
  for (const gism of gisms) {
    const n = aggN.get(gism) || { ca: 0, marge: 0 };
    const n1 = aggN1.get(gism) || { ca: 0, marge: 0 };
    const st = stockParGism.get(gism) || { stock: 0, nbDeprec: 0, valDeprec: 0 };

    const marge = n.ca !== 0 ? (n.marge / n.ca) * 100 : 0;
    const rhCa = evolPct(n.ca, n1.ca);
    const rhMarge = evolPct(n.marge, n1.marge);
    const tauxDeprec = st.stock !== 0 ? (st.valDeprec / st.stock) * 100 : 0;

    const dico = dictionnaire ? dictionnaire.get(gism) : null;
    const lbl = dico && dico.libelle ? dico.libelle : gism;
    const metrage = dico ? dico.metrage : 0;
    const caMetre = metrage > 0 ? n.ca / metrage : 0;

    rows.push({
      LBL_RAYON: lbl,
      CODE_RAYON: gism,
      CA: n.ca,
      MARGE: marge,
      "R/H": rhCa,
      STOCK: st.stock,
      MARGE_VAL: n.marge,
      "R/H_2": rhMarge,
      NBR_ART_DEPREC: st.nbDeprec,
      VALEUR_DEPREC: st.valDeprec,
      TAUX_DEPREC: tauxDeprec,
      METRAGE: metrage,
      CA_METRE: caMetre,
    });
  }

  // Filtre CA > 0, tri CA desc
  const data = rows.filter((r) => r.CA > 0).sort((a, b) => b.CA - a.CA);
  const n = data.length;

  const ws = workbook.addWorksheet("Rayons", {
    properties: { tabColor: { argb: "FFFF6B6B" } },
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }], // freeze C2 (quirk)
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

  // Titre A1:M1 (h30)
  ws.mergeCells("A1:M1");
  const auj = new Date();
  const p = (x) => String(x).padStart(2, "0");
  const title = ws.getCell("A1");
  title.value = `ANALYSE DES RAYONS PAR CODE GISM1 - ${p(auj.getDate())}/${p(auj.getMonth() + 1)}/${auj.getFullYear()}`;
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

  const BLEU = "D6E8FA", BLEU_PALE = "E8F4FD", MAUVE = "E6D7FF",
    JAUNE = "FFF9C4", ORANGE = "FFE4CC", VERT = "E8F5E8", LIGHT = "F2F2F2";

  // Données (rows 3..n+2)
  data.forEach((r, i) => {
    const excelRow = 3 + i;
    const row = ws.getRow(excelRow);
    // parité du script : row_idx (2..) pré-insertion ; ligne data k (0-based) ->
    // row_idx = k + 2 ; is_even = (k+2)%2==0. alt = LIGHT si pair sinon blanc.
    const alt = (i + 2) % 2 === 0 ? LIGHT : "FFFFFF";
    const vals = [
      r.LBL_RAYON, r.CODE_RAYON, r.CA, r.MARGE, r["R/H"],
      r.STOCK, r.MARGE_VAL, r["R/H_2"], r.NBR_ART_DEPREC,
      r.VALEUR_DEPREC, r.TAUX_DEPREC, r.METRAGE, r.CA_METRE,
    ];
    vals.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      const letter = String.fromCharCode(65 + ci); // A..M
      cell.value = v;
      cell.border = thinGris;
      cell.font = { size: 9 };
      cell.alignment = { horizontal: "center", vertical: "middle" };

      if (letter === "A") {
        cell.fill = fill(BLEU);
        cell.font = { size: 9, color: { argb: "FF003D7A" } };
        cell.alignment = { horizontal: "left", vertical: "middle" };
      } else if (letter === "B") {
        cell.fill = fill(BLEU_PALE);
        cell.font = { size: 9, color: { argb: "FF0066CC" } };
      } else if (letter === "C") {
        cell.fill = fill(alt);
        cell.numFmt = "#,##0";
      } else if (letter === "D") {
        cell.fill = fill(JAUNE);
        cell.font = { size: 9, color: { argb: "FFE65100" } };
        cell.numFmt = "0.0%";
        cell.value = v / 100;
      } else if (letter === "E") {
        cell.fill = fill(MAUVE);
        cell.numFmt = "+0.0%;-0.0%;0.0%";
        cell.value = v / 100;
        if (v > 0) cell.font = { size: 9, color: { argb: "FF70AD47" }, bold: true };
        else if (v < 0) cell.font = { size: 9, color: { argb: "FFC5504B" }, bold: true };
        else cell.font = { size: 9, color: { argb: "FF4A148C" } };
      } else if (letter === "F") {
        cell.fill = fill(alt);
        cell.numFmt = "#,##0";
      } else if (letter === "G") {
        cell.fill = fill(JAUNE);
        cell.font = { size: 9, color: { argb: "FFE65100" } };
        cell.numFmt = "#,##0";
      } else if (letter === "H") {
        cell.fill = fill(MAUVE);
        cell.numFmt = "+0.0%;-0.0%;0.0%";
        cell.value = v / 100;
        if (v > 0) cell.font = { size: 9, color: { argb: "FF70AD47" }, bold: true };
        else if (v < 0) cell.font = { size: 9, color: { argb: "FFC5504B" }, bold: true };
        else cell.font = { size: 9, color: { argb: "FF4A148C" } };
      } else if (letter === "I") {
        cell.fill = fill(ORANGE);
        cell.font = { size: 9, color: { argb: "FFCC5500" } };
        cell.numFmt = "#,##0";
      } else if (letter === "J") {
        cell.fill = fill(alt);
        cell.numFmt = "#,##0";
      } else if (letter === "K") {
        cell.fill = fill(alt);
        cell.numFmt = "0.0%";
        cell.value = v / 100;
      } else if (letter === "L") {
        cell.fill = fill(alt);
        cell.numFmt = "0.0";
      } else if (letter === "M") {
        cell.fill = fill(VERT);
        cell.font = { size: 9, color: { argb: "FF2E7D32" } };
        cell.numFmt = "#,##0";
      }
    });
  });

  // Ligne TOTAL (n+3) — formules Excel (référencent les données rows 3..n+2)
  const totalRow = n + 3;
  const dataStart = 3;
  const dataEndRow = n + 2;
  const tr = ws.getRow(totalRow);
  const setTotal = (col, value) => {
    const cell = tr.getCell(col);
    cell.value = value;
    cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = fill("2E75B6");
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = mediumBleu;
    return cell;
  };
  setTotal(1, "TOTAL GÉNÉRAL");
  setTotal(2, "");
  // Sommes (C,F,G,I,J,M)
  const sumCols = { C: 3, F: 6, G: 7, I: 9, J: 10, M: 13 };
  for (const [letter, idx] of Object.entries(sumCols)) {
    const cell = setTotal(idx, {
      formula: `SUM(${letter}${dataStart}:${letter}${dataEndRow})`,
    });
    cell.numFmt = "#,##0";
  }
  // Moyennes pondérées
  const dCell = setTotal(4, {
    formula: `IF(C${totalRow}>0,G${totalRow}/C${totalRow},0)`,
  });
  dCell.numFmt = "0.0%";
  const kCell = setTotal(11, {
    formula: `IF(F${totalRow}>0,J${totalRow}/F${totalRow},0)`,
  });
  kCell.numFmt = "0.0%";
  // E, H, L, et B : cellules total sans valeur (mise en forme seulement)
  setTotal(5, "");
  setTotal(8, "");
  const lCell = setTotal(12, "");
  lCell.numFmt = "0.0";

  // Mise en forme conditionnelle (coordonnées PRÉ-insertion : rows 2..n+1)
  const cfEnd = n + 1;
  ws.addConditionalFormatting({
    ref: `K2:K${cfEnd}`,
    rules: [{
      type: "colorScale",
      cfvo: [
        { type: "min" },
        { type: "percentile", value: 50 },
        { type: "max" },
      ],
      color: [
        { argb: "FFC3E6CB" },
        { argb: "FFFFC000" },
        { argb: "FFFF6B6B" },
      ],
    }],
  });
  ws.addConditionalFormatting({
    ref: `C2:C${cfEnd}`,
    rules: [{
      type: "dataBar",
      cfvo: [{ type: "min" }, { type: "max" }],
      color: { argb: "FF5B9BD5" },
      showValue: true,
    }],
  });
  for (const col of ["E", "H"]) {
    ws.addConditionalFormatting({
      ref: `${col}2:${col}${cfEnd}`,
      rules: [{
        type: "iconSet", iconSet: "3Arrows", showValue: true, reverse: false,
        cfvo: [
          { type: "num", value: -999999 },
          { type: "num", value: 0 },
          { type: "num", value: 0.0001 },
        ],
      }],
    });
  }

  // Largeurs + autofiltre (pré-insertion A1:M{n+1})
  const widths = [35, 12, 15, 10, 10, 15, 15, 10, 14, 15, 12, 10, 15];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.autoFilter = `A1:M${n + 1}`;

  return data;
}

export default buildRayonsSheet;