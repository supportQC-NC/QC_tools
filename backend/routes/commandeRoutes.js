// backend/routes/commandeRoutes.js
import express from "express";
import {
  getCommandes,
  getCommandeByNumcde,
  getCommandesByFournisseur,
  getCommandesByArticle,
  searchCommandes,
  getCommandeDetails,
  getCommandesStructure,
  getFournisseursCommandes,
  getBateaux,
  getEtatsCommandes,
  getAdjacentCommandes,
  invalidateCache,
  getCacheStats,
} from "../controllers/commandeController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Cache stats (admin) - AVANT les routes avec paramètres
router.get("/cache-stats", protect, admin, getCacheStats);

// Liste des commandes avec pagination et filtres avancés
router.get(
  "/:nomDossierDBF",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  getCommandes,
);

// Structure/métadonnées des fichiers DBF (cmdref + cmdetail)
router.get(
  "/:nomDossierDBF/structure",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  getCommandesStructure,
);

// Recherche de commandes
router.get(
  "/:nomDossierDBF/search",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  searchCommandes,
);

// Liste des fournisseurs ayant des commandes
router.get(
  "/:nomDossierDBF/fournisseurs",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  getFournisseursCommandes,
);

// Liste des bateaux distincts
router.get(
  "/:nomDossierDBF/bateaux",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  getBateaux,
);

// Liste des états distincts
router.get(
  "/:nomDossierDBF/etats",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  getEtatsCommandes,
);

// Navigation précédent/suivant
router.get(
  "/:nomDossierDBF/adjacent/:numcde",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  getAdjacentCommandes,
);

// Commande par numéro (entête + détails liés)
router.get(
  "/:nomDossierDBF/code/:numcde",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  getCommandeByNumcde,
);

// Détails (lignes) d'une commande
router.get(
  "/:nomDossierDBF/details/:numcde",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  getCommandeDetails,
);

// Commandes d'un fournisseur
router.get(
  "/:nomDossierDBF/fournisseur/:fourn",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  getCommandesByFournisseur,
);

// Commandes contenant un article (recherche par NART dans cmdetail)
router.get(
  "/:nomDossierDBF/article/:nart",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("commandes", "read"),
  getCommandesByArticle,
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