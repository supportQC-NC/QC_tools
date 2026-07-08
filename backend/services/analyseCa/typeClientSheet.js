// backend/services/analyseCa/typeClientSheet.js
//
// Onglet "TYPES_CLIENT" — transcription fidèle de analyse_ca_type_client.py
// (classe AnalyseCATypeClientMensuelNUC, version active).
//
// Source : details EXTERNES N et N-1 (datasets du socle analyseCaDataService,
// identiques au chargement SQL du script : TIERS_ID < 9905, hors 2226,
// exclusions articles + PVTE aberrante déjà appliquées).
//
// Calculs par (TYPE_CLIENT, MOIS) :
//  - CA_LIGNE = QTE × PVTE × (1 − POURC/100) ; COUT_LIGNE = QTE × PREV
//  - GROUPE article = artplus code 06 (défaut "AUTRE" — le script dégrade si
//    artplus absent, il ne saute PAS cet onglet)
//  - NB Factures = factures TYPFACT="F" dont le CA facture > 0
//  - NUC = moyenne par facture du nb de références (NART) uniques
//  - NUC hors FIXATIONS = idem sur les lignes GROUPE ≠ "FIXATIONS"
//  - Marge = CA − Coût ; Panier moyen = CA / NB Factures
//  - grille complète 10 types × 12 mois (zéros inclus dans les moyennes NUC)
//
// Mise en page (openpyxl -> ExcelJS, identique) :
//  titre fusionné A1:O1 (fond 1F4E79), en-têtes (2E75B6), blocs par type avec
//  colonne A fusionnée en texte vertical (5B9BD5), formats/fonds par métrique,
//  bloc TOTAL MENSUEL (A fusionnée 1F4E79, gras, colonne B fond E7E6E6),
//  largeurs A=20 B=18 C..O=14, volets figés C3. Onglet couleur 4472C4.

const MOIS_FR = [
  "JANV", "FÉVR", "MARS", "AVR", "MAI", "JUIN",
  "JUIL", "AOÛT", "SEPT", "OCT", "NOV", "DÉC",
];

const TYPES_CLIENTS_DEFAUT = [
  "PARTICULIER", "PRO COMPTANT", "PRO DEBIT", "ADMINISTRATION",
  "AGRICULTEUR", "GROUPE", "EMPLOYE", "FIDELITE", "REVENDEUR", "AUTRE",
];

const TYPES_ORDER = [
  "PARTICULIER", "FIDELITE", "PRO COMPTANT", "PRO DEBIT", "REVENDEUR",
  "GROUPE", "ADMINISTRATION", "AGRICULTEUR", "EMPLOYE", "AUTRE",
];

const COLORS = {
  primary: "1F4E79",
  secondary: "2E75B6",
  info: "5B9BD5",
  light2: "E7E6E6",
};

const METRIQUES = [
  "NB Factures", "CA", "Panier Moyen", "NUC",
  "Marge", "Marge %", "CA R/H %", "Marge R/H %",
];

// standardize_client_category du script
function standardizeCategory(category) {
  const s = category === null || category === undefined ? "" : String(category).trim();
  if (s === "") return "AUTRE";
  const c = s.toUpperCase();
  if (["NAN", "AUTRE", "AUTRES", "NULL", "NONE"].includes(c)) return "AUTRE";
  if (c === "PARTICULER") return "PARTICULIER";
  if (c.includes("PRO") && c.includes("DEBIT")) return "PRO DEBIT";
  if (c === "FIDELITE") return "FIDELITE";
  if (c === "REVENDEUR") return "REVENDEUR";
  const standard = [
    "PARTICULIER", "PRO COMPTANT", "ADMINISTRATION",
    "AGRICULTEUR", "GROUPE", "EMPLOYE", "FIDELITE", "REVENDEUR",
  ];
  if (standard.includes(c)) return c;
  return "AUTRE";
}

// "DD/MM/YYYY" -> mois 1..12 (défaut 1, comme fillna(1) du script)
function moisFromDateFr(dateFr) {
  if (typeof dateFr === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(dateFr)) {
    const m = parseInt(dateFr.slice(3, 5), 10);
    if (m >= 1 && m <= 12) return m;
  }
  return 1;
}

