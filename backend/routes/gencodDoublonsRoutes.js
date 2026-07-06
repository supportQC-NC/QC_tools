// backend/routes/gencodDoublonsRoutes.js
import express from "express";
import {
  getReport,
  refreshReport,
} from "../controllers/gencodDoublonsController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";
import { checkAnalyseAccess } from "../middleware/accessControl.js";

const router = express.Router();

// Accès : droit d'analyse « doublonsGencode » (admins ET users).
const analyse = checkAnalyseAccess("doublonsGencode");

router.post("/:nomDossierDBF/refresh", protect, analyse, refreshReport);

router.get(
  "/:nomDossierDBF",
  protect,
  analyse,
  checkEntrepriseAccess,
  getReport,
);

export default router;