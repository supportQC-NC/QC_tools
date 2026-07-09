// backend/routes/commerciauxRoutes.js
import express from "express";
import {
  getCommerciaux,
  getCommerciauxFull,
  getCommercialDetail,
  refreshCommerciaux,
} from "../controllers/commerciauxController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("commerciaux_admin", "read");

// Liste des commerciaux + KPI agrégés
router.get("/:nomDossierDBF", protect, canRead, checkEntrepriseAccess, getCommerciaux);

// Analyse complète (avec clients) — AVANT la route générique /:code
router.get("/:nomDossierDBF/full", protect, canRead, checkEntrepriseAccess, getCommerciauxFull);

// Invalidation du cache — AVANT la route générique /:code
router.post("/:nomDossierDBF/refresh", protect, canRead, checkEntrepriseAccess, refreshCommerciaux);

// Détail d'un commercial — DOIT RESTER EN DERNIER (route générique)
router.get("/:nomDossierDBF/:code", protect, canRead, checkEntrepriseAccess, getCommercialDetail);

export default router;