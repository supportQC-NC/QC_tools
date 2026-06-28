// backend/controllers/proformaController.js
import asyncHandler from "../middleware/asyncHandler.js";
import proformaCacheService from "../services/proformaCacheService.js";
import articleCacheService from "../services/articleService.js";
import path from "path";
import fs from "fs";

/**
 * Structure proforma.dbf (entête) :
 * NUMFACT(C:7) - Numéro de proforma
 * DATFACT(D:8) - Date de la proforma
 * TIERS(N:4.0) - Code tiers/client
 * NOM(C:30) - Nom du client
 * TEXTE(C:60) - Texte/objet de la proforma
 * REPRES(N:2.0) - Code représentant
 * MONTANT(N:8.0) - Montant total
 * DATCHANT(D:8) - Date de chantier
 * MAILING1-5(C:70) - Adresse mailing
 * ETAT(N:1.0) - État : 0=brouillon, 1=validée, 2=facturée
 *
 * Structure prodet.dbf (détail) :
 * NUMFACT(C:7) - Numéro de proforma (lien avec proforma.dbf)
 * NART(C:6) - Code article (lien avec article.dbf, si vide ou contient "!" => commentaire)
 * DESIGN(C:50) - Désignation
 * QTE(N:9.3) - Quantité
 * PVTE(N:11.2) - Prix de vente HT unitaire
 * PREV(N:11.2) - Prix de revient
 * POURC(N:3.0) - Pourcentage remise
 * DTVA(N:5.2) - Taux de TVA/TGC
 * CLIENT(C:4) - Code client
 * NL(N:8.3) - Numéro de ligne
 * COMPOSE(C:2) - Composé
 * NONIMP(C:1) - Non imprimable
 * PVTTC(N:8.0) - Prix TTC
 * NUMSERIE(C:40) - Numéro de série
 * GARANTIE(C:10) - Garantie
 */

// ===========================================
// HELPERS
// ===========================================

/**
 * Vérifie que les fichiers proforma.dbf et prodet.dbf existent
 */
const checkProformaFiles = (entreprise) => {
  const basePath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
  );
  const proformaPath = path.join(basePath, "proforma.dbf");
  const prodetPath = path.join(basePath, "prodet.dbf");

  if (!fs.existsSync(proformaPath)) {
    return {
      exists: false,
      error: `Fichier proforma.dbf non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    };
  }
  if (!fs.existsSync(prodetPath)) {
    return {
      exists: false,
      error: `Fichier prodet.dbf non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    };
  }

  return { exists: true };
};

/**
 * Objet entreprise standardisé pour les réponses
 */
const formatEntreprise = (entreprise) => ({
  _id: entreprise._id,
  nomDossierDBF: entreprise.nomDossierDBF,
  trigramme: entreprise.trigramme,
  nomComplet: entreprise.nomComplet,
});

/**
 * Labels des états de proforma
 */
const ETAT_LABELS = {
  0: "brouillon",
  1: "validée",
  2: "facturée",
};

// ===========================================
// CONTROLLERS
// ===========================================

/**
 * @desc    Obtenir la liste des proformas avec pagination et filtres
 * @route   GET /api/proformas/:nomDossierDBF
 * @access  Private (module proforma, read)
 *
 * Query params supportés:
 * - page, limit : pagination
 * - search : recherche textuelle (NUMFACT, NOM, TEXTE)
 * - tiers : filtre par code tiers/client
 * - repres : filtre par représentant
 * - etat : filtre par état (0, 1, 2)
 * - dateDebut : date de début (ISO ou YYYY-MM-DD)
 * - dateFin : date de fin (ISO ou YYYY-MM-DD)
 */
const getProformas = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const filesCheck = checkProformaFiles(entreprise);
  if (!filesCheck.exists) {
    res.status(404);
    throw new Error(filesCheck.error);
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const filterOptions = {
      page,
      limit,
      search: req.query.search || undefined,
      tiers: req.query.tiers || undefined,
      repres: req.query.repres || undefined,
      etat: req.query.etat !== undefined ? req.query.etat : undefined,
      dateDebut: req.query.dateDebut || undefined,
      dateFin: req.query.dateFin || undefined,
    };

    const result = await proformaCacheService.getPaginated(
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
      entreprise: formatEntreprise(entreprise),
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
      etatLabels: ETAT_LABELS,
      _queryTime: `${queryTime}ms`,
      proformas: result.proformas,
    });
  } catch (error) {
    console.error("Erreur lecture proformas:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture des proformas: ${error.message}`);
  }
});

