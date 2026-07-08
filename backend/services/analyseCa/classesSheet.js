// backend/services/analyseCa/classesSheet.js
//
// Onglets "Classes" (#BF8F00) et "Sous_Classes" (#D4A84B) — transcription
// fidèle de analyse_ca_classe.py (classe AnalyseCAClasses, version active).
//
// Source : details EXTERNES N / N-1 + référentiel articles (socle).
//  - CODE_CLASSE (sous-classe) = 2 premiers caractères du NART.
//  - Libellé sous-classe = config.nomsSousClasses[code] (éditeur "Noms des
//    sous-classes" de la fiche entreprise) sinon "SANS CLASSE".
//  - Onglet Classes = regroupement par DIZAINE : code = (int(code)//10)*10 ;
//    libellé = config.nomsClasses[dizaine] sinon "CLASSE {dizaine}".
//  - NB_ARTICLES_DISTINCTS : nunique NART du référentiel par CODE_CLASSE
//    (articles filtrés 08* / 000001 / !).
//
// La mise en forme (grille 24 colonnes) est mutualisée dans analyseCaGrid.js.

import { finaliserLignes, writeGridSheet } from "./analyseCaGrid.js";

const COLS_SOUS = [
  "RANG", "CODE_CLASSE", "CLASSE",
  "NB_ARTICLES_N", "NB_ARTICLES_DISTINCTS",
  "CA_N", "CA_N1", "EVOL_CA", "PART_CA", "PART_CUMULEE",
  "QTE_N", "QTE_N1", "EVOL_QTE",
  "PRIX_MOY_N", "PRIX_MOY_N1",
  "MARGE_N", "PCT_MARGE_N", "MARGE_N1", "PCT_MARGE_N1", "EVOL_MARGE",
  "NB_FACTURES_N", "NB_FACTURES_N1", "NB_CLIENTS_N", "NB_CLIENTS_N1",
];
const HEADERS_SOUS = {
  RANG: "#", CODE_CLASSE: "Code\nClasse", CLASSE: "Classe",
  NB_ARTICLES_N: "Nb Articles\nVendus N", NB_ARTICLES_DISTINCTS: "Nb Articles\nDistincts",
  CA_N: "CA N\n(XPF)", CA_N1: "CA N-1\n(XPF)", EVOL_CA: "Évol.\nCA (%)",
  PART_CA: "Part\nCA (%)", PART_CUMULEE: "Part\nCumulée (%)",
  QTE_N: "Quantité\nN", QTE_N1: "Quantité\nN-1", EVOL_QTE: "Évol.\nQté (%)",
  PRIX_MOY_N: "Prix Moy N\n(XPF)", PRIX_MOY_N1: "Prix Moy N-1\n(XPF)",
  MARGE_N: "Marge N\n(XPF)", PCT_MARGE_N: "Taux\nMarge N (%)",
  MARGE_N1: "Marge N-1\n(XPF)", PCT_MARGE_N1: "Taux\nMarge N-1 (%)", EVOL_MARGE: "Évol.\nMarge (%)",
  NB_FACTURES_N: "Nb Factures\nN", NB_FACTURES_N1: "Nb Factures\nN-1",
  NB_CLIENTS_N: "Nb Clients\nN", NB_CLIENTS_N1: "Nb Clients\nN-1",
};
const WIDTHS_SOUS = {
  RANG: 5, CODE_CLASSE: 10, CLASSE: 35,
  NB_ARTICLES_N: 13, NB_ARTICLES_DISTINCTS: 13,
  CA_N: 15, CA_N1: 15, EVOL_CA: 13, PART_CA: 10, PART_CUMULEE: 12,
  QTE_N: 12, QTE_N1: 12, EVOL_QTE: 13, PRIX_MOY_N: 12, PRIX_MOY_N1: 12,
  MARGE_N: 15, PCT_MARGE_N: 15, MARGE_N1: 15, PCT_MARGE_N1: 15, EVOL_MARGE: 15,
  NB_FACTURES_N: 13, NB_FACTURES_N1: 13, NB_CLIENTS_N: 12, NB_CLIENTS_N1: 12,
};

