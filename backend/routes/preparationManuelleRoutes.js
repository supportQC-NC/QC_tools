// backend/routes/preparationManuelleRoutes.js
//
// Module « Préparation de commande MANUELLE » (fiches papier à remplir à la main).
// Toutes les routes sont scopées société par :nomDossierDBF -> checkEntrepriseAccess.
import express from "express";
import {
  getProformas,
  getProformaDetails,
  genererFiche,
  updateStatut,
  getHistorique,
  resetSuivi,
} from "../controllers/preparationManuelleController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("prep_commande_manuelle", "read");
const canWrite = checkModuleAccess("prep_commande_manuelle", "write");
const canDelete = checkModuleAccess("prep_commande_manuelle", "delete");

// Historique des fiches (route statique AVANT /proformas/:numfact)
router.get(
  "/:nomDossierDBF/historique",
  protect,
  checkEntrepriseAccess,
  canRead,
  getHistorique,
);

// Liste des proformas à préparer (DBF) + suivi des impressions
router.get(
  "/:nomDossierDBF/proformas",
  protect,
  checkEntrepriseAccess,
  canRead,
  getProformas,
);

// Détail d'une proforma (aperçu du parcours dock / magasin avant impression)
router.get(
  "/:nomDossierDBF/proformas/:numfact",
  protect,
  checkEntrepriseAccess,
  canRead,
  getProformaDetails,
);

// Génération de la fiche de préparation PDF (+ trace de l'impression)
router.post(
  "/:nomDossierDBF/proformas/:numfact/fiche-pdf",
  protect,
  checkEntrepriseAccess,
  canWrite,
  genererFiche,
);

// Statut de suivi (à préparer / imprimée / préparée)
router.put(
  "/:nomDossierDBF/proformas/:numfact/statut",
  protect,
  checkEntrepriseAccess,
  canWrite,
  updateStatut,
);

// Remise à zéro du suivi d'une proforma
router.delete(
  "/:nomDossierDBF/proformas/:numfact/suivi",
  protect,
  checkEntrepriseAccess,
  canDelete,
  resetSuivi,
);

export default router;
