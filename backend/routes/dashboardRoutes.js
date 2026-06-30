// backend/routes/dashboardRoutes.js
import express from "express";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  getGlobalStats,
  getEntrepriseStats,
} from "../controllers/dashboardController.js";

const router = express.Router();

// KPI globaux (Mongo, toutes entreprises)
router.get("/global", protect, admin, getGlobalStats);

// KPI d'une entreprise (DBF : commandes, ventes, nouveautés, ruptures)
router.get("/entreprise/:nomDossierDBF", protect, admin, getEntrepriseStats);

export default router;