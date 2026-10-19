// backend/services/topVentesExcelService.js
//
// Export Excel du DÉTAIL Top Ventes : les articles d'UN fournisseur ou d'UN
// rayon, avec les mêmes indicateurs et les mêmes filtres (recherche, renvois,
// tri) que l'écran — l'export contient exactement ce que l'utilisateur regarde,
// sans la borne d'affichage (limit=0 côté getDetail : rien n'est tronqué).
//
// Même contrat de masquage que fournisseurArticlesExcelService : chaque colonne
// déclare son champ DBF source (`dbf`), celles dont le champ est interdit à
// l'utilisateur sont retirées AVANT construction — envoyerClasseur ne sert que
// de filet. Marque, coef et PR déclarent `PREV` : la marge révèle le prix de
// revient, masquer l'un doit masquer les autres.

import ExcelJS from "exceljs";
import { getDetail, getLibelleGroupe } from "./topVentesService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

const RENVOI_LABELS = {
  "1": "uniquement les articles en renvoi",
  "0": "sans les articles en renvoi",
};

const styleHeader = (row) => {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF8B5CF6" },
  };
  row.alignment = { vertical: "middle" };
  row.height = 20;
};

/**
 * Construit le classeur Excel du détail Top Ventes d'un fournisseur / rayon.
 *
 * @param {object} p
 * @param {object} p.entreprise
 * @param {"fournisseur"|"rayon"} p.type
 * @param {string|number} p.code   code FOURN ou GISM1
 * @param {string} [p.search]      filtre texte (NART/désignation/réf/gencod)
 * @param {string} [p.sort]        champ de tri (mêmes clés que l'écran)
 * @param {string} [p.dir]         "asc" | "desc"
 * @param {string} [p.renvoi]      "1" = renvois seuls, "0" = sans renvois
 * @param {Set}    [p.masqueDbf]   champs DBF interdits (req.masqueDbf)
 * @returns {Promise<{ workbook, filename, count }>}
 */
