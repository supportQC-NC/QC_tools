// backend/routes/factureRoutes.js
import express from "express";
import {
  getFactures,
  getFactureByNumfact,
  searchFactures,
  getRepresentants,
  getFacturesStructure,
  getFacturesByTiers,
  saveFactureDat,
  invalidateCache,
  getCacheStats,
} from "../controllers/factureController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Cache stats (admin) - AVANT les routes avec paramètres
router.get("/cache-stats", protect, admin, getCacheStats);

// Liste des factures avec pagination et filtres
router.get(
  "/:nomDossierDBF",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("facture", "read"),
  getFactures,
);

// Structure/métadonnées des fichiers DBF
router.get(
  "/:nomDossierDBF/structure",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("facture", "read"),
  getFacturesStructure,
);

// Recherche
router.get(
  "/:nomDossierDBF/search",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("facture", "read"),
  searchFactures,
);

// Représentants distincts
router.get(
  "/:nomDossierDBF/representants",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("facture", "read"),
  getRepresentants,
);

// Factures par tiers
router.get(
  "/:nomDossierDBF/tiers/:tiers",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("facture", "read"),
  getFacturesByTiers,
);

// Enregistrer .dat sur le serveur (AVANT la route générique /:numfact)
router.post(
  "/:nomDossierDBF/:numfact/save-dat",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("facture", "read"),
  saveFactureDat,
);

// Détail d'une facture par NUMFACT - DOIT RESTER EN DERNIER (route générique)
router.get(
  "/:nomDossierDBF/:numfact",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("facture", "read"),
  getFactureByNumfact,
);

// Invalider le cache (admin)
router.post(
  "/:nomDossierDBF/invalidate-cache",
  protect,
  admin,
  checkEntrepriseAccess,
  invalidateCache,
);

export default router;