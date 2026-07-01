// backend/routes/debitComptantRoutes.js
import express from "express";
import {
  getReport,
  getProgress,
  refreshReport,
} from "../controllers/debitComptantController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

router.get("/:nomDossierDBF/progress", protect, admin, getProgress);

router.post("/:nomDossierDBF/refresh", protect, admin, refreshReport);

router.get("/:nomDossierDBF", protect, admin, checkEntrepriseAccess, getReport);

export default router;