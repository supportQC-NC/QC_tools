// backend/routes/receptionManuelleRoutes.js
//
// Module « Contrôle réception MANUEL » (fiches papier à remplir à la main).
// Toutes les routes sont scopées société par :nomDossierDBF -> checkEntrepriseAccess.
import express from "express";
import {
  getCommandes,
  getCommandeDetails,
  genererFiche,
  updateStatut,
  getHistorique,
  resetSuivi,
} from "../controllers/receptionManuelleController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("reception_manuelle", "read");
const canWrite = checkModuleAccess("reception_manuelle", "write");
const canDelete = checkModuleAccess("reception_manuelle", "delete");

// Historique des fiches (route statique AVANT /commandes/:numcde)
router.get(
  "/:nomDossierDBF/historique",
  protect,
  checkEntrepriseAccess,
  canRead,
  getHistorique,
);

// Liste des commandes à contrôler (DBF) + suivi des impressions
router.get(
  "/:nomDossierDBF/commandes",
  protect,
  checkEntrepriseAccess,
  canRead,
  getCommandes,
);

// Détail d'une commande (aperçu avant impression)
router.get(
  "/:nomDossierDBF/commandes/:numcde",
  protect,
  checkEntrepriseAccess,
  canRead,
  getCommandeDetails,
);

// Génération de la fiche de contrôle PDF (+ trace de l'impression)
router.post(
  "/:nomDossierDBF/commandes/:numcde/fiche-pdf",
  protect,
  checkEntrepriseAccess,
  canWrite,
  genererFiche,
);

// Statut de suivi (à contrôler / imprimé / contrôlé)
router.put(
  "/:nomDossierDBF/commandes/:numcde/statut",
  protect,
  checkEntrepriseAccess,
  canWrite,
  updateStatut,
);

// Remise à zéro du suivi d'une commande
router.delete(
  "/:nomDossierDBF/commandes/:numcde/suivi",
  protect,
  checkEntrepriseAccess,
  canDelete,
  resetSuivi,
);

export default router;
