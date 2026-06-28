// // backend/controllers/clientController.js
// import asyncHandler from "../middleware/asyncHandler.js";
// import clientCacheService from "../services/clientCacheService.js";
// import Entreprise from "../models/EntrepriseModel.js";
// import path from "path";
// import fs from "fs";

// const checkClientFile = (entreprise) => {
//   const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
//   const clientPath = path.join(basePath, "clients.dbf");
//   if (!fs.existsSync(clientPath)) {
//     return { exists: false, error: `Fichier clients.dbf non trouvé pour ${entreprise.nomComplet}` };
//   }
//   return { exists: true };
// };

// const formatEntreprise = (entreprise) => ({
//   _id: entreprise._id,
//   nomDossierDBF: entreprise.nomDossierDBF,
//   trigramme: entreprise.trigramme,
//   nomComplet: entreprise.nomComplet,
// });

// // ===========================================
// // CONTROLLERS
// // ===========================================

// /**
//  * @desc    Liste des clients avec pagination et TOUS les filtres
//  * @route   GET /api/clients/:nomDossierDBF
//  * @query   page, limit, search, repres, catcli, type, categorie,
//  *          groupe, banque, codtarif, cltva, ecotaxe, sav, fdm, compte
//  */
// const getClients = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   const startTime = Date.now();

//   const check = checkClientFile(entreprise);
//   if (!check.exists) { res.status(404); throw new Error(check.error); }

//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 50;

//     const result = await clientCacheService.getPaginated(entreprise, {
//       page,
//       limit,
//       search: req.query.search || undefined,
//       repres: req.query.repres || undefined,
//       catcli: req.query.catcli || undefined,
//       type: req.query.type || undefined,
//       categorie: req.query.categorie || undefined,
//       groupe: req.query.groupe || undefined,
//       banque: req.query.banque || undefined,
//       codtarif: req.query.codtarif || undefined,
//       cltva: req.query.cltva || undefined,
//       ecotaxe: req.query.ecotaxe || undefined,
//       sav: req.query.sav || undefined,
//       fdm: req.query.fdm || undefined,
//       compte: req.query.compte || undefined,
//     });

//     res.json({
//       entreprise: formatEntreprise(entreprise),
//       pagination: {
//         page: result.page, limit: result.limit,
//         totalRecords: result.totalRecords, totalPages: result.totalPages,
//         hasNextPage: result.hasNextPage, hasPrevPage: result.hasPrevPage,
//       },
//       _queryTime: `${Date.now() - startTime}ms`,
//       clients: result.clients,
//     });
//   } catch (error) {
//     console.error("Erreur lecture clients:", error);
//     res.status(500);
//     throw new Error(`Erreur lors de la lecture des clients: ${error.message}`);
//   }
// });

// /**
//  * @desc    Détail d'un client par TIERS
//  * @route   GET /api/clients/:nomDossierDBF/:tiers
//  */
// const getClientByTiers = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   const { tiers } = req.params;
//   const startTime = Date.now();

//   const check = checkClientFile(entreprise);
//   if (!check.exists) { res.status(404); throw new Error(check.error); }

//   try {
//     const client = await clientCacheService.findByTiers(entreprise, tiers);
//     if (!client) { res.status(404); throw new Error(`Client tiers ${tiers} non trouvé`); }

//     res.json({
//       entreprise: formatEntreprise(entreprise),
//       _queryTime: `${Date.now() - startTime}ms`,
//       client,
//     });
//   } catch (error) {
//     if (error.message.includes("non trouvé")) throw error;
//     console.error("Erreur lecture client:", error);
//     res.status(500);
//     throw new Error(`Erreur lors de la lecture du client: ${error.message}`);
//   }
// });

// /**
//  * @desc    Recherche cross-entreprise
//  * @route   GET /api/clients/:nomDossierDBF/:tiers/cross-entreprise
//  */
// const getCrossEntreprise = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   const { tiers } = req.params;
//   const startTime = Date.now();

//   const check = checkClientFile(entreprise);
//   if (!check.exists) { res.status(404); throw new Error(check.error); }

