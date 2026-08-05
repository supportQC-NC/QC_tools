// backend/routes/changementPrixRoutes.js
import express from "express";
import {
  getChangements,
  exportExcel,
  genererEtiquettes,
} from "../controllers/changementPrixController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("changement_prix", "read");

// Tableau des changements de prix de vente (société + date).
router.get("/:nomDossierDBF", protect, checkEntrepriseAccess, canRead, getChangements);

// Rapport Excel.
router.get("/:nomDossierDBF/excel", protect, checkEntrepriseAccess, canRead, exportExcel);

// PDF d'étiquettes standard des articles dont le prix a changé.
router.post("/:nomDossierDBF/etiquettes", protect, checkEntrepriseAccess, canRead, genererEtiquettes);

export default router;
