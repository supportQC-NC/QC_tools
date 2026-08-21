// backend/routes/bipageRoutes.js
import express from "express";
import multer from "multer";
import {
  getBipages,
  updateBipage,
  exportCsv,
  recommencerZone,
  listProformasBipage,
  importProformasBipage,
  modeleExcelBipage,
  importExcelBipage,
} from "../controllers/bipageController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("bipage", "read");
const canWrite = checkModuleAccess("bipage", "write");

// Upload Excel en mémoire (5 Mo max, 1 fichier). Le NOM du fichier porte
// l'agent / la zone / l'emplacement : il ne doit pas être perdu.
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("file");

// Routes littérales / spécifiques d'abord, puis paramétrées.
router.get("/:entrepriseId/export", protect, canRead, checkEntrepriseAccess, exportCsv);

router.post("/:entrepriseId/recommencer", protect, canWrite, checkEntrepriseAccess, recommencerZone);

// ─── Import depuis les proformas de l'ERP ─────────────────────────────────
router.get("/:entrepriseId/proformas", protect, canRead, checkEntrepriseAccess, listProformasBipage);
router.post("/:entrepriseId/import-proformas", protect, canWrite, checkEntrepriseAccess, importProformasBipage);

// ─── Import depuis un fichier Excel ───────────────────────────────────────
router.get("/:entrepriseId/modele-excel", protect, canRead, checkEntrepriseAccess, modeleExcelBipage);
router.post("/:entrepriseId/import-excel", protect, canWrite, checkEntrepriseAccess, uploadExcel, importExcelBipage);

router.get("/:entrepriseId", protect, canRead, checkEntrepriseAccess, getBipages);

router.put("/:entrepriseId/:id", protect, canWrite, checkEntrepriseAccess, updateBipage);

export default router;