// backend/controllers/filialeController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Entreprise from "../models/EntrepriseModel.js";
import { DBFFile } from "dbffile";
import path from "path";
import fs from "fs";

/**
 * Structure du fichier filliale.dbf :
 * CODE(C:6) - Code article (NART)
 * LIBELLE(C:100) - Format: TRIGRAMME-NART_FILIALE-STOCK-PRIXF / TRIGRAMME2-NART2-STOCK2-PRIX2F / ...
 *
 * Exemples:
 * - "MQ-000004-2-0F" = Trigramme MQ, NART 000004, Stock 2, Prix 0F
 * - "LD-990118-100 / MQ-000041-30-890F" = LD stock 100 (grossiste sans prix), MQ stock 30 prix 890F
 * - "LD-110055-0 / KQ-112363-0-1300F" = LD stock 0 (pas de prix), KQ stock 0 prix 1300F
 */

// Cache pour les données filiales
const filialeCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Parse une entrée de filiale du format "TRIGRAMME-NART-STOCK-PRIXF" ou "TRIGRAMME-NART-STOCK"
 * @param {string} entry - Une entrée de filiale
 * @returns {object|null} - { trigramme, nart, stock, prix } ou null si invalide
 */
const parseFilialeEntry = (entry) => {
  if (!entry || typeof entry !== "string") return null;

  const trimmed = entry.trim();
  if (!trimmed) return null;

  // Format attendu: TRIGRAMME-NART-STOCK-PRIXF ou TRIGRAMME-NART-STOCK (sans prix pour grossistes)
  const parts = trimmed.split("-");

  if (parts.length < 3) return null;

  const trigramme = parts[0].trim().toUpperCase();
  const nart = parts[1].trim();

  // Le stock est toujours en position 2
  const stockStr = parts[2].trim();
  const stock = parseInt(stockStr) || 0;

  // Le prix peut être en position 3 (format: "1300F" ou "0F" ou absent pour grossistes)
  let prix = null;
  if (parts.length >= 4) {
    const prixStr = parts[3].trim();
    // Extraire le nombre avant le "F"
    const prixMatch = prixStr.match(/^(\d+)F?$/i);
    if (prixMatch) {
      prix = parseInt(prixMatch[1]) || 0;
    }
  }

  return {
    trigramme,
    nart,
    stock,
    prix, // null si grossiste ou non spécifié
  };
};

/**
 * Parse le champ LIBELLE complet pour extraire toutes les filiales
 * @param {string} libelle - Le champ LIBELLE du DBF
 * @returns {Array} - Liste des filiales parsées
 */
const parseLibelle = (libelle) => {
  if (!libelle || typeof libelle !== "string") return [];

  const filiales = [];

  // Séparer par " / " pour obtenir chaque entrée de filiale
  const entries = libelle.split(" / ");

  for (const entry of entries) {
    const parsed = parseFilialeEntry(entry);
    if (parsed) {
      filiales.push(parsed);
    }
  }

  return filiales;
};

/**
 * Charge les données filiales depuis le fichier DBF avec mise en cache
 * @param {object} entreprise - L'entreprise source
 * @returns {Map} - Map de NART -> Array de filiales
 */
const loadFilialeData = async (entreprise) => {
  const cacheKey = entreprise.nomDossierDBF;
  const cached = filialeCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "filiales.dbf",
  );

  if (!fs.existsSync(dbfPath)) {
    console.warn(`Fichier filiale.dbf non trouvé: ${dbfPath}`);
    return new Map();
  }

  try {
    const dbf = await DBFFile.open(dbfPath);
    const records = await dbf.readRecords();

    const filialeMap = new Map();

    for (const record of records) {
      const code = record.CODE ? record.CODE.trim() : "";
      const libelle = record.LIBELLE ? record.LIBELLE.trim() : "";

      if (code && libelle) {
        const filiales = parseLibelle(libelle);
        if (filiales.length > 0) {
          filialeMap.set(code, filiales);
        }
      }
    }

    // Mettre en cache
    filialeCache.set(cacheKey, {
      data: filialeMap,
      timestamp: Date.now(),
    });

    console.log(
      `Cache filliale chargé pour ${entreprise.nomComplet}: ${filialeMap.size} articles`,
    );

    return filialeMap;
  } catch (error) {
    console.error(`Erreur lecture filliale.dbf: ${error.message}`);
    return new Map();
  }
};

/**
 * @desc    Obtenir les stocks et prix des autres entités pour un article
 * @route   GET /api/filiales/:nomDossierDBF/article/:nart
 * @access  Private
 */
