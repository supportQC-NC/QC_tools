// backend/routes/ficheArticleRoutes.js
import express from "express";
import { getFicheArticle } from "../controllers/ficheArticleController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

router.get(
  "/:nomDossierDBF/:nart",
  protect,
  checkModuleAccess("stock", "read"),
  checkEntrepriseAccess,
  getFicheArticle,
);

export default router;