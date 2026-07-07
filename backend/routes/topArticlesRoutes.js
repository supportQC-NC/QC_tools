// backend/routes/topArticlesRoutes.js
import express from "express";
import { getTopArticles } from "../controllers/topArticlesController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";
import { checkAnalyseAccess } from "../middleware/accessControl.js";

const router = express.Router();

// Accès : droit d'analyse « topArticles » (admins ET users) + accès entreprise.
router.get(
  "/:nomDossierDBF",
  protect,
  checkAnalyseAccess("topArticles"),
  checkEntrepriseAccess,
  getTopArticles,
);

export default router;