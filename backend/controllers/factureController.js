// backend/controllers/factureController.js
import asyncHandler from "../middleware/asyncHandler.js";
import factureCacheService from "../services/factureCacheService.js";
import path from "path";
import fs from "fs";

/**
 * Structure facture.dbf (entête) :
 * NUMFACT(C:7), TYPFACT(C:1), DATFACT(D:8), DATTRAV(D:8), TIERS(N:4.0),
 * GENER(C:1), DBCPT(C:1), BONCDE(C:30), REPRES(N:3.0), TEXTE(C:60),
 * CHEQUE(C:16), MONTANT(N:10.0), FACTREM(N:8.0), FACTNBLG(N:4.0),
 * FACTREV(N:10.0), SUPPR(C:1), MONTAXES(N:8.0), ACOMPTE(C:7),
 * STDEST(N:1.0), STORI(N:1.0), ETAT(N:1.0), HEURE(C:5), AP(C:1),
 * EXTIERS(N:4.0), NOM(C:30), MECANO(N:2.0)
 *
 * Structure detail.dbf (détail) :
 * NUMFACT(C:7), NART(C:6), DESIGN(C:50), QTE(N:10.3), PVTE(N:11.2),
 * PREV(N:11.2), POURC(N:3.0), TYPFACT(C:1), NONIMP(C:1), DTVA(N:5.2),
 * POINTE(C:1), CLIENT(C:4), PROMO(C:1), STKREST(N:10.2), NL(N:8.3),
 * COMPOSE(C:2), PVTTC(N:8.0), NUMSERIE(C:40), GARANTIE(C:10)
 *
 * TYPFACT : F=Facture, A=Avoir, R=RESA, T=Transfert
 */

// ===========================================
// HELPERS
// ===========================================

const TYPFACT_LABELS = {
  F: "Facture",
  A: "Avoir",
  R: "RESA",
  T: "Transfert",
};

const checkFactureFiles = (entreprise) => {
  const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
  const facturePath = path.join(basePath, "facture.dbf");
  const detailPath = path.join(basePath, "detail.dbf");

  if (!fs.existsSync(facturePath)) {
    return { exists: false, error: `Fichier facture.dbf non trouvé pour l'entreprise ${entreprise.nomComplet}` };
  }
  if (!fs.existsSync(detailPath)) {
    return { exists: false, error: `Fichier detail.dbf non trouvé pour l'entreprise ${entreprise.nomComplet}` };
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
 * @desc    Liste des factures avec pagination et filtres
 * @route   GET /api/factures/:nomDossierDBF
 * @access  Private (module facture, read)
 *
 * Query params : page, limit, search, tiers, repres, etat, typfact, dateDebut, dateFin
 */
const getFactures = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const filesCheck = checkFactureFiles(entreprise);
  if (!filesCheck.exists) { res.status(404); throw new Error(filesCheck.error); }

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
      typfact: req.query.typfact || undefined,
      dateDebut: req.query.dateDebut || undefined,
      dateFin: req.query.dateFin || undefined,
    };

    const result = await factureCacheService.getPaginated(entreprise, filterOptions);
    const queryTime = Date.now() - startTime;

    const activeFilters = Object.entries(filterOptions).filter(
      ([key, val]) => key !== "page" && key !== "limit" && val !== undefined && val !== false && val !== "",
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
      filters: { active: activeFilters },
      typfactLabels: TYPFACT_LABELS,
      _queryTime: `${queryTime}ms`,
      factures: result.factures,
    });
  } catch (error) {
    console.error("Erreur lecture factures:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture des factures: ${error.message}`);
  }
});

/**
 * @desc    Détail d'une facture par NUMFACT
 * @route   GET /api/factures/:nomDossierDBF/:numfact
 * @access  Private (module facture, read)
 */
const getFactureByNumfact = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { numfact } = req.params;
  const startTime = Date.now();

  const filesCheck = checkFactureFiles(entreprise);
  if (!filesCheck.exists) { res.status(404); throw new Error(filesCheck.error); }

  try {
    const facture = await factureCacheService.findByNumfact(entreprise, numfact);
    if (!facture) { res.status(404); throw new Error(`Facture ${numfact} non trouvée`); }

    const lignes = await factureCacheService.getDetailByNumfact(entreprise, numfact);
    const lignesArticle = lignes.filter((l) => !l._isComment);
    const lignesCommentaire = lignes.filter((l) => l._isComment);

    const queryTime = Date.now() - startTime;
    const typfact = (facture.TYPFACT || "").toString().trim().toUpperCase();

    res.json({
      entreprise: formatEntreprise(entreprise),
      _queryTime: `${queryTime}ms`,
      facture,
      typfactLabel: TYPFACT_LABELS[typfact] || `Type ${typfact}`,
      detail: {
        totalLignes: lignes.length,
        lignesArticle: lignesArticle.length,
        lignesCommentaire: lignesCommentaire.length,
        lignes,
      },
    });
  } catch (error) {
    if (error.message.includes("non trouvée")) throw error;
    console.error("Erreur lecture facture:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture de la facture: ${error.message}`);
  }
});

