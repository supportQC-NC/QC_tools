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

router.get("/mobile/en-cours", protect, canRead, getMobileReceptionsEnCours);
router.get("/:id/signalement/:sigId/photo", protect, canRead, getSignalementPhoto);

export default router;