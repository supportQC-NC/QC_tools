// backend/routes/receptionSuiviRoutes.js
import express from "express";
import {
  getMobileReceptionsEnCours,
  getReceptionProgress,
  getCommandesAgregats,
  getRecentesControlees,
  downloadFichierReception,
  getSignalementPhoto,
} from "../controllers/receptionSuiviController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkModuleAccess,
  checkEntrepriseAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();
const canRead = checkModuleAccess("reception", "read");
const canReadWeb = checkModuleAccess("reception_suivi_admin", "read");

// MOBILE (module reception) et WEB (module reception_suivi_admin) : même handler.
router.get("/mobile/en-cours", protect, canRead, getMobileReceptionsEnCours);
router.get("/en-cours", protect, canReadWeb, getMobileReceptionsEnCours);

// Progression des contrôles en cours d'une entreprise (superposée à /a-controler)
router.get("/mobile/progress/:nomDossierDBF", protect, canRead, checkEntrepriseAccess, getReceptionProgress);
router.get("/progress/:nomDossierDBF", protect, canReadWeb, checkEntrepriseAccess, getReceptionProgress);
// Agrégats par commande (web) : nb articles, total unités, nouveautés
router.get("/agregats/:nomDossierDBF", protect, canReadWeb, checkEntrepriseAccess, getCommandesAgregats);
// 10 dernières réceptions terminées + téléchargement des fichiers (web)
router.get("/recentes/:nomDossierDBF", protect, canReadWeb, checkEntrepriseAccess, getRecentesControlees);
router.get("/:id/fichier/:filename", protect, canReadWeb, downloadFichierReception);
router.get("/:id/signalement/:sigId/photo", protect, canRead, getSignalementPhoto);

export default router;