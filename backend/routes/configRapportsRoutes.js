// backend/routes/configRapportsRoutes.js
import express from "express";
import {
  listResource,
  createResource,
  updateResource,
  deleteResource,
  seedConfig,
} from "../controllers/configRapportsController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// La config rapports vit désormais DANS la config entreprise -> même droit.
const canRead = checkModuleAccess("entreprises_admin", "read");
const canWrite = checkModuleAccess("entreprises_admin", "write");

// Import initial (bouton prod) — placé AVANT /:resource pour ne pas être capté.
router.post("/seed", protect, canWrite, seedConfig);

router.get("/:resource", protect, canRead, listResource);
router.post("/:resource", protect, canWrite, createResource);
router.put("/:resource/:id", protect, canWrite, updateResource);
router.delete("/:resource/:id", protect, canWrite, deleteResource);

export default router;
