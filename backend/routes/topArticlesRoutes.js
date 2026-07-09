// backend/routes/topArticlesRoutes.js
import express from "express";
import { getTopArticles } from "../controllers/topArticlesController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Accès : module "top_articles_admin" (lecture) + accès à l'entreprise.
router.get(
  "/:nomDossierDBF",
  protect,
  checkModuleAccess("top_articles_admin", "read"),
  checkEntrepriseAccess,
  getTopArticles,
);

export default router;