const COLS_CLASSES = [
  "RANG", "CODE_CLASSE", "NOM_CLASSE",
  "NB_SOUS_CLASSES", "NB_ARTICLES_DISTINCTS",
  "CA_N", "CA_N1", "EVOL_CA", "PART_CA", "PART_CUMULEE",
  "QTE_N", "QTE_N1", "EVOL_QTE",
  "PRIX_MOY_N", "PRIX_MOY_N1",
  "MARGE_N", "PCT_MARGE_N", "MARGE_N1", "PCT_MARGE_N1", "EVOL_MARGE",
  "NB_FACTURES_N", "NB_FACTURES_N1", "NB_CLIENTS_N", "NB_CLIENTS_N1",
];
const HEADERS_CLASSES = {
  ...HEADERS_SOUS,
  NOM_CLASSE: "Classe",
  NB_SOUS_CLASSES: "Nb Sous-\nClasses",
};
const WIDTHS_CLASSES = {
  RANG: 5, CODE_CLASSE: 10, NOM_CLASSE: 35,
  NB_SOUS_CLASSES: 12, NB_ARTICLES_DISTINCTS: 13,
  CA_N: 15, CA_N1: 15, EVOL_CA: 13, PART_CA: 10, PART_CUMULEE: 12,
  QTE_N: 12, QTE_N1: 12, EVOL_QTE: 13, PRIX_MOY_N: 12, PRIX_MOY_N1: 12,
  MARGE_N: 15, PCT_MARGE_N: 15, MARGE_N1: 15, PCT_MARGE_N1: 15, EVOL_MARGE: 15,
  NB_FACTURES_N: 13, NB_FACTURES_N1: 13, NB_CLIENTS_N: 12, NB_CLIENTS_N1: 12,
};

function agregatSousClasses(details) {
  const map = new Map();
  for (const l of details) {
    const code = String(l.NART).slice(0, 2);
    const ca = l.QTE * l.PVTE * (1 - l.POURC / 100);
    const cout = l.QTE * l.PREV;
    if (!map.has(code)) {
      map.set(code, {
        ca: 0, cout: 0, qte: 0,
        factures: new Set(), clients: new Set(), narts: new Set(),
      });
    }
    const a = map.get(code);
    a.ca += ca;
    a.cout += cout;
    a.qte += l.QTE;
    a.factures.add(l.NUMFACT);
    a.clients.add(l.TIERS_ID);
    a.narts.add(l.NART);
  }
  return map;
}

function nbArticlesDistincts(articles) {
  const parCode = new Map();
  for (const a of articles) {
    const nart = String(a.NART).trim();
    if (nart.startsWith("08") || nart === "000001" || nart.includes("!")) continue;
    const code = nart.slice(0, 2);
    if (!parCode.has(code)) parCode.set(code, new Set());
    parCode.get(code).add(nart);
  }
  const out = new Map();
  for (const [code, set] of parCode) out.set(code, set.size);
  return out;
}

