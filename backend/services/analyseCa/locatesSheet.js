// backend/services/analyseCa/locatesSheet.js
//
// Onglet "Locates" (#8DB4E2) — transcription fidèle de analyse_ca_locates.py
// (classe AnalyseCALocates, version active).
//
// Source : details EXTERNES N / N-1 + référentiel articles (socle).
//  - Jointure NART -> articles.GROUPE (le "locate"). GROUPE vide/nan ->
//    "SANS LOCATE". Articles filtrés 08* / 000001 / !.
//  - CODE_GROUPE = GROUPE. NOM_GROUPE = config.nomsLocates[GROUPE] sinon GROUPE.
//  - NB_ARTICLES_STOCK : nunique NART du référentiel (STOCK > 0) par GROUPE.
//
// Mise en forme mutualisée : analyseCaGrid.js (grille 24 colonnes).

import { finaliserLignes, writeGridSheet } from "./analyseCaGrid.js";

const COLS = [
  "RANG", "CODE_GROUPE", "NOM_GROUPE",
  "NB_ARTICLES_N", "NB_ARTICLES_STOCK",
  "CA_N", "CA_N1", "EVOL_CA", "PART_CA", "PART_CUMULEE",
  "QTE_N", "QTE_N1", "EVOL_QTE", "PRIX_MOY_N", "PRIX_MOY_N1",
  "MARGE_N", "PCT_MARGE_N", "MARGE_N1", "PCT_MARGE_N1", "EVOL_MARGE",
  "NB_FACTURES_N", "NB_FACTURES_N1", "NB_CLIENTS_N", "NB_CLIENTS_N1",
];
const HEADERS = {
  RANG: "#", CODE_GROUPE: "Code\nGroupe", NOM_GROUPE: "Locate",
  NB_ARTICLES_N: "Nb Articles\nVendus N", NB_ARTICLES_STOCK: "Nb Articles\nen Stock",
  CA_N: "CA N\n(XPF)", CA_N1: "CA N-1\n(XPF)",
  EVOL_CA: "Évol.\nCA (%)", PART_CA: "Part\nCA (%)", PART_CUMULEE: "Part\nCumulée (%)",
  QTE_N: "Quantité\nN", QTE_N1: "Quantité\nN-1", EVOL_QTE: "Évol.\nQté (%)",
  PRIX_MOY_N: "Prix Moy N\n(XPF)", PRIX_MOY_N1: "Prix Moy N-1\n(XPF)",
  MARGE_N: "Marge N\n(XPF)", PCT_MARGE_N: "Taux\nMarge N (%)",
  MARGE_N1: "Marge N-1\n(XPF)", PCT_MARGE_N1: "Taux\nMarge N-1 (%)", EVOL_MARGE: "Évol.\nMarge (%)",
  NB_FACTURES_N: "Nb Factures\nN", NB_FACTURES_N1: "Nb Factures\nN-1",
  NB_CLIENTS_N: "Nb Clients\nN", NB_CLIENTS_N1: "Nb Clients\nN-1",
};
const WIDTHS = {
  RANG: 5, CODE_GROUPE: 12, NOM_GROUPE: 35,
  NB_ARTICLES_N: 13, NB_ARTICLES_STOCK: 13,
  CA_N: 15, CA_N1: 15, EVOL_CA: 13, PART_CA: 10, PART_CUMULEE: 12,
  QTE_N: 12, QTE_N1: 12, EVOL_QTE: 13, PRIX_MOY_N: 12, PRIX_MOY_N1: 12,
  MARGE_N: 15, PCT_MARGE_N: 15, MARGE_N1: 15, PCT_MARGE_N1: 15, EVOL_MARGE: 15,
  NB_FACTURES_N: 13, NB_FACTURES_N1: 13, NB_CLIENTS_N: 12, NB_CLIENTS_N1: 12,
};

// GROUPE nettoyé ('' / nan / none -> SANS LOCATE)
function groupeDe(v) {
  const s = v === null || v === undefined ? "" : String(v).trim();
  if (s === "" || ["nan", "none", "null"].includes(s.toLowerCase())) return "SANS LOCATE";
  return s;
}

function agregatParGroupe(details, groupeByNart) {
  const map = new Map();
  for (const l of details) {
    const groupe = groupeByNart.get(String(l.NART).toUpperCase()) || "SANS LOCATE";
    const ca = l.QTE * l.PVTE * (1 - l.POURC / 100);
    const cout = l.QTE * l.PREV;
    if (!map.has(groupe)) {
      map.set(groupe, {
        ca: 0, cout: 0, qte: 0,
        factures: new Set(), clients: new Set(), narts: new Set(),
      });
    }
    const a = map.get(groupe);
    a.ca += ca;
    a.cout += cout;
    a.qte += l.QTE;
    a.factures.add(l.NUMFACT);
    a.clients.add(l.TIERS_ID);
    a.narts.add(l.NART);
  }
  return map;
}

/**
 * Ajoute l'onglet Locates au classeur.
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets }
 */
export function buildLocatesSheet(workbook, ctx) {
  const { datasets } = ctx;
  const nomsLocates = datasets.config.nomsLocates || {};

  // Référentiel : NART -> GROUPE (articles filtrés) + stock par groupe
  const groupeByNart = new Map();
  const stockParGroupe = new Map(); // groupe -> Set NART (STOCK > 0)
  for (const a of datasets.articles) {
    const nart = String(a.NART).trim();
    if (nart.startsWith("08") || nart === "000001" || nart.includes("!")) continue;
    const groupe = groupeDe(a.GROUPE);
    groupeByNart.set(nart.toUpperCase(), groupe);
    if (a.STOCK > 0) {
      if (!stockParGroupe.has(groupe)) stockParGroupe.set(groupe, new Set());
      stockParGroupe.get(groupe).add(nart);
    }
  }

  const aggN = agregatParGroupe(datasets.detailsN, groupeByNart);
  const aggN1 = agregatParGroupe(datasets.detailsN1, groupeByNart);

  const groupes = new Set([...aggN.keys(), ...aggN1.keys()]);
  const rows = [];
  for (const groupe of groupes) {
    const n = aggN.get(groupe);
    const n1 = aggN1.get(groupe);
    const stock = stockParGroupe.get(groupe);
    rows.push({
      CODE_GROUPE: groupe,
      NOM_GROUPE: nomsLocates[groupe] || groupe,
      NB_ARTICLES_N: n ? n.narts.size : 0,
      NB_ARTICLES_STOCK: stock ? stock.size : 0,
      CA_N: n ? n.ca : 0,
      CA_N1: n1 ? n1.ca : 0,
      COUT_N: n ? n.cout : 0,
      COUT_N1: n1 ? n1.cout : 0,
      QTE_N: n ? n.qte : 0,
      QTE_N1: n1 ? n1.qte : 0,
      NB_FACTURES_N: n ? n.factures.size : 0,
      NB_FACTURES_N1: n1 ? n1.factures.size : 0,
      NB_CLIENTS_N: n ? n.clients.size : 0,
      NB_CLIENTS_N1: n1 ? n1.clients.size : 0,
    });
  }
  finaliserLignes(rows);

  writeGridSheet(workbook, {
    sheetName: "Locates",
    tabColor: "FF8DB4E2",
    rows,
    colOrder: COLS,
    headers: HEADERS,
    widths: WIDTHS,
    titleText: "ANALYSE CA PAR LOCATE",
    codeCol: "CODE_GROUPE",
    articleCountCols: ["NB_ARTICLES_N", "NB_ARTICLES_STOCK"],
  });

  return rows;
}

export default buildLocatesSheet;