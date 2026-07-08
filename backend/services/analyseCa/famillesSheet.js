// backend/services/analyseCa/famillesSheet.js
//
// Onglets "Familles" (#A5A5A5, artplus code 07) et "Sous_Familles" (#5B9BD5,
// artplus code 08) — transcription fidèle de analyse_ca_famille.py et
// analyse_ca_sous_famille.py (versions actives).
//
// DÉPENDENT d'artplus.dbf. Décision projet : entreprise sans artplus -> onglets
// OMIS (l'orchestrateur ne les appelle pas). Les builders supposent artplus.
//
// Particularités reproduites :
//  - jointure détail NART -> artplus (07 = famille / 08 = sous-famille) ;
//    "SANS FAMILLE" / "SANS SOUS-FAMILLE" si absent.
//  - stock : le mapping NART->libellé est RESTREINT aux NART VENDUS (présents
//    dans les ventes N/N-1 ET ayant un libellé artplus) ; les articles en stock
//    non vendus tombent en "SANS ...". (Comportement exact des scripts.)
//  - Familles : NB_ARTICLES_STOCK = nunique NART en stock (STOCK>0) par famille.
//  - Sous_Familles : STOCK_TOTAL = SOMME de STOCK (tous articles filtrés, y
//    compris stock ≤ 0) par sous-famille.
//  - libellé en 2e colonne (pas de colonne code) ; gel C3.
//
// Grille mutualisée : analyseCaGrid.js.

import { finaliserLignes, writeGridSheet } from "./analyseCaGrid.js";

// ── Colonnes (identiques hors nom du libellé et de la colonne stock) ─────────
function makeCols(labelKey, stockKey) {
  return [
    "RANG", labelKey,
    "NB_ARTICLES_N", stockKey,
    "CA_N", "CA_N1", "EVOL_CA", "PART_CA", "PART_CUMULEE",
    "QTE_N", "QTE_N1", "EVOL_QTE", "PRIX_MOY_N", "PRIX_MOY_N1",
    "MARGE_N", "PCT_MARGE_N", "MARGE_N1", "PCT_MARGE_N1", "EVOL_MARGE",
    "NB_FACTURES_N", "NB_FACTURES_N1", "NB_CLIENTS_N", "NB_CLIENTS_N1",
  ];
}
function makeHeaders(labelKey, labelLibelle, stockKey, stockLibelle) {
  return {
    RANG: "Rang", [labelKey]: labelLibelle,
    NB_ARTICLES_N: "Nb Articles\nN", [stockKey]: stockLibelle,
    CA_N: "CA N\n(XPF)", CA_N1: "CA N-1\n(XPF)",
    EVOL_CA: "Évol CA\n(%)", PART_CA: "Part CA\n(%)", PART_CUMULEE: "Part\nCumulée (%)",
    QTE_N: "Quantité\nN", QTE_N1: "Quantité\nN-1", EVOL_QTE: "Évol Qté\n(%)",
    PRIX_MOY_N: "Prix Moy N\n(XPF)", PRIX_MOY_N1: "Prix Moy N-1\n(XPF)",
    MARGE_N: "Marge N\n(XPF)", PCT_MARGE_N: "Taux Marge\nN (%)",
    MARGE_N1: "Marge N-1\n(XPF)", PCT_MARGE_N1: "Taux Marge\nN-1 (%)", EVOL_MARGE: "Évol Marge\n(%)",
    NB_FACTURES_N: "Nb Factures\nN", NB_FACTURES_N1: "Nb Factures\nN-1",
    NB_CLIENTS_N: "Nb Clients\nN", NB_CLIENTS_N1: "Nb Clients\nN-1",
  };
}
function makeWidths(labelKey, stockKey) {
  return {
    RANG: 6, [labelKey]: 30,
    NB_ARTICLES_N: 12, [stockKey]: stockKey === "NB_ARTICLES_STOCK" ? 13 : 12,
    CA_N: 15, CA_N1: 15, EVOL_CA: 10, PART_CA: 10, PART_CUMULEE: 12,
    QTE_N: 12, QTE_N1: 12, EVOL_QTE: 10, PRIX_MOY_N: 12, PRIX_MOY_N1: 12,
    MARGE_N: 15, PCT_MARGE_N: 12, MARGE_N1: 15, PCT_MARGE_N1: 12, EVOL_MARGE: 12,
    NB_FACTURES_N: 12, NB_FACTURES_N1: 12, NB_CLIENTS_N: 12, NB_CLIENTS_N1: 12,
  };
}

// Agrège une année par libellé (via mapping NART(upper) -> libellé)
function agregatParLibelle(details, libelleByNart, sansLibelle) {
  const map = new Map();
  for (const l of details) {
    const lib = libelleByNart.get(String(l.NART).toUpperCase()) || sansLibelle;
    const ca = l.QTE * l.PVTE * (1 - l.POURC / 100);
    const cout = l.QTE * l.PREV;
    if (!map.has(lib)) {
      map.set(lib, {
        ca: 0, cout: 0, qte: 0,
        factures: new Set(), clients: new Set(), narts: new Set(),
      });
    }
    const a = map.get(lib);
    a.ca += ca;
    a.cout += cout;
    a.qte += l.QTE;
    a.factures.add(l.NUMFACT);
    a.clients.add(l.TIERS_ID);
    a.narts.add(l.NART);
  }
  return map;
}