/**
 * @desc    Obtenir une proforma par NUMFACT (entête + lignes détail enrichies)
 * @route   GET /api/proformas/:nomDossierDBF/:numfact
 * @access  Private (module proforma, read)
 */
const getProformaByNumfact = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { numfact } = req.params;
  const startTime = Date.now();

  const filesCheck = checkProformaFiles(entreprise);
  if (!filesCheck.exists) {
    res.status(404);
    throw new Error(filesCheck.error);
  }

  try {
    // Récupérer l'entête
    const proforma = await proformaCacheService.findByNumfact(
      entreprise,
      numfact,
    );

    if (!proforma) {
      res.status(404);
      throw new Error(`Proforma ${numfact} non trouvée`);
    }

    // Récupérer les lignes détail enrichies avec infos article
    const lignes = await proformaCacheService.getProdetByNumfact(
      entreprise,
      numfact,
    );

    // Séparer commentaires et lignes article
    const lignesArticle = lignes.filter((l) => !l._isComment);
    const lignesCommentaire = lignes.filter((l) => l._isComment);

    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: formatEntreprise(entreprise),
      _queryTime: `${queryTime}ms`,
      proforma,
      etatLabel: ETAT_LABELS[proforma.ETAT] || "inconnu",
      detail: {
        totalLignes: lignes.length,
        lignesArticle: lignesArticle.length,
        lignesCommentaire: lignesCommentaire.length,
        lignes,
      },
    });
  } catch (error) {
    if (error.message.includes("non trouvée")) {
      throw error;
    }
    console.error("Erreur lecture proforma:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture de la proforma: ${error.message}`,
    );
  }
});

/**
 * @desc    Recherche avancée de proformas
 * @route   GET /api/proformas/:nomDossierDBF/search
 * @access  Private (module proforma, read)
 *
 * Query params:
 * - q : terme de recherche (requis)
 * - limit : nombre de résultats max (défaut 50)
 */
const searchProformas = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { q, limit = 50 } = req.query;
  const startTime = Date.now();

  if (!q) {
    res.status(400);
    throw new Error("Le paramètre de recherche 'q' est requis");
  }

  const filesCheck = checkProformaFiles(entreprise);
  if (!filesCheck.exists) {
    res.status(404);
    throw new Error(filesCheck.error);
  }

  try {
    const result = await proformaCacheService.search(entreprise, q, {
      limit: parseInt(limit),
    });

    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: formatEntreprise(entreprise),
      search: {
        query: q,
        totalFound: result.totalFound,
        returned: result.proformas.length,
      },
      _queryTime: `${queryTime}ms`,
      proformas: result.proformas,
    });
  } catch (error) {
    console.error("Erreur recherche proformas:", error);
    res.status(500);
    throw new Error(`Erreur lors de la recherche: ${error.message}`);
  }
});

/**
 * @desc    Obtenir la liste des représentants distincts (avec comptage)
 * @route   GET /api/proformas/:nomDossierDBF/representants
 * @access  Private (module proforma, read)
 */
const getRepresentants = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const filesCheck = checkProformaFiles(entreprise);
  if (!filesCheck.exists) {
    res.status(404);
    throw new Error(filesCheck.error);
  }

  try {
    const representants = await proformaCacheService.getRepresentants(entreprise);
    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: formatEntreprise(entreprise),
      totalRepresentants: representants.length,
      _queryTime: `${queryTime}ms`,
      representants,
    });
  } catch (error) {
    console.error("Erreur lecture représentants:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture des représentants: ${error.message}`,
    );
  }
});

/**
 * @desc    Obtenir la structure des fichiers DBF (proforma + prodet)
 * @route   GET /api/proformas/:nomDossierDBF/structure
 * @access  Private (module proforma, read)
 */
