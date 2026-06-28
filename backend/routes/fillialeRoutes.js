// backend/routes/filialeRoutes.js
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
