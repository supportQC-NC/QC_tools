// backend/controllers/commandeController.js
import asyncHandler from "../middleware/asyncHandler.js";
import commandeCacheService from "../services/commandeService.js";
import path from "path";
import fs from "fs";

/**
 * Structure du fichier cmdref.dbf (entête commande) :
 * FOURN(N:3.0) - Code fournisseur
 * NUMCDE(C:6) - Numéro de commande (clé de liaison)
 * DATCDE(D:8) - Date de commande
 * BATEAU(C:16) - Nom du bateau
 * ARRIVEE(D:8) - Date d'arrivée
 * OBSERV(C:63) - Observation
 * NUMFACT(C:7) - Numéro de facture
 * DATFACT(D:8) - Date de facture
 * VERROU(C:1) - Verrouillé (O/N)
 * NOT1-NOT10(C:72) - Notes
 * ENT1-ENT3(C:72) - Entêtes
 * TAXES(N:10.2) - Taxes
 * TOTPR(N:10.0) - Total produits
 * DVISE(N:10.5) - Devise
 * FRET(N:8.0) - Frêt
 * FRTRANSIT(N:8.0) - Frêt transit
 * GROUPAGE(C:1) - Groupage (O/N)
 * ETAT(N:1.0) - État de la commande
 * COMPTLIG(N:5.0) - Nombre de lignes
 * CDVISE(C:5) - Code devise
 *
 * Structure du fichier cmdetail.dbf (détail commande) :
 * NUMCDE(C:6) - Numéro de commande (clé de liaison)
 * NART(C:6) - Code article
 * QTE(N:8.2) - Quantité
 * MONTANT(N:13.4) - Montant
 * MOYMOIS(N:13.4) - Moyenne mensuelle
 * RENTRE(N:8.2) - Quantité rentrée
 * FRET(N:11.3) - Frêt
 * FRTRANSIT(N:11.3) - Frêt transit
 * TAXES(N:11.3) - Taxes
 * PACHAT(N:11.3) - Prix d'achat
 * PCAF(N:11.3) - Prix CAF
 * PABRUT(N:11.3) - Prix d'achat brut
 * POINTE(C:1) - Pointé (O/N)
 * DESIGN(C:50) - Désignation
 * REFER(C:13) - Référence fournisseur
 * IDLIGN(C:15) - Identifiant ligne
 * NL(N:8.3) - Numéro de ligne
 */

// =============================================
// ENDPOINTS POUR LES COMMANDES (ENTÊTES)
// =============================================

/**
 * @desc    Obtenir toutes les commandes d'une entreprise avec filtres avancés
 * @route   GET /api/commandes/:nomDossierDBF
 * @access  Private (avec vérification d'accès à l'entreprise)
 *
 * Query params supportés:
 * - page, limit: pagination
 * - search: recherche textuelle (NUMCDE, OBSERV, BATEAU, NUMFACT)
 * - numcde: filtre par numéro de commande (partiel)
 * - fourn: filtre par code fournisseur
 * - etat: filtre par état (0, 1, 2...)
 * - verrou: "true" pour commandes verrouillées
 * - hasFacture: "true" pour commandes facturées
 * - groupage: "true" pour commandes en groupage
 * - dateDebut: date de commande minimum (YYYY-MM-DD)
 * - dateFin: date de commande maximum (YYYY-MM-DD)
 * - bateau: filtre par nom de bateau
 * - cdvise: filtre par code devise
 */
const getCommandes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const cmdrefPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdref.dbf",
  );

  if (!fs.existsSync(cmdrefPath)) {
    res.status(404);
    throw new Error(
      `Fichier commandes non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const filterOptions = {
      page,
      limit,
      // Filtres textuels
      search: req.query.search || undefined,
      numcde: req.query.numcde || undefined,
      fourn: req.query.fourn || undefined,
      bateau: req.query.bateau || undefined,
      cdvise: req.query.cdvise || undefined,
      // Filtres booléens
      verrou: req.query.verrou === "true",
      hasFacture: req.query.hasFacture === "true",
      groupage: req.query.groupage === "true",
      // Filtres numériques
      etat: req.query.etat !== undefined ? parseInt(req.query.etat) : undefined,
      // Filtres de dates
      dateDebut: req.query.dateDebut || undefined,
      dateFin: req.query.dateFin || undefined,
    };

    const result = await commandeCacheService.getPaginated(
      entreprise,
      filterOptions,
    );

    const queryTime = Date.now() - startTime;

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
      commandes: result.commandes,
    });
  } catch (error) {
    console.error("Erreur lecture commandes:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture des commandes: ${error.message}`,
    );
  }
});

