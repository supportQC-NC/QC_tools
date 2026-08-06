// backend/routes/balancesRoutes.js
import express from "express";
import {
  getBalancesReport,
  exportExcel,
} from "../controllers/balancesController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("balances_clients", "read");

router.get("/:nomDossierDBF", protect, checkEntrepriseAccess, canRead, getBalancesReport);
router.get("/:nomDossierDBF/excel", protect, checkEntrepriseAccess, canRead, exportExcel);

export default router;