export const buildTopVentesDetailWorkbook = async ({
  entreprise,
  type,
  code,
  search,
  sort,
  dir,
  renvoi,
  masqueDbf = null,
}) => {
  const typeNorm = type === "rayon" ? "rayon" : "fournisseur";
  const { total, nbRenvois, articles } = await getDetail(entreprise, {
    type: typeNorm,
    code,
    search,
    sort,
    dir,
    renvoi,
    limit: 0, // tout : un export tronqué en silence serait pris pour complet
  });
  const label = await getLibelleGroupe(entreprise, typeNorm, code);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Outil Quincaillerie";
  wb.created = new Date();

  const ws = wb.addWorksheet("Top Ventes");

  // Bandeau : groupe exporté, filtres appliqués, volumétrie.
  ws.mergeCells("A1:M1");
  ws.getCell("A1").value =
    `Top Ventes — ${typeNorm === "rayon" ? "Rayon" : "Fournisseur"} ${safeTrim(code)}` +
    (label ? ` — ${label}` : "");
  ws.getCell("A1").font = { bold: true, size: 13 };

  const filtres = [
    `${total} article(s)`,
    nbRenvois > 0 ? `${nbRenvois} en renvoi` : "",
    RENVOI_LABELS[safeTrim(renvoi)] || "",
    safeTrim(search) ? `recherche « ${safeTrim(search)} »` : "",
    "ventes des 12 derniers mois (fiche article)",
  ].filter(Boolean);
  ws.mergeCells("A2:M2");
  ws.getCell("A2").value = filtres.join(" · ");
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  // Colonnes déclarées avec leur champ DBF source (`dbf`) — `dbf: null` =
  // colonne calculée sans champ sensible.
  const COLONNES = [
    { key: "nart", entete: "NART", largeur: 12, dbf: "NART" },
    { key: "design", entete: "Désignation", largeur: 42, dbf: "DESIGN" },
    { key: "refer", entete: "Référence fourn.", largeur: 18, dbf: "REFER" },
    { key: "gencod", entete: "GENCOD", largeur: 16, dbf: "GENCOD" },
    { key: "fourn", entete: "FOURN", largeur: 9, dbf: "FOURN" },
    { key: "gism1", entete: "GISM1", largeur: 9, dbf: "GISM1" },
    { key: "rayon", entete: "Rayon", largeur: 24, dbf: "GISM1" },
    { key: "venteAnnee", entete: "Ventes 12 mois (qté)", largeur: 18, dbf: "V1" },
    { key: "venteMoisMoy", entete: "Ventes / mois (moy.)", largeur: 18, dbf: "V1" },
    { key: "caAnnee", entete: "CA HT 12 mois", largeur: 16, dbf: "PVTE" },
    { key: "tauxMarque", entete: "Taux de marque %", largeur: 16, dbf: "PREV" },
    { key: "coef", entete: "Coef. multiplicateur", largeur: 17, dbf: "PREV" },
    { key: "pvte", entete: "PV HT (PVTE)", largeur: 13, dbf: "PVTE" },
    { key: "prev", entete: "PR (PREV)", largeur: 12, dbf: "PREV" },
    { key: "jourRupture", entete: "Rupture 12 mois (j)", largeur: 17, dbf: "RUP1" },
    { key: "stockMag", entete: "Stock magasin (S1)", largeur: 17, dbf: "S1" },
    { key: "stockDock", entete: "Stock dock (S2..S5)", largeur: 17, dbf: "S2" },
    { key: "stockTotal", entete: "Stock total", largeur: 11, dbf: "S1" },
    { key: "encde", entete: "En commande (ENCDE)", largeur: 20, dbf: "ENCDE" },
    { key: "renvoi", entete: "Renvoi vers (GENDOUBL)", largeur: 22, dbf: "GENDOUBL" },
  ];

  const visibles = masqueDbf
    ? COLONNES.filter((c) => !c.dbf || !masqueDbf.has(c.dbf.toUpperCase()))
    : COLONNES;

  ws.getRow(3).values = visibles.map((c) => c.entete);
  ws.columns = visibles.map((c) => ({ key: c.key, width: c.largeur }));
  styleHeader(ws.getRow(3));
  ws.views = [{ state: "frozen", ySplit: 3 }];

  const clesVisibles = new Set(visibles.map((c) => c.key));
  const nettoyer = (ligne) =>
    Object.fromEntries(
      Object.entries(ligne).filter(([k]) => clesVisibles.has(k)),
    );

  const totaux = { venteAnnee: 0, caAnnee: 0, stockTotal: 0 };
  for (const a of articles) {
    totaux.venteAnnee += a.venteAnnee || 0;
    totaux.caAnnee += a.caAnnee || 0;
    totaux.stockTotal += a.stockTotal || 0;
    ws.addRow(
      nettoyer({
        nart: a.nart,
        design: a.design,
        refer: a.refer,
        gencod: a.gencod,
        fourn: a.fourn,
        gism1: a.gism1,
        rayon: a.rayon,
        venteAnnee: a.venteAnnee,
        venteMoisMoy: a.venteMoisMoy,
        caAnnee: a.caAnnee,
        // null (coût inconnu) → cellule vide, comme le « — » de l'écran.
        tauxMarque: a.tauxMarque ?? null,
        coef: a.coef ?? null,
        pvte: a.pvte,
        prev: a.prev,
        jourRupture: a.jourRupture,
        stockMag: a.stockMag,
        stockDock: a.stockDock,
        stockTotal: a.stockTotal,
        encde: a.encde,
        renvoi: a.renvoi
          ? `${a.renvoi.nart}${a.renvoi.trouve ? "" : " (introuvable)"}`
          : "",
      }),
    );
  }

  const ligneTotal = ws.addRow(
    nettoyer({
      nart: "TOTAL",
      design: `${articles.length} article(s)`,
      venteAnnee: Math.round(totaux.venteAnnee * 100) / 100,
      caAnnee: Math.round(totaux.caAnnee),
      stockTotal: Math.round(totaux.stockTotal * 100) / 100,
    }),
  );
  ligneTotal.font = { bold: true };
  ligneTotal.border = { top: { style: "double" } };

  for (const key of ["caAnnee", "pvte", "prev"]) {
    if (clesVisibles.has(key)) ws.getColumn(key).numFmt = "#,##0";
  }
  for (const key of ["tauxMarque", "coef", "venteMoisMoy"]) {
    if (clesVisibles.has(key)) ws.getColumn(key).numFmt = "#,##0.00";
  }

  // Autofiltre sur la ligne d'entêtes (≤ 26 colonnes : une lettre suffit).
  const derniere = String.fromCharCode(64 + visibles.length);
  ws.autoFilter = { from: "A3", to: `${derniere}3` };

  const trig =
    safeTrim(entreprise?.trigramme) ||
    safeTrim(entreprise?.nomDossierDBF) ||
    "societe";
  const filename = `top_ventes_${typeNorm}_${safeTrim(code)}_${trig}.xlsx`;

  return { workbook: wb, filename, count: articles.length };
};

export default { buildTopVentesDetailWorkbook };
