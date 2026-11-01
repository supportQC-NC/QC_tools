// backend/routes/proformaAnalyseRoutes.js
import express from "express";
import { getAnalyse } from "../controllers/proformaAnalyseController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Accès : module "analyse_proforma_admin" (lecture) + accès à l'entreprise.
// Aligné sur l'Analyse factures (facture_analyse_admin).
router.get(
  "/:nomDossierDBF",
  protect,
  checkModuleAccess("analyse_proforma_admin", "read"),
  checkEntrepriseAccess,
  getAnalyse,
);

export default router;
