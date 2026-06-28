// backend/routes/articleRoutes.js
import express from "express";
import {
  getArticles,
  getArticleByNart,
  getArticleByGencod,
  getArticlesStructure,
  searchArticles,
  getGroupes,
  getTgcRates,
  invalidateCache,
  getCacheStats,
  getAdjacentArticles,
} from "../controllers/articleController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Cache stats (admin) - AVANT les routes avec paramètres
router.get("/cache-stats", protect, admin, getCacheStats);

// Liste des articles avec pagination et filtres avancés
router.get(
  "/:nomDossierDBF",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getArticles,
);

// Structure/métadonnées du fichier DBF
router.get(
  "/:nomDossierDBF/structure",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getArticlesStructure,
);

// Recherche d'articles
router.get(
  "/:nomDossierDBF/search",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  searchArticles,
);

// Liste des groupes/familles
router.get(
  "/:nomDossierDBF/groupes",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getGroupes,
);

// Liste des taux TGC distincts
router.get(
  "/:nomDossierDBF/tgc-rates",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getTgcRates,
);

// APRÈS
router.get(
  "/:nomDossierDBF/adjacent/:nart",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getAdjacentArticles,
);
// Article par code NART
router.get(
  "/:nomDossierDBF/code/:nart",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getArticleByNart,
);

// Article par code barre GENCOD
router.get(
  "/:nomDossierDBF/gencod/:gencod",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getArticleByGencod,
);

// Invalider le cache (admin)
router.post(
  "/:nomDossierDBF/invalidate-cache",
  protect,
  admin,
  checkEntrepriseAccess,
  invalidateCache,
);

export default router;
