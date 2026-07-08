// backend/routes/analyseCaRoutes.js
import express from "express";
import {
  getApercu,
  genererRapport,
} from "../controllers/analyseCaController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Génération du fichier .xlsx (13 onglets) pour le mois de coupure choisi.
router.post(
  "/:nomDossierDBF/generer",
  protect,
  admin,
  checkEntrepriseAccess,
  genererRapport,
);

// Aperçu (période, KPIs, onglets) pour le dashboard.
router.get(
  "/:nomDossierDBF",
  protect,
  admin,
  checkEntrepriseAccess,
  getApercu,
);

export default router;