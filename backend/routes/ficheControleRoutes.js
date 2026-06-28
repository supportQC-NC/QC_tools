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
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// ----- Contrôle de la surveillance (global, admin) -----
router.get("/watch/status", protect, admin, statutSurveillance);
router.post("/watch/start", protect, admin, demarrerSurveillance);
router.post("/watch/stop", protect, admin, arreterSurveillance);

router.get(
  "/:entrepriseId",
  protect,
  admin,
  checkEntrepriseAccess,
  getFiches,
);

router.post(
  "/:entrepriseId/scan",
  protect,
  admin,
  checkEntrepriseAccess,
  scanMaintenant,
);

router.post(
  "/:entrepriseId/:id/reprint",
  protect,
  admin,
  checkEntrepriseAccess,
  reimprimer,
);

router.get(
  "/:entrepriseId/:id/pdf",
  protect,
  admin,
  checkEntrepriseAccess,
  telechargerPdf,
);

router.delete(
  "/:entrepriseId/:id",
  protect,
  admin,
  checkEntrepriseAccess,
  supprimerFiche,
);

export default router;