// backend/routes/dashboardRoutes.js
import express from "express";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";
import {
  getGlobalStats,
  getEntrepriseStats,
} from "../controllers/dashboardController.js";

const router = express.Router();

// KPI globaux (Mongo) — filtrés sur le périmètre de l'utilisateur (admin scopé
// inclus, filtrage interne au contrôleur).
router.get("/global", protect, admin, getGlobalStats);

// KPI d'une entreprise (DBF) — accès vérifié sur le périmètre de l'utilisateur.
router.get(
  "/entreprise/:nomDossierDBF",
  protect,
  admin,
  checkEntrepriseAccess,
  getEntrepriseStats,
);

export default router;