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

// MOBILE : liste active + réalisation.
//
// ⚠️ AUCUNE garde de module ici, VOLONTAIREMENT (règle métier du 26/08/2026) :
// « dès qu'une liste est créée, tous les collecteurs rattachés à la société
// doivent la voir ». Le périmètre reste la SOCIÉTÉ — `getMobileDemandes` filtre
// sur les sociétés accordées à l'utilisateur et `chargerListeMobile` renvoie 403
// pour une liste d'une autre société.
//
// Avant, ces routes exigeaient `demande_reappro` ou `reapro` : un collecteur
// n'ayant que `inventaire`/`reception` recevait un 403 que l'app affiche comme
// une liste VIDE — d'où « aucune demande ne s'affiche » sans le moindre message.
router.get("/mobile/list", protect, getMobileDemandes);
router.post("/mobile/:id/ouvrir", protect, ouvrirDemande);
router.post("/mobile/:id/liberer", protect, libererDemande);
router.post("/mobile/:id/scan", protect, scanDemande);
router.post("/mobile/:id/lignes", protect, enregistrerLigne);
router.patch("/mobile/:id/realiser", protect, realiserDemande);

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
