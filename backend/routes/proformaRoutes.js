import express from "express";
import {
  getProformas,
  getProformaByNumfact,
  searchProformas,
  getRepresentants,
  getProformasStructure,
  getProformasByTiers,
  invalidateCache,
  getCacheStats,
  saveProformaDat,
} from "../controllers/proformaController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Cache stats (admin) - AVANT les routes avec paramètres
router.get("/cache-stats", protect, admin, getCacheStats);

// Liste des proformas avec pagination et filtres
router.get(
  "/:nomDossierDBF",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("proforma", "read"),
  getProformas,
);

// Structure/métadonnées des fichiers DBF (proforma + prodet)
router.get(
  "/:nomDossierDBF/structure",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("proforma", "read"),
  getProformasStructure,
);

// Recherche de proformas
router.get(
  "/:nomDossierDBF/search",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("proforma", "read"),
  searchProformas,
);

// Liste des représentants distincts
router.get(
  "/:nomDossierDBF/representants",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("proforma", "read"),
  getRepresentants,
);

// Proformas par tiers/client
router.get(
  "/:nomDossierDBF/tiers/:tiers",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("proforma", "read"),
  getProformasByTiers,
);

// Enregistrer fichier .dat sur le serveur (AVANT la route générique /:numfact)
router.post(
  "/:nomDossierDBF/:numfact/save-dat",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("proforma", "read"),
  saveProformaDat,
);

// Détail d'une proforma par NUMFACT - DOIT RESTER EN DERNIER (route générique)
router.get(
  "/:nomDossierDBF/:numfact",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("proforma", "read"),
  getProformaByNumfact,
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