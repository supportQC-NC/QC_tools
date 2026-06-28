// backend/controllers/articleController.js
import asyncHandler from "../middleware/asyncHandler.js";
import articleCacheService from "../services/articleService.js";
import path from "path";
import fs from "fs";

/**
 * Structure du fichier article.dbf :
 * NART(C:6) - Code article
 * DESIGN(C:50) - Désignation
 * DESIGN2(C:30) - Désignation 2
 * GENCOD(C:13) - Code barre EAN
 * REFER(C:13) - Référence fournisseur
 * FOURN(N:3.0) - Code fournisseur
 * PVTE(N:11.2) - Prix de vente HT
 * PVTETTC(N:8.0) - Prix de vente TTC
 * PACHAT(N:13.4) - Prix d'achat
 * S1-S5 - Stocks par entrepôt
 * GROUPE(C:6) - Code groupe/famille
 * UNITE(C:3) - Unité de vente
 * TAXES(N:5.2) - Taux de taxe
 * GENDOUBL(C:6) - Code article de renvoi
 * DEPREC - Dépréciation
 * WEB - Visible web (O/N)
 * FOTO - Photo (F si présente)
 * DPROMOD/DPROMOF - Dates promo début/fin
 * PVPROMO - Prix promo
 * GISM1-5, PLACE - Gisements
 */

/**
 * @desc    Fonction utilitaire pour suivre la chaîne de renvois via GENDOUBL
 *          Utilise le cache pour des recherches O(1)
 */
const suivreChaineRenvois = async (entreprise, article) => {
  const MAX_ITERATIONS = 10;
  let currentArticle = article;
  let iterations = 0;
  const chaineRenvois = [];

  const articleOriginal = {
    nart: article.NART ? article.NART.trim() : "",
    gencod: article.GENCOD ? article.GENCOD.trim() : "",
    designation: article.DESIGN ? article.DESIGN.trim() : "",
  };

  while (currentArticle && iterations < MAX_ITERATIONS) {
    const gendoubl = currentArticle.GENDOUBL
      ? currentArticle.GENDOUBL.trim()
      : "";

    if (!gendoubl) {
      break;
    }

    chaineRenvois.push({
      nart: currentArticle.NART ? currentArticle.NART.trim() : "",
      gencod: currentArticle.GENCOD ? currentArticle.GENCOD.trim() : "",
      designation: currentArticle.DESIGN ? currentArticle.DESIGN.trim() : "",
      renvoisVers: gendoubl,
    });

    // Recherche O(1) via le cache
    const nextArticle = await articleCacheService.findByNart(
      entreprise,
      gendoubl,
    );

    if (!nextArticle) {
      console.warn(`Renvoi vers article inexistant (NART): ${gendoubl}`);
      break;
    }

    currentArticle = nextArticle;
    iterations++;
  }

  const isRenvoi = chaineRenvois.length > 0;

  return {
    articleFinal: currentArticle,
    isRenvoi,
    articleOriginal: isRenvoi ? articleOriginal : null,
    chaineRenvois: isRenvoi ? chaineRenvois : null,
    nombreRenvois: chaineRenvois.length,
  };
};

/**
 * @desc    Obtenir tous les articles d'une entreprise avec filtres avancés
 * @route   GET /api/articles/:nomDossierDBF
 * @access  Private (avec vérification d'accès à l'entreprise)
 *
 * Query params supportés:
 * - page, limit: pagination
 * - search: recherche textuelle (DESIGN, DESIGN2, NART, GENCOD, REFER)
 * - nart: filtre par code article (partiel)
 * - groupe: filtre par groupe/famille
 * - fourn: filtre par fournisseur
 * - gisement: filtre par gisement (GISM1-5, PLACE)
 * - enStock: "true" pour articles en stock (S1+S2+S3+S4+S5 > 0)
 * - hasGencod: "true" pour articles avec code barre
 * - hasPromo: "true" pour articles en promo active
 * - hasDeprec: "true" pour articles dépréciés
 * - isWeb: "true" pour articles visibles web
 * - hasPhoto: "true" pour articles avec photo
 * - reapproMag: "true" pour réappro magasin (stock>0 et S1=0)
 * - tgc: filtre par taux de taxe
 */
