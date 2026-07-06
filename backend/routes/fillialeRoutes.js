// backend/routes/fillialeRoutes.js
//
// Données FILIALES par ARTICLE (comparatif d'un article à travers les filiales).
// Utilisé par les fiches article (AdminArticleInfosScreen, UserArticleSearch).
// NE PAS confondre avec filialesRoutes.js (analyse réseau DQ/QC/LD).
import express from "express";
import {
  getArticleFilialeData,
  getMultipleArticlesFilialeData,
  invalidateFilialeCache,
  getFilialesCacheStats,
} from "../controllers/fillialeController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Stats du cache (admin)
router.get("/cache-stats", protect, admin, getFilialesCacheStats);

// Obtenir les données filiales pour un article
router.get(
  "/:nomDossierDBF/article/:nart",
  protect,
  checkModuleAccess("stock", "read"),
  getArticleFilialeData,
);

// Obtenir les données filiales pour plusieurs articles
router.post(
  "/:nomDossierDBF/articles",
  protect,
  checkModuleAccess("stock", "read"),
  getMultipleArticlesFilialeData,
);

// Invalider le cache (admin)
router.post(
  "/:nomDossierDBF/invalidate-cache",
  protect,
  admin,
  invalidateFilialeCache,
);

export default router;