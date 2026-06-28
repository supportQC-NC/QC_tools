// backend/routes/fournissRoutes.js
import express from "express";
import {
  getFournisseurs,
  getFournisseurByCode,
  getArticlesByFournisseur,
  searchFournisseurs,
  getFournisseursStructure,
  invalidateCache,
} from "../controllers/fournissController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Liste des fournisseurs
router.get(
  "/:nomDossierDBF",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getFournisseurs
);

// Structure
router.get(
  "/:nomDossierDBF/structure",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getFournisseursStructure
);

// Recherche
router.get(
  "/:nomDossierDBF/search",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  searchFournisseurs
);

// Détail fournisseur
router.get(
  "/:nomDossierDBF/code/:fourn",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getFournisseurByCode
);

// Articles liés à ce fournisseur
router.get(
  "/:nomDossierDBF/code/:fourn/articles",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getArticlesByFournisseur
);

// Invalider cache
router.post(
  "/:nomDossierDBF/invalidate-cache",
  protect,
  admin,
  checkEntrepriseAccess,
  invalidateCache
);

export default router;