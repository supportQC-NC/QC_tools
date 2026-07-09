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
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("inventaire", "read");
const canWrite = checkModuleAccess("inventaire", "write");
const canDelete = checkModuleAccess("inventaire", "delete");

// Toutes les routes : module "inventaire" + accès entreprise (param :entrepriseId)

// Initialisation (archive l'actif puis crée)
router.post("/init/:entrepriseId", protect, canWrite, checkEntrepriseAccess, initInventaireZone);

// Bip d'un code-barres
router.post("/:entrepriseId/bip", protect, canWrite, checkEntrepriseAccess, biperZone);

// Session active détaillée
router.get("/:entrepriseId/active", protect, canRead, checkEntrepriseAccess, getActiveSession);

// Progression légère (% global + par phase)
router.get("/:entrepriseId/progress", protect, canRead, checkEntrepriseAccess, getProgress);

// Historique des sessions archivées
router.get("/:entrepriseId/historique", protect, canRead, checkEntrepriseAccess, getHistorique);

// Correction manuelle d'une phase
router.put("/:entrepriseId/zone/:code/:phase", protect, canWrite, checkEntrepriseAccess, setPhaseManuelle);

// Suppression d'une session archivée
router.delete("/:entrepriseId/:id", protect, canDelete, checkEntrepriseAccess, deleteSession);

export default router;