/**
 * @desc    Obtenir une commande par son NUMCDE (entête + détails liés)
 * @route   GET /api/commandes/:nomDossierDBF/code/:numcde
 * @access  Private
 */
const getCommandeByNumcde = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { numcde } = req.params;
  const startTime = Date.now();

  const cmdrefPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdref.dbf",
  );
  const cmdetailPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdetail.dbf",
  );

  if (!fs.existsSync(cmdrefPath)) {
    res.status(404);
    throw new Error(
      `Fichier commandes non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  if (!fs.existsSync(cmdetailPath)) {
    res.status(404);
    throw new Error(
      `Fichier détails commandes non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    // Recherche O(1) via l'index pour l'entête
    const commande = await commandeCacheService.findByNumcde(
      entreprise,
      numcde,
    );

    if (!commande) {
      res.status(404);
      throw new Error(`Commande avec le numéro ${numcde} non trouvée`);
    }

    // Recherche des lignes de détail liées par NUMCDE
    const details = await commandeCacheService.getDetailsByNumcde(
      entreprise,
      numcde,
    );

    const queryTime = Date.now() - startTime;

    // Calculs récapitulatifs sur les détails
    const totaux = details.reduce(
      (acc, ligne) => {
        acc.totalMontant += ligne.MONTANT || 0;
        acc.totalQte += ligne.QTE || 0;
        acc.totalRentre += ligne.RENTRE || 0;
        acc.totalFret += ligne.FRET || 0;
        acc.totalTaxes += ligne.TAXES || 0;
        return acc;
      },
      {
        totalMontant: 0,
        totalQte: 0,
        totalRentre: 0,
        totalFret: 0,
        totalTaxes: 0,
      },
    );

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      _queryTime: `${queryTime}ms`,
      commande,
      details: {
        totalLignes: details.length,
        totaux: {
          totalMontant: Math.round(totaux.totalMontant * 100) / 100,
          totalQte: Math.round(totaux.totalQte * 100) / 100,
          totalRentre: Math.round(totaux.totalRentre * 100) / 100,
          totalFret: Math.round(totaux.totalFret * 1000) / 1000,
          totalTaxes: Math.round(totaux.totalTaxes * 1000) / 1000,
        },
        lignes: details,
      },
    });
  } catch (error) {
    if (error.message.includes("non trouvée")) {
      throw error;
    }
    console.error("Erreur lecture commande:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture de la commande: ${error.message}`,
    );
  }
});

/**
 * @desc    Obtenir les commandes d'un fournisseur
 * @route   GET /api/commandes/:nomDossierDBF/fournisseur/:fourn
 * @access  Private
 */
const getCommandesByFournisseur = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { fourn } = req.params;
  const startTime = Date.now();

  const cmdrefPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdref.dbf",
  );

  if (!fs.existsSync(cmdrefPath)) {
    res.status(404);
    throw new Error(
      `Fichier commandes non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const result = await commandeCacheService.findByFournisseur(
      entreprise,
      parseInt(fourn),
      { page, limit },
    );

    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      fournisseur: parseInt(fourn),
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPrevPage: result.hasPrevPage,
      },
      _queryTime: `${queryTime}ms`,
      commandes: result.commandes,
    });
  } catch (error) {
    console.error("Erreur lecture commandes fournisseur:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture des commandes fournisseur: ${error.message}`,
    );
  }
});

/**
 * @desc    Rechercher dans les détails de commande par NART
 * @route   GET /api/commandes/:nomDossierDBF/article/:nart
 * @access  Private
 */
const getCommandesByArticle = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { nart } = req.params;
  const startTime = Date.now();

  const cmdetailPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdetail.dbf",
  );

  if (!fs.existsSync(cmdetailPath)) {
    res.status(404);
    throw new Error(
      `Fichier détails commandes non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    const result = await commandeCacheService.findDetailsByNart(
      entreprise,
      nart,
      { page, limit },
    );

    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      article: nart.trim(),
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
        hasNextPage: result.hasNextPage,
        hasPrevPage: result.hasPrevPage,
      },
      _queryTime: `${queryTime}ms`,
      commandesAvecArticle: result.details,
    });
  } catch (error) {
    console.error("Erreur recherche article dans commandes:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la recherche de l'article dans les commandes: ${error.message}`,
    );
  }
});

/**
 * @desc    Recherche avancée dans les commandes
 * @route   GET /api/commandes/:nomDossierDBF/search
 * @access  Private
 */
