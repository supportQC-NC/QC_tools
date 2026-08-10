// backend/routes/configRapportsRoutes.js
import express from "express";
import multer from "multer";
import {
  listResource,
  createResource,
  updateResource,
  deleteResource,
  seedConfig,
  syncGroupesPrioritaires,
  exportResource,
  importResource,
} from "../controllers/configRapportsController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// La config rapports vit désormais DANS la config entreprise -> même droit.
const canRead = checkModuleAccess("entreprises_admin", "read");
const canWrite = checkModuleAccess("entreprises_admin", "write");

// Import initial (bouton prod) — placé AVANT /:resource pour ne pas être capté.
router.post("/seed", protect, canWrite, seedConfig);

// Complète les groupes prioritaires depuis article.dbf d'une société.
// Placé AVANT /:resource pour rester lisible (2 segments, donc non capté).
router.post(
  "/groupes-prioritaires/sync-articles",
  protect,
  canWrite,
  syncGroupesPrioritaires,
);

// Aller-retour Excel (groupes spéciaux / prioritaires) — 2 segments, donc
// jamais capté par les routes /:resource ci-dessous.
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("file");

router.get("/:resource/export", protect, canRead, exportResource);
router.post("/:resource/import", protect, canWrite, uploadExcel, importResource);

router.get("/:resource", protect, canRead, listResource);
router.post("/:resource", protect, canWrite, createResource);
router.put("/:resource/:id", protect, canWrite, updateResource);
router.delete("/:resource/:id", protect, canWrite, deleteResource);

export default router;
