// backend/controllers/publicApiController.js
//
// API PARTENAIRE — lecture seule des bases DBF articles & clients.
// Destinée à un intégrateur externe (ex. site marchand SITEC).
//
// Principes :
//   - LECTURE SEULE : aucune route n'écrit dans le DBF ni dans Mongo.
//   - TOUS LES CHAMPS DBF sont renvoyés tels quels (noms d'origine en
//     MAJUSCULES). Les champs ajoutés par l'API sont préfixés « _ » pour être
//     immédiatement distinguables du DBF.
//   - Les lectures passent par les services de cache (articleService /
//     clientCacheService) : jamais d'ouverture directe du .dbf ici.

import asyncHandler from "../middleware/asyncHandler.js";
import articleCacheService from "../services/articleService.js";
import clientCacheService from "../services/clientCacheService.js";
import Entreprise from "../models/EntrepriseModel.js";
import { elaguer } from "../middleware/masquerChampsDbf.js";
import { SCOPES_API } from "../models/ApiKeyModel.js";

// Plafonds de pagination : au-delà, la réponse JSON devient trop lourde.
// Pour une synchronisation complète, utiliser /export (NDJSON en flux).
const LIMITE_DEFAUT = 100;
const LIMITE_MAX = 500;

const entier = (v, defaut, min, max) => {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return defaut;
  return Math.min(Math.max(n, min), max);
};

const booleen = (v) =>
  v === true || v === "1" || v === "true" || v === "oui" ? true : undefined;

const societe = (entreprise) => ({
  nomDossierDBF: entreprise.nomDossierDBF,
  trigramme: entreprise.trigramme,
  nomComplet: entreprise.nomComplet,
});

/**
 * Projection facultative : `?champs=NART,DESIGN,PVTE`.
 * Les champs calculés « _xxx » restent toujours disponibles s'ils sont demandés.
 */
const projeter = (enregistrement, champs) => {
  if (!champs) return enregistrement;
  const sortie = {};
  for (const c of champs) {
    if (c in enregistrement) sortie[c] = enregistrement[c];
  }
  return sortie;
};

const listeChamps = (q) => {
  if (!q) return null;
  const champs = String(q)
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => (c.startsWith("_") ? c : c.toUpperCase()));
  return champs.length ? champs : null;
};

// ---------------------------------------------------------------------------
// Enrichissements ARTICLE
// ---------------------------------------------------------------------------
// Le DBF stocke le stock éclaté par entrepôt et la promo en trois champs
// séparés. Recalculer ça côté partenaire serait à la fois pénible et une source
// de divergence : on livre le résultat, en plus des champs bruts.

const enrichirArticle = (record, entreprise) => {
  const stockTotal = articleCacheService.calculateStockTotal(record);
  const promo = articleCacheService.isPromoActive(record);
  const pvte = parseFloat(record.PVTE) || 0;
  const pvpromo = parseFloat(record.PVPROMO) || 0;
  const mapping = entreprise.mappingEntrepots || {};

  return {
    ...record,
    _stockTotal: stockTotal,
    _stockParEntrepot: {
      S1: { libelle: mapping.S1 || "S1", quantite: parseFloat(record.S1) || 0 },
      S2: { libelle: mapping.S2 || "S2", quantite: parseFloat(record.S2) || 0 },
      S3: { libelle: mapping.S3 || "S3", quantite: parseFloat(record.S3) || 0 },
      S4: { libelle: mapping.S4 || "S4", quantite: parseFloat(record.S4) || 0 },
      S5: { libelle: mapping.S5 || "S5", quantite: parseFloat(record.S5) || 0 },
    },
    _enStock: stockTotal > 0,
    _promoActive: promo,
    // Prix de vente HT effectivement applicable aujourd'hui.
    _prixVenteHT: promo && pvpromo > 0 ? pvpromo : pvte,
    _publieWeb: String(record.WEB || "").trim().toUpperCase() === "O",
    _aPhoto: String(record.FOTO || "").trim().toUpperCase() === "F",
  };
};