//   try {
//     const client = await clientCacheService.findByTiers(entreprise, tiers);
//     if (!client) { res.status(404); throw new Error(`Client tiers ${tiers} non trouvé`); }

//     const allEntreprises = await Entreprise.find({}).lean();
//     const otherEntreprises = allEntreprises.filter((e) => e.nomDossierDBF !== entreprise.nomDossierDBF);
//     await clientCacheService.preloadAll(otherEntreprises);

//     const crossResult = await clientCacheService.findCrossEntreprise(client, entreprise.nomDossierDBF);
//     const enrichedResults = crossResult.results.map((result) => {
//       const ent = allEntreprises.find((e) => e.nomDossierDBF === result.nomDossierDBF);
//       return {
//         entreprise: ent ? formatEntreprise(ent) : { nomDossierDBF: result.nomDossierDBF },
//         matchType: result.matchType,
//         clients: result.clients,
//       };
//     });

//     res.json({
//       entreprise: formatEntreprise(entreprise),
//       client,
//       ridet: client._ridet || "",
//       ridetRaw: clientCacheService.safeTrim(client.AD5),
//       matchType: crossResult.matchType,
//       matchValue: crossResult.matchValue,
//       crossEntreprise: enrichedResults,
//       totalAutresEntreprises: enrichedResults.length,
//       _queryTime: `${Date.now() - startTime}ms`,
//     });
//   } catch (error) {
//     if (error.message.includes("non trouvé")) throw error;
//     console.error("Erreur cross-entreprise:", error);
//     res.status(500);
//     throw new Error(`Erreur lors de la recherche cross-entreprise: ${error.message}`);
//   }
// });

// /**
//  * @desc    Recherche avancée
//  * @route   GET /api/clients/:nomDossierDBF/search
//  */
// const searchClients = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   const { q, limit = 50 } = req.query;
//   const startTime = Date.now();

//   if (!q) { res.status(400); throw new Error("Le paramètre de recherche 'q' est requis"); }

//   const check = checkClientFile(entreprise);
//   if (!check.exists) { res.status(404); throw new Error(check.error); }

//   try {
//     const result = await clientCacheService.search(entreprise, q, { limit: parseInt(limit) });
//     res.json({
//       entreprise: formatEntreprise(entreprise),
//       search: { query: q, totalFound: result.totalFound, returned: result.clients.length },
//       _queryTime: `${Date.now() - startTime}ms`,
//       clients: result.clients,
//     });
//   } catch (error) {
//     console.error("Erreur recherche clients:", error);
//     res.status(500);
//     throw new Error(`Erreur lors de la recherche: ${error.message}`);
//   }
// });

// /**
//  * @desc    Toutes les valeurs de filtres en UN SEUL appel
//  * @route   GET /api/clients/:nomDossierDBF/filter-values
//  */
// const getFilterValues = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   const startTime = Date.now();

//   console.log(`[FilterValues] Appel pour ${entreprise.nomDossierDBF}`);

//   const check = checkClientFile(entreprise);
//   if (!check.exists) { res.status(404); throw new Error(check.error); }

//   try {
//     const values = await clientCacheService.getAllFilterValues(entreprise);

//     console.log(`[FilterValues] Résultat pour ${entreprise.nomDossierDBF}:`,
//       `representants=${values.representants.length}`,
//       `catclis=${values.catclis.length}`,
//       `types=${values.types.length}`,
//       `categories=${values.categories.length}`,
//       `groupes=${values.groupes.length}`,
//       `banques=${values.banques.length}`,
//       `comptes=${values.comptes.length}`,
//     );

//     res.json({
//       entreprise: formatEntreprise(entreprise),
//       _queryTime: `${Date.now() - startTime}ms`,
//       ...values,
//     });
//   } catch (error) {
//     console.error("Erreur getFilterValues:", error);
//     res.status(500);
//     throw new Error(`Erreur lors de la récupération des filtres: ${error.message}`);
//   }
// });

