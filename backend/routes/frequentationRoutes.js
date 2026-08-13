// backend/routes/frequentationRoutes.js
//
// Module « Fréquentation du magasin » (analyse des plages horaires depuis les
// factures éditées). Scopé société par :nomDossierDBF.
import express from "express";
import {
  getAnalyse,
  exportExcel,
} from "../controllers/frequentationController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("frequentation_admin", "read");

router.get("/:nomDossierDBF/excel", protect, checkEntrepriseAccess, canRead, exportExcel);
router.get("/:nomDossierDBF", protect, checkEntrepriseAccess, canRead, getAnalyse);

export default router;