function calculerSousClasses(datasets) {
  const nomsSousClasses = datasets.config.nomsSousClasses || {};
  const aggN = agregatSousClasses(datasets.detailsN);
  const aggN1 = agregatSousClasses(datasets.detailsN1);
  const distincts = nbArticlesDistincts(datasets.articles);

  const codes = new Set([...aggN.keys(), ...aggN1.keys()]);
  const rows = [];
  for (const code of codes) {
    const n = aggN.get(code);
    const n1 = aggN1.get(code);
    rows.push({
      CODE_CLASSE: code,
      CLASSE: nomsSousClasses[code] || "SANS CLASSE",
      NB_ARTICLES_N: n ? n.narts.size : 0,
      NB_ARTICLES_DISTINCTS: distincts.get(code) || 0,
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
  return finaliserLignes(rows);
}

function calculerClasses(datasets, sousClasses) {
  const nomsClasses = datasets.config.nomsClasses || {};
  const dizaine = (code) => {
    const n = parseInt(code, 10);
    return Number.isFinite(n) ? String(Math.floor(n / 10) * 10) : code;
  };

  const groupes = new Map();
  for (const sc of sousClasses) {
    const d = dizaine(sc.CODE_CLASSE);
    if (!groupes.has(d)) {
      groupes.set(d, {
        CODE_CLASSE: d,
        NB_SOUS_CLASSES: 0,
        NB_ARTICLES_DISTINCTS: 0,
        CA_N: 0, CA_N1: 0, COUT_N: 0, COUT_N1: 0, QTE_N: 0, QTE_N1: 0,
      });
    }
    const g = groupes.get(d);
    g.NB_SOUS_CLASSES += 1;
    g.NB_ARTICLES_DISTINCTS += sc.NB_ARTICLES_DISTINCTS;
    g.CA_N += sc.CA_N;
    g.CA_N1 += sc.CA_N1;
    g.COUT_N += sc.COUT_N;
    g.COUT_N1 += sc.COUT_N1;
    g.QTE_N += sc.QTE_N;
    g.QTE_N1 += sc.QTE_N1;
  }

  const facturesClients = (details) => {
    const m = new Map();
    for (const l of details) {
      const d = dizaine(String(l.NART).slice(0, 2));
      if (!m.has(d)) m.set(d, { factures: new Set(), clients: new Set() });
      const e = m.get(d);
      e.factures.add(l.NUMFACT);
      e.clients.add(l.TIERS_ID);
    }
    return m;
  };
  const fcN = facturesClients(datasets.detailsN);
  const fcN1 = facturesClients(datasets.detailsN1);

  const rows = [];
  for (const g of groupes.values()) {
    const n = fcN.get(g.CODE_CLASSE);
    const n1 = fcN1.get(g.CODE_CLASSE);
    rows.push({
      ...g,
      NOM_CLASSE: nomsClasses[g.CODE_CLASSE] || `CLASSE ${g.CODE_CLASSE}`,
      NB_FACTURES_N: n ? n.factures.size : 0,
      NB_FACTURES_N1: n1 ? n1.factures.size : 0,
      NB_CLIENTS_N: n ? n.clients.size : 0,
      NB_CLIENTS_N1: n1 ? n1.clients.size : 0,
    });
  }
  return finaliserLignes(rows);
}

/**
 * Ajoute les onglets Classes puis Sous_Classes au classeur.
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets }
 */
export function buildClassesSheets(workbook, ctx) {
  const { datasets } = ctx;
  const sousClasses = calculerSousClasses(datasets);
  const classes = calculerClasses(datasets, sousClasses);

  writeGridSheet(workbook, {
    sheetName: "Classes",
    tabColor: "FFBF8F00",
    rows: classes,
    colOrder: COLS_CLASSES,
    headers: HEADERS_CLASSES,
    widths: WIDTHS_CLASSES,
    titleText: "ANALYSE CA PAR CLASSE",
    codeCol: "CODE_CLASSE",
    articleCountCols: ["NB_SOUS_CLASSES", "NB_ARTICLES_DISTINCTS"],
  });

  writeGridSheet(workbook, {
    sheetName: "Sous_Classes",
    tabColor: "FFD4A84B",
    rows: sousClasses,
    colOrder: COLS_SOUS,
    headers: HEADERS_SOUS,
    widths: WIDTHS_SOUS,
    titleText: "ANALYSE CA PAR SOUS-CLASSE",
    codeCol: "CODE_CLASSE",
    articleCountCols: ["NB_ARTICLES_N", "NB_ARTICLES_DISTINCTS"],
  });

  return { classes, sousClasses };
}

export default buildClassesSheets;