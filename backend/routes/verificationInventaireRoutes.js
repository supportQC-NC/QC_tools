// backend/routes/verificationInventaireRoutes.js
//
// VÉRIFICATION POINT ROUGE — module de permission à part entière
// (`verification_inventaire`, 24/11/2026), distinct d'`inventaire` et de
// `bipage`. Deux clients : l'écran web /admin/verification-point-rouge et
// l'app collecteur (VerificationPointRougeScreen, 25/11/2026) — mêmes routes.

import express from "express";
import {
  getContexte,
  resoudreRayon,
  verifierCode,
  confirmerCode,
  ajouterAuBipage,
} from "../controllers/verificationInventaireController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const read = [
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("verification_inventaire", "read"),
];
const write = [
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("verification_inventaire", "write"),
];

router.get("/:entrepriseId/contexte", read, getContexte);
router.get("/:entrepriseId/rayon", read, resoudreRayon);
router.get("/:entrepriseId/verifier", read, verifierCode);
router.post("/:entrepriseId/confirmer", write, confirmerCode);
router.post("/:entrepriseId/ajouter", write, ajouterAuBipage);

export default router;
