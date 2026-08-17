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
import artplusService from "../services/artplusService.js";
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

const enrichirArticle = (record, entreprise, indexPlus = null) => {
  const stockTotal = articleCacheService.calculateStockTotal(record);
  const promo = articleCacheService.isPromoActive(record);
  const pvte = parseFloat(record.PVTE) || 0;
  const pvpromo = parseFloat(record.PVPROMO) || 0;
  const mapping = entreprise.mappingEntrepots || {};

  // Compléments artplus.dbf : attributs libres + produit de rattachement.
  // Absents (société sans artplus, ou `?plus=0`) : les clés ne sont tout
  // simplement pas là, jamais un objet vide trompeur.
  let plus = null;
  if (indexPlus?.present) {
    const nart = String(record.NART || "").trim().toUpperCase();
    const attributs = indexPlus.parNart.get(nart);
    const cleProduit = indexPlus.produitParNart.get(nart);
    const produit = cleProduit ? indexPlus.produits.get(cleProduit) : null;
    if (attributs || produit) {
      plus = {
        _plus: attributs || {},
        _produit: produit
          ? {
              cle: produit.cle,
              id: produit.id,
              nom: produit.nom,
              groupe: produit.groupe,
              famille: produit.famille,
              sousFamille: produit.sousFamille,
              arborescence: produit.arborescence,
              marque: produit.marque,
              nbVariantes: produit.narts.length,
            }
          : null,
      };
    }
  }

  return {
    ...record,
    ...(plus || {}),
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

/**
 * Index artplus de la société, sauf si l'appelant l'a désactivé (`?plus=0`).
 *
 * Ne remonte JAMAIS d'erreur : les compléments article sont un bonus. Une
 * société sans artplus.dbf, ou un fichier illisible, ne doit pas faire échouer
 * une requête « articles » qui fonctionnait la veille.
 */
const indexPlusDe = async (req) => {
  const q = req.query || {};
  if (q.plus === "0" || q.plus === "false" || q.plus === "non") return null;
  try {
    return await artplusService.getIndex(req.entreprise);
  } catch (err) {
    console.warn(
      `[ApiPublique] artplus indisponible pour ${req.entreprise.nomDossierDBF}: ${err.message}`,
    );
    return null;
  }
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

  const [resultat, plus] = await Promise.all([
    articleCacheService.getPaginated(entreprise, {
      page,
      limit,
      ...filtresArticles(req.query),
    }),
    indexPlusDe(req),
  ]);

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
      projeter(enrichirArticle(a, entreprise, plus), champs),
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
      enrichirArticle(article, entreprise, await indexPlusDe(req)),
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
      enrichirArticle(article, entreprise, await indexPlusDe(req)),
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
  const plus = await indexPlusDe(req);
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
    let ligne = projeter(enrichirArticle(article, entreprise, plus), champs);
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
// PRODUITS & ATTRIBUTS (artplus.dbf)
// ===========================================================================
// artplus.dbf apporte ce qui manque à article.dbf pour un usage catalogue :
// un nom de produit lisible, un classement groupe/famille/sous-famille, et de
// quoi regrouper les références en PRODUITS À VARIANTES (une même serrure en
// 5 couleurs = 1 produit, 5 références). Les intitulés d'attributs sont propres
// à chaque société : voir GET /attributs pour le dictionnaire réel.

/** Prépare une variante pour la réponse (article enrichi + projeté). */
const vueVariante = (variante, entreprise, champs, avecArticle) => ({
  nart: variante.nart,
  attributs: variante.attributs,
  articleTrouve: variante.articleTrouve,
  // `_plus` n'est pas réinjecté ici : la variante porte déjà ses attributs,
  // les répéter dans l'article doublerait la charge utile pour rien.
  article:
    avecArticle && variante.article
      ? projeter(enrichirArticle(variante.article, entreprise), champs)
      : undefined,
});

const vueProduitApi = (produit, entreprise, champs, avecArticles) => ({
  ...produit,
  variantes: produit.variantes.map((v) =>
    vueVariante(v, entreprise, champs, avecArticles),
  ),
});

const avecArticlesDemande = (q) =>
  !(q.articles === "0" || q.articles === "false" || q.articles === "non");

/**
 * @desc    Dictionnaire des attributs artplus de la société + facettes
 * @route   GET /api/public/v1/:nomDossierDBF/attributs
 * @note    À lire EN PREMIER par un intégrateur : les intitulés ne sont pas les
 *          mêmes d'une société à l'autre, et c'est ici qu'on voit lesquels
 *          jouent le rôle de nom de produit, de classement, etc.
 */
const getAttributs = asyncHandler(async (req, res) => {
  const index = await artplusService.getIndex(req.entreprise);
  res.json({
    societe: societe(req.entreprise),
    fichier: "artplus.dbf",
    present: index.present,
    nbEnregistrements: index.dbfInfo.recordCount,
    derniereModification: index.dbfInfo.lastModified,
    nbArticles: index.parNart.size,
    nbProduits: index.produits.size,
    // Rôle -> clé d'attribut. Ce que l'API a reconnu dans les intitulés.
    roles: index.roles,
    attributs: index.intitules.map((i) => ({
      intitule: i.intitule,
      cle: i.cle,
      role: i.role || "",
      nbLignes: i.nbLignes,
      nbRemplies: i.nbRemplies,
    })),
    facettes: index.facettes,
  });
});

/**
 * @desc    Classement groupe > famille > sous-famille (arbre + comptages)
 * @route   GET /api/public/v1/:nomDossierDBF/classement
 */
const getClassement = asyncHandler(async (req, res) => {
  const arbre = await artplusService.getClassement(req.entreprise);
  res.json({
    societe: societe(req.entreprise),
    // Faux quand la société n'a pas d'attributs de classement dans artplus.
    disponible: arbre.disponible,
    total: arbre.groupes.length,
    groupes: arbre.groupes,
  });
});

/**
 * @desc    Compléments d'UN article (attributs bruts + normalisés + produit)
 * @route   GET /api/public/v1/:nomDossierDBF/articles/:nart/attributs
 */
const getArticleAttributs = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const detail = await artplusService.getAttributsDetail(
    entreprise,
    req.params.nart,
  );
  const produit = await artplusService.getProduitDeArticle(
    entreprise,
    req.params.nart,
  );

  res.json({
    societe: societe(entreprise),
    nart: String(req.params.nart).trim().toUpperCase(),
    // Clés stables, exploitables directement.
    attributs: detail.attributs,
    // Mêmes valeurs avec l'INTITULE d'origine, dans l'ordre du fichier.
    attributsBruts: detail.brut,
    produit: produit
      ? {
          cle: produit.cle,
          id: produit.id,
          nom: produit.nom,
          nbVariantes: produit.narts.length,
          axes: produit.axes,
          narts: produit.narts,
        }
      : null,
  });
});

/**
 * @desc    Liste paginée des PRODUITS (références regroupées par variantes)
 * @route   GET /api/public/v1/:nomDossierDBF/produits
 * @query   page, limit, champs, search, groupe, famille, sousFamille,
 *          arborescence (préfixe accepté), marque, enStock, web, articles
 */
const getProduits = asyncHandler(async (req, res) => {
  const debut = Date.now();
  const entreprise = req.entreprise;
  const page = entier(req.query.page, 1, 1, 1_000_000);
  const limit = entier(req.query.limit, LIMITE_DEFAUT, 1, LIMITE_MAX);
  const champs = listeChamps(req.query.champs);
  const avecArticles = avecArticlesDemande(req.query);

  const resultat = await artplusService.listerProduits(entreprise, {
    page,
    limit,
    search: req.query.search || undefined,
    groupe: req.query.groupe || undefined,
    famille: req.query.famille || undefined,
    sousFamille: req.query.sousFamille || undefined,
    arborescence: req.query.arborescence || undefined,
    marque: req.query.marque || undefined,
    enStock: booleen(req.query.enStock),
    web: booleen(req.query.web),
  });

  res.json({
    societe: societe(entreprise),
    present: resultat.present,
    pagination: {
      page: resultat.page,
      limit: resultat.limit,
      totalRecords: resultat.totalRecords,
      totalPages: resultat.totalPages,
      hasNextPage: resultat.hasNextPage,
      hasPrevPage: resultat.hasPrevPage,
    },
    _tempsMs: Date.now() - debut,
    produits: resultat.produits.map((p) =>
      vueProduitApi(p, entreprise, champs, avecArticles),
    ),
  });
});

/**
 * @desc    Un produit et toutes ses variantes
 * @route   GET /api/public/v1/:nomDossierDBF/produits/:cle
 */
const getProduit = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const produit = await artplusService.getProduit(entreprise, req.params.cle);
  if (!produit) {
    res.status(404);
    throw new Error(`Produit ${req.params.cle} introuvable`);
  }
  res.json({
    societe: societe(entreprise),
    produit: vueProduitApi(
      produit,
      entreprise,
      listeChamps(req.query.champs),
      avecArticlesDemande(req.query),
    ),
  });
});