/** Options de filtrage articles, communes à /articles et /articles/export. */
const filtresArticles = (q) => ({
  search: q.search || undefined,
  nart: q.nart || undefined,
  groupe: q.groupe || undefined,
  fourn: q.fourn || undefined,
  fournExact: booleen(q.fournExact) || false,
  gisement: q.gisement || undefined,
  enStock: booleen(q.enStock),
  hasGencod: booleen(q.avecGencod),
  hasPromo: booleen(q.enPromo),
  isWeb: booleen(q.web),
  hasPhoto: booleen(q.avecPhoto),
  stockFilter: q.stock === "positif" || q.stock === "zero" ? q.stock : undefined,
  tgc: q.tgc,
});

// ===========================================================================
// MÉTA
// ===========================================================================

/**
 * @desc    Vérifie la clé et décrit son périmètre
 * @route   GET /api/public/v1/ping
 */
const ping = asyncHandler(async (req, res) => {
  const cle = req.apiKey;
  const entreprises = await Entreprise.find({
    _id: { $in: cle.entreprises },
  }).select("nomDossierDBF trigramme nomComplet isActive");

  res.json({
    ok: true,
    horodatage: new Date().toISOString(),
    cle: {
      nom: cle.nom,
      prefixe: cle.prefixe,
      scopes: cle.scopes,
      scopesDisponibles: SCOPES_API,
      limiteParMinute: cle.limiteParMinute,
      expireLe: cle.expireLe,
    },
    societes: entreprises.map((e) => ({
      ...societe(e),
      isActive: e.isActive,
    })),
    votreIp: req.apiKeyIp,
  });
});

/**
 * @desc    Sociétés accessibles avec cette clé
 * @route   GET /api/public/v1/societes
 */
const getSocietes = asyncHandler(async (req, res) => {
  const entreprises = await Entreprise.find({
    _id: { $in: req.apiKey.entreprises },
    isActive: true,
  }).select("nomDossierDBF trigramme nomComplet mappingEntrepots");

  res.json({
    total: entreprises.length,
    societes: entreprises.map((e) => ({
      ...societe(e),
      entrepots: e.mappingEntrepots,
    })),
  });
});

// ===========================================================================
// ARTICLES
// ===========================================================================

/**
 * @desc    Liste paginée des articles (tous champs DBF + champs calculés)
 * @route   GET /api/public/v1/:nomDossierDBF/articles
 * @query   page, limit, champs, search, nart, groupe, fourn, fournExact,
 *          gisement, enStock, stock, avecGencod, enPromo, web, avecPhoto, tgc
 */
const getArticles = asyncHandler(async (req, res) => {
  const debut = Date.now();
  const entreprise = req.entreprise;
  const page = entier(req.query.page, 1, 1, 1_000_000);
  const limit = entier(req.query.limit, LIMITE_DEFAUT, 1, LIMITE_MAX);
  const champs = listeChamps(req.query.champs);

  const resultat = await articleCacheService.getPaginated(entreprise, {
    page,
    limit,
    ...filtresArticles(req.query),
  });

  res.json({
    societe: societe(entreprise),
    pagination: {
      page: resultat.page,
      limit: resultat.limit,
      totalRecords: resultat.totalRecords,
      totalPages: resultat.totalPages,
      hasNextPage: resultat.hasNextPage,
      hasPrevPage: resultat.hasPrevPage,
    },
    _tempsMs: Date.now() - debut,
    articles: resultat.articles.map((a) =>
      projeter(enrichirArticle(a, entreprise), champs),
    ),
  });
});

/**
 * @desc    Un article par code article (NART)
 * @route   GET /api/public/v1/:nomDossierDBF/articles/:nart
 */
const getArticleByNart = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const article = await articleCacheService.findByNart(
    entreprise,
    req.params.nart,
  );
  if (!article) {
    res.status(404);
    throw new Error(`Article ${req.params.nart} introuvable`);
  }
  res.json({
    societe: societe(entreprise),
    article: projeter(
      enrichirArticle(article, entreprise),
      listeChamps(req.query.champs),
    ),
  });
});

/**
 * @desc    Un article par code-barres (GENCOD)
 * @route   GET /api/public/v1/:nomDossierDBF/articles/gencod/:gencod
 */
