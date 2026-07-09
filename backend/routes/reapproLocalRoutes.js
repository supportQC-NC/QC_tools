// backend/routes/reapproLocalRoutes.js
import express from "express";
import {
  getProgress,
  refreshReport,
  getReport,
} from "../controllers/reapproLocalController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("reappro_local_admin", "read");

// Progression (léger) — AVANT la route générique
router.get("/:nomDossierDBF/progress", protect, canRead, getProgress);

// Invalidation du cache
router.post("/:nomDossierDBF/refresh", protect, canRead, refreshReport);

// Rapport complet
router.get("/:nomDossierDBF", protect, canRead, checkEntrepriseAccess, getReport);

export default router;