// backend/routes/bipageRoutes.js
import express from "express";
import multer from "multer";
import {
  getBipages,
  exportEcartsBipage,
  updateBipage,
  exportCsv,
  recommencerZone,
  listProformasBipage,
  apercuImportProformas,
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

// Les imports (Excel / proforma) sont pilotés depuis l'écran « Progression
// inventaire », qui relève du module `inventaire` : ces routes acceptent donc
// l'un OU l'autre droit. Le reste de l'écran « Détail des bipages » garde le
// droit `bipage` seul.
const canReadImport = checkModuleAccess(["inventaire", "bipage"], "read");
const canWriteImport = checkModuleAccess(["inventaire", "bipage"], "write");

// Upload Excel en mémoire (5 Mo max, 1 fichier).
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("file");

// Routes littérales / spécifiques d'abord, puis paramétrées.
router.get("/:entrepriseId/export", protect, canRead, checkEntrepriseAccess, exportCsv);

// Feuille d'écarts (PDF / Excel) — MÊME document que l'inventaire proforma.
router.get("/:entrepriseId/ecarts", protect, canReadImport, checkEntrepriseAccess, exportEcartsBipage);

router.post("/:entrepriseId/recommencer", protect, canWrite, checkEntrepriseAccess, recommencerZone);

// ─── Import depuis les proformas de l'ERP ─────────────────────────────────
router.get("/:entrepriseId/proformas", protect, canReadImport, checkEntrepriseAccess, listProformasBipage);
// Aperçu AVANT écriture : impact article par article + état des phases de la zone.
router.post("/:entrepriseId/proformas/apercu", protect, canReadImport, checkEntrepriseAccess, apercuImportProformas);
router.post("/:entrepriseId/import-proformas", protect, canWriteImport, checkEntrepriseAccess, importProformasBipage);

// ─── Import depuis un fichier Excel ───────────────────────────────────────
router.get("/:entrepriseId/modele-excel", protect, canReadImport, checkEntrepriseAccess, modeleExcelBipage);
router.post("/:entrepriseId/import-excel", protect, canWriteImport, checkEntrepriseAccess, uploadExcel, importExcelBipage);

router.get("/:entrepriseId", protect, canRead, checkEntrepriseAccess, getBipages);

router.put("/:entrepriseId/:id", protect, canWrite, checkEntrepriseAccess, updateBipage);

export default router;