const getArticleByGencod = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const article = await articleCacheService.findByGencod(
    entreprise,
    req.params.gencod,
  );
  if (!article) {
    res.status(404);
    throw new Error(`Aucun article pour le code-barres ${req.params.gencod}`);
  }
  res.json({
    societe: societe(entreprise),
    article: projeter(
      enrichirArticle(article, entreprise),
      listeChamps(req.query.champs),
    ),
  });
});

/**
 * @desc    Structure du fichier article.dbf (noms/types/tailles des champs)
 * @route   GET /api/public/v1/:nomDossierDBF/articles/structure
 */
const getArticlesStructure = asyncHandler(async (req, res) => {
  const structure = await articleCacheService.getStructure(req.entreprise);
  res.json({
    societe: societe(req.entreprise),
    fichier: "article.dbf",
    nbEnregistrements: structure.recordCount,
    derniereModification: structure.lastModified,
    champs: structure.fields,
  });
});

/**
 * @desc    Empreinte du jeu de données (pour décider s'il faut resynchroniser)
 * @route   GET /api/public/v1/:nomDossierDBF/articles/version
 */
const getArticlesVersion = asyncHandler(async (req, res) => {
  const cache = await articleCacheService.getArticles(req.entreprise);
  res.json({
    societe: societe(req.entreprise),
    fichier: "article.dbf",
    nbEnregistrements: cache.records.length,
    derniereModification: cache.dbfInfo.lastModified,
    // Signature stable : change dès que le DBF est réécrit par l'ERP.
    version: `${new Date(cache.dbfInfo.lastModified).getTime()}-${cache.records.length}`,
  });
});

/**
 * @desc    Familles/groupes d'articles avec comptage
 * @route   GET /api/public/v1/:nomDossierDBF/articles/groupes
 */
const getArticlesGroupes = asyncHandler(async (req, res) => {
  const groupes = await articleCacheService.getGroupes(req.entreprise);
  res.json({ societe: societe(req.entreprise), total: groupes.length, groupes });
});

/**
 * @desc    Taux de TGC distincts présents dans le fichier
 * @route   GET /api/public/v1/:nomDossierDBF/articles/tgc
 */
const getArticlesTgc = asyncHandler(async (req, res) => {
  const taux = await articleCacheService.getTgcRates(req.entreprise);
  res.json({ societe: societe(req.entreprise), taux });
});

/**
 * @desc    Export complet en NDJSON (une ligne JSON par article)
 * @route   GET /api/public/v1/:nomDossierDBF/articles/export
 * @note    Réservé aux synchronisations complètes. Accepte les mêmes filtres
 *          que la liste ; ignore page/limit.
 */
const exportArticles = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const champs = listeChamps(req.query.champs);

  // getPaginated applique les filtres sur l'ensemble du fichier ; on demande
  // une « page » unique assez grande pour tout couvrir.
  const cache = await articleCacheService.getArticles(entreprise);
  const resultat = await articleCacheService.getPaginated(entreprise, {
    page: 1,
    limit: Math.max(cache.records.length, 1),
    ...filtresArticles(req.query),
  });

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("X-Total-Records", String(resultat.totalRecords));
  res.setHeader(
    "X-Data-Version",
    `${new Date(cache.dbfInfo.lastModified).getTime()}-${cache.records.length}`,
  );

  const masque = req.masqueDbf;
  for (const article of resultat.articles) {
    let ligne = projeter(enrichirArticle(article, entreprise), champs);
    // Le flux ne passe pas par res.json : l'exclusion de champs doit être
    // appliquée explicitement ici.
    if (masque && masque.size) ligne = elaguer(ligne, masque);
    if (!res.write(`${JSON.stringify(ligne)}\n`)) {
      await new Promise((resolve) => res.once("drain", resolve));
    }
  }
  res.end();
});

// ===========================================================================
// CLIENTS
// ===========================================================================

/**
 * @desc    Liste paginée des clients (tous champs DBF)
 * @route   GET /api/public/v1/:nomDossierDBF/clients
 * @query   page, limit, champs, search, repres, catcli, type, categorie,
 *          groupe, banque, codtarif, cltva, ecotaxe, sav, fdm, compte
 */