// Agrège une année : Map "TYPE|MOIS" -> { nbFact, ca, cout, nuc, nucHorsFix }
// tiersForcerAutre (Set) : lignes de ces tiers basculées en catégorie AUTRE
// (TIERS_FORCER_AUTRE du script, désormais configurable par entreprise).
function agregatAnnee(details, artplus, tiersForcerAutre) {
  if (!details || details.length === 0) return new Map();

  // Regroupement par (type, mois, facture)
  const parFacture = new Map(); // clé "type|mois|numfact"
  for (const l of details) {
    const force = tiersForcerAutre && tiersForcerAutre.has(l.TIERS_ID);
    const type = standardizeCategory(force ? "AUTRE" : l.categorie_client);
    const mois = moisFromDateFr(l.date_facture);
    const groupe =
      (artplus && artplus.get(String(l.NART).toUpperCase())?.groupe06) || "AUTRE";
    const ca = l.QTE * l.PVTE * (1 - l.POURC / 100);
    const cout = l.QTE * l.PREV;
    const horsFix = groupe !== "FIXATIONS";

    const key = `${type}|${mois}|${l.NUMFACT}`;
    if (!parFacture.has(key)) {
      parFacture.set(key, {
        type, mois, ca: 0, cout: 0,
        typfact: l.TYPFACT, // 'first' comme le script
        narts: new Set(),
        nartsHF: new Set(),
        aLigneHF: false,
      });
    }
    const f = parFacture.get(key);
    f.ca += ca;
    f.cout += cout;
    f.narts.add(l.NART);
    if (horsFix) {
      f.nartsHF.add(l.NART);
      f.aLigneHF = true;
    }
  }

  // Agrégat par (type, mois)
  const parTypeMois = new Map(); // clé "type|mois"
  for (const f of parFacture.values()) {
    const key = `${f.type}|${f.mois}`;
    if (!parTypeMois.has(key)) {
      parTypeMois.set(key, {
        nbFact: 0, ca: 0, cout: 0,
        sommeNuc: 0, nbFacturesNuc: 0,
        sommeNucHF: 0, nbFacturesNucHF: 0,
      });
    }
    const g = parTypeMois.get(key);
    g.ca += f.ca;
    g.cout += f.cout;
    if (f.typfact === "F" && f.ca > 0) g.nbFact += 1;
    g.sommeNuc += f.narts.size;
    g.nbFacturesNuc += 1;
    if (f.aLigneHF) {
      g.sommeNucHF += f.nartsHF.size;
      g.nbFacturesNucHF += 1;
    }
  }

  const out = new Map();
  for (const [key, g] of parTypeMois) {
    out.set(key, {
      nbFact: g.nbFact,
      ca: g.ca,
      cout: g.cout,
      nuc: g.nbFacturesNuc > 0 ? g.sommeNuc / g.nbFacturesNuc : 0,
      nucHorsFix: g.nbFacturesNucHF > 0 ? g.sommeNucHF / g.nbFacturesNucHF : 0,
    });
  }
  return out;
}

/**
 * Construit la grille complète (types × 12 mois) puis les lignes du pivot.
 * @returns {{ rows: Array, orderedTypes: string[] }}
 */
function construireGrille(detailsN, detailsN1, artplus, tiersForcerAutre) {
  const aggN = agregatAnnee(detailsN, artplus, tiersForcerAutre);
  const aggN1 = agregatAnnee(detailsN1, artplus, tiersForcerAutre);

  const typesObserves = new Set();
  for (const key of aggN.keys()) typesObserves.add(key.split("|")[0]);
  for (const key of aggN1.keys()) typesObserves.add(key.split("|")[0]);
  const allTypes = [...new Set([...TYPES_CLIENTS_DEFAUT, ...typesObserves])];

  // Grille complète, zéros inclus
  const grille = new Map(); // "type|mois" -> {nbFactN, caN, coutN, margeN, nucN, caN1, margeN1, nbFactN1, ...}
  for (const type of allTypes) {
    for (let m = 1; m <= 12; m++) {
      const n = aggN.get(`${type}|${m}`) || { nbFact: 0, ca: 0, cout: 0, nuc: 0, nucHorsFix: 0 };
      const n1 = aggN1.get(`${type}|${m}`) || { nbFact: 0, ca: 0, cout: 0, nuc: 0, nucHorsFix: 0 };
      grille.set(`${type}|${m}`, {
        nbFactN: n.nbFact,
        caN: n.ca,
        coutN: n.cout,
        margeN: n.ca - n.cout,
        nucN: n.nuc,
        nbFactN1: n1.nbFact,
        caN1: n1.ca,
        margeN1: n1.ca - n1.cout,
      });
    }
  }

  // Ordre des types (types_order puis extras dans l'ordre d'apparition)
  const orderedTypes = TYPES_ORDER.filter((t) => allTypes.includes(t));
  for (const t of allTypes) {
    if (!orderedTypes.includes(t)) orderedTypes.push(t);
  }

  return { grille, orderedTypes, allTypes };
}