// /**
//  * @desc    Représentants distincts
//  * @route   GET /api/clients/:nomDossierDBF/representants
//  */
// const getRepresentants = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   const check = checkClientFile(entreprise);
//   if (!check.exists) { res.status(404); throw new Error(check.error); }
//   try {
//     const representants = await clientCacheService.getRepresentants(entreprise);
//     res.json({ entreprise: formatEntreprise(entreprise), totalRepresentants: representants.length, representants });
//   } catch (error) { res.status(500); throw new Error(`Erreur: ${error.message}`); }
// });

// /**
//  * @desc    Catégories clients (CATCLI)
//  * @route   GET /api/clients/:nomDossierDBF/categories
//  */
// const getCategories = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   const check = checkClientFile(entreprise);
//   if (!check.exists) { res.status(404); throw new Error(check.error); }
//   try {
//     const categories = await clientCacheService.getCategories(entreprise);
//     res.json({ entreprise: formatEntreprise(entreprise), totalCategories: categories.length, categories });
//   } catch (error) { res.status(500); throw new Error(`Erreur: ${error.message}`); }
// });

// /**
//  * @desc    Structure DBF
//  * @route   GET /api/clients/:nomDossierDBF/structure
//  */
// const getClientsStructure = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   const check = checkClientFile(entreprise);
//   if (!check.exists) { res.status(404); throw new Error(check.error); }
//   try {
//     const structure = await clientCacheService.getStructure(entreprise);
//     res.json({ entreprise: formatEntreprise(entreprise), structure });
//   } catch (error) { res.status(500); throw new Error(`Erreur: ${error.message}`); }
// });

// /**
//  * @desc    Invalider le cache
//  * @route   POST /api/clients/:nomDossierDBF/invalidate-cache
//  */
// const invalidateCache = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   clientCacheService.invalidate(entreprise.nomDossierDBF);
//   res.json({ message: `Cache clients invalidé pour ${entreprise.nomComplet}`, nomDossierDBF: entreprise.nomDossierDBF });
// });

// /**
//  * @desc    Stats du cache
//  * @route   GET /api/clients/cache-stats
//  */
// const getCacheStats = asyncHandler(async (req, res) => {
//   const stats = clientCacheService.getStats();
//   res.json({ cacheEntries: Object.keys(stats).length, stats });
// });

// export {
//   getClients,
//   getClientByTiers,
//   getCrossEntreprise,
//   searchClients,
//   getFilterValues,
//   getRepresentants,
//   getCategories,
//   getClientsStructure,
//   invalidateCache,
//   getCacheStats,
// };


// backend/controllers/clientController.js
import asyncHandler from "../middleware/asyncHandler.js";
import clientCacheService from "../services/clientCacheService.js";
import Entreprise from "../models/EntrepriseModel.js";
import path from "path";
import fs from "fs";

const checkClientFile = (entreprise) => {
  const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
  const clientPath = path.join(basePath, "clients.dbf");
  if (!fs.existsSync(clientPath)) {
    return { exists: false, error: `Fichier clients.dbf non trouvé pour ${entreprise.nomComplet}` };
  }
  return { exists: true };
};

const formatEntreprise = (entreprise) => ({
  _id: entreprise._id,
  nomDossierDBF: entreprise.nomDossierDBF,
  trigramme: entreprise.trigramme,
  nomComplet: entreprise.nomComplet,
});

// ===========================================
// CONTROLLERS
// ===========================================

/**
 * @desc    Liste des clients avec pagination et TOUS les filtres
 * @route   GET /api/clients/:nomDossierDBF
 * @query   page, limit, search, repres, catcli, type, categorie,
 *          groupe, banque, codtarif, cltva, ecotaxe, sav, fdm, compte
 */
const getClients = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const check = checkClientFile(entreprise);
  if (!check.exists) { res.status(404); throw new Error(check.error); }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const result = await clientCacheService.getPaginated(entreprise, {
      page,
      limit,
      search: req.query.search || undefined,
      repres: req.query.repres || undefined,
      catcli: req.query.catcli || undefined,
      type: req.query.type || undefined,
      categorie: req.query.categorie || undefined,
      groupe: req.query.groupe || undefined,
      banque: req.query.banque || undefined,
      codtarif: req.query.codtarif || undefined,
      cltva: req.query.cltva || undefined,
      ecotaxe: req.query.ecotaxe || undefined,
      sav: req.query.sav || undefined,
      fdm: req.query.fdm || undefined,
      compte: req.query.compte || undefined,
    });

    res.json({
      entreprise: formatEntreprise(entreprise),
      pagination: {
        page: result.page, limit: result.limit,
        totalRecords: result.totalRecords, totalPages: result.totalPages,
        hasNextPage: result.hasNextPage, hasPrevPage: result.hasPrevPage,
      },
      _queryTime: `${Date.now() - startTime}ms`,
      clients: result.clients,
    });
  } catch (error) {
    console.error("Erreur lecture clients:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture des clients: ${error.message}`);
  }
});

