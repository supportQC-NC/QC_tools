// backend/routes/clientRoutes.js
import express from "express";
import {
  getClients,
  getClientByTiers,
  getCrossEntreprise,
  searchClients,
  getFilterValues,
  getRepresentants,
  getCategories,
  getClientsStructure,
  invalidateCache,
  getCacheStats,
} from "../controllers/clientController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Cache stats (admin) - AVANT les routes avec paramètres
router.get("/cache-stats", protect, admin, getCacheStats);

// Liste des clients avec pagination et filtres
router.get(
  "/:nomDossierDBF",
  protect, checkEntrepriseAccess, checkModuleAccess("client", "read"),
  getClients,
);

// Structure DBF
router.get(
  "/:nomDossierDBF/structure",
  protect, checkEntrepriseAccess, checkModuleAccess("client", "read"),
  getClientsStructure,
);

// Recherche
router.get(
  "/:nomDossierDBF/search",
  protect, checkEntrepriseAccess, checkModuleAccess("client", "read"),
  searchClients,
);

// Toutes les valeurs de filtres en un seul appel (optimisé)
router.get(
  "/:nomDossierDBF/filter-values",
  protect, checkEntrepriseAccess, checkModuleAccess("client", "read"),
  getFilterValues,
);

// Représentants distincts
router.get(
  "/:nomDossierDBF/representants",
  protect, checkEntrepriseAccess, checkModuleAccess("client", "read"),
  getRepresentants,
);

// Catégories clients
router.get(
  "/:nomDossierDBF/categories",
  protect, checkEntrepriseAccess, checkModuleAccess("client", "read"),
  getCategories,
);

// Cross-entreprise (AVANT /:tiers générique)
router.get(
  "/:nomDossierDBF/:tiers/cross-entreprise",
  protect, checkEntrepriseAccess, checkModuleAccess("client", "read"),
  getCrossEntreprise,
);

// Détail d'un client par TIERS - DOIT RESTER EN DERNIER
router.get(
  "/:nomDossierDBF/:tiers",
  protect, checkEntrepriseAccess, checkModuleAccess("client", "read"),
  getClientByTiers,
);

// Invalider le cache (admin)
router.post(
  "/:nomDossierDBF/invalidate-cache",
  protect, admin, checkEntrepriseAccess,
  invalidateCache,
);

export default router;