/**
 * @desc    Export complet des produits en NDJSON (une ligne par produit)
 * @route   GET /api/public/v1/:nomDossierDBF/produits/export
 */
const exportProduits = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const champs = listeChamps(req.query.champs);
  const avecArticles = avecArticlesDemande(req.query);

  const index = await artplusService.getIndex(entreprise);
  const resultat = await artplusService.listerProduits(entreprise, {
    page: 1,
    limit: Math.max(index.produits.size, 1),
    search: req.query.search || undefined,
    groupe: req.query.groupe || undefined,
    famille: req.query.famille || undefined,
    sousFamille: req.query.sousFamille || undefined,
    arborescence: req.query.arborescence || undefined,
    marque: req.query.marque || undefined,
    enStock: booleen(req.query.enStock),
    web: booleen(req.query.web),
  });

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("X-Total-Records", String(resultat.totalRecords));
  res.setHeader(
    "X-Data-Version",
    `${new Date(index.dbfInfo.lastModified || 0).getTime()}-${index.parNart.size}`,
  );

  const masque = req.masqueDbf;
  for (const produit of resultat.produits) {
    let ligne = vueProduitApi(produit, entreprise, champs, avecArticles);
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
  getArticleAttributs,
  getAttributs,
  getClassement,
  getProduits,
  getProduit,
  exportProduits,
  getClients,
  getClientByTiers,
  getClientsStructure,
  getClientsVersion,
  getClientsFiltres,
  exportClients,
};
