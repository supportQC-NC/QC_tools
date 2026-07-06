// backend/routes/commerciauxRoutes.js
import express from "express";
import {
  getCommerciaux,
  getCommerciauxFull,
  getCommercialDetail,
  refreshCommerciaux,
} from "../controllers/commerciauxController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";
import { checkAnalyseAccess } from "../middleware/accessControl.js";

const router = express.Router();

// Accès : droit d'analyse « commerciaux » (admins ET users) + accès à l'entreprise.
const analyse = checkAnalyseAccess("commerciaux");

// Liste des commerciaux + KPI agrégés
router.get("/:nomDossierDBF", protect, analyse, checkEntrepriseAccess, getCommerciaux);

// Analyse complète (avec clients) — AVANT la route générique /:code
router.get(
  "/:nomDossierDBF/full",
  protect,
  analyse,
  checkEntrepriseAccess,
  getCommerciauxFull,
);

// Invalidation du cache — AVANT la route générique /:code
router.post(
  "/:nomDossierDBF/refresh",
  protect,
  analyse,
  checkEntrepriseAccess,
  refreshCommerciaux,
);

// Détail d'un commercial — DOIT RESTER EN DERNIER (route générique)
router.get(
  "/:nomDossierDBF/:code",
  protect,
  analyse,
  checkEntrepriseAccess,
  getCommercialDetail,
);

export default router;