// backend/routes/demandeBipageRoutes.js
import express from "express";
import {
  createDemandeProforma,
  createDemandeGisement,
  createDemandeGroupe,
  getRayonVide,
  getFournisseursBipage,
  getArticlesFournisseur,
  createDemandePanier,
  getArticleBipage,
  getDemandes,
  getSuivi,
  getLignesBipage,
  getDemandeById,
  deleteDemande,
  getMobileDemandes,
  realiserDemande,
} from "../controllers/demandeBipageController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Web (admin) : module "bipage"
const canRead = checkModuleAccess("bipage", "read");
const canWrite = checkModuleAccess("bipage", "write");
const canDelete = checkModuleAccess("bipage", "delete");

// Détail (par id) + suppression — statiques avant /:nomDossierDBF
router.get("/detail/:id", protect, canRead, getDemandeById);
router.delete("/:id", protect, canDelete, deleteDemande);

// MOBILE : liste active + réalisation.
//
// ⚠️ AUCUNE garde de module ici, VOLONTAIREMENT — même règle que les listes de
// réappro : toute demande est visible par les collecteurs de SA société, le
// périmètre société étant appliqué dans `getMobileDemandes`. L'ancienne garde
// `reapro` fermait l'écran aux collecteurs qui ne l'avaient pas, sous la forme
// d'une liste vide (l'app avale les 403).
router.get("/mobile/list", protect, getMobileDemandes);
router.patch("/mobile/:id/realiser", protect, realiserDemande);

// Résolution NART (manuel) + créations (scopées entreprise)
router.get(
  "/:nomDossierDBF/article/:nart",
  protect, canRead, checkEntrepriseAccess, getArticleBipage,
);
router.post(
  "/:nomDossierDBF/proforma",
  protect, canWrite, checkEntrepriseAccess, createDemandeProforma,
);
router.post(
  "/:nomDossierDBF/gisement",
  protect, canWrite, checkEntrepriseAccess, createDemandeGisement,
);
router.post(
  "/:nomDossierDBF/groupe",
  protect, canWrite, checkEntrepriseAccess, createDemandeGroupe,
);
router.post(
  "/:nomDossierDBF/panier",
  protect, canWrite, checkEntrepriseAccess, createDemandePanier,
);

// Articles absents du rayon (S1 = 0, stock en réserve) — liste de sélection.
router.get(
  "/:nomDossierDBF/rayon-vide",
  protect, canRead, checkEntrepriseAccess, getRayonVide,
);

// Sélection par fournisseur : la liste, puis les articles d'un fournisseur.
router.get(
  "/:nomDossierDBF/fournisseurs",
  protect, canRead, checkEntrepriseAccess, getFournisseursBipage,
);
router.get(
  "/:nomDossierDBF/fournisseur/:fourn/articles",
  protect, canRead, checkEntrepriseAccess, getArticlesFournisseur,
);

// Détail d'un bipage (articles bipés) — demande ou bipage libre.
router.get(
  "/:nomDossierDBF/suivi/:type/:id/lignes",
  protect, canRead, checkEntrepriseAccess, getLignesBipage,
);

// Suivi (scopé entreprise) — AVANT la route « liste », sinon « suivi » serait
// lu comme un nomDossierDBF.
router.get(
  "/:nomDossierDBF/suivi",
  protect, canRead, checkEntrepriseAccess, getSuivi,
);

// Liste (scopée entreprise)
router.get("/:nomDossierDBF", protect, canRead, checkEntrepriseAccess, getDemandes);

export default router;
