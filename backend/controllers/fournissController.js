// backend/controllers/fournissController.js
import asyncHandler from "../middleware/asyncHandler.js";
import fournissCacheService from "../services/fournissCacheService.js";
import articleCacheService from "../services/articleService.js"; // Pour chercher les articles liés
import {
  buildArticlesFournisseurWorkbook,
  normaliserDeprecation,
  normaliserStock,
} from "../services/fournisseurArticlesExcelService.js";
import path from "path";
import fs from "fs";

/**
 * @desc    Obtenir tous les fournisseurs
 * @route   GET /api/fournisseurs/:nomDossierDBF
 * @access  Private
 */
const getFournisseurs = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  // IMPORTANT : Vérifier que le nom du fichier correspond à votre fichier réel
  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "fourniss.dbf" 
  );

  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(`Fichier fournisseurs non trouvé`);
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || undefined;

    const result = await fournissCacheService.getPaginated(entreprise, {
      page,
      limit,
      search,
    });

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
      },
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPrevPage: result.hasPrevPage,
      },
      _queryTime: `${Date.now() - startTime}ms`,
      fournisseurs: result.fournisseurs,
    });
  } catch (error) {
    console.error("Erreur lecture fournisseurs:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture: ${error.message}`);
  }
});

/**
 * @desc    Obtenir un fournisseur par son code FOURN
 * @route   GET /api/fournisseurs/:nomDossierDBF/code/:fourn
 * @access  Private
 */
// backend/controllers/fournissController.js

/**
 * @desc    Obtenir un fournisseur par son code FOURN
 * @route   GET /api/fournisseurs/:nomDossierDBF/code/:fourn
 * @access  Private
 */
const getFournisseurByCode = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { fourn } = req.params;
  const startTime = Date.now();

  try {
    const fournisseur = await fournissCacheService.findByFourn(entreprise, fourn);

    if (!fournisseur) {
      res.status(404);
      throw new Error(`Fournisseur avec le code ${fourn} non trouvé`);
    }

    // Calculer les stats de dépréciation pour ce fournisseur
    const depreciationStats = await articleCacheService.getSupplierStats(entreprise, fourn);

    res.json({
      _queryTime: `${Date.now() - startTime}ms`,
      fournisseur,
      depreciationStats, // On ajoute les stats ici
    });
  } catch (error) {
    if (error.message.includes("non trouvé")) throw error;
    res.status(500);
    throw new Error(`Erreur: ${error.message}`);
  }
});

/**
 * @desc    Obtenir les articles liés à un fournisseur
 * @route   GET /api/fournisseurs/:nomDossierDBF/code/:fourn/articles
 *          ?deprecation=tout|deprecies|non-deprecies
 * @access  Private
 */
const getArticlesByFournisseur = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { fourn } = req.params;
  const startTime = Date.now();

  // Vérifier si le fournisseur existe
  const fournisseur = await fournissCacheService.findByFourn(entreprise, fourn);
  if (!fournisseur) {
    res.status(404);
    throw new Error(`Fournisseur ${fourn} non trouvé`);
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const deprecation = normaliserDeprecation(req.query.deprecation);
    const stockFilter = normaliserStock(req.query.stock);

    // Un seul passage de filtrage : les totaux de ventes portent donc
    // exactement sur les lignes listées (toutes pages confondues).
    const { articles: filtres } = await articleCacheService.getPaginated(
      entreprise,
      {
        page: 1,
        limit: Number.MAX_SAFE_INTEGER,
        fourn, // Appliquer le filtre FOURN
        fournExact: true, // Égalité stricte : 3 ne doit pas remonter 30/130/300
        deprecation, // "tout" => aucun filtrage
        stockFilter, // "tout" => aucun filtrage
      },
    );

    const totalRecords = filtres.length;
    const totalPages = Math.ceil(totalRecords / limit) || 1;
    const start = (page - 1) * limit;

    // Les enregistrements du cache ne doivent jamais être mutés : on renvoie
    // des copies enrichies des champs calculés.
    const articles = filtres.slice(start, start + limit).map((a) => ({
      ...a,
      _stockTotal: articleCacheService.calculateStockTotal(a),
      _deprecie: articleCacheService.isArticleDeprecie(a),
      _ventes: articleCacheService.calculerVentesArticle(a),
    }));

    res.json({
      fournisseur: {
        FOURN: fournisseur.FOURN,
        NOM: fournisseur.NOM ? fournisseur.NOM.trim() : "",
        AD1: fournisseur.AD1 ? fournisseur.AD1.trim() : "",
      },
      deprecation,
      stock: stockFilter,
      // Ventes cumulées du fournisseur sur les articles filtrés
      ventes: articleCacheService.agregerVentes(filtres),
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages,
        hasNextPage: start + limit < totalRecords,
        hasPrevPage: page > 1,
      },
      _queryTime: `${Date.now() - startTime}ms`,
      articles,
    });
  } catch (error) {
    console.error("Erreur récupération articles fournisseur:", error);
    res.status(500);
    throw new Error(`Erreur: ${error.message}`);
  }
});

