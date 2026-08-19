// backend/routes/demandeReapproRoutes.js
import express from "express";
import {
  createDemandes,
  createDemandePanier,
  getArticleReappro,
  getDemandes,
  getDemandeById,
  importerProformas,
  getStatsPreparateurs,
  updateDemande,
  updateUrgence,
  deleteDemande,
  getMobileDemandes,
  ouvrirDemande,
  libererDemande,
  scanDemande,
  enregistrerLigne,
  realiserDemande,
} from "../controllers/demandeReapproController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Module dédié aux listes de réappro. « analyse_reappro_admin » et « reapro »
// restent acceptés pour ne pas fermer d'un coup l'écran Analyse Réappro et
// l'app mobile, qui utilisaient ces droits avant la création du module.
const canRead = checkModuleAccess(
  ["demande_reappro", "analyse_reappro_admin"],
  "read",
);
const canWrite = checkModuleAccess(
  ["demande_reappro", "analyse_reappro_admin"],
  "write",
);
const canDelete = checkModuleAccess(
  ["demande_reappro", "analyse_reappro_admin"],
  "delete",
);

// Détail (par id) — statique avant /:nomDossierDBF
router.get("/detail/:id", protect, canRead, getDemandeById);
router.patch("/:id/urgence", protect, canWrite, updateUrgence);
router.delete("/:id", protect, canDelete, deleteDemande);

// MOBILE : liste active + réalisation
const canReapproRead = checkModuleAccess(["demande_reappro", "reapro"], "read");
const canReapproWrite = checkModuleAccess(
  ["demande_reappro", "reapro"],
  "write",
);
router.get("/mobile/list", protect, canReapproRead, getMobileDemandes);
router.post("/mobile/:id/ouvrir", protect, canReapproWrite, ouvrirDemande);
router.post("/mobile/:id/liberer", protect, canReapproWrite, libererDemande);
router.post("/mobile/:id/scan", protect, canReapproWrite, scanDemande);
router.post("/mobile/:id/lignes", protect, canReapproWrite, enregistrerLigne);
router.patch("/mobile/:id/realiser", protect, canReapproWrite, realiserDemande);

// Résolution d'un code (NART / gencode / référence) + création par panier
router.get(
  "/:nomDossierDBF/article/:nart",
  protect, canRead, checkEntrepriseAccess, getArticleReappro,
);
router.post(
  "/:nomDossierDBF/panier",
  protect, canWrite, checkEntrepriseAccess, createDemandePanier,
);

// Statistiques de préparation (par opérateur, sur une période)
router.get(
  "/:nomDossierDBF/stats",
  protect, canRead, checkEntrepriseAccess, getStatsPreparateurs,
);

// Import immédiat des proformas « reappro » (le job tourne aussi chaque heure)
router.post(
  "/:nomDossierDBF/import-proformas",
  protect, canWrite, checkEntrepriseAccess, importerProformas,
);

// Liste + création par gisements (scopées entreprise)
router.get("/:nomDossierDBF", protect, canRead, checkEntrepriseAccess, getDemandes);
router.post("/:nomDossierDBF", protect, canWrite, checkEntrepriseAccess, createDemandes);

// Entête d'une liste (nom / rayon / observation) — après les routes ci-dessus
router.patch("/:id", protect, canWrite, updateDemande);

export default router;
