// backend/routes/etiquetteRoutes.js
import express from "express";
import { genererEtiquettes } from "../controllers/etiquetteController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Génération du PDF d'étiquettes (proforma ou NART manuels)
router.post(
  "/:nomDossierDBF/generer",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("etiquettes", "read"),
  genererEtiquettes,
);

export default router;