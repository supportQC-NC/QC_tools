// backend/routes/factureAnalyseRoutes.js
import express from "express";
import { getReport } from "../controllers/factureAnalyseController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";
import { checkAnalyseAccess } from "../middleware/accessControl.js";

const router = express.Router();

// Accès : droit d'analyse « factures » (admins ET users) + accès à l'entreprise.
router.get(
  "/:nomDossierDBF",
  protect,
  checkAnalyseAccess("factures"),
  checkEntrepriseAccess,
  getReport,
);

export default router;