// backend/routes/resaEntreesRoutes.js
import express from "express";
import {
  getResaEntreesReport,
  exportExcel,
} from "../controllers/resaEntreesController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("resa_entrees", "read");

router.get("/:nomDossierDBF", protect, checkEntrepriseAccess, canRead, getResaEntreesReport);
router.get("/:nomDossierDBF/excel", protect, checkEntrepriseAccess, canRead, exportExcel);

export default router;
