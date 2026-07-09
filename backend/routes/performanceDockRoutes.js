// backend/routes/performanceDockRoutes.js
import express from "express";
import {
  getReport,
  refreshReport,
} from "../controllers/performanceDockController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("performance_dock_admin", "read");

// QC uniquement, dossier serveur fixe -> pas de checkEntrepriseAccess
router.get("/", protect, canRead, getReport);
router.post("/refresh", protect, canRead, refreshReport);

export default router;