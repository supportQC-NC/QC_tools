// backend/routes/articleRoutes.js
import express from "express";
import multer from "multer";
import {
  getArticles,
  getArticleByNart,
  getArticleByGencod,
  getArticlesStructure,
  searchArticles,
  getGroupes,
  getGism1,
  getGismNiveau,
  getTgcRates,
  invalidateCache,
  getCacheStats,
  getAdjacentArticles,
} from "../controllers/articleController.js";
import {
  exportGisements,
  genererEtiquettesGisement,
  genererEtiquettesDepuisExcel,
} from "../controllers/gisementsExportController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Upload en mémoire pour l'import Excel d'étiquettes (5 Mo max, 1 fichier).
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("file");

// Cache stats (admin) - AVANT les routes avec paramètres
router.get("/cache-stats", protect, admin, getCacheStats);

// Export Excel des gisements (GISM1..GISM5) — outil admin dédié
router.get(
  "/:nomDossierDBF/export-gisements",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("export_gisements_admin", "read"),
  exportGisements,
);

// Codes distincts d'un niveau de gisement (GISM1..GISM5) — pour le sélecteur
router.get(
  "/:nomDossierDBF/gism/:niveau",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("export_gisements_admin", "read"),
  getGismNiveau,
);

// Génération PDF d'étiquettes de gisement (A8, Code128)
router.post(
  "/:nomDossierDBF/gisement-etiquettes",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("export_gisements_admin", "read"),
  genererEtiquettesGisement,
);

// Étiquettes (A8, Code128/QR) à partir d'un Excel importé (1 colonne = code)
router.post(
  "/:nomDossierDBF/etiquettes-excel",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("export_gisements_admin", "read"),
  uploadExcel,
  genererEtiquettesDepuisExcel,
);

// Liste des articles avec pagination et filtres avancés
router.get(
  "/:nomDossierDBF",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getArticles,
);

// Structure/métadonnées du fichier DBF
router.get(
  "/:nomDossierDBF/structure",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getArticlesStructure,
);

// Recherche d'articles
router.get(
  "/:nomDossierDBF/search",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  searchArticles,
);

// Liste des groupes/familles (partagée avec le générateur d'étiquettes)
router.get(
  "/:nomDossierDBF/groupes",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess(["stock", "etiquettes"], "read"),
  getGroupes,
);

// Liste des GISM1 (gisements) (partagée avec le générateur d'étiquettes)
router.get(
  "/:nomDossierDBF/gism1",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess(["stock", "etiquettes"], "read"),
  getGism1,
);

// Liste des taux TGC distincts
router.get(
  "/:nomDossierDBF/tgc-rates",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getTgcRates,
);

// APRÈS
router.get(
  "/:nomDossierDBF/adjacent/:nart",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getAdjacentArticles,
);
// Article par code NART
router.get(
  "/:nomDossierDBF/code/:nart",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getArticleByNart,
);

// Article par code barre GENCOD
router.get(
  "/:nomDossierDBF/gencod/:gencod",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("stock", "read"),
  getArticleByGencod,
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
