// backend/routes/rapportTgcRoutes.js
import express from "express";
import {
  getRapport,
  exportExcel,
} from "../controllers/rapportTgcController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("rapport_tgc", "read");

router.get("/:nomDossierDBF", protect, checkEntrepriseAccess, canRead, getRapport);
router.get("/:nomDossierDBF/excel", protect, checkEntrepriseAccess, canRead, exportExcel);

export default router;
