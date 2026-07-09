// backend/routes/factureAnalyseRoutes.js
import express from "express";
import { getReport } from "../controllers/factureAnalyseController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Accès : module "facture_analyse_admin" (lecture) + accès à l'entreprise.
// Aligné sur les autres écrans d'analyse (commerciaux, filiales, etc.).
router.get(
  "/:nomDossierDBF",
  protect,
  checkModuleAccess("facture_analyse_admin", "read"),
  checkEntrepriseAccess,
  getReport,
);

export default router;