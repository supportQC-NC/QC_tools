// backend/routes/suiviEntreesRoutes.js
import express from "express";
import {
  getEntrees,
  getReservations,
  exportExcel,
} from "../controllers/suiviEntreesController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("suivi_entrees", "read");

router.get("/:nomDossierDBF", protect, checkEntrepriseAccess, canRead, getEntrees);
router.get("/:nomDossierDBF/reservations", protect, checkEntrepriseAccess, canRead, getReservations);
router.get("/:nomDossierDBF/excel", protect, checkEntrepriseAccess, canRead, exportExcel);

export default router;
