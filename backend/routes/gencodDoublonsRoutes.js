// backend/routes/gencodDoublonsRoutes.js
import express from "express";
import {
  getReport,
  refreshReport,
} from "../controllers/gencodDoublonsController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

router.post("/:nomDossierDBF/refresh", protect, admin, refreshReport);

router.get("/:nomDossierDBF", protect, admin, checkEntrepriseAccess, getReport);

export default router;