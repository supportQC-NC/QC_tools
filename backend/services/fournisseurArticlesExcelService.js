// backend/services/fournisseurArticlesExcelService.js
//
// Génère le classeur Excel des articles d'UN fournisseur (article.dbf, via le
// cache article). Les filtres actifs à l'écran (dépréciation, niveau de stock)
// sont appliqués ici : l'export contient exactement les lignes affichées,
// toutes pages confondues, et se termine par la ligne de totaux du fournisseur.
//
// "Déprécié"  = stock total (S1..S5) nul ET DEPREC > 1
// "Ventes"    = V1..V12 (V1 = mois courant) ; CA HT = quantité × PVTE

import ExcelJS from "exceljs";
import articleCacheService from "./articleService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Libellés des valeurs de filtre, pour l'entête et le nom de fichier.
export const DEPRECATION_LABELS = {
  tout: "Tous les articles",
  deprecies: "Articles dépréciés",
  "non-deprecies": "Articles non dépréciés",
};

export const STOCK_LABELS = {
  tout: "tous niveaux de stock",
  positif: "stock positif",
  zero: "stock nul",
};

export const normaliserDeprecation = (valeur) => {
  const v = safeTrim(valeur);
  return v === "deprecies" || v === "non-deprecies" ? v : "tout";
};

export const normaliserStock = (valeur) => {
  const v = safeTrim(valeur);
  return v === "positif" || v === "zero" ? v : "tout";
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
 * Construit le classeur Excel des articles d'un fournisseur.
 *
 * @param {object} p
 * @param {object} p.entreprise
 * @param {object} p.fournisseur      enregistrement fourniss.dbf
 * @param {"tout"|"deprecies"|"non-deprecies"} [p.deprecation]
 * @param {"tout"|"positif"|"zero"} [p.stockFilter]
 * @returns {Promise<{ workbook, filename, count, ventes }>}
 */
export const buildArticlesFournisseurWorkbook = async ({
  entreprise,
  fournisseur,
  deprecation = "tout",
  stockFilter = "tout",
  // Champs DBF interdits à l'utilisateur (req.masqueDbf). L'export ne passe pas
  // par res.json : il doit filtrer lui-même, sinon masquer un champ à l'écran
  // ne protégerait rien.
  masqueDbf = null,
}) => {
  const filtre = normaliserDeprecation(deprecation);
  const filtreStock = normaliserStock(stockFilter);
  const fourn = fournisseur.FOURN;

  // Même chemin de filtrage que la liste à l'écran (égalité stricte sur FOURN
  // + filtres), mais sans pagination.
  const { articles } = await articleCacheService.getPaginated(entreprise, {
    page: 1,
    limit: Number.MAX_SAFE_INTEGER,
    fourn,
    fournExact: true,
    deprecation: filtre,
    stockFilter: filtreStock,
  });

  const ventes = articleCacheService.agregerVentes(articles);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Outil Quincaillerie";
  wb.created = new Date();

  const ws = wb.addWorksheet("Articles");

  // Bandeau d'entête : fournisseur, filtres appliqués, ventes cumulées.
  ws.mergeCells("A1:M1");
  ws.getCell("A1").value = `Fournisseur ${fourn} — ${safeTrim(fournisseur.NOM)}`;
  ws.getCell("A1").font = { bold: true, size: 13 };

  ws.mergeCells("A2:M2");
  ws.getCell("A2").value =
    `${DEPRECATION_LABELS[filtre]} · ${STOCK_LABELS[filtreStock]} · ` +
    `${articles.length} référence${articles.length > 1 ? "s" : ""} · ` +
    `CA HT 12 mois : ${ventes.ca12Mois.toLocaleString("fr-FR")} XPF`;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  // Colonnes déclarées avec leur champ DBF source (`dbf`) : celles dont le
  // champ est masqué pour l'utilisateur sont retirées du classeur.
  // `dbf: null` = colonne calculée, sans champ source direct.
  const COLONNES = [
    { key: "nart", entete: "NART", largeur: 14, dbf: "NART" },
    { key: "design", entete: "Désignation", largeur: 42, dbf: "DESIGN" },
    { key: "gencod", entete: "GENCOD", largeur: 16, dbf: "GENCOD" },
    { key: "refer", entete: "Référence fourn.", largeur: 18, dbf: "REFER" },
    { key: "groupe", entete: "Groupe", largeur: 10, dbf: "GROUPE" },
    { key: "stock", entete: "Stock total", largeur: 12, dbf: "STOCK" },
    { key: "deprec", entete: "DEPREC", largeur: 10, dbf: "DEPREC" },
    { key: "deprecie", entete: "Déprécié", largeur: 11, dbf: "DEPREC" },
    { key: "pvte", entete: "PV HT (PVTE)", largeur: 13, dbf: "PVTE" },
    { key: "qteMois", entete: "Qté mois courant", largeur: 17, dbf: "V1" },
    { key: "qte3Mois", entete: "Qté 3 mois", largeur: 12, dbf: "V1" },
    { key: "qte12Mois", entete: "Qté 12 mois", largeur: 13, dbf: "V1" },
    { key: "ca12Mois", entete: "CA HT 12 mois", largeur: 16, dbf: "PVTE" },
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

  for (const a of articles) {
    const v = articleCacheService.calculerVentesArticle(a);
    ws.addRow(nettoyer({
      nart: safeTrim(a.NART),
      design: safeTrim(a.DESIGN),
      gencod: safeTrim(a.GENCOD),
      refer: safeTrim(a.REFER),
      groupe: safeTrim(a.GROUPE),
      stock: articleCacheService.calculateStockTotal(a),
      deprec: Number(a.DEPREC) || 0,
      deprecie: articleCacheService.isArticleDeprecie(a) ? "OUI" : "NON",
      pvte: Number(a.PVTE) || 0,
      qteMois: v.qteMois,
      qte3Mois: v.qte3Mois,
      qte12Mois: v.qte12Mois,
      ca12Mois: Math.round(v.ca12Mois),
    }));
  }

  // Ligne de totaux fournisseur (sur les lignes filtrées).
  const ligneTotal = ws.addRow(nettoyer({
    nart: "TOTAL",
    design: `${articles.length} référence${articles.length > 1 ? "s" : ""}`,
    qteMois: ventes.qteMois,
    qte3Mois: ventes.qte3Mois,
    qte12Mois: ventes.qte12Mois,
    ca12Mois: ventes.ca12Mois,
  }));
  ligneTotal.font = { bold: true };
  ligneTotal.border = { top: { style: "double" } };

  for (const key of ["stock", "pvte", "qteMois", "qte3Mois", "qte12Mois", "ca12Mois"]) {
    if (clesVisibles.has(key)) ws.getColumn(key).numFmt = "#,##0";
  }
  const derniere = String.fromCharCode(64 + visibles.length);
  ws.autoFilter = { from: "A3", to: `${derniere}3` };

  const trig =
    safeTrim(entreprise?.trigramme) ||
    safeTrim(entreprise?.nomDossierDBF) ||
    "societe";
  const suffixes = [
    filtre === "tout" ? "" : `_${filtre}`,
    filtreStock === "tout" ? "" : `_stock-${filtreStock}`,
  ].join("");
  const filename = `articles_fournisseur_${fourn}${suffixes}_${trig}.xlsx`;

  return { workbook: wb, filename, count: articles.length, ventes };
};

export default {
  buildArticlesFournisseurWorkbook,
  normaliserDeprecation,
  normaliserStock,
};