/**
 * @desc    Détail d'un client par TIERS
 * @route   GET /api/clients/:nomDossierDBF/:tiers
 */
const getClientByTiers = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { tiers } = req.params;
  const startTime = Date.now();

  const check = checkClientFile(entreprise);
  if (!check.exists) { res.status(404); throw new Error(check.error); }

  try {
    const client = await clientCacheService.findByTiers(entreprise, tiers);
    if (!client) { res.status(404); throw new Error(`Client tiers ${tiers} non trouvé`); }

    res.json({
      entreprise: formatEntreprise(entreprise),
      _queryTime: `${Date.now() - startTime}ms`,
      client,
    });
  } catch (error) {
    if (error.message.includes("non trouvé")) throw error;
    console.error("Erreur lecture client:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture du client: ${error.message}`);
  }
});

/**
 * @desc    Recherche cross-entreprise
 * @route   GET /api/clients/:nomDossierDBF/:tiers/cross-entreprise
 */
const getCrossEntreprise = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { tiers } = req.params;
  const startTime = Date.now();

  const check = checkClientFile(entreprise);
  if (!check.exists) { res.status(404); throw new Error(check.error); }

  try {
    const client = await clientCacheService.findByTiers(entreprise, tiers);
    if (!client) { res.status(404); throw new Error(`Client tiers ${tiers} non trouvé`); }

    // .lean() => getters Mongoose non appliqués : on réapplique l'override env
    // (bascule dev/prod) sur les chemins, comme le fait le modèle Entreprise.
    const allEntreprises = (await Entreprise.find({}).lean()).map((e) => ({
      ...e,
      cheminBase: process.env.DBF_BASE_PATH || e.cheminBase,
      cheminExportInventaire:
        process.env.RCOMMON_COLLECT_PATH || e.cheminExportInventaire,
    }));
    const otherEntreprises = allEntreprises.filter((e) => e.nomDossierDBF !== entreprise.nomDossierDBF);
    await clientCacheService.preloadAll(otherEntreprises);

    const crossResult = await clientCacheService.findCrossEntreprise(client, entreprise.nomDossierDBF);
    const enrichedResults = crossResult.results.map((result) => {
      const ent = allEntreprises.find((e) => e.nomDossierDBF === result.nomDossierDBF);
      return {
        entreprise: ent ? formatEntreprise(ent) : { nomDossierDBF: result.nomDossierDBF },
        matchType: result.matchType,
        clients: result.clients,
      };
    });

    res.json({
      entreprise: formatEntreprise(entreprise),
      client,
      ridet: client._ridet || "",
      ridetRaw: clientCacheService.safeTrim(client.AD5),
      matchType: crossResult.matchType,
      matchValue: crossResult.matchValue,
      crossEntreprise: enrichedResults,
      totalAutresEntreprises: enrichedResults.length,
      _queryTime: `${Date.now() - startTime}ms`,
    });
  } catch (error) {
    if (error.message.includes("non trouvé")) throw error;
    console.error("Erreur cross-entreprise:", error);
    res.status(500);
    throw new Error(`Erreur lors de la recherche cross-entreprise: ${error.message}`);
  }
});

/**
 * @desc    Recherche avancée
 * @route   GET /api/clients/:nomDossierDBF/search
 */
