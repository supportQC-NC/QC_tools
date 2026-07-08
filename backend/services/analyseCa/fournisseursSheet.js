// backend/services/analyseCa/fournisseursSheet.js
//
// Onglet "Fournisseurs" — transcription fidèle de analyse_ca_fournisseur_final.py
// (classe AnalyseCAMargeStock, version active, feuille 'CA_fournisseurs' de
// Fournisseurs.xlsx ; nommée "Fournisseurs" à la consolidation, tabColor #FFC000).
//
// Source : details EXTERNES N / N-1 + référentiel articles (avec
// NOM_FOURNISSEUR) + référentiel fournisseurs (code FOUR).
// Règles reproduites :
//  - exclusion SUPPLÉMENTAIRE de l'article '999' (fournisseur interne), sur les
//    détails ET le référentiel articles.
//  - jointure détail -> articles.NOM_FOURNISSEUR (défaut 'INCONNU').
//  - réalignement N-1 au même jour de l'année que la dernière date réelle de N.
//  - nb_mois_periode = nb de mois entre la 1re et la dernière date de N.
//  - agrégat par fournisseur : CA/COUT/QTE (round2) ; NB_ART_VENDUS = QTE.
//  - stock (référentiel articles filtré) : VAL_STOCK = STOCK × PREV ;
//    NB_ART_DEPREC = nb articles DEPREC>0 ; VAL_DEPREC = Σ VAL_STOCK des
//    dépréciés ; NB_ART_TOTAL = nb de références ; TAUX_DEPREC (%).
//  - fusion externe ventes N/N-1/stock (fournisseurs sans vente inclus), 0 par
//    défaut ; EVOL_* (garde 100 si N-1=0 et N>0) ; DELTA_CA ; PART_CA ;
//    MOIS_STOCK = (VAL_STOCK/(1−%margeN/100)) / (CA_N/nb_mois) si CA_N>0,
//    nb_mois>0 et %margeN<100 sinon 0. Tri CA_N desc.
//  - code FOUR : correspondance nom fournisseur (UPPER) -> fournisseurs.FOURN,
//    'N/A' sinon.
//  - Excel 21 colonnes A..U (SANS Marge N), % stockés /100 format '0%',
//    dégradé de verts sur "Mois de stock" (≥18 / ≥12 / ≥6 / <6), ligne TOTAL
//    fond 2E75B6 (ligne vide avant), titre A1:U1, QUIRKS openpyxl reproduits
//    (CF/autofiltre/freeze/hauteurs non décalés par l'insertion du titre).

const HEADERS = [
  "#", "Fournisseur", "FOUR",
  "CA N\n(XPF)", "CA N-1\n(XPF)", "Évol.\nCA (%)", "Δ CA\n(XPF)", "Part\nCA (%)",
  "Taux\nMarge N (%)", "Marge N-1\n(XPF)", "Taux\nMarge N-1 (%)", "Évol.\nMARGE (%)",
  "Val Moy/Art\nN (XPF)", "Val Moy/Art\nN-1 (XPF)", "Évol.\nVal Moy (%)",
  "Nb Art\nVendus N", "Nb Art\nVendus N-1",
  "Val. Stock\n(XPF)", "Mois de\nstock", "Taux\nDépréc. (%)", "Nb Ref\nArticle",
]; // 21 colonnes = A..U

const MONTANT_COLS = [4, 5, 7, 10, 13, 14, 18]; // D E G J M N R
const PCT_COLS = [6, 8, 9, 11, 12, 15, 20]; // F H I K L O T
const INT_COLS = [16, 17, 21]; // P Q U
const MOIS_STOCK_COL = 19; // S

const r2 = (n) => Math.round(n * 100) / 100;

function evolPct(n, n1) {
  if (n1 !== 0) return ((n - n1) / n1) * 100;
  return n > 0 ? 100 : 0;
}

