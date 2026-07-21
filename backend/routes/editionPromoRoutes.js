// backend/routes/editionPromoRoutes.js
import express from "express";
import { genererPromo } from "../controllers/editionPromoController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Génération du fichier CSV promo (proforma -> collect_sec).
// "write" : l'action crée un fichier sur le partage collect_sec.
router.post(
  "/:nomDossierDBF/generer",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("edition_promo", "write"),
  genererPromo,
);

export default router;