/**
 * @desc    Recherche avancée de factures
 * @route   GET /api/factures/:nomDossierDBF/search
 */
const searchFactures = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { q, limit = 50 } = req.query;
  const startTime = Date.now();

  if (!q) { res.status(400); throw new Error("Le paramètre de recherche 'q' est requis"); }

  const filesCheck = checkFactureFiles(entreprise);
  if (!filesCheck.exists) { res.status(404); throw new Error(filesCheck.error); }

  try {
    const result = await factureCacheService.search(entreprise, q, { limit: parseInt(limit) });
    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: formatEntreprise(entreprise),
      search: { query: q, totalFound: result.totalFound, returned: result.factures.length },
      _queryTime: `${queryTime}ms`,
      factures: result.factures,
    });
  } catch (error) {
    console.error("Erreur recherche factures:", error);
    res.status(500);
    throw new Error(`Erreur lors de la recherche: ${error.message}`);
  }
});

/**
 * @desc    Représentants distincts
 * @route   GET /api/factures/:nomDossierDBF/representants
 */
const getRepresentants = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const filesCheck = checkFactureFiles(entreprise);
  if (!filesCheck.exists) { res.status(404); throw new Error(filesCheck.error); }

  try {
    const representants = await factureCacheService.getRepresentants(entreprise);
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
    throw new Error(`Erreur lors de la lecture des représentants: ${error.message}`);
  }
});

/**
 * @desc    Structure des fichiers DBF
 * @route   GET /api/factures/:nomDossierDBF/structure
 */
const getFacturesStructure = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const filesCheck = checkFactureFiles(entreprise);
  if (!filesCheck.exists) { res.status(404); throw new Error(filesCheck.error); }

  try {
    const structure = await factureCacheService.getStructure(entreprise);
    res.json({ entreprise: formatEntreprise(entreprise), structure });
  } catch (error) {
    console.error("Erreur lecture structure:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture de la structure: ${error.message}`);
  }
});

/**
 * @desc    Factures par tiers
 * @route   GET /api/factures/:nomDossierDBF/tiers/:tiers
 */
const getFacturesByTiers = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { tiers } = req.params;
  const startTime = Date.now();

  const filesCheck = checkFactureFiles(entreprise);
  if (!filesCheck.exists) { res.status(404); throw new Error(filesCheck.error); }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const result = await factureCacheService.getPaginated(entreprise, { page, limit, tiers });
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
      factures: result.factures,
    });
  } catch (error) {
    console.error("Erreur lecture factures par tiers:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture des factures du tiers: ${error.message}`);
  }
});

/**
 * @desc    Enregistrer un fichier .dat sur le serveur
 * @route   POST /api/factures/:nomDossierDBF/:numfact/save-dat
 */
const saveFactureDat = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { datContent, fileName: customFileName } = req.body;

  if (!datContent || typeof datContent !== "string") {
    res.status(400);
    throw new Error("Le contenu du fichier .dat est requis");
  }

  const exportPath = entreprise.cheminExportInventaire;
  if (!exportPath) {
    res.status(400);
    throw new Error(`Aucun chemin d'export inventaire configuré pour ${entreprise.nomComplet}`);
  }

  if (!fs.existsSync(exportPath)) {
    res.status(404);
    throw new Error(`Le dossier d'export n'existe pas ou n'est pas accessible : ${exportPath}`);
  }

  let fileName;
  if (customFileName && customFileName.trim()) {
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
    throw new Error(`Erreur lors de l'écriture du fichier .dat : ${error.message}`);
  }
});

/**
 * @desc    Invalider le cache
 * @route   POST /api/factures/:nomDossierDBF/invalidate-cache
 */
const invalidateCache = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  factureCacheService.invalidate(entreprise.nomDossierDBF);
  res.json({
    message: `Cache factures invalidé pour ${entreprise.nomComplet}`,
    nomDossierDBF: entreprise.nomDossierDBF,
  });
});

/**
 * @desc    Stats du cache
 * @route   GET /api/factures/cache-stats
 */
const getCacheStats = asyncHandler(async (req, res) => {
  const stats = factureCacheService.getStats();
  res.json({ cacheEntries: Object.keys(stats).length, stats });
});

export {
  getFactures,
  getFactureByNumfact,
  searchFactures,
  getRepresentants,
  getFacturesStructure,
  getFacturesByTiers,
  saveFactureDat,
  invalidateCache,
  getCacheStats,
};