// Valeurs d'une métrique pour un ensemble de cellules de grille
function valeurMetrique(metrique, cells) {
  const somme = (champ) => cells.reduce((s, c) => s + c[champ], 0);
  switch (metrique) {
    case "NB Factures":
      return somme("nbFactN");
    case "CA":
      return somme("caN");
    case "Panier Moyen": {
      const nb = somme("nbFactN");
      return nb > 0 ? somme("caN") / nb : 0;
    }
    case "NUC": {
      // mean() pandas : moyenne sur toutes les cellules (zéros inclus)
      if (cells.length === 0) return 0;
      return cells.reduce((s, c) => s + c.nucN, 0) / cells.length;
    }
    case "Marge":
      return somme("margeN");
    case "Marge %": {
      const ca = somme("caN");
      return ca > 0 ? somme("margeN") / ca : 0; // décimal
    }
    default:
      return 0;
  }
}

/**
 * Ajoute l'onglet TYPES_CLIENT au classeur ExcelJS.
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets, artplus } (artplus : Map ou null)
 */
export function buildTypeClientSheet(workbook, ctx) {
  const { datasets, artplus } = ctx;
  const { grille, orderedTypes } = construireGrille(
    datasets.detailsN,
    datasets.detailsN1,
    artplus,
    datasets.config?.tiersForcerAutre,
  );

  const cellsType = (type) =>
    Array.from({ length: 12 }, (_, i) => grille.get(`${type}|${i + 1}`));
  const cellsMois = (m) => orderedTypes.map((t) => grille.get(`${t}|${m}`));
  const cellsAll = () =>
    orderedTypes.flatMap((t) => cellsType(t));

  // ── Construction des lignes du pivot (identique au script) ────────────────
  // Chaque ligne : { type, metrique, valeurs[12], cumul } | { vide: true }
  const rows = [];

  const rhValeur = (nArr, n1Arr) =>
    nArr.map((n, i) => {
      const n1 = n1Arr[i];
      if (n1 > 0) return (n - n1) / n1;
      return n > 0 ? 1.0 : 0;
    });
  const rhCumul = (nArr, n1Arr) => {
    let nC = 0;
    let n1C = 0;
    for (let i = 0; i < 12; i++) {
      if (n1Arr[i] > 0) {
        nC += nArr[i];
        n1C += n1Arr[i];
      }
    }
    return n1C > 0 ? (nC - n1C) / n1C : 0;
  };

  const pushBloc = (label, cellsParMois, cellsCumul) => {
    // métriques simples
    for (const metrique of ["NB Factures", "CA", "Panier Moyen", "NUC", "Marge", "Marge %"]) {
      rows.push({
        type: label,
        metrique,
        valeurs: cellsParMois.map((cells) => valeurMetrique(metrique, cells)),
        cumul: valeurMetrique(metrique, cellsCumul),
      });
    }
    // R/H % (décimal)
    const caN = cellsParMois.map((cells) => cells.reduce((s, c) => s + c.caN, 0));
    const caN1 = cellsParMois.map((cells) => cells.reduce((s, c) => s + c.caN1, 0));
    rows.push({
      type: label, metrique: "CA R/H %",
      valeurs: rhValeur(caN, caN1), cumul: rhCumul(caN, caN1),
    });
    const mgN = cellsParMois.map((cells) => cells.reduce((s, c) => s + c.margeN, 0));
    const mgN1 = cellsParMois.map((cells) => cells.reduce((s, c) => s + c.margeN1, 0));
    rows.push({
      type: label, metrique: "Marge R/H %",
      valeurs: rhValeur(mgN, mgN1), cumul: rhCumul(mgN, mgN1),
    });
  };

  for (const type of orderedTypes) {
    const parMois = Array.from({ length: 12 }, (_, i) => [grille.get(`${type}|${i + 1}`)]);
    pushBloc(type, parMois, cellsType(type));
    rows.push({ vide: true });
  }

  // TOTAL MENSUEL
  const parMoisTotal = Array.from({ length: 12 }, (_, i) => cellsMois(i + 1));
  pushBloc("TOTAL MENSUEL", parMoisTotal, cellsAll());

  // ── Écriture ExcelJS ───────────────────────────────────────────────────────
  const ws = workbook.addWorksheet("TYPES_CLIENT", {
    properties: { tabColor: { argb: "FF4472C4" } },
    views: [{ state: "frozen", xSplit: 2, ySplit: 2 }], // freeze C3
  });

  const fill = (hex) => ({
    type: "pattern", pattern: "solid", fgColor: { argb: `FF${hex}` },
  });
  const thinBorder = {
    left: { style: "thin", color: { argb: "FFD0D0D0" } },
    right: { style: "thin", color: { argb: "FFD0D0D0" } },
    top: { style: "thin", color: { argb: "FFD0D0D0" } },
    bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  };
  const FORMAT_METRIQUE = {
    "NB Factures": { numFmt: "#,##0", fill: "E6F3FF" },
    CA: { numFmt: "#,##0", fill: "E6FFE6" },
    Marge: { numFmt: "#,##0", fill: "FFFFE6" },
    "Panier Moyen": { numFmt: "#,##0", fill: "FFE6F3" },
    NUC: { numFmt: "#,##0.0", fill: "F3E6FF" },
    "Marge %": { numFmt: "0.00%", fill: "FFE6E6" },
    "CA R/H %": { numFmt: "+0.00%;-0.00%;0.00%", fill: "F0F0F0" },
    "Marge R/H %": { numFmt: "+0.00%;-0.00%;0.00%", fill: "F0F0F0" },
  };

  // Ligne 1 : titre fusionné A1:O1
  ws.mergeCells("A1:O1");
  const title = ws.getCell("A1");
  title.value = "ANALYSE MENSUELLE CA PAR TYPE DE CLIENT";
  title.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = fill(COLORS.primary);
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  // Ligne 2 : en-têtes
  const headers = ["TYPE_CLIENT", "METRIQUE", ...MOIS_FR, "CUMUL"];
  const headerRow = ws.getRow(2);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = fill(COLORS.secondary);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  headerRow.height = 25;

  // Lignes de données (à partir de la ligne 3)
  let excelRow = 3;
  const blocs = []; // { type, start, end } pour fusion/bordures
  let blocCourant = null;

  for (const r of rows) {
    const row = ws.getRow(excelRow);
    if (r.vide) {
      // ligne vide : ferme le bloc courant
      for (let c = 1; c <= 15; c++) row.getCell(c).value = "";
      if (blocCourant) {
        blocs.push(blocCourant);
        blocCourant = null;
      }
    } else {
      if (!blocCourant || blocCourant.type !== r.type) {
        if (blocCourant) blocs.push(blocCourant);
        blocCourant = { type: r.type, start: excelRow, end: excelRow };
      }
      blocCourant.end = excelRow;

      row.getCell(1).value = r.type;
      row.getCell(2).value = r.metrique;
      const fmt = FORMAT_METRIQUE[r.metrique];
      for (let m = 0; m < 12; m++) {
        const cell = row.getCell(3 + m);
        cell.value = r.valeurs[m];
        if (fmt) {
          cell.numFmt = fmt.numFmt;
          cell.fill = fill(fmt.fill);
        }
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
      const cumul = row.getCell(15);
      cumul.value = r.cumul;
      if (fmt) {
        cumul.numFmt = fmt.numFmt;
        cumul.fill = fill(fmt.fill);
      }
      cumul.alignment = { horizontal: "center", vertical: "middle" };
    }
    excelRow += 1;
  }
  if (blocCourant) blocs.push(blocCourant);

  // Fusion colonne A + bordures par bloc de type ; bloc TOTAL à part
  for (const bloc of blocs) {
    if (bloc.type === "TOTAL MENSUEL") {
      ws.mergeCells(`A${bloc.start}:A${bloc.end}`);
      const mc = ws.getCell(`A${bloc.start}`);
      mc.alignment = { horizontal: "center", vertical: "middle" };
      mc.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
      mc.fill = fill(COLORS.primary);
      for (let r = bloc.start; r <= bloc.end; r++) {
        for (let c = 2; c <= 15; c++) {
          const cell = ws.getRow(r).getCell(c);
          cell.font = { ...(cell.font || {}), bold: true };
          if (c === 2) cell.fill = fill(COLORS.light2);
        }
      }
    } else if (bloc.start < bloc.end) {
      ws.mergeCells(`A${bloc.start}:A${bloc.end}`);
      const mc = ws.getCell(`A${bloc.start}`);
      mc.alignment = { horizontal: "center", vertical: "middle", textRotation: 90 };
      mc.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      mc.fill = fill(COLORS.info);
      for (let r = bloc.start; r <= bloc.end; r++) {
        for (let c = 1; c <= 15; c++) {
          ws.getRow(r).getCell(c).border = thinBorder;
        }
      }
    }
  }

  // Largeurs de colonnes (A=20, B=18, C..O=14)
  ws.getColumn(1).width = 20;
  ws.getColumn(2).width = 18;
  for (let c = 3; c <= 15; c++) ws.getColumn(c).width = 14;

  return ws;
}

export default buildTypeClientSheet;