// backend/routes/topVentesRoutes.js
//
// Routes de l'outil « Top Ventes » (groupe Commerciaux).
// Chaîne : protect -> checkEntrepriseAccess -> checkModuleAccess("commerciaux_outils","read").
import express from "express";
import { synthese, detail } from "../controllers/topVentesController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const read = [
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commerciaux_outils", "read"),
];

router.get("/:nomDossierDBF/synthese", ...read, synthese);
router.get("/:nomDossierDBF/detail", ...read, detail);

export default router;
