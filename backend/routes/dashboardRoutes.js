// backend/routes/dashboardRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";
import {
  getGlobalStats,
  getEntrepriseStats,
} from "../controllers/dashboardController.js";

const router = express.Router();

const canRead = checkModuleAccess("dashboard_admin", "read");

// KPI globaux (Mongo, toutes entreprises)
router.get("/global", protect, canRead, getGlobalStats);

// KPI d'une entreprise (DBF : commandes, ventes, nouveautés, ruptures)
router.get(
  "/entreprise/:nomDossierDBF",
  protect,
  canRead,
  checkEntrepriseAccess,
  getEntrepriseStats,
);

export default router;