function parseDateFr(s) {
  if (typeof s !== "string" || !/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return null;
  const d = new Date(
    parseInt(s.slice(6, 10), 10),
    parseInt(s.slice(3, 5), 10) - 1,
    parseInt(s.slice(0, 2), 10),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayOfYear(d) {
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d - start) / 86400000) + 1;
}

// Exclusion supplémentaire du '999' (les autres filtres sont déjà appliqués
// par le socle : ! / 08* / 000001)
const nartExclu999 = (nart) => String(nart).trim() === "999";

// Agrège une année par NOM_FOURNISSEUR
function agregatParFournisseur(details, nomFournisseurByNart) {
  const map = new Map();
  for (const l of details) {
    if (nartExclu999(l.NART)) continue;
    const nomF =
      nomFournisseurByNart.get(String(l.NART).toUpperCase()) || "INCONNU";
    const ca = l.QTE * l.PVTE * (1 - l.POURC / 100);
    const cout = l.QTE * l.PREV;
    if (!map.has(nomF)) map.set(nomF, { ca: 0, cout: 0, qte: 0 });
    const f = map.get(nomF);
    f.ca += ca;
    f.cout += cout;
    f.qte += l.QTE;
  }
  for (const f of map.values()) {
    f.ca = r2(f.ca);
    f.cout = r2(f.cout);
    f.qte = r2(f.qte);
  }
  return map;
}

/**
 * Calcule les lignes du tableau + nb_mois_periode.
 */
function calculerLignes(datasets) {
  const detailsN = datasets.detailsN;

  // Réalignement N-1 + nb de mois de la période (dates réelles de N)
  let detailsN1 = datasets.detailsN1;
  let premiere = null;
  let derniere = null;
  for (const l of detailsN) {
    const d = parseDateFr(l.date_facture);
    if (!d) continue;
    if (!premiere || d < premiere) premiere = d;
    if (!derniere || d > derniere) derniere = d;
  }
  let nbMois = 12;
  if (premiere && derniere) {
    nbMois =
      (derniere.getFullYear() - premiere.getFullYear()) * 12 +
      derniere.getMonth() - premiere.getMonth() + 1;
    const jours = dayOfYear(derniere);
    const limite = new Date(derniere.getFullYear() - 1, 0, 1);
    limite.setDate(limite.getDate() + jours - 1);
    limite.setHours(23, 59, 59, 999);
    detailsN1 = detailsN1.filter((l) => {
      const d = parseDateFr(l.date_facture);
      return d && d <= limite;
    });
  }

  // Référentiel articles : NART -> NOM_FOURNISSEUR (mêmes exclusions + '999')
  const nomFournisseurByNart = new Map();
  const articlesFiltres = [];
  for (const a of datasets.articles) {
    const nart = String(a.NART).trim();
    if (
      nart.startsWith("08") ||
      nart === "000001" ||
      nart.includes("!") ||
      nart === "999"
    ) {
      continue;
    }
    articlesFiltres.push(a);
    nomFournisseurByNart.set(nart.toUpperCase(), a.NOM_FOURNISSEUR || "INCONNU");
  }

  const aggN = agregatParFournisseur(detailsN, nomFournisseurByNart);
  const aggN1 = agregatParFournisseur(detailsN1, nomFournisseurByNart);

  // Métriques de stock par fournisseur (référentiel filtré)
  const stockMap = new Map();
  for (const a of articlesFiltres) {
    const nomF = a.NOM_FOURNISSEUR || "INCONNU";
    const valStock = a.STOCK * a.PREV;
    if (!stockMap.has(nomF)) {
      stockMap.set(nomF, {
        valStock: 0, nbDeprec: 0, valDeprec: 0, nbTotal: 0,
      });
    }
    const s = stockMap.get(nomF);
    s.valStock += valStock;
    s.nbTotal += 1;
    if (a.DEPREC > 0) {
      s.nbDeprec += 1;
      s.valDeprec += valStock;
    }
  }
  for (const s of stockMap.values()) {
    s.valStock = r2(s.valStock);
    s.valDeprec = r2(s.valDeprec);
  }

  // Fusion externe (ventes N ∪ N-1 ∪ stock)
  const noms = new Set([...aggN.keys(), ...aggN1.keys(), ...stockMap.keys()]);
  const rows = [];
  for (const nom of noms) {
    const n = aggN.get(nom) || { ca: 0, cout: 0, qte: 0 };
    const n1 = aggN1.get(nom) || { ca: 0, cout: 0, qte: 0 };
    const st = stockMap.get(nom) || {
      valStock: 0, nbDeprec: 0, valDeprec: 0, nbTotal: 0,
    };

    const margeN = n.ca - n.cout;
    const margeN1 = n1.ca - n1.cout;
    const pctMargeN = n.ca !== 0 ? (margeN / n.ca) * 100 : 0;
    const pctMargeN1 = n1.ca !== 0 ? (margeN1 / n1.ca) * 100 : 0;
    const valMoyN = n.qte > 0 ? n.ca / n.qte : 0;
    const valMoyN1 = n1.qte > 0 ? n1.ca / n1.qte : 0;
    const tauxDeprec = st.valStock !== 0 ? (st.valDeprec / st.valStock) * 100 : 0;
    const moisStock =
      n.ca > 0 && nbMois > 0 && pctMargeN < 100
        ? st.valStock / (1 - pctMargeN / 100) / (n.ca / nbMois)
        : 0;

    rows.push({
      fournisseur: nom,
      caN: n.ca, caN1: n1.ca,
      evolCa: evolPct(n.ca, n1.ca),
      deltaCa: n.ca - n1.ca,
      margeN, margeN1, pctMargeN, pctMargeN1,
      evolMarge: evolPct(margeN, margeN1),
      valMoyN, valMoyN1,
      evolValMoy: evolPct(valMoyN, valMoyN1),
      nbArtVendusN: n.qte, nbArtVendusN1: n1.qte,
      valStock: st.valStock,
      moisStock,
      tauxDeprec,
      nbArtTotal: st.nbTotal,
      valDeprec: st.valDeprec,
    });
  }

  const totalCa = rows.reduce((s, r) => s + r.caN, 0);
  for (const r of rows) {
    r.partCa = totalCa > 0 ? (r.caN / totalCa) * 100 : 0;
  }
  rows.sort((a, b) => b.caN - a.caN);
  return { rows, nbMois };
}

/**
 * Ajoute l'onglet Fournisseurs au classeur ExcelJS.
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets }
 */
export function buildFournisseursSheet(workbook, ctx) {
  const { datasets } = ctx;
  const { rows, nbMois } = calculerLignes(datasets);
  const n = rows.length;

  // Code FOUR : nom (UPPER) -> code (1re occurrence), 'N/A' sinon
  const fournByNom = new Map();
  for (const f of datasets.fournisseurs) {
    const key = String(f.NOM || "").trim().toUpperCase();
    if (key && !fournByNom.has(key)) fournByNom.set(key, String(f.FOURN || "").trim());
  }
  const codeFour = (nom) =>
    fournByNom.get(String(nom).trim().toUpperCase()) ?? "N/A";

  const ws = workbook.addWorksheet("Fournisseurs", {
    properties: { tabColor: { argb: "FFFFC000" } },
    views: [{ state: "frozen", xSplit: 3, ySplit: 1 }], // freeze D2 (quirk)
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

  // ── Titre (ligne 1) ────────────────────────────────────────────────────────
  const auj = new Date();
  const p = (x) => String(x).padStart(2, "0");
  ws.mergeCells("A1:U1");
  const title = ws.getCell("A1");
  title.value = `ANALYSE CA PAR FOURNISSEUR - ${p(auj.getDate())}/${p(auj.getMonth() + 1)}/${auj.getFullYear()}`;
  title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = fill("1F4E79");
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  // ── En-têtes (ligne 2) ─────────────────────────────────────────────────────
  const headerRow = ws.getRow(2);
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = fill("1F4E79");
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = mediumGris;
  });

  const valeurs = (r, rang) => [
    rang, r.fournisseur, codeFour(r.fournisseur),
    r.caN, r.caN1, r.evolCa, r.deltaCa, r.partCa,
    r.pctMargeN, r.margeN1, r.pctMargeN1, r.evolMarge,
    r.valMoyN, r.valMoyN1, r.evolValMoy,
    r.nbArtVendusN, r.nbArtVendusN1,
    r.valStock, r.moisStock, r.tauxDeprec, r.nbArtTotal,
  ];

  const styleDataCell = (cell, colIdx, parity) => {
    if (colIdx === 5) {
      // E : CA N-1, fond blanc, texte noir
      cell.fill = fill("FFFFFF");
      cell.font = { bold: true, size: 9, color: { argb: "FF000000" } };
    } else if ([6, 12, 15].includes(colIdx)) {
      // F, L, O : mauve
      cell.fill = fill("E6D7FF");
      cell.font = { bold: true, size: 9, color: { argb: "FF4A148C" } };
    } else if (colIdx === 9) {
      // I : Taux Marge N, jaune
      cell.fill = fill("FFF9C4");
      cell.font = { bold: true, size: 9, color: { argb: "FFE65100" } };
    } else if (colIdx === 18) {
      // R : Val. Stock, vert pastel
      cell.fill = fill("D4EDDA");
      cell.font = { bold: true, size: 9, color: { argb: "FF155724" } };
    } else if (colIdx === MOIS_STOCK_COL) {
      // S : dégradé de verts selon la valeur
      const v = cell.value;
      if (typeof v === "number") {
        if (v >= 18) {
          cell.fill = fill("155724");
          cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
        } else if (v >= 12) {
          cell.fill = fill("28A745");
          cell.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" } };
        } else if (v >= 6) {
          cell.fill = fill("71C776");
          cell.font = { bold: true, size: 9, color: { argb: "FF000000" } };
        } else {
          cell.fill = fill("C3E6CB");
          cell.font = { bold: true, size: 9, color: { argb: "FF000000" } };
        }
      } else {
        cell.font = { bold: true, size: 9 };
      }
    } else {
      cell.fill = fill(parity === 0 ? "F8F8F8" : "FFFFFF");
      cell.font = { bold: true, size: 9 };
    }
    cell.border = mediumGris;
    cell.alignment =
      colIdx === 2 || colIdx === 3
        ? { horizontal: "left", vertical: "middle" }
        : { horizontal: "center", vertical: "middle" };
  };

  const appliquerFormat = (cell, colIdx) => {
    if (typeof cell.value !== "number") return;
    if (MONTANT_COLS.includes(colIdx) || INT_COLS.includes(colIdx)) {
      cell.numFmt = "#,##0";
    } else if (PCT_COLS.includes(colIdx)) {
      cell.value = cell.value / 100;
      cell.numFmt = "0%";
    } else if (colIdx === MOIS_STOCK_COL) {
      cell.numFmt = "0.0";
    }
  };

  // ── Données (lignes 3..n+2) ────────────────────────────────────────────────
  rows.forEach((r, i) => {
    const row = ws.getRow(3 + i);
    const parity = (i + 2) % 2 === 0 ? 0 : 1;
    valeurs(r, i + 1).forEach((v, c) => {
      const colIdx = c + 1;
      const cell = row.getCell(colIdx);
      cell.value = v;
      styleDataCell(cell, colIdx, parity);
      appliquerFormat(cell, colIdx);
    });
    row.getCell(1).font = { bold: true, size: 9, color: { argb: "FF2E75B6" } };
  });

  // ── Ligne TOTAL (n+4, ligne n+3 vide) ──────────────────────────────────────
  const somme = (champ) => rows.reduce((s, r) => s + r[champ], 0);
  const caNT = somme("caN");
  const caN1T = somme("caN1");
  const margeNT = somme("margeN");
  const margeN1T = somme("margeN1");
  const qteNT = somme("nbArtVendusN");
  const qteN1T = somme("nbArtVendusN1");
  const valStockT = somme("valStock");
  const valDeprecT = somme("valDeprec");
  const tauxMargeT = caNT > 0 ? (margeNT / caNT) * 100 : 0;
  const valMoyNT = qteNT > 0 ? caNT / qteNT : 0;
  const valMoyN1T = qteN1T > 0 ? caN1T / qteN1T : 0;
  const evolT = (a, b) => (b > 0 ? ((a - b) / b) * 100 : 0);
  const moisStockT =
    caNT > 0 && nbMois > 0 && tauxMargeT < 100
      ? valStockT / (1 - tauxMargeT / 100) / (caNT / nbMois)
      : 0;

  const totalVals = [
    "TOTAL", "TOTAL GÉNÉRAL", "",
    caNT, caN1T, evolT(caNT, caN1T), somme("deltaCa"), 100,
    tauxMargeT, margeN1T, caN1T > 0 ? (margeN1T / caN1T) * 100 : 0,
    evolT(margeNT, margeN1T),
    valMoyNT, valMoyN1T, evolT(valMoyNT, valMoyN1T),
    qteNT, qteN1T,
    valStockT, moisStockT,
    valStockT > 0 ? (valDeprecT / valStockT) * 100 : 0,
    somme("nbArtTotal"),
  ];

  const totalRow = ws.getRow(n + 4);
  totalVals.forEach((v, c) => {
    const colIdx = c + 1;
    const cell = totalRow.getCell(colIdx);
    cell.value = v;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = fill("2E75B6");
    cell.border = mediumBleu;
    cell.alignment = { horizontal: "center", vertical: "middle" };
    appliquerFormat(cell, colIdx);
  });

  // ── Mise en forme conditionnelle (coordonnées pré-insertion, quirk) ────────
  const cfEnd = n + 1;
  ws.addConditionalFormatting({
    ref: `D2:D${cfEnd}`,
    rules: [
      {
        type: "dataBar",
        cfvo: [{ type: "min" }, { type: "max" }],
        color: { argb: "FF5B9BD5" },
        showValue: true,
      },
    ],
  });
  ws.addConditionalFormatting({
    ref: `H2:H${cfEnd}`,
    rules: [
      {
        type: "colorScale",
        cfvo: [
          { type: "min" },
          { type: "percentile", value: 50 },
          { type: "max" },
        ],
        color: [
          { argb: "FFFFFFFF" },
          { argb: "FFFFE699" },
          { argb: "FFFF9933" },
        ],
      },
    ],
  });
  for (const col of ["F", "L"]) {
    ws.addConditionalFormatting({
      ref: `${col}2:${col}${cfEnd}`,
      rules: [
        {
          type: "iconSet",
          iconSet: "3Arrows",
          showValue: true,
          reverse: false,
          cfvo: [
            { type: "num", value: -999999 },
            { type: "num", value: 0 },
            { type: "num", value: 0.0001 },
          ],
        },
      ],
    });
  }

  // ── Autofiltre (quirk) + largeurs ──────────────────────────────────────────
  ws.autoFilter = `A1:U${n + 1}`;
  const widths = [
    5, 30, 8, 15, 15, 13, 13, 10, 15, 15, 15, 15,
    15, 15, 15, 15, 15, 15, 12, 15, 15,
  ];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  return ws;
}

export default buildFournisseursSheet;