/**
 * @desc    Exporter en Excel les articles d'un fournisseur.
 *          Le filtre de dépréciation actif à l'écran est repris tel quel :
 *          l'export contient exactement les lignes affichées (toutes pages).
 * @route   GET /api/fournisseurs/:nomDossierDBF/code/:fourn/articles/export
 *          ?deprecation=tout|deprecies|non-deprecies
 * @access  Private
 */
const exportArticlesByFournisseur = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { fourn } = req.params;

  const fournisseur = await fournissCacheService.findByFourn(entreprise, fourn);
  if (!fournisseur) {
    res.status(404);
    throw new Error(`Fournisseur ${fourn} non trouvé`);
  }

  const deprecation = normaliserDeprecation(req.query.deprecation);
  const stockFilter = normaliserStock(req.query.stock);

  const { workbook, filename, count } =
    await buildArticlesFournisseurWorkbook({
      entreprise,
      fournisseur,
      deprecation,
      stockFilter,
    });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Access-Control-Expose-Headers", "X-Lignes");
  res.setHeader("X-Lignes", String(count));

  await workbook.xlsx.write(res);
  res.end();
});

/**
 * @desc    Rechercher des fournisseurs
 * @route   GET /api/fournisseurs/:nomDossierDBF/search
 * @access  Private
 */
const searchFournisseurs = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { q, limit = 20 } = req.query;
  const startTime = Date.now();

  if (!q) {
    res.status(400);
    throw new Error("Le paramètre 'q' est requis");
  }

  try {
    const result = await fournissCacheService.search(entreprise, q, { limit: parseInt(limit) });

    res.json({
      query: q,
      totalFound: result.totalFound,
      _queryTime: `${Date.now() - startTime}ms`,
      fournisseurs: result.fournisseurs,
    });
  } catch (error) {
    res.status(500);
    throw new Error(`Erreur recherche: ${error.message}`);
  }
});

/**
 * @desc    Obtenir la structure du fichier DBF
 * @route   GET /api/fournisseurs/:nomDossierDBF/structure
 * @access  Private
 */
const getFournisseursStructure = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  try {
    const structure = await fournissCacheService.getStructure(entreprise);
    res.json({ structure });
  } catch (error) {
    res.status(500);
    throw new Error(`Erreur lecture structure: ${error.message}`);
  }
});

/**
 * @desc    Invalider le cache
 * @route   POST /api/fournisseurs/:nomDossierDBF/invalidate-cache
 * @access  Private/Admin
 */
const invalidateCache = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  fournissCacheService.invalidate(entreprise.nomDossierDBF);
  res.json({ message: `Cache fournisseurs invalidé pour ${entreprise.nomDossierDBF}` });
});

export {
  getFournisseurs,
  getFournisseurByCode,
  getArticlesByFournisseur,
  exportArticlesByFournisseur,
  searchFournisseurs,
  getFournisseursStructure, // AJOUTÉ ICI
  invalidateCache,
};