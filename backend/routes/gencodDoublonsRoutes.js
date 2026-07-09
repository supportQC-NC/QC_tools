// backend/routes/gencodDoublonsRoutes.js
import express from "express";
import {
  getReport,
  refreshReport,
} from "../controllers/gencodDoublonsController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("gencod_doublons_admin", "read");

router.post("/:nomDossierDBF/refresh", protect, canRead, refreshReport);

router.get("/:nomDossierDBF", protect, canRead, checkEntrepriseAccess, getReport);

export default router;