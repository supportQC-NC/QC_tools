// backend/routes/reapproMecalacRoutes.js
//
// Réappro « Mécalac » — analyse d'un entrepôt (S2..S5) vers le rayon (S1) et
// génération du .dat dans collect_sec. Même module de permission que le
// réappro classique (`reapro`) : c'est le même métier, le même fichier de
// sortie et les mêmes personnes.
import express from "express";
import {
  listerEntrepots,
  analyser,
  resoudre,
  genererFichier,
} from "../controllers/reapproMecalacController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Gardes réutilisées (même forme que les autres routeurs du dépôt).
const lecture = [
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("reapro", "read"),
];
const ecriture = [
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("reapro", "write"),
];

// Entrepôts sources de la société (noms de la fiche société + volumes)
router.get("/:entrepriseId/entrepots", ...lecture, listerEntrepots);

// Analyse : articles à descendre de l'entrepôt choisi
router.get("/:entrepriseId/analyse", ...lecture, analyser);

// Résolution d'un code saisi à la main (ajout d'une ligne)
router.post("/:entrepriseId/article", ...lecture, resoudre);

// Génération du fichier .dat dans collect_sec
router.post("/:entrepriseId/generer", ...ecriture, genererFichier);

export default router;
