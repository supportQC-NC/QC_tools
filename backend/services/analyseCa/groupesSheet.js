// backend/services/analyseCa/groupesSheet.js
//
// Onglet "Groupes" (#ED7D31) — transcription fidèle de analyse_ca_groupe.py
// (classe AnalyseCAGroupeSimple, version active).
//
// DÉPEND d'artplus.dbf (code 06 = groupe). Décision projet : si l'entreprise
// n'a pas artplus.dbf, cet onglet est OMIS (l'orchestrateur ne l'appelle pas) ;
// le builder suppose donc artplus non-null.
//
// Source : details EXTERNES N / N-1 + artplus (NART -> GROUPE) + référentiel
// articles (nb en stock). Particularités reproduites :
//  - jointure détail NART -> artplus.groupe06 ; "SANS GROUPE" si absent.
//  - NB_ARTICLES_STOCK : nunique NART en stock par groupe, le groupe d'un
//    article étant d'abord celui d'artplus (via NART), sinon la colonne GROUPE
//    native d'article.dbf, sinon "SANS GROUPE".
//  - GROUPE en 2e colonne (sert de libellé ; pas de colonne code) ; gel C3.
//
// Grille mutualisée : analyseCaGrid.js.

import { finaliserLignes, writeGridSheet } from "./analyseCaGrid.js";

const COLS = [
  "RANG", "GROUPE",
  "NB_ARTICLES_N", "NB_ARTICLES_STOCK",
  "CA_N", "CA_N1", "EVOL_CA", "PART_CA", "PART_CUMULEE",
  "QTE_N", "QTE_N1", "EVOL_QTE", "PRIX_MOY_N", "PRIX_MOY_N1",
  "MARGE_N", "PCT_MARGE_N", "MARGE_N1", "PCT_MARGE_N1", "EVOL_MARGE",
  "NB_FACTURES_N", "NB_FACTURES_N1", "NB_CLIENTS_N", "NB_CLIENTS_N1",
];
const HEADERS = {
  RANG: "Rang", GROUPE: "Groupe",
  NB_ARTICLES_N: "Nb Articles\nN", NB_ARTICLES_STOCK: "Nb Articles\nen Stock",
  CA_N: "CA N\n(XPF)", CA_N1: "CA N-1\n(XPF)",
  EVOL_CA: "Évol CA\n(%)", PART_CA: "Part CA\n(%)", PART_CUMULEE: "Part\nCumulée (%)",
  QTE_N: "Quantité\nN", QTE_N1: "Quantité\nN-1", EVOL_QTE: "Évol Qté\n(%)",
  PRIX_MOY_N: "Prix Moy N\n(XPF)", PRIX_MOY_N1: "Prix Moy N-1\n(XPF)",
  MARGE_N: "Marge N\n(XPF)", PCT_MARGE_N: "Taux Marge\nN (%)",
  MARGE_N1: "Marge N-1\n(XPF)", PCT_MARGE_N1: "Taux Marge\nN-1 (%)", EVOL_MARGE: "Évol Marge\n(%)",
  NB_FACTURES_N: "Nb Factures\nN", NB_FACTURES_N1: "Nb Factures\nN-1",
  NB_CLIENTS_N: "Nb Clients\nN", NB_CLIENTS_N1: "Nb Clients\nN-1",
};
const WIDTHS = {
  RANG: 6, GROUPE: 30,
  NB_ARTICLES_N: 12, NB_ARTICLES_STOCK: 13,
  CA_N: 15, CA_N1: 15, EVOL_CA: 10, PART_CA: 10, PART_CUMULEE: 12,
  QTE_N: 12, QTE_N1: 12, EVOL_QTE: 10, PRIX_MOY_N: 12, PRIX_MOY_N1: 12,
  MARGE_N: 15, PCT_MARGE_N: 12, MARGE_N1: 15, PCT_MARGE_N1: 12, EVOL_MARGE: 12,
  NB_FACTURES_N: 12, NB_FACTURES_N1: 12, NB_CLIENTS_N: 12, NB_CLIENTS_N1: 12,
};

function agregatParGroupe(details, groupeByNart) {
  const map = new Map();
  for (const l of details) {
    const groupe = groupeByNart.get(String(l.NART).toUpperCase()) || "SANS GROUPE";
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

// Nettoyage d'un GROUPE natif ('' / nan -> null)
function natifOuNull(v) {
  const s = v === null || v === undefined ? "" : String(v).trim();
  if (s === "" || ["nan", "none", "null"].includes(s.toLowerCase())) return null;
  return s;
}

/**
 * Ajoute l'onglet Groupes au classeur.
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets, artplus }  (artplus : Map NART->{groupe06,...})
 */
export function buildGroupesSheet(workbook, ctx) {
  const { datasets, artplus } = ctx;

  // NART -> GROUPE (artplus code 06) — pour les ventes
  const groupeByNart = new Map();
  if (artplus) {
    for (const [nart, attr] of artplus) {
      if (attr.groupe06) groupeByNart.set(nart, attr.groupe06);
    }
  }

  const aggN = agregatParGroupe(datasets.detailsN, groupeByNart);
  const aggN1 = agregatParGroupe(datasets.detailsN1, groupeByNart);

  // NB_ARTICLES_STOCK par groupe : groupe = artplus (via NART) sinon GROUPE
  // natif d'article.dbf sinon "SANS GROUPE" ; articles filtrés 08*/000001/! ;
  // comptage nunique NART où STOCK > 0.
  const stockParGroupe = new Map();
  for (const a of datasets.articles) {
    const nart = String(a.NART).trim();
    if (nart.startsWith("08") || nart === "000001" || nart.includes("!")) continue;
    if (!(a.STOCK > 0)) continue;
    const parVentes = groupeByNart.get(nart.toUpperCase());
    const natif = natifOuNull(a.GROUPE);
    const groupe = parVentes || natif || "SANS GROUPE";
    if (!stockParGroupe.has(groupe)) stockParGroupe.set(groupe, new Set());
    stockParGroupe.get(groupe).add(nart);
  }

  const groupes = new Set([...aggN.keys(), ...aggN1.keys()]);
  const rows = [];
  for (const groupe of groupes) {
    const n = aggN.get(groupe);
    const n1 = aggN1.get(groupe);
    const stock = stockParGroupe.get(groupe);
    rows.push({
      GROUPE: groupe,
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
    sheetName: "Groupes",
    tabColor: "FFED7D31",
    rows,
    colOrder: COLS,
    headers: HEADERS,
    widths: WIDTHS,
    titleText: "ANALYSE CA PAR GROUPE",
    labelCol: "GROUPE", // GROUPE en 2e colonne sert de libellé ; pas de code
    articleCountCols: ["NB_ARTICLES_N", "NB_ARTICLES_STOCK"],
    freezeXSplit: 2, // gel C3
  });

  return rows;
}

export default buildGroupesSheet;