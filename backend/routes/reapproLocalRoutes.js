// backend/routes/reapproLocalRoutes.js
import express from "express";
import {
  getProgress,
  refreshReport,
  getReport,
} from "../controllers/reapproLocalController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Progression (léger) — AVANT la route générique
router.get("/:nomDossierDBF/progress", protect, admin, getProgress);

// Invalidation du cache
router.post("/:nomDossierDBF/refresh", protect, admin, refreshReport);

// Rapport complet
router.get(
  "/:nomDossierDBF",
  protect,
  admin,
  checkEntrepriseAccess,
  getReport,
);

export default router;