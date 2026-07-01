// backend/routes/performanceDockRoutes.js
import express from "express";
import {
  getReport,
  refreshReport,
} from "../controllers/performanceDockController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// QC uniquement, dossier serveur fixe -> pas de checkEntrepriseAccess
router.get("/", protect, admin, getReport);
router.post("/refresh", protect, admin, refreshReport);

export default router;