const searchClients = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { q, limit = 50 } = req.query;
  const startTime = Date.now();

  if (!q) { res.status(400); throw new Error("Le paramètre de recherche 'q' est requis"); }

  const check = checkClientFile(entreprise);
  if (!check.exists) { res.status(404); throw new Error(check.error); }

  try {
    const result = await clientCacheService.search(entreprise, q, { limit: parseInt(limit) });
    res.json({
      entreprise: formatEntreprise(entreprise),
      search: { query: q, totalFound: result.totalFound, returned: result.clients.length },
      _queryTime: `${Date.now() - startTime}ms`,
      clients: result.clients,
    });
  } catch (error) {
    console.error("Erreur recherche clients:", error);
    res.status(500);
    throw new Error(`Erreur lors de la recherche: ${error.message}`);
  }
});

/**
 * @desc    Toutes les valeurs de filtres en UN SEUL appel
 * @route   GET /api/clients/:nomDossierDBF/filter-values
 */
const getFilterValues = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  console.log(`[FilterValues] Appel pour ${entreprise.nomDossierDBF}`);

  const check = checkClientFile(entreprise);
  if (!check.exists) { res.status(404); throw new Error(check.error); }

  try {
    const values = await clientCacheService.getAllFilterValues(entreprise);

    console.log(`[FilterValues] Résultat pour ${entreprise.nomDossierDBF}:`,
      `representants=${values.representants.length}`,
      `catclis=${values.catclis.length}`,
      `types=${values.types.length}`,
      `categories=${values.categories.length}`,
      `groupes=${values.groupes.length}`,
      `banques=${values.banques.length}`,
      `comptes=${values.comptes.length}`,
    );

    res.json({
      entreprise: formatEntreprise(entreprise),
      _queryTime: `${Date.now() - startTime}ms`,
      ...values,
    });
  } catch (error) {
    console.error("Erreur getFilterValues:", error);
    res.status(500);
    throw new Error(`Erreur lors de la récupération des filtres: ${error.message}`);
  }
});

/**
 * @desc    Représentants distincts
 * @route   GET /api/clients/:nomDossierDBF/representants
 */
const getRepresentants = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const check = checkClientFile(entreprise);
  if (!check.exists) { res.status(404); throw new Error(check.error); }
  try {
    const representants = await clientCacheService.getRepresentants(entreprise);
    res.json({ entreprise: formatEntreprise(entreprise), totalRepresentants: representants.length, representants });
  } catch (error) { res.status(500); throw new Error(`Erreur: ${error.message}`); }
});

/**
 * @desc    Catégories clients (CATCLI)
 * @route   GET /api/clients/:nomDossierDBF/categories
 */
const getCategories = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const check = checkClientFile(entreprise);
  if (!check.exists) { res.status(404); throw new Error(check.error); }
  try {
    const categories = await clientCacheService.getCategories(entreprise);
    res.json({ entreprise: formatEntreprise(entreprise), totalCategories: categories.length, categories });
  } catch (error) { res.status(500); throw new Error(`Erreur: ${error.message}`); }
});

/**
 * @desc    Structure DBF
 * @route   GET /api/clients/:nomDossierDBF/structure
 */
const getClientsStructure = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const check = checkClientFile(entreprise);
  if (!check.exists) { res.status(404); throw new Error(check.error); }
  try {
    const structure = await clientCacheService.getStructure(entreprise);
    res.json({ entreprise: formatEntreprise(entreprise), structure });
  } catch (error) { res.status(500); throw new Error(`Erreur: ${error.message}`); }
});

/**
 * @desc    Invalider le cache
 * @route   POST /api/clients/:nomDossierDBF/invalidate-cache
 */
const invalidateCache = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  clientCacheService.invalidate(entreprise.nomDossierDBF);
  res.json({ message: `Cache clients invalidé pour ${entreprise.nomComplet}`, nomDossierDBF: entreprise.nomDossierDBF });
});

/**
 * @desc    Stats du cache
 * @route   GET /api/clients/cache-stats
 */
const getCacheStats = asyncHandler(async (req, res) => {
  const stats = clientCacheService.getStats();
  res.json({ cacheEntries: Object.keys(stats).length, stats });
});

export {
  getClients,
  getClientByTiers,
  getCrossEntreprise,
  searchClients,
  getFilterValues,
  getRepresentants,
  getCategories,
  getClientsStructure,
  invalidateCache,
  getCacheStats,
};