// backend/routes/receptionSuiviRoutes.js
import express from "express";
import {
  getMobileReceptionsEnCours,
  getSignalementPhoto,
} from "../controllers/receptionSuiviController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();
const canRead = checkModuleAccess("reception", "read");
const canReadWeb = checkModuleAccess("reception_suivi_admin", "read");

// MOBILE (module reception) et WEB (module reception_suivi_admin) : même handler.
router.get("/mobile/en-cours", protect, canRead, getMobileReceptionsEnCours);
router.get("/en-cours", protect, canReadWeb, getMobileReceptionsEnCours);
router.get("/:id/signalement/:sigId/photo", protect, canRead, getSignalementPhoto);

export default router;