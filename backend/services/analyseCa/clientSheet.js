// backend/services/analyseCa/clientSheet.js
//
// Onglet "Client" — transcription fidèle de analyse_ca_client_final.py
// (classe AnalyseCAClient, version active, feuille 'CA_clients' du fichier
// Client.xlsx ; nommée "Client" à la consolidation, tabColor #70AD47).
//
// Source : details EXTERNES N / N-1 + référentiel clients (socle).
// Particularités reproduites à l'identique :
//  - standardisation de catégorie SPÉCIFIQUE (AUTRES avec un S ; ''/0/NAN/
//    INCONNU -> AUTRES ; PARTICULER -> PARTICULIER ; PRO+DEBIT -> PRO DEBIT).
//  - réalignement N-1 : dernière date réelle de N -> jour de l'année ;
//    N-1 filtré au même jour de l'année (datetime(N-1,1,1)+jours-1).
//  - agrégat par client (NOM, TIERS, CATEGORIE, PROFES) : CA/COUT/QTE arrondis
//    2 déc., nb factures uniques, nb NART uniques ; NUC = moyenne par facture
//    des références uniques (arrondi 2 déc.).
//  - fusion externe N/N-1 : clients uniquement N-1 -> CATEGORIE "AUTRES",
//    PROFES "" (comportement du merge du script).
//  - évolutions : (n-n1)/n1×100, sinon 100 si n>0 sinon 0 ; PART_CA ;
//    CA moyen/facture ; valeur moyenne/article (CA/QTE si QTE>0).
//  - tri CA_N décroissant, colonne RANG.
//  - Excel : les pourcentages sont STOCKÉS /100 avec format '0%' ;
//    montants '#,##0' ; NUC '0.00' ; fonds par colonne ; bordures MEDIUM
//    D3D3D3 ; ligne TOTAL fond 2E75B6 bordure medium 2E75B6, séparée par une
//    ligne vide ; titre fusionné A1:AE1 "ANALYSE CA PAR CLIENT - JJ/MM/AAAA".
//  - QUIRKS openpyxl reproduits (insert_rows(1) ne décale ni la mise en forme
//    conditionnelle, ni l'autofiltre, ni le gel de volets, ni les hauteurs) :
//    -> CF sur les lignes 2..n+1 (décalées d'une ligne vs données),
//    -> autofiltre A1:AE{n+1}, volets figés F2, hauteur de ligne 30 sur le
//    titre seulement (l'en-tête garde la hauteur par défaut).

const HEADERS = [
  "#", "Client", "Code\nTiers", "Catégorie", "Profession",
  "CA N\n(XPF)", "CA N-1\n(XPF)", "Évol.\nCA (%)", "Part\nCA (%)",
  "Marge N\n(XPF)", "Taux\nMarge N (%)", "Marge N-1\n(XPF)",
  "Taux\nMarge N-1 (%)", "Évol.\nMARGE (%)",
  "Nb Factures\nN", "Nb Factures\nN-1", "Évol.\nNb Fact (%)",
  "CA Moy/Fact\nN (XPF)", "CA Moy/Fact\nN-1 (XPF)", "Évol.\nCA Moy/Fact (%)",
  "Val Moy/Art\nN (XPF)", "Val Moy/Art\nN-1 (XPF)", "Évol.\nVal Moy (%)",
  "Quantité\nN", "Quantité\nN-1",
  "NUC\nN", "NUC\nN-1", "Évol.\nNUC (%)",
  "Nb Réf.\nN", "Nb Réf.\nN-1", "Évol.\nNb Réf. (%)",
]; // 31 colonnes = A..AE

// Index (1-based) par lettre openpyxl
const MONTANT_COLS = [6, 7, 10, 12, 18, 19, 21, 22]; // F G J L R S U V
const PCT_COLS = [8, 9, 11, 13, 14, 17, 20, 23, 28, 31]; // H I K M N Q T W AB AE
const INT_COLS = [15, 16, 24, 25, 29, 30]; // O P X Y AC AD
const NUC_COLS = [26, 27]; // Z AA

