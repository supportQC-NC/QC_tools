// backend/routes/documentsFtpRoutes.js
import express from "express";
import multer from "multer";
import {
  listerDocuments,
  telechargerDocument,
  televerserDocuments,
  supprimerDocument,
} from "../controllers/documentsFtpController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Module documents_ftp_admin + accès à la société, action par verbe.
const read = [
  protect,
  checkModuleAccess("documents_ftp_admin", "read"),
  checkEntrepriseAccess,
];
const write = [
  protect,
  checkModuleAccess("documents_ftp_admin", "write"),
  checkEntrepriseAccess,
];
const del = [
  protect,
  checkModuleAccess("documents_ftp_admin", "delete"),
  checkEntrepriseAccess,
];

// Upload en mémoire (25 Mo max par fichier, 10 fichiers max par envoi).
const uploadFichiers = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
}).array("fichiers", 10);

router.get("/:nomDossierDBF", read, listerDocuments);
router.get("/:nomDossierDBF/telecharger", read, telechargerDocument);
router.post("/:nomDossierDBF/televerser", write, uploadFichiers, televerserDocuments);
router.delete("/:nomDossierDBF", del, supprimerDocument);

export default router;
