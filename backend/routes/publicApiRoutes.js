// backend/routes/publicApiRoutes.js
//
// API PARTENAIRE (/api/public/v1) — accès externe en LECTURE SEULE aux bases
// articles & clients d'une société, authentifié par clé d'API.
//
// ⚠️ Ce routeur n'utilise NI `protect` NI `checkEntrepriseAccess` : ces
// middlewares supposent un utilisateur interne (cookie JWT + Permission).
// Ici c'est `apiKeyAuth` + `requireScope` + `chargerEntrepriseApi`.
//
// ⚠️ Aucune route d'écriture ne doit être ajoutée ici sans décision explicite :
// le DBF est la source de vérité de l'ERP et n'est jamais réécrit par l'appli.

import express from "express";
import cors from "cors";
import {
  apiKeyAuth,
  limiterDebit,
  requireScope,
  chargerEntrepriseApi,
} from "../middleware/apiKeyAuth.js";
import {
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
} from "../controllers/publicApiController.js";

const router = express.Router();

// CORS ouvert et SANS cookies : l'authentification se fait par en-tête, jamais
// par cookie de session — il n'y a donc pas de risque de requête authentifiée
// « à l'insu » d'un navigateur tiers. Cela permet au prestataire de tester
// depuis un outil web sans être bloqué par la politique du front interne.
router.use(
  cors({
    origin: "*",
    credentials: false,
    methods: ["GET", "OPTIONS"],
    allowedHeaders: ["X-API-Key", "Authorization", "Content-Type"],
    exposedHeaders: [
      "X-Total-Records",
      "X-Data-Version",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "Retry-After",
    ],
  }),
);

// Toutes les routes ci-dessous exigent une clé valide et respectent son quota.
router.use(apiKeyAuth, limiterDebit);

// ---- Méta -----------------------------------------------------------------
router.get("/ping", ping);
router.get("/societes", getSocietes);

// ---- Articles -------------------------------------------------------------
const articles = requireScope("articles:read");

// Les segments littéraux DOIVENT précéder /:nart, sinon "structure" serait
// interprété comme un code article.
router.get("/:nomDossierDBF/articles/structure", articles, chargerEntrepriseApi, getArticlesStructure);
router.get("/:nomDossierDBF/articles/version", articles, chargerEntrepriseApi, getArticlesVersion);
router.get("/:nomDossierDBF/articles/groupes", articles, chargerEntrepriseApi, getArticlesGroupes);
router.get("/:nomDossierDBF/articles/tgc", articles, chargerEntrepriseApi, getArticlesTgc);
router.get("/:nomDossierDBF/articles/export", articles, chargerEntrepriseApi, exportArticles);
router.get("/:nomDossierDBF/articles/gencod/:gencod", articles, chargerEntrepriseApi, getArticleByGencod);
router.get("/:nomDossierDBF/articles", articles, chargerEntrepriseApi, getArticles);
router.get("/:nomDossierDBF/articles/:nart", articles, chargerEntrepriseApi, getArticleByNart);
router.get("/:nomDossierDBF/articles/:nart/attributs", articles, chargerEntrepriseApi, getArticleAttributs);

// ---- Produits & attributs (artplus.dbf) ------------------------------------
// Même ressource que les articles (mêmes données, regroupées) : le scope
// « articles:read » suffit, inutile de réémettre les clés déjà distribuées.
router.get("/:nomDossierDBF/attributs", articles, chargerEntrepriseApi, getAttributs);
router.get("/:nomDossierDBF/classement", articles, chargerEntrepriseApi, getClassement);
// « export » AVANT /:cle, sinon il serait pris pour une clé de produit.
router.get("/:nomDossierDBF/produits/export", articles, chargerEntrepriseApi, exportProduits);
router.get("/:nomDossierDBF/produits", articles, chargerEntrepriseApi, getProduits);
router.get("/:nomDossierDBF/produits/:cle", articles, chargerEntrepriseApi, getProduit);

// ---- Clients --------------------------------------------------------------
const clients = requireScope("clients:read");

router.get("/:nomDossierDBF/clients/structure", clients, chargerEntrepriseApi, getClientsStructure);
router.get("/:nomDossierDBF/clients/version", clients, chargerEntrepriseApi, getClientsVersion);
router.get("/:nomDossierDBF/clients/filtres", clients, chargerEntrepriseApi, getClientsFiltres);
router.get("/:nomDossierDBF/clients/export", clients, chargerEntrepriseApi, exportClients);
router.get("/:nomDossierDBF/clients", clients, chargerEntrepriseApi, getClients);
router.get("/:nomDossierDBF/clients/:tiers", clients, chargerEntrepriseApi, getClientByTiers);

export default router;