const getClients = asyncHandler(async (req, res) => {
  const debut = Date.now();
  const entreprise = req.entreprise;
  const page = entier(req.query.page, 1, 1, 1_000_000);
  const limit = entier(req.query.limit, LIMITE_DEFAUT, 1, LIMITE_MAX);
  const champs = listeChamps(req.query.champs);

  const resultat = await clientCacheService.getPaginated(entreprise, {
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
    societe: societe(entreprise),
    pagination: {
      page: resultat.page,
      limit: resultat.limit,
      totalRecords: resultat.totalRecords,
      totalPages: resultat.totalPages,
      hasNextPage: resultat.hasNextPage,
      hasPrevPage: resultat.hasPrevPage,
    },
    _tempsMs: Date.now() - debut,
    clients: resultat.clients.map((c) => projeter(c, champs)),
  });
});

/**
 * @desc    Un client par numéro de tiers
 * @route   GET /api/public/v1/:nomDossierDBF/clients/:tiers
 */
const getClientByTiers = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const client = await clientCacheService.findByTiers(
    entreprise,
    req.params.tiers,
  );
  if (!client) {
    res.status(404);
    throw new Error(`Client tiers ${req.params.tiers} introuvable`);
  }
  res.json({
    societe: societe(entreprise),
    client: projeter(client, listeChamps(req.query.champs)),
  });
});

/**
 * @desc    Structure du fichier clients.dbf
 * @route   GET /api/public/v1/:nomDossierDBF/clients/structure
 */
const getClientsStructure = asyncHandler(async (req, res) => {
  const structure = await clientCacheService.getStructure(req.entreprise);
  res.json({
    societe: societe(req.entreprise),
    fichier: "clients.dbf",
    nbEnregistrements: structure.clients.recordCount,
    derniereModification: structure.clients.lastModified,
    champs: structure.clients.fields,
  });
});

/**
 * @desc    Empreinte du jeu de données clients
 * @route   GET /api/public/v1/:nomDossierDBF/clients/version
 */
const getClientsVersion = asyncHandler(async (req, res) => {
  const cache = await clientCacheService.getClients(req.entreprise);
  res.json({
    societe: societe(req.entreprise),
    fichier: "clients.dbf",
    nbEnregistrements: cache.records.length,
    derniereModification: cache.dbfInfo.lastModified,
    version: `${new Date(cache.dbfInfo.lastModified).getTime()}-${cache.records.length}`,
  });
});

/**
 * @desc    Valeurs distinctes des champs filtrables (pour construire des menus)
 * @route   GET /api/public/v1/:nomDossierDBF/clients/filtres
 */
const getClientsFiltres = asyncHandler(async (req, res) => {
  const valeurs = await clientCacheService.getAllFilterValues(req.entreprise);
  res.json({ societe: societe(req.entreprise), ...valeurs });
});

/**
 * @desc    Export complet des clients en NDJSON
 * @route   GET /api/public/v1/:nomDossierDBF/clients/export
 */
const exportClients = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const champs = listeChamps(req.query.champs);
  const cache = await clientCacheService.getClients(entreprise);

  const resultat = await clientCacheService.getPaginated(entreprise, {
    page: 1,
    limit: Math.max(cache.records.length, 1),
    search: req.query.search || undefined,
    categorie: req.query.categorie || undefined,
    type: req.query.type || undefined,
    groupe: req.query.groupe || undefined,
  });

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("X-Total-Records", String(resultat.totalRecords));
  res.setHeader(
    "X-Data-Version",
    `${new Date(cache.dbfInfo.lastModified).getTime()}-${cache.records.length}`,
  );

  const masque = req.masqueDbf;
  for (const client of resultat.clients) {
    let ligne = projeter(client, champs);
    if (masque && masque.size) ligne = elaguer(ligne, masque);
    if (!res.write(`${JSON.stringify(ligne)}\n`)) {
      await new Promise((resolve) => res.once("drain", resolve));
    }
  }
  res.end();
});

export {
  ping,
  getSocietes,
  getArticles,
  getArticleByNart,
  getArticleByGencod,
  getArticlesStructure,
  getArticlesVersion,
  getArticlesGroupes,
  getArticlesTgc,
  exportArticles,
  getClients,
  getClientByTiers,
  getClientsStructure,
  getClientsVersion,
  getClientsFiltres,
  exportClients,
};