const searchCommandes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { q, field, limit = 50 } = req.query;
  const startTime = Date.now();

  if (!q) {
    res.status(400);
    throw new Error("Le paramètre de recherche 'q' est requis");
  }

  const cmdrefPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdref.dbf",
  );

  if (!fs.existsSync(cmdrefPath)) {
    res.status(404);
    throw new Error(
      `Fichier commandes non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const allowedFields = [
      "NUMCDE",
      "OBSERV",
      "BATEAU",
      "NUMFACT",
      "NOT1",
      "NOT2",
      "NOT3",
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

    const result = await commandeCacheService.search(entreprise, q, {
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
        field: field || "NUMCDE, OBSERV, BATEAU, NUMFACT",
        totalFound: result.totalFound,
        returned: result.commandes.length,
      },
      _queryTime: `${queryTime}ms`,
      commandes: result.commandes,
    });
  } catch (error) {
    if (error.message.includes("non autorisé")) {
      throw error;
    }
    console.error("Erreur recherche commandes:", error);
    res.status(500);
    throw new Error(`Erreur lors de la recherche: ${error.message}`);
  }
});

// =============================================
// ENDPOINTS POUR LES DÉTAILS DE COMMANDE
// =============================================

/**
 * @desc    Obtenir les détails (lignes) d'une commande spécifique
 * @route   GET /api/commandes/:nomDossierDBF/details/:numcde
 * @access  Private
 */
const getCommandeDetails = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { numcde } = req.params;
  const startTime = Date.now();

  const cmdetailPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdetail.dbf",
  );

  if (!fs.existsSync(cmdetailPath)) {
    res.status(404);
    throw new Error(
      `Fichier détails commandes non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const details = await commandeCacheService.getDetailsByNumcde(
      entreprise,
      numcde,
    );

    if (!details || details.length === 0) {
      res.status(404);
      throw new Error(`Aucun détail trouvé pour la commande ${numcde}`);
    }

    const queryTime = Date.now() - startTime;

    const totaux = details.reduce(
      (acc, ligne) => {
        acc.totalMontant += ligne.MONTANT || 0;
        acc.totalQte += ligne.QTE || 0;
        acc.totalRentre += ligne.RENTRE || 0;
        acc.totalFret += ligne.FRET || 0;
        acc.totalFrtransit += ligne.FRTRANSIT || 0;
        acc.totalTaxes += ligne.TAXES || 0;
        return acc;
      },
      {
        totalMontant: 0,
        totalQte: 0,
        totalRentre: 0,
        totalFret: 0,
        totalFrtransit: 0,
        totalTaxes: 0,
      },
    );

    const lignesPointees = details.filter(
      (d) => d.POINTE && d.POINTE.trim() === "O",
    ).length;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      numcde: numcde.trim(),
      _queryTime: `${queryTime}ms`,
      resume: {
        totalLignes: details.length,
        lignesPointees,
        lignesNonPointees: details.length - lignesPointees,
        totaux: {
          totalMontant: Math.round(totaux.totalMontant * 100) / 100,
          totalQte: Math.round(totaux.totalQte * 100) / 100,
          totalRentre: Math.round(totaux.totalRentre * 100) / 100,
          totalFret: Math.round(totaux.totalFret * 1000) / 1000,
          totalFrtransit: Math.round(totaux.totalFrtransit * 1000) / 1000,
          totalTaxes: Math.round(totaux.totalTaxes * 1000) / 1000,
        },
      },
      lignes: details,
    });
  } catch (error) {
    if (error.message.includes("Aucun détail")) {
      throw error;
    }
    console.error("Erreur lecture détails commande:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture des détails: ${error.message}`,
    );
  }
});

// =============================================
// ENDPOINTS UTILITAIRES / STATISTIQUES
// =============================================

/**
 * @desc    Obtenir la structure des fichiers DBF commandes
 * @route   GET /api/commandes/:nomDossierDBF/structure
 * @access  Private
 */
const getCommandesStructure = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const cmdrefPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdref.dbf",
  );
  const cmdetailPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdetail.dbf",
  );

  try {
    const structures = {};

    if (fs.existsSync(cmdrefPath)) {
      structures.cmdref = await commandeCacheService.getStructure(
        entreprise,
        "cmdref",
      );
    }

    if (fs.existsSync(cmdetailPath)) {
      structures.cmdetail = await commandeCacheService.getStructure(
        entreprise,
        "cmdetail",
      );
    }

    if (Object.keys(structures).length === 0) {
      res.status(404);
      throw new Error(
        `Fichiers commandes non trouvés pour l'entreprise ${entreprise.nomComplet}`,
      );
    }

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      structures,
    });
  } catch (error) {
    console.error("Erreur lecture structure commandes:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture de la structure: ${error.message}`,
    );
  }
});

/**
 * @desc    Obtenir la liste des fournisseurs ayant des commandes
 * @route   GET /api/commandes/:nomDossierDBF/fournisseurs
 * @access  Private
 */
