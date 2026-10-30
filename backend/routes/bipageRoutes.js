// backend/routes/bipageRoutes.js
import express from "express";
import multer from "multer";
import {
  getBipages,
  getStatsZonesRetouchees,
  getStatsProformasZones,
  exportEcartsBipage,
  updateBipage,
  ajouterLigneBipage,
  exportCsv,
  recommencerZone,
  setStockFige,
  genererDatIntegration,
  getEmplacementsSpeciaux,
  getGisementsEmplacement,
  listProformasBipage,
  apercuImportProformas,
  importProformasBipage,
  ficheProformaImportee,
  modeleExcelBipage,
  importExcelBipage,
} from "../controllers/bipageController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("bipage", "read");
const canWrite = checkModuleAccess("bipage", "write");

// Les imports (Excel / proforma) sont pilotés depuis l'écran « Progression
// inventaire », qui relève du module `inventaire` : ces routes acceptent donc
// l'un OU l'autre droit. Le reste de l'écran « Détail des bipages » garde le
// droit `bipage` seul.
const canReadImport = checkModuleAccess(["inventaire", "bipage"], "read");
const canWriteImport = checkModuleAccess(["inventaire", "bipage"], "write");

// Upload Excel en mémoire (5 Mo max, 1 fichier).
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("file");

// Routes littérales / spécifiques d'abord, puis paramétrées.
// Classement des zones les plus retouchees a la main, par emplacement.
// AVANT "/:entrepriseId" n'est pas necessaire (chemin plus long), mais on la
// garde avec les autres routes nommees pour la lisibilite.
router.get("/:entrepriseId/stats-zones", protect, canRead, checkEntrepriseAccess, getStatsZonesRetouchees);

// Proformas intégrées par zone (tableau de bord inventaire) — même double
// droit que les imports : l'écran relève du module `inventaire`.
router.get("/:entrepriseId/stats-proformas-zones", protect, canReadImport, checkEntrepriseAccess, getStatsProformasZones);

router.get("/:entrepriseId/export", protect, canRead, checkEntrepriseAccess, exportCsv);

// Feuille d'écarts (PDF / Excel) — MÊME document que l'inventaire proforma.
router.get("/:entrepriseId/ecarts", protect, canReadImport, checkEntrepriseAccess, exportEcartsBipage);

router.post("/:entrepriseId/recommencer", protect, canWrite, checkEntrepriseAccess, recommencerZone);

// Figer / défiger le stock (photo de la base article pour la feuille d'écarts).
// Même double-droit que la feuille d'écarts (l'action vit à côté d'elle).
router.post("/:entrepriseId/stock-fige", protect, canWriteImport, checkEntrepriseAccess, setStockFige);

// Fichiers .dat d'intégration Stock XL (un par dépôt S1..S5, ZIP téléchargé).
router.get("/:entrepriseId/integration-dat", protect, canReadImport, checkEntrepriseAccess, genererDatIntegration);

// Emplacements spéciaux S3/S4/S5 (inventoriés par import de proformas) :
// proposés seulement s'ils existent dans la fiche article.
router.get("/:entrepriseId/emplacements-speciaux", protect, canReadImport, checkEntrepriseAccess, getEmplacementsSpeciaux);

// Gisements d'un emplacement, lus dans la fiche article (zones proposées à
// l'import de proformas — indépendantes du référentiel et du bipage).
router.get("/:entrepriseId/gisements-emplacement", protect, canReadImport, checkEntrepriseAccess, getGisementsEmplacement);

// ─── Import depuis les proformas de l'ERP ─────────────────────────────────
router.get("/:entrepriseId/proformas", protect, canReadImport, checkEntrepriseAccess, listProformasBipage);
// Aperçu AVANT écriture : impact article par article + état des phases de la zone.
router.post("/:entrepriseId/proformas/apercu", protect, canReadImport, checkEntrepriseAccess, apercuImportProformas);
router.post("/:entrepriseId/import-proformas", protect, canWriteImport, checkEntrepriseAccess, importProformasBipage);
// Fiche de contrôle PDF d'une proforma déjà importée (ouverte dans un onglet).
router.get("/:entrepriseId/proformas/:numfact/fiche-pdf", protect, canReadImport, checkEntrepriseAccess, ficheProformaImportee);

// ─── Import depuis un fichier Excel ───────────────────────────────────────
router.get("/:entrepriseId/modele-excel", protect, canReadImport, checkEntrepriseAccess, modeleExcelBipage);
router.post("/:entrepriseId/import-excel", protect, canWriteImport, checkEntrepriseAccess, uploadExcel, importExcelBipage);

router.get("/:entrepriseId", protect, canRead, checkEntrepriseAccess, getBipages);

// Ajout d'une ligne A LA MAIN dans la zone filtree. La zone et l'emplacement
// ne sont pas saisis : ils viennent du filtre et sont verifies contre le
// snapshot de la session (voir le controleur).
router.post("/:entrepriseId/ligne", protect, canWrite, checkEntrepriseAccess, ajouterLigneBipage);

router.put("/:entrepriseId/:id", protect, canWrite, checkEntrepriseAccess, updateBipage);

export default router;