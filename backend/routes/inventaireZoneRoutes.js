// backend/routes/inventaireZoneRoutes.js
import express from "express";
import {
  initInventaireZone,
  biperZone,
  getActiveSession,
  getProgress,
  getHistorique,
  setPhaseManuelle,
  deleteSession,
} from "../controllers/inventaireZoneController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Toutes les routes : admin only + accès entreprise (param :entrepriseId)

// Initialisation (archive l'actif puis crée)
router.post(
  "/init/:entrepriseId",
  protect,
  admin,
  checkEntrepriseAccess,
  initInventaireZone,
);

// Bip d'un code-barres
router.post(
  "/:entrepriseId/bip",
  protect,
  admin,
  checkEntrepriseAccess,
  biperZone,
);

// Session active détaillée
router.get(
  "/:entrepriseId/active",
  protect,
  admin,
  checkEntrepriseAccess,
  getActiveSession,
);

// Progression légère (% global + par phase)
router.get(
  "/:entrepriseId/progress",
  protect,
  admin,
  checkEntrepriseAccess,
  getProgress,
);

// Historique des sessions archivées
router.get(
  "/:entrepriseId/historique",
  protect,
  admin,
  checkEntrepriseAccess,
  getHistorique,
);

// Correction manuelle d'une phase
router.put(
  "/:entrepriseId/zone/:code/:phase",
  protect,
  admin,
  checkEntrepriseAccess,
  setPhaseManuelle,
);

// Suppression d'une session archivée
router.delete(
  "/:entrepriseId/:id",
  protect,
  admin,
  checkEntrepriseAccess,
  deleteSession,
);

export default router;