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
  getMyDashboard,
  getCaDashboard,
  getCaComparaison,
} from "../controllers/dashboardController.js";

const router = express.Router();

const canRead = checkModuleAccess("dashboard_admin", "read");

// Mon tableau de bord personnel (tout utilisateur connecté, scopé à ses accès)
router.get("/me", protect, getMyDashboard);

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

// CA / meilleures ventes (snapshot) — RÉSERVÉ à l'analyse CA (analyse_ca_admin)
router.get(
  "/ca/:nomDossierDBF",
  protect,
  checkModuleAccess("analyse_ca_admin", "read"),
  checkEntrepriseAccess,
  getCaDashboard,
);

// Comparaison CA entre sociétés accessibles — RÉSERVÉ à l'analyse CA
router.get(
  "/ca-comparaison",
  protect,
  checkModuleAccess("analyse_ca_admin", "read"),
  getCaComparaison,
);

export default router;