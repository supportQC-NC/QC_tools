// backend/routes/verificationInventaireRoutes.js
//
// VÉRIFICATION POINT ROUGE — module de permission à part entière
// (`verification_inventaire`, 24/11/2026), distinct d'`inventaire` et de
// `bipage` : il sera aussi porté sur l'app mobile.

import express from "express";
import {
  getContexte,
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
router.get("/:entrepriseId/verifier", read, verifierCode);
router.post("/:entrepriseId/confirmer", write, confirmerCode);
router.post("/:entrepriseId/ajouter", write, ajouterAuBipage);

export default router;