const getArticles = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(
      `Fichier articles non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    // Paramètres de pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    // Construire les options de filtrage
    const filterOptions = {
      page,
      limit,
      // Filtres textuels
      search: req.query.search || undefined,
      nart: req.query.nart || undefined,
      groupe: req.query.groupe || undefined,
      fourn: req.query.fourn || undefined,
      gisement: req.query.gisement || undefined,
      // Filtres booléens
      enStock: req.query.enStock === "true",
      hasGencod: req.query.hasGencod === "true",
      hasPromo: req.query.hasPromo === "true",
      hasDeprec: req.query.hasDeprec === "true",
      isWeb: req.query.isWeb === "true",
      hasPhoto: req.query.hasPhoto === "true",
      reapproMag: req.query.reapproMag === "true",
      // Filtres numériques
      tgc: req.query.tgc || undefined,
    };

    // Appeler le service avec tous les filtres
    const result = await articleCacheService.getPaginated(
      entreprise,
      filterOptions,
    );

    const queryTime = Date.now() - startTime;

    // Compter les filtres actifs
    const activeFilters = Object.entries(filterOptions).filter(
      ([key, val]) =>
        key !== "page" &&
        key !== "limit" &&
        val !== undefined &&
        val !== false &&
        val !== "",
    ).length;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPrevPage: result.hasPrevPage,
      },
      filters: {
        active: activeFilters,
      },
      _queryTime: `${queryTime}ms`,
      articles: result.articles,
    });
  } catch (error) {
    console.error("Erreur lecture articles:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture des articles: ${error.message}`);
  }
});

/**
 * @desc    Obtenir un article par son code NART (avec cache - O(1) + gestion renvois)
 * @route   GET /api/articles/:nomDossierDBF/code/:nart
 * @access  Private
 */
const getArticleByNart = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { nart } = req.params;
  const startTime = Date.now();

  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(
      `Fichier articles non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    // Recherche O(1) via l'index
    const article = await articleCacheService.findByNart(entreprise, nart);

    if (!article) {
      res.status(404);
      throw new Error(`Article avec le code ${nart} non trouvé`);
    }

    // Suivre la chaîne de renvois si nécessaire
    const resultatRenvoi = await suivreChaineRenvois(entreprise, article);
    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      _queryTime: `${queryTime}ms`,
      article: resultatRenvoi.articleFinal,
      // Informations de renvoi
      isRenvoi: resultatRenvoi.isRenvoi,
      articleOriginal: resultatRenvoi.articleOriginal,
      chaineRenvois: resultatRenvoi.chaineRenvois,
      nombreRenvois: resultatRenvoi.nombreRenvois,
    });
  } catch (error) {
    if (error.message.includes("non trouvé")) {
      throw error;
    }
    console.error("Erreur lecture article:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture de l'article: ${error.message}`);
  }
});

/**
 * @desc    Rechercher un article par code barre (GENCOD) (avec cache - O(1) + gestion renvois)
 * @route   GET /api/articles/:nomDossierDBF/gencod/:gencod
 * @access  Private
 */
const getArticleByGencod = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { gencod } = req.params;
  const startTime = Date.now();

  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(
      `Fichier articles non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    // Recherche O(1) via l'index
    const article = await articleCacheService.findByGencod(entreprise, gencod);

    if (!article) {
      res.status(404);
      throw new Error(`Article avec le code barre ${gencod} non trouvé`);
    }

    // Suivre la chaîne de renvois si nécessaire
    const resultatRenvoi = await suivreChaineRenvois(entreprise, article);
    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      _queryTime: `${queryTime}ms`,
      article: resultatRenvoi.articleFinal,
      // Informations de renvoi
      isRenvoi: resultatRenvoi.isRenvoi,
      articleOriginal: resultatRenvoi.articleOriginal,
      chaineRenvois: resultatRenvoi.chaineRenvois,
      nombreRenvois: resultatRenvoi.nombreRenvois,
    });
  } catch (error) {
    if (error.message.includes("non trouvé")) {
      throw error;
    }
    console.error("Erreur lecture article:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture de l'article: ${error.message}`);
  }
});

/**
 * @desc    Obtenir la structure du fichier DBF
 * @route   GET /api/articles/:nomDossierDBF/structure
 * @access  Private
 */
const getArticlesStructure = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(
      `Fichier articles non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const structure = await articleCacheService.getStructure(entreprise);

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      structure,
    });
  } catch (error) {
    console.error("Erreur lecture structure:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture de la structure: ${error.message}`,
    );
  }
});

/**
 * @desc    Recherche avancée d'articles (avec cache et index inversé)
 * @route   GET /api/articles/:nomDossierDBF/search
 * @access  Private
 */
