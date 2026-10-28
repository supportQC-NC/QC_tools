// backend/routes/analyseCaRoutes.js
import express from "express";
import {
  getApercu,
  genererRapport,
} from "../controllers/analyseCaController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("analyse_ca_admin", "read");

// Génération du fichier .xlsx (13 onglets) pour le mois de coupure choisi.
router.post(
  "/:nomDossierDBF/generer",
  protect,
  canRead,
  checkEntrepriseAccess,
  genererRapport,
);

// Aperçu (période, KPIs, graphiques, onglets) calculé depuis le DBF.
// ⚠️ Plus consommé par le web depuis que l'écran Analyse CA lit les matrices
// Excel du Rcommun (/api/analyse-ca-matrices). Conservé le temps de valider le
// nouvel écran — à retirer avec analyseCaGenerator.apercu() si confirmé.
router.get(
  "/:nomDossierDBF",
  protect,
  canRead,
  checkEntrepriseAccess,
  getApercu,
);

export default router;