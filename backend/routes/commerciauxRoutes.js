// backend/routes/commerciauxRoutes.js
import express from "express";
import {
  getCommerciaux,
  getCommerciauxFull,
  getCommercialDetail,
  refreshCommerciaux,
} from "../controllers/commerciauxController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Liste des commerciaux + KPI agrégés
router.get(
  "/:nomDossierDBF",
  protect,
  admin,
  checkEntrepriseAccess,
  getCommerciaux,
);

// Analyse complète (avec clients) — AVANT la route générique /:code
router.get(
  "/:nomDossierDBF/full",
  protect,
  admin,
  checkEntrepriseAccess,
  getCommerciauxFull,
);

// Invalidation du cache — AVANT la route générique /:code
router.post(
  "/:nomDossierDBF/refresh",
  protect,
  admin,
  checkEntrepriseAccess,
  refreshCommerciaux,
);

// Détail d'un commercial — DOIT RESTER EN DERNIER (route générique)
router.get(
  "/:nomDossierDBF/:code",
  protect,
  admin,
  checkEntrepriseAccess,
  getCommercialDetail,
);

export default router;