const getProformasStructure = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const filesCheck = checkProformaFiles(entreprise);
  if (!filesCheck.exists) {
    res.status(404);
    throw new Error(filesCheck.error);
  }

  try {
    const structure = await proformaCacheService.getStructure(entreprise);

    res.json({
      entreprise: formatEntreprise(entreprise),
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
 * @desc    Obtenir les proformas d'un tiers/client
 * @route   GET /api/proformas/:nomDossierDBF/tiers/:tiers
 * @access  Private (module proforma, read)
 */
const getProformasByTiers = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { tiers } = req.params;
  const startTime = Date.now();

  const filesCheck = checkProformaFiles(entreprise);
  if (!filesCheck.exists) {
    res.status(404);
    throw new Error(filesCheck.error);
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const result = await proformaCacheService.getPaginated(entreprise, {
      page,
      limit,
      tiers,
    });

    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: formatEntreprise(entreprise),
      tiers,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPrevPage: result.hasPrevPage,
      },
      _queryTime: `${queryTime}ms`,
      proformas: result.proformas,
    });
  } catch (error) {
    console.error("Erreur lecture proformas par tiers:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture des proformas du tiers: ${error.message}`,
    );
  }
});

/**
 * @desc    Invalider le cache proformas d'une entreprise
 * @route   POST /api/proformas/:nomDossierDBF/invalidate-cache
 * @access  Private/Admin
 */
const invalidateCache = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  proformaCacheService.invalidate(entreprise.nomDossierDBF);

  res.json({
    message: `Cache proformas invalidé pour ${entreprise.nomComplet}`,
    nomDossierDBF: entreprise.nomDossierDBF,
  });
});

/**
 * @desc    Obtenir les statistiques du cache proformas
 * @route   GET /api/proformas/cache-stats
 * @access  Private/Admin
 */
const getCacheStats = asyncHandler(async (req, res) => {
  const stats = proformaCacheService.getStats();

  res.json({
    cacheEntries: Object.keys(stats).length,
    stats,
  });
});
/**
 * @desc    Enregistrer un fichier .dat sur le serveur (cheminExportInventaire)
 * @route   POST /api/proformas/:nomDossierDBF/:numfact/save-dat
 * @access  Private (module proforma, read)
 *
 * Body: { datContent: string }
 *
 * Le fichier est enregistré dans entreprise.cheminExportInventaire
 * Nom du fichier : Proforma_{NUMFACT}.dat
 */
const saveProformaDat = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { numfact } = req.params;
  const { datContent, fileName: customFileName } = req.body;

  if (!datContent || typeof datContent !== "string") {
    res.status(400);
    throw new Error("Le contenu du fichier .dat est requis");
  }

  // Vérifier le chemin d'export
  const exportPath = entreprise.cheminExportInventaire;
  if (!exportPath) {
    res.status(400);
    throw new Error(
      `Aucun chemin d'export inventaire configuré pour ${entreprise.nomComplet}`,
    );
  }

  // Vérifier que le dossier existe
  if (!fs.existsSync(exportPath)) {
    res.status(404);
    throw new Error(
      `Le dossier d'export n'existe pas ou n'est pas accessible : ${exportPath}`,
    );
  }

  // Nom du fichier : personnalisé ou par défaut "stock.dat YYYYMMDD"
  let fileName;
  if (customFileName && customFileName.trim()) {
    // Nettoyer les caractères interdits dans un nom de fichier (garder les espaces et points)
    fileName = customFileName.trim().replace(/[<>:"/\\|?*]/g, "_");
  } else {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    fileName = `stock.dat ${y}${m}${d}`;
  }

  const filePath = path.join(exportPath, fileName);

  try {
    // Écrire le fichier
    fs.writeFileSync(filePath, datContent, "utf-8");

    res.json({
      message: `Fichier .dat enregistré avec succès`,
      fileName,
      filePath,
      size: datContent.length,
      lines: datContent.split("\n").filter((l) => l.trim()).length,
    });
  } catch (error) {
    console.error("Erreur écriture fichier .dat:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de l'écriture du fichier .dat : ${error.message}`,
    );
  }
});



// =============================================
// AJOUTER À L'EXPORT en bas du fichier :
// =============================================
// export { ..., saveProformaDat };

export {
  getProformas,

  saveProformaDat,
  getProformaByNumfact,
  searchProformas,
  getRepresentants,
  getProformasStructure,
  getProformasByTiers,
  invalidateCache,
  getCacheStats,
};