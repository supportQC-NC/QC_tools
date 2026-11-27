// backend/routes/localisationInventaireRoutes.js
//
// Module LOCALISATION INVENTAIRE — module de permission À PART ENTIÈRE
// (`localisation_inventaire`, décision client du 24/11/2026), distinct du
// module `inventaire` : il sera aussi porté sur l'app mobile.

import express from "express";
import {
  getInventaires,
  getEmplacements,
  rechercher,
  getSuggestions,
  getPlan,
  renommerInventaire,
} from "../controllers/localisationInventaireController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const read = [
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("localisation_inventaire", "read"),
];
const write = [
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("localisation_inventaire", "write"),
];

router.get("/:entrepriseId/inventaires", read, getInventaires);
router.get(
  "/:entrepriseId/inventaires/:sessionId/emplacements",
  read,
  getEmplacements,
);
router.get(
  "/:entrepriseId/inventaires/:sessionId/recherche",
  read,
  rechercher,
);
// Suggestions de la barre de recherche (code partiel ou mots de la désignation)
router.get(
  "/:entrepriseId/inventaires/:sessionId/suggestions",
  read,
  getSuggestions,
);
// Plan schématique : emplacements → allées → zones, ordre de parcours
router.get("/:entrepriseId/inventaires/:sessionId/plan", read, getPlan);
// Renommage du NOM d'affichage d'un inventaire (jamais le slug du dossier).
router.patch(
  "/:entrepriseId/inventaires/:sessionId/nom",
  write,
  renommerInventaire,
);

export default router;