// Mapping NART(upper) -> libellé RESTREINT aux NART vendus ayant un libellé
// artplus (reproduit "nart_to_X depuis ventes+artplus" des scripts).
function mappingVendus(datasets, attrKey) {
  const map = new Map();
  const artplus = datasets.artplus;
  const ajouter = (details) => {
    for (const l of details) {
      const key = String(l.NART).toUpperCase();
      if (map.has(key)) continue;
      const attr = artplus.get(key);
      if (attr && attr[attrKey]) map.set(key, attr[attrKey]);
    }
  };
  ajouter(datasets.detailsN);
  ajouter(datasets.detailsN1);
  return map;
}

function articlesFiltres(datasets) {
  return datasets.articles.filter((a) => {
    const nart = String(a.NART).trim();
    return !(nart.startsWith("08") || nart === "000001" || nart.includes("!"));
  });
}

function construireLignes(datasets, { labelKey, stockKey, attrKey, sansLibelle, stockMode }) {
  // artplus est injecté dans datasets pour le mapping vendus
  datasets.artplus = datasets.artplus || new Map();
  const libByNart = mappingVendus(datasets, attrKey);

  const aggN = agregatParLibelle(datasets.detailsN, libByNart, sansLibelle);
  const aggN1 = agregatParLibelle(datasets.detailsN1, libByNart, sansLibelle);

  // Stock par libellé (mapping restreint aux vendus ; articles filtrés)
  const stockParLib = new Map();
  for (const a of articlesFiltres(datasets)) {
    const lib = libByNart.get(String(a.NART).toUpperCase()) || sansLibelle;
    if (stockMode === "count") {
      if (!(a.STOCK > 0)) continue;
      if (!stockParLib.has(lib)) stockParLib.set(lib, new Set());
      stockParLib.get(lib).add(String(a.NART).trim());
    } else {
      // "sum" : somme de STOCK (tous articles, y compris ≤ 0)
      stockParLib.set(lib, (stockParLib.get(lib) || 0) + a.STOCK);
    }
  }
  const stockValeur = (lib) => {
    const v = stockParLib.get(lib);
    if (v === undefined) return 0;
    return stockMode === "count" ? v.size : Math.trunc(v);
  };

  const libs = new Set([...aggN.keys(), ...aggN1.keys()]);
  const rows = [];
  for (const lib of libs) {
    const n = aggN.get(lib);
    const n1 = aggN1.get(lib);
    rows.push({
      [labelKey]: lib,
      NB_ARTICLES_N: n ? n.narts.size : 0,
      [stockKey]: stockValeur(lib),
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

/**
 * Ajoute l'onglet Familles au classeur (artplus code 07).
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets, artplus }
 */
export function buildFamillesSheet(workbook, ctx) {
  const datasets = { ...ctx.datasets, artplus: ctx.artplus };
  const rows = construireLignes(datasets, {
    labelKey: "FAMILLE",
    stockKey: "NB_ARTICLES_STOCK",
    attrKey: "famille",
    sansLibelle: "SANS FAMILLE",
    stockMode: "count",
  });
  writeGridSheet(workbook, {
    sheetName: "Familles",
    tabColor: "FFA5A5A5",
    rows,
    colOrder: makeCols("FAMILLE", "NB_ARTICLES_STOCK"),
    headers: makeHeaders("FAMILLE", "Famille", "NB_ARTICLES_STOCK", "Nb Articles\nen Stock"),
    widths: makeWidths("FAMILLE", "NB_ARTICLES_STOCK"),
    titleText: "ANALYSE CA PAR FAMILLE",
    labelCol: "FAMILLE",
    articleCountCols: ["NB_ARTICLES_N", "NB_ARTICLES_STOCK"],
    freezeXSplit: 2,
  });
  return rows;
}

/**
 * Ajoute l'onglet Sous_Familles au classeur (artplus code 08).
 * @param {ExcelJS.Workbook} workbook
 * @param {object} ctx - { datasets, artplus }
 */
export function buildSousFamillesSheet(workbook, ctx) {
  const datasets = { ...ctx.datasets, artplus: ctx.artplus };
  const rows = construireLignes(datasets, {
    labelKey: "SOUS_FAMILLE",
    stockKey: "STOCK_TOTAL",
    attrKey: "sousFamille",
    sansLibelle: "SANS SOUS-FAMILLE",
    stockMode: "sum",
  });
  writeGridSheet(workbook, {
    sheetName: "Sous_Familles",
    tabColor: "FF5B9BD5",
    rows,
    colOrder: makeCols("SOUS_FAMILLE", "STOCK_TOTAL"),
    headers: makeHeaders("SOUS_FAMILLE", "Sous-Famille", "STOCK_TOTAL", "Stock\nTotal"),
    widths: makeWidths("SOUS_FAMILLE", "STOCK_TOTAL"),
    titleText: "ANALYSE CA PAR SOUS-FAMILLE",
    labelCol: "SOUS_FAMILLE",
    articleCountCols: ["NB_ARTICLES_N", "STOCK_TOTAL"],
    freezeXSplit: 2,
  });
  return rows;
}

export default { buildFamillesSheet, buildSousFamillesSheet };