// standardize_category du script (version "AUTRES")
function standardizeCategory(category) {
  const s = category === null || category === undefined ? "" : String(category).trim();
  if (s === "") return "AUTRES";
  const c = s.toUpperCase();
  if (["0", "0.0", "NAN", "NULL", "NONE", "INCONNU"].includes(c)) return "AUTRES";
  if (c === "AUTRE" || c === "AUTRES") return "AUTRES";
  if (c === "FIDELITE") return "FIDELITE";
  if (c === "REVENDEUR") return "REVENDEUR";
  if (c === "PARTICULER") return "PARTICULIER";
  if (c.includes("PRO") && c.includes("DEBIT")) return "PRO DEBIT";
  const standard = [
    "PARTICULIER", "PRO COMPTANT", "PRO DEBIT", "ADMINISTRATION",
    "AGRICULTEUR", "GROUPE", "EMPLOYE", "FIDELITE", "REVENDEUR",
  ];
  if (standard.includes(c)) return c;
  return "AUTRES";
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

const r2 = (n) => Math.round(n * 100) / 100;

// Évolution % : (n - n1)/n1×100 ; 100 si n1==0 et n>0 ; sinon 0
function evolPct(n, n1) {
  if (n1 !== 0) return ((n - n1) / n1) * 100;
  return n > 0 ? 100 : 0;
}

// Agrège une année par client : Map "NOM|TIERS" -> métriques
function agregatParClient(details, clientByTiers) {
  const parClient = new Map();
  const parClientFacture = new Map(); // "NOM|TIERS|NUMFACT" -> Set NART

  for (const l of details) {
    const cli = clientByTiers.get(l.TIERS_ID);
    const nom = cli && cli.NOM ? cli.NOM : "CLIENT INCONNU";
    const categorie = standardizeCategory(cli ? cli.CATEGORIE : null);
    const profes = cli && cli.PROFES ? cli.PROFES : "";
    const key = `${nom}|${l.TIERS_ID}`;

    const ca = l.QTE * l.PVTE * (1 - l.POURC / 100);
    const cout = l.QTE * l.PREV;

    if (!parClient.has(key)) {
      parClient.set(key, {
        nom, tiers: l.TIERS_ID, categorie, profes,
        ca: 0, cout: 0, qte: 0,
        factures: new Set(), narts: new Set(),
      });
    }
    const c = parClient.get(key);
    c.ca += ca;
    c.cout += cout;
    c.qte += l.QTE;
    c.factures.add(l.NUMFACT);
    c.narts.add(l.NART);

    const fk = `${key}|${l.NUMFACT}`;
    if (!parClientFacture.has(fk)) parClientFacture.set(fk, { key, narts: new Set() });
    parClientFacture.get(fk).narts.add(l.NART);
  }

  // NUC par client = moyenne des références uniques par facture (round 2)
  const nucAgg = new Map(); // key -> {somme, nb}
  for (const f of parClientFacture.values()) {
    if (!nucAgg.has(f.key)) nucAgg.set(f.key, { somme: 0, nb: 0 });
    const a = nucAgg.get(f.key);
    a.somme += f.narts.size;
    a.nb += 1;
  }

  const out = new Map();
  for (const [key, c] of parClient) {
    const nuc = nucAgg.get(key);
    out.set(key, {
      nom: c.nom,
      tiers: c.tiers,
      categorie: c.categorie,
      profes: c.profes,
      ca: r2(c.ca),
      cout: r2(c.cout),
      qte: r2(c.qte),
      nbFactures: c.factures.size,
      nbNart: c.narts.size,
      nuc: nuc && nuc.nb > 0 ? r2(nuc.somme / nuc.nb) : 0,
    });
  }
  return out;
}

/**
 * Calcule le tableau final (une ligne par client, trié CA_N desc).
 */
function calculerLignes(datasets) {
  const { clientByTiers } = datasets;
  const detailsN = datasets.detailsN;

  // Réalignement N-1 au même jour de l'année que la dernière date réelle de N
  let detailsN1 = datasets.detailsN1;
  let derniere = null;
  for (const l of detailsN) {
    const d = parseDateFr(l.date_facture);
    if (d && (!derniere || d > derniere)) derniere = d;
  }
  if (derniere) {
    const jours = dayOfYear(derniere);
    const limite = new Date(derniere.getFullYear() - 1, 0, 1);
    limite.setDate(limite.getDate() + jours - 1);
    limite.setHours(23, 59, 59, 999);
    detailsN1 = detailsN1.filter((l) => {
      const d = parseDateFr(l.date_facture);
      return d && d <= limite;
    });
  }

  const aggN = agregatParClient(detailsN, clientByTiers);
  const aggN1 = agregatParClient(detailsN1, clientByTiers);

  // Fusion externe sur (NOM, TIERS)
  const keys = new Set([...aggN.keys(), ...aggN1.keys()]);
  const rows = [];
  for (const key of keys) {
    const n = aggN.get(key);
    const n1 = aggN1.get(key);
    const base = n || n1;
    // Clients uniquement N-1 : CATEGORIE 'AUTRES', PROFES '' (merge du script)
    const categorie = n ? n.categorie : "AUTRES";
    const profes = n ? n.profes : "";

    const caN = n ? n.ca : 0;
    const caN1 = n1 ? n1.ca : 0;
    const coutN = n ? n.cout : 0;
    const coutN1 = n1 ? n1.cout : 0;
    const margeN = caN - coutN;
    const margeN1 = caN1 - coutN1;
    const qteN = n ? n.qte : 0;
    const qteN1 = n1 ? n1.qte : 0;
    const nbFactN = n ? n.nbFactures : 0;
    const nbFactN1 = n1 ? n1.nbFactures : 0;
    const nucN = n ? n.nuc : 0;
    const nucN1 = n1 ? n1.nuc : 0;
    const nbNartN = n ? n.nbNart : 0;
    const nbNartN1 = n1 ? n1.nbNart : 0;

    const caMoyFactN = nbFactN > 0 ? caN / nbFactN : 0;
    const caMoyFactN1 = nbFactN1 > 0 ? caN1 / nbFactN1 : 0;
    const valMoyN = qteN > 0 ? caN / qteN : 0;
    const valMoyN1 = qteN1 > 0 ? caN1 / qteN1 : 0;

    rows.push({
      nomClient: base.nom,
      tiers: base.tiers,
      categorie: standardizeCategory(categorie),
      profes,
      caN, caN1,
      evolCa: evolPct(caN, caN1),
      margeN,
      pctMargeN: caN !== 0 ? (margeN / caN) * 100 : 0,
      margeN1,
      pctMargeN1: caN1 !== 0 ? (margeN1 / caN1) * 100 : 0,
      evolMarge: evolPct(margeN, margeN1),
      nbFactN, nbFactN1,
      evolNbFact: evolPct(nbFactN, nbFactN1),
      caMoyFactN, caMoyFactN1,
      evolCaMoyFact: evolPct(caMoyFactN, caMoyFactN1),
      valMoyN, valMoyN1,
      evolValMoy: evolPct(valMoyN, valMoyN1),
      qteN, qteN1,
      nucN, nucN1,
      evolNuc: evolPct(nucN, nucN1),
      nbNartN, nbNartN1,
      evolNbNart: evolPct(nbNartN, nbNartN1),
    });
  }

  // PART_CA sur le total CA_N
  const totalCa = rows.reduce((s, r) => s + r.caN, 0);
  for (const r of rows) {
    r.partCa = totalCa > 0 ? (r.caN / totalCa) * 100 : 0;
  }

  rows.sort((a, b) => b.caN - a.caN);
  return rows;
}

/**
 * Ajoute l'onglet Client au classeur ExcelJS.
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets }
 */
export function buildClientSheet(workbook, ctx) {
  const rows = calculerLignes(ctx.datasets);
  const n = rows.length;

  const ws = workbook.addWorksheet("Client", {
    properties: { tabColor: { argb: "FF70AD47" } },
    views: [{ state: "frozen", xSplit: 5, ySplit: 1 }], // freeze F2 (quirk)
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

  // ── Ligne 1 : titre fusionné (hauteur 30) ──────────────────────────────────
  const auj = new Date();
  const p = (x) => String(x).padStart(2, "0");
  ws.mergeCells("A1:AE1");
  const title = ws.getCell("A1");
  title.value = `ANALYSE CA PAR CLIENT - ${p(auj.getDate())}/${p(auj.getMonth() + 1)}/${auj.getFullYear()}`;
  title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = fill("1F4E79");
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  // ── Ligne 2 : en-têtes ─────────────────────────────────────────────────────
  const headerRow = ws.getRow(2);
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = fill("1F4E79");
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = mediumGris;
  });

  // ── Valeurs d'une ligne (ordre des 31 colonnes) ────────────────────────────
  const valeurs = (r, rang) => [
    rang, r.nomClient, r.tiers, r.categorie, r.profes,
    r.caN, r.caN1, r.evolCa, r.partCa,
    r.margeN, r.pctMargeN, r.margeN1, r.pctMargeN1, r.evolMarge,
    r.nbFactN, r.nbFactN1, r.evolNbFact,
    r.caMoyFactN, r.caMoyFactN1, r.evolCaMoyFact,
    r.valMoyN, r.valMoyN1, r.evolValMoy,
    r.qteN, r.qteN1,
    r.nucN, r.nucN1, r.evolNuc,
    r.nbNartN, r.nbNartN1, r.evolNbNart,
  ];

  // Style d'une cellule de données selon sa colonne (positions du script)
  const styleDataCell = (cell, colIdx, rowParity) => {
    if (colIdx === 3) {
      cell.fill = fill("E8F4FD");
      cell.font = { bold: true, size: 9, color: { argb: "FF0066CC" } };
    } else if (colIdx === 4 || colIdx === 5) {
      cell.fill = fill("D6E8FA");
      cell.font = { bold: true, size: 9, color: { argb: "FF003D7A" } };
    } else if (colIdx === 7) {
      cell.font = { bold: true, size: 9, color: { argb: "FF000000" } };
    } else if ([8, 14, 17, 20, 23].includes(colIdx)) {
      cell.fill = fill("E6D7FF");
      cell.font = { bold: true, size: 9, color: { argb: "FF4A148C" } };
    } else if (colIdx === 28 || colIdx === 31) {
      cell.fill = fill("FFE4CC");
      cell.font = { bold: true, size: 9, color: { argb: "FFCC5500" } };
    } else if (colIdx === 10 || colIdx === 11) {
      cell.fill = fill("FFF9C4");
      cell.font = { bold: true, size: 9, color: { argb: "FFE65100" } };
    } else if (colIdx === 15 || colIdx === 16) {
      cell.fill = fill("FFE4CC");
      cell.font = { bold: true, size: 9, color: { argb: "FFCC5500" } };
    } else if (colIdx === 18 || colIdx === 19) {
      cell.fill = fill("E8F5E8");
      cell.font = { bold: true, size: 9, color: { argb: "FF2E7D32" } };
    } else {
      cell.fill = fill(rowParity === 0 ? "F8F8F8" : "FFFFFF");
      cell.font = { bold: true, size: 9 };
    }
    cell.border = mediumGris;
    cell.alignment =
      colIdx === 2 || colIdx === 4 || colIdx === 5
        ? { horizontal: "left", vertical: "middle" }
        : { horizontal: "center", vertical: "middle" };
  };

  const appliquerFormat = (cell, colIdx) => {
    if (typeof cell.value !== "number") return;
    if (MONTANT_COLS.includes(colIdx) || INT_COLS.includes(colIdx)) {
      cell.numFmt = "#,##0";
    } else if (PCT_COLS.includes(colIdx)) {
      cell.value = cell.value / 100; // stocké décimal, format 0%
      cell.numFmt = "0%";
    } else if (NUC_COLS.includes(colIdx)) {
      cell.numFmt = "0.00";
    }
  };

  // ── Lignes de données (3..n+2) ─────────────────────────────────────────────
  rows.forEach((r, i) => {
    const excelRow = 3 + i;
    const row = ws.getRow(excelRow);
    const vals = valeurs(r, i + 1);
    // parité du script : row_idx (2..) % 2 == 0 -> F8F8F8. row_idx pré-titre
    // = i + 2 -> parité (i+2) % 2 = i % 2.
    const parity = (i + 2) % 2 === 0 ? 0 : 1;
    vals.forEach((v, c) => {
      const colIdx = c + 1;
      const cell = row.getCell(colIdx);
      cell.value = v;
      styleDataCell(cell, colIdx, parity);
      appliquerFormat(cell, colIdx);
    });
    // Rang : police bleue (écrase la zébrée, comme le script)
    row.getCell(1).font = { bold: true, size: 9, color: { argb: "FF2E75B6" } };
  });

  // ── Ligne TOTAL (n+4, ligne n+3 vide) ──────────────────────────────────────
  const somme = (champ) => rows.reduce((s, r) => s + r[champ], 0);
  const caNT = somme("caN");
  const caN1T = somme("caN1");
  const margeNT = somme("margeN");
  const margeN1T = somme("margeN1");
  const nbFactNT = somme("nbFactN");
  const nbFactN1T = somme("nbFactN1");
  const qteNT = somme("qteN");
  const qteN1T = somme("qteN1");
  const caMoyFactNT = nbFactNT > 0 ? caNT / nbFactNT : 0;
  const caMoyFactN1T = nbFactN1T > 0 ? caN1T / nbFactN1T : 0;
  const valMoyNT = qteNT > 0 ? caNT / qteNT : 0;
  const valMoyN1T = qteN1T > 0 ? caN1T / qteN1T : 0;
  const nucNT = n > 0 ? somme("nucN") / n : 0;
  const nucN1T = n > 0 ? somme("nucN1") / n : 0;
  const nbNartNT = somme("nbNartN");
  const nbNartN1T = somme("nbNartN1");
  const evolT = (a, b) => (b > 0 ? ((a - b) / b) * 100 : 0); // 0-guard du script

  const totalVals = [
    "TOTAL", "TOTAL GÉNÉRAL", "", "TOUTES", "",
    caNT, caN1T, evolT(caNT, caN1T), 100,
    margeNT, caNT > 0 ? (margeNT / caNT) * 100 : 0,
    margeN1T, caN1T > 0 ? (margeN1T / caN1T) * 100 : 0,
    evolT(margeNT, margeN1T),
    nbFactNT, nbFactN1T, evolT(nbFactNT, nbFactN1T),
    caMoyFactNT, caMoyFactN1T, evolT(caMoyFactNT, caMoyFactN1T),
    valMoyNT, valMoyN1T, evolT(valMoyNT, valMoyN1T),
    qteNT, qteN1T,
    nucNT, nucN1T, evolT(nucNT, nucN1T),
    nbNartNT, nbNartN1T, evolT(nbNartNT, nbNartN1T),
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

  // ── Mise en forme conditionnelle (coordonnées PRÉ-insertion du titre,
  //    non décalées par openpyxl -> reproduites telles quelles) ───────────────
  const iconSetNum = {
    type: "iconSet",
    iconSet: "3Arrows",
    showValue: true,
    reverse: false,
    cfvo: [
      { type: "num", value: -999999 },
      { type: "num", value: 0 },
      { type: "num", value: 0.0001 },
    ],
  };
  const cfEnd = n + 1;
  ws.addConditionalFormatting({
    ref: `F2:F${cfEnd}`,
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
    ref: `I2:I${cfEnd}`,
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
  for (const col of ["H", "N", "Q", "T", "W", "AB", "AE"]) {
    ws.addConditionalFormatting({
      ref: `${col}2:${col}${cfEnd}`,
      rules: [iconSetNum],
    });
  }
  ws.addConditionalFormatting({
    ref: `K2:K${cfEnd}`,
    rules: [
      {
        type: "iconSet",
        iconSet: "3Arrows",
        showValue: true,
        reverse: false,
        cfvo: [
          { type: "percent", value: 0 },
          { type: "percent", value: 20 },
          { type: "percent", value: 35 },
        ],
      },
    ],
  });

  // ── Autofiltre (coordonnées pré-insertion, quirk reproduit) ────────────────
  ws.autoFilter = `A1:AE${n + 1}`;

  // ── Largeurs de colonnes ───────────────────────────────────────────────────
  const widths = [
    5, 35, 10, 20, 20, 15, 15, 13, 10, 15, 15, 15, 15, 15,
    13, 13, 15, 15, 15, 18, 15, 15, 15, 12, 12, 10, 10, 13, 12, 12, 13,
  ];
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  return ws;
}

export default buildClientSheet;