const searchArticles = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { q, field, limit = 50 } = req.query;
  const startTime = Date.now();

  if (!q) {
    res.status(400);
    throw new Error("Le paramètre de recherche 'q' est requis");
  }

  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(
      `Fichier articles non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const allowedFields = [
      "NART",
      "DESIGN",
      "DESIGN2",
      "GENCOD",
      "REFER",
      "GROUPE",
      "OBSERV",
      "DESIFRN",
      "PLACE",
    ];

    if (field) {
      const fieldUpper = field.toUpperCase();
      if (!allowedFields.includes(fieldUpper)) {
        res.status(400);
        throw new Error(
          `Champ '${field}' non autorisé. Champs disponibles: ${allowedFields.join(", ")}`,
        );
      }
    }

    const result = await articleCacheService.search(entreprise, q, {
      limit: parseInt(limit),
    });

    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      search: {
        query: q,
        field: field || "NART, DESIGN, DESIGN2, GENCOD, REFER",
        totalFound: result.totalFound,
        returned: result.articles.length,
      },
      _queryTime: `${queryTime}ms`,
      articles: result.articles,
    });
  } catch (error) {
    if (error.message.includes("non autorisé")) {
      throw error;
    }
    console.error("Erreur recherche articles:", error);
    res.status(500);
    throw new Error(`Erreur lors de la recherche: ${error.message}`);
  }
});

/**
 * @desc    Obtenir la liste des groupes/familles d'articles (avec cache)
 * @route   GET /api/articles/:nomDossierDBF/groupes
 * @access  Private
 */
const getGroupes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(
      `Fichier articles non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const groupes = await articleCacheService.getGroupes(entreprise);
    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      totalGroupes: groupes.length,
      _queryTime: `${queryTime}ms`,
      groupes,
    });
  } catch (error) {
    console.error("Erreur lecture groupes:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture des groupes: ${error.message}`);
  }
});

/**
 * @desc    Obtenir la liste des taux TGC distincts
 * @route   GET /api/articles/:nomDossierDBF/tgc-rates
 * @access  Private
 */
const getTgcRates = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(
      `Fichier articles non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const tgcRates = await articleCacheService.getTgcRates(entreprise);
    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      totalRates: tgcRates.length,
      _queryTime: `${queryTime}ms`,
      tgcRates,
    });
  } catch (error) {
    console.error("Erreur lecture taux TGC:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture des taux TGC: ${error.message}`);
  }
});

/**
 * @desc    Invalider le cache d'une entreprise (utile après modifications)
 * @route   POST /api/articles/:nomDossierDBF/invalidate-cache
 * @access  Private/Admin
 */
const invalidateCache = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  articleCacheService.invalidate(entreprise.nomDossierDBF);

  res.json({
    message: `Cache invalidé pour ${entreprise.nomComplet}`,
    nomDossierDBF: entreprise.nomDossierDBF,
  });
});

/**
 * @desc    Obtenir les statistiques du cache
 * @route   GET /api/articles/cache-stats
 * @access  Private/Admin
 */
const getCacheStats = asyncHandler(async (req, res) => {
  const stats = articleCacheService.getStats();

  res.json({
    cacheEntries: Object.keys(stats).length,
    stats,
  });
});

// ===========================================
// AJOUT À FAIRE DANS articleController.js
// Endpoint pour récupérer les articles adjacents (précédent/suivant)
// ===========================================

/**
 * @desc    Récupérer les articles adjacents (précédent et suivant) par NART
 * @route   GET /api/articles/:nomDossierDBF/adjacent/:nart
 * @access  Private
 */
const getAdjacentArticles = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { nart } = req.params;
  const startTime = Date.now();

  const normalizedNart = nart.trim();

  // Récupérer tous les articles triés par NART
  const allArticles = await articleCacheService.getPaginated(entreprise, {
    page: 1,
    limit: 999999,
  });

  // Trier par NART
  const sortedArticles = allArticles.articles
    .map((a) => ({
      NART: a.NART?.trim(),
      DESIGN: a.DESIGN?.trim(),
      GENCOD: a.GENCOD?.trim(),
    }))
    .filter((a) => a.NART)
    .sort((a, b) => a.NART.localeCompare(b.NART));

  // Trouver l'index actuel
  const currentIndex = sortedArticles.findIndex(
    (a) => a.NART === normalizedNart,
  );

  const previousArticle =
    currentIndex > 0 ? sortedArticles[currentIndex - 1] : null;
  const nextArticle =
    currentIndex >= 0 && currentIndex < sortedArticles.length - 1
      ? sortedArticles[currentIndex + 1]
      : null;

  const queryTime = Date.now() - startTime;

  res.json({
    current: normalizedNart,
    previous: previousArticle,
    next: nextArticle,
    _queryTime: `${queryTime}ms`,
  });
});

export {
  getArticles,
  getArticleByNart,
  getArticleByGencod,
  getArticlesStructure,
  searchArticles,
  getGroupes,
  getTgcRates,
  getAdjacentArticles,
  invalidateCache,
  getCacheStats,
};
