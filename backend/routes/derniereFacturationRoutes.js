// backend/routes/derniereFacturationRoutes.js
import express from "express";
import {
  getRapport,
  refreshRapport,
} from "../controllers/derniereFacturationController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("derniere_facturation_admin", "read");

router.post("/:nomDossierDBF/refresh", protect, canRead, refreshRapport);

router.get("/:nomDossierDBF", protect, canRead, checkEntrepriseAccess, getRapport);

export default router;
