// backend/routes/bipageRoutes.js
import express from "express";
import {
  getBipages,
  updateBipage,
  exportCsv,
  recommencerZone,
} from "../controllers/bipageController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Routes littérales / spécifiques d'abord, puis paramétrées.
router.get(
  "/:entrepriseId/export",
  protect,
  admin,
  checkEntrepriseAccess,
  exportCsv,
);

router.post(
  "/:entrepriseId/recommencer",
  protect,
  admin,
  checkEntrepriseAccess,
  recommencerZone,
);

router.get("/:entrepriseId", protect, admin, checkEntrepriseAccess, getBipages);

router.put(
  "/:entrepriseId/:id",
  protect,
  admin,
  checkEntrepriseAccess,
  updateBipage,
);

export default router;