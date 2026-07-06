// backend/routes/debitComptantRoutes.js
import express from "express";
import {
  getReport,
  getProgress,
  refreshReport,
} from "../controllers/debitComptantController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";
import { checkAnalyseAccess } from "../middleware/accessControl.js";

const router = express.Router();

// Accès : droit d'analyse « debitComptant » (admins ET users).
const analyse = checkAnalyseAccess("debitComptant");

router.get("/:nomDossierDBF/progress", protect, analyse, getProgress);

router.post("/:nomDossierDBF/refresh", protect, analyse, refreshReport);

router.get(
  "/:nomDossierDBF",
  protect,
  analyse,
  checkEntrepriseAccess,
  getReport,
);

export default router;