// backend/routes/analyseStockRoutes.js
//
// Analyse stock mensuelle (classeurs analyse_stock_<trig>_<MM>_<AAAA>.xlsx du
// FTPS robot-documents). Module de permission dédié : `analyse_stock_admin`.

import express from "express";
import {
  listerSources,
  getSynthese,
  getArticles,
} from "../controllers/analyseStockController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("analyse_stock_admin", "read");

// Sources disponibles (sociétés du périmètre).
router.get("/", protect, canRead, listerSources);

// Synthèse complète d'une société (KPI, graphiques, tops).
router.get(
  "/societe/:nomDossierDBF",
  protect,
  canRead,
  checkEntrepriseAccess,
  getSynthese,
);

// Explorateur d'articles (filtre + tri + pagination serveur).
router.get(
  "/societe/:nomDossierDBF/articles",
  protect,
  canRead,
  checkEntrepriseAccess,
  getArticles,
);

export default router;