const getFournisseursCommandes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const cmdrefPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdref.dbf",
  );

  if (!fs.existsSync(cmdrefPath)) {
    res.status(404);
    throw new Error(
      `Fichier commandes non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const fournisseurs =
      await commandeCacheService.getFournisseurs(entreprise);
    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      totalFournisseurs: fournisseurs.length,
      _queryTime: `${queryTime}ms`,
      fournisseurs,
    });
  } catch (error) {
    console.error("Erreur lecture fournisseurs commandes:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture des fournisseurs: ${error.message}`,
    );
  }
});

/**
 * @desc    Obtenir la liste des bateaux distincts
 * @route   GET /api/commandes/:nomDossierDBF/bateaux
 * @access  Private
 */
const getBateaux = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const cmdrefPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdref.dbf",
  );

  if (!fs.existsSync(cmdrefPath)) {
    res.status(404);
    throw new Error(
      `Fichier commandes non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const bateaux = await commandeCacheService.getBateaux(entreprise);
    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      totalBateaux: bateaux.length,
      _queryTime: `${queryTime}ms`,
      bateaux,
    });
  } catch (error) {
    console.error("Erreur lecture bateaux:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture des bateaux: ${error.message}`,
    );
  }
});

/**
 * @desc    Obtenir les états distincts des commandes
 * @route   GET /api/commandes/:nomDossierDBF/etats
 * @access  Private
 */
const getEtatsCommandes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const cmdrefPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "cmdref.dbf",
  );

  if (!fs.existsSync(cmdrefPath)) {
    res.status(404);
    throw new Error(
      `Fichier commandes non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  try {
    const etats = await commandeCacheService.getEtats(entreprise);
    const queryTime = Date.now() - startTime;

    res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      totalEtats: etats.length,
      _queryTime: `${queryTime}ms`,
      etats,
    });
  } catch (error) {
    console.error("Erreur lecture états commandes:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture des états: ${error.message}`,
    );
  }
});

/**
 * @desc    Récupérer les commandes adjacentes (précédente et suivante) par NUMCDE
 * @route   GET /api/commandes/:nomDossierDBF/adjacent/:numcde
 * @access  Private
 */
const getAdjacentCommandes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { numcde } = req.params;
  const startTime = Date.now();

  const normalizedNumcde = numcde.trim();

  const allCommandes = await commandeCacheService.getPaginated(entreprise, {
    page: 1,
    limit: 999999,
  });

  const sortedCommandes = allCommandes.commandes
    .map((c) => ({
      NUMCDE: c.NUMCDE?.trim(),
      FOURN: c.FOURN,
      DATCDE: c.DATCDE,
      OBSERV: c.OBSERV?.trim(),
      ETAT: c.ETAT,
    }))
    .filter((c) => c.NUMCDE)
    .sort((a, b) => a.NUMCDE.localeCompare(b.NUMCDE));

  const currentIndex = sortedCommandes.findIndex(
    (c) => c.NUMCDE === normalizedNumcde,
  );

  const previousCommande =
    currentIndex > 0 ? sortedCommandes[currentIndex - 1] : null;
  const nextCommande =
    currentIndex >= 0 && currentIndex < sortedCommandes.length - 1
      ? sortedCommandes[currentIndex + 1]
      : null;

  const queryTime = Date.now() - startTime;

  res.json({
    current: normalizedNumcde,
    previous: previousCommande,
    next: nextCommande,
    _queryTime: `${queryTime}ms`,
  });
});

/**
 * @desc    Invalider le cache commandes d'une entreprise
 * @route   POST /api/commandes/:nomDossierDBF/invalidate-cache
 * @access  Private/Admin
 */
const invalidateCache = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  commandeCacheService.invalidate(entreprise.nomDossierDBF);

  res.json({
    message: `Cache commandes invalidé pour ${entreprise.nomComplet}`,
    nomDossierDBF: entreprise.nomDossierDBF,
  });
});

/**
 * @desc    Obtenir les statistiques du cache commandes
 * @route   GET /api/commandes/cache-stats
 * @access  Private/Admin
 */
const getCacheStats = asyncHandler(async (req, res) => {
  const stats = commandeCacheService.getStats();

  res.json({
    cacheEntries: Object.keys(stats).length,
    stats,
  });
});

export {
  getCommandes,
  getCommandeByNumcde,
  getCommandesByFournisseur,
  getCommandesByArticle,
  searchCommandes,
  getCommandeDetails,
  getCommandesStructure,
  getFournisseursCommandes,
  getBateaux,
  getEtatsCommandes,
  getAdjacentCommandes,
  invalidateCache,
  getCacheStats,
};