// backend/routes/bipageRoutes.js
import express from "express";
import {
  getBipages,
  updateBipage,
  exportCsv,
  recommencerZone,
} from "../controllers/bipageController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("bipage", "read");
const canWrite = checkModuleAccess("bipage", "write");

// Routes littérales / spécifiques d'abord, puis paramétrées.
router.get("/:entrepriseId/export", protect, canRead, checkEntrepriseAccess, exportCsv);

router.post("/:entrepriseId/recommencer", protect, canWrite, checkEntrepriseAccess, recommencerZone);

router.get("/:entrepriseId", protect, canRead, checkEntrepriseAccess, getBipages);

router.put("/:entrepriseId/:id", protect, canWrite, checkEntrepriseAccess, updateBipage);

export default router;