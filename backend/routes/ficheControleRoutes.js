// backend/routes/ficheControleRoutes.js
import express from "express";
import {
  getFiches,
  scanMaintenant,
  statutSurveillance,
  demarrerSurveillance,
  arreterSurveillance,
  reimprimer,
  telechargerPdf,
  supprimerFiche,
} from "../controllers/ficheControleController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("fiches_controle_admin", "read");
const canWrite = checkModuleAccess("fiches_controle_admin", "write");
const canDelete = checkModuleAccess("fiches_controle_admin", "delete");

// ----- Contrôle de la surveillance (global) -----
router.get("/watch/status", protect, canRead, statutSurveillance);
router.post("/watch/start", protect, canWrite, demarrerSurveillance);
router.post("/watch/stop", protect, canWrite, arreterSurveillance);

router.get("/:entrepriseId", protect, canRead, checkEntrepriseAccess, getFiches);

router.post("/:entrepriseId/scan", protect, canWrite, checkEntrepriseAccess, scanMaintenant);

router.post("/:entrepriseId/:id/reprint", protect, canWrite, checkEntrepriseAccess, reimprimer);

router.get("/:entrepriseId/:id/pdf", protect, canRead, checkEntrepriseAccess, telechargerPdf);

router.delete("/:entrepriseId/:id", protect, canDelete, checkEntrepriseAccess, supprimerFiche);

export default router;