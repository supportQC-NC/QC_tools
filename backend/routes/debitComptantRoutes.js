// backend/routes/debitComptantRoutes.js
import express from "express";
import {
  getReport,
  getProgress,
  refreshReport,
} from "../controllers/debitComptantController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("debit_comptant_admin", "read");

router.get("/:nomDossierDBF/progress", protect, canRead, getProgress);

router.post("/:nomDossierDBF/refresh", protect, canRead, refreshReport);

router.get("/:nomDossierDBF", protect, canRead, checkEntrepriseAccess, getReport);

export default router;