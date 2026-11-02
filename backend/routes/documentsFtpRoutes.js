// backend/routes/documentsFtpRoutes.js
import express from "express";
import {
  listerDocuments,
  telechargerDocument,
} from "../controllers/documentsFtpController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Lecture seule : module documents_ftp_admin + accès à la société.
const read = [
  protect,
  checkModuleAccess("documents_ftp_admin", "read"),
  checkEntrepriseAccess,
];

router.get("/:nomDossierDBF", read, listerDocuments);
router.get("/:nomDossierDBF/telecharger", read, telechargerDocument);

export default router;
