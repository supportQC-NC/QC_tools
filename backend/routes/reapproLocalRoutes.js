// backend/routes/reapproLocalRoutes.js
import express from "express";
import {
  getProgress,
  refreshReport,
  getReport,
} from "../controllers/reapproLocalController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";
import { checkAnalyseAccess } from "../middleware/accessControl.js";

const router = express.Router();

// Accès : droit d'analyse « reapproLocal » (admins ET users).
const analyse = checkAnalyseAccess("reapproLocal");

// Progression (léger) — AVANT la route générique
router.get("/:nomDossierDBF/progress", protect, analyse, getProgress);

// Invalidation du cache
router.post("/:nomDossierDBF/refresh", protect, analyse, refreshReport);

// Rapport complet
router.get(
  "/:nomDossierDBF",
  protect,
  analyse,
  checkEntrepriseAccess,
  getReport,
);

export default router;