const getArticleFilialeData = asyncHandler(async (req, res) => {
  const { nomDossierDBF, nart } = req.params;
  const startTime = Date.now();

  // Trouver l'entreprise
  const entreprise = await Entreprise.findOne({
    nomDossierDBF,
    isActive: true,
  });

  if (!entreprise) {
    res.status(404);
    throw new Error(`Entreprise ${nomDossierDBF} non trouvée`);
  }

  // Charger les données filiales
  const filialeMap = await loadFilialeData(entreprise);

  // Chercher l'article
  const nartClean = nart.trim().toUpperCase();
  let filiales = filialeMap.get(nartClean);

  // Si pas trouvé avec majuscules, essayer tel quel
  if (!filiales) {
    filiales = filialeMap.get(nart.trim());
  }

  // Si toujours pas trouvé, chercher avec padding
  if (!filiales) {
    const nartPadded = nart.trim().padStart(6, "0");
    filiales = filialeMap.get(nartPadded);
  }

  if (!filiales || filiales.length === 0) {
    return res.json({
      entreprise: {
        _id: entreprise._id,
        nomDossierDBF: entreprise.nomDossierDBF,
        trigramme: entreprise.trigramme,
        nomComplet: entreprise.nomComplet,
      },
      nart: nart.trim(),
      filiales: [],
      _queryTime: `${Date.now() - startTime}ms`,
    });
  }

  // Récupérer les informations des entreprises pour enrichir les données
  const trigrammes = [...new Set(filiales.map((f) => f.trigramme))];
  const entreprisesInfo = await Entreprise.find({
    trigramme: { $in: trigrammes },
    isActive: true,
  }).select("trigramme nomComplet nomDossierDBF");

  const entreprisesMap = new Map();
  for (const ent of entreprisesInfo) {
    entreprisesMap.set(ent.trigramme, {
      nomComplet: ent.nomComplet,
      nomDossierDBF: ent.nomDossierDBF,
    });
  }

  // Enrichir les données des filiales
  const filialesEnrichies = filiales.map((f) => {
    const entInfo = entreprisesMap.get(f.trigramme);
    return {
      trigramme: f.trigramme,
      nartFiliale: f.nart,
      stock: f.stock,
      prix: f.prix,
      hasPrix: f.prix !== null,
      entrepriseNom: entInfo?.nomComplet || f.trigramme,
      entrepriseDossier: entInfo?.nomDossierDBF || null,
    };
  });

  // Trier par trigramme
  filialesEnrichies.sort((a, b) => a.trigramme.localeCompare(b.trigramme));

  res.json({
    entreprise: {
      _id: entreprise._id,
      nomDossierDBF: entreprise.nomDossierDBF,
      trigramme: entreprise.trigramme,
      nomComplet: entreprise.nomComplet,
    },
    nart: nart.trim(),
    totalFiliales: filialesEnrichies.length,
    stockTotal: filialesEnrichies.reduce((sum, f) => sum + f.stock, 0),
    filiales: filialesEnrichies,
    _queryTime: `${Date.now() - startTime}ms`,
  });
});

/**
 * @desc    Obtenir les stocks et prix de toutes les entités pour plusieurs articles
 * @route   POST /api/filiales/:nomDossierDBF/articles
 * @access  Private
 * @body    { narts: ["NART1", "NART2", ...] }
 */
const getMultipleArticlesFilialeData = asyncHandler(async (req, res) => {
  const { nomDossierDBF } = req.params;
  const { narts } = req.body;
  const startTime = Date.now();

  if (!narts || !Array.isArray(narts) || narts.length === 0) {
    res.status(400);
    throw new Error("Le paramètre 'narts' est requis et doit être un tableau");
  }

  // Limiter à 100 articles max
  const nartsLimited = narts.slice(0, 100);

  // Trouver l'entreprise
  const entreprise = await Entreprise.findOne({
    nomDossierDBF,
    isActive: true,
  });

  if (!entreprise) {
    res.status(404);
    throw new Error(`Entreprise ${nomDossierDBF} non trouvée`);
  }

  // Charger les données filiales
  const filialeMap = await loadFilialeData(entreprise);

  // Récupérer toutes les entreprises pour enrichir les données
  const entreprisesInfo = await Entreprise.find({ isActive: true }).select(
    "trigramme nomComplet nomDossierDBF",
  );

  const entreprisesMap = new Map();
  for (const ent of entreprisesInfo) {
    entreprisesMap.set(ent.trigramme, {
      nomComplet: ent.nomComplet,
      nomDossierDBF: ent.nomDossierDBF,
    });
  }

  // Chercher les données pour chaque NART
  const results = {};

  for (const nart of nartsLimited) {
    const nartClean = nart.trim();
    let filiales =
      filialeMap.get(nartClean.toUpperCase()) ||
      filialeMap.get(nartClean) ||
      filialeMap.get(nartClean.padStart(6, "0"));

    if (filiales && filiales.length > 0) {
      results[nartClean] = filiales.map((f) => {
        const entInfo = entreprisesMap.get(f.trigramme);
        return {
          trigramme: f.trigramme,
          nartFiliale: f.nart,
          stock: f.stock,
          prix: f.prix,
          hasPrix: f.prix !== null,
          entrepriseNom: entInfo?.nomComplet || f.trigramme,
        };
      });
    } else {
      results[nartClean] = [];
    }
  }

  res.json({
    entreprise: {
      _id: entreprise._id,
      nomDossierDBF: entreprise.nomDossierDBF,
      trigramme: entreprise.trigramme,
      nomComplet: entreprise.nomComplet,
    },
    results,
    _queryTime: `${Date.now() - startTime}ms`,
  });
});

/**
 * @desc    Invalider le cache des filiales pour une entreprise
 * @route   POST /api/filiales/:nomDossierDBF/invalidate-cache
 * @access  Private/Admin
 */
const invalidateFilialeCache = asyncHandler(async (req, res) => {
  const { nomDossierDBF } = req.params;

  filialeCache.delete(nomDossierDBF);

  res.json({
    message: `Cache filiales invalidé pour ${nomDossierDBF}`,
    nomDossierDBF,
  });
});

/**
 * @desc    Obtenir les statistiques du cache des filiales
 * @route   GET /api/filiales/cache-stats
 * @access  Private/Admin
 */
const getFilialesCacheStats = asyncHandler(async (req, res) => {
  const stats = {};

  for (const [key, value] of filialeCache.entries()) {
    stats[key] = {
      articlesCount: value.data.size,
      loadedAt: new Date(value.timestamp).toISOString(),
      ageMs: Date.now() - value.timestamp,
    };
  }

  res.json({
    cacheEntries: filialeCache.size,
    cacheTTL: CACHE_TTL,
    stats,
  });
});

export {
  getArticleFilialeData,
  getMultipleArticlesFilialeData,
  invalidateFilialeCache,
  getFilialesCacheStats,
};
