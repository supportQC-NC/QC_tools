// backend/routes/preparationRoutes.js
import express from "express";
import {
  // Sélection
  getProformasAPreparer,
  // Sessions
  createPreparation,
  getPreparationsEnCours,
  getPreparationEnCours,
  getPreparationById,
  // Scan & préparation
  scanControleLigne,
  preparerLigne,
  passerLigne,
  // Phases
  terminerDock,
  terminerPreparation,
  getControleFinal,
  traiterControleFinal,
  // Commentaire / suppression
  updateCommentaire,
  genererRapport,
  deletePreparation,
} from "../controllers/preparationController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// ==========================================
// SESSIONS — routes statiques (AVANT /:id)
// ==========================================

// Créer / reprendre une session de préparation
router.post(
  "/",
  protect,
  checkModuleAccess("prep_commande", "write"),
  createPreparation,
);

// ==========================================
// SÉLECTION — proformas à préparer (ETAT 2)
// ==========================================
router.get(
  "/a-preparer/:nomDossierDBF",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("prep_commande", "read"),
  getProformasAPreparer,
);

// ==========================================
// SESSIONS EN COURS
// ==========================================
router.get(
  "/en-cours/:entrepriseId/:numpro",
  protect,
  checkModuleAccess("prep_commande", "read"),
  getPreparationEnCours,
);
router.get(
  "/en-cours/:entrepriseId",
  protect,
  checkModuleAccess("prep_commande", "read"),
  getPreparationsEnCours,
);

// ==========================================
// ACTIONS SUR UNE SESSION (:id)
// ==========================================

// Scan / contrôle gencode d'une ligne
router.post(
  "/:id/lignes/:ligneId/scan",
  protect,
  checkModuleAccess("prep_commande", "write"),
  scanControleLigne,
);

// Enregistrer la quantité préparée d'une ligne (dock / magasin)
router.post(
  "/:id/lignes/:ligneId/preparer",
  protect,
  checkModuleAccess("prep_commande", "write"),
  preparerLigne,
);

// Marquer une ligne « non trouvée » pour une phase
router.post(
  "/:id/lignes/:ligneId/passer",
  protect,
  checkModuleAccess("prep_commande", "write"),
  passerLigne,
);

// Transitions de phase
router.post(
  "/:id/terminer-dock",
  protect,
  checkModuleAccess("prep_commande", "write"),
  terminerDock,
);
router.post(
  "/:id/terminer-preparation",
  protect,
  checkModuleAccess("prep_commande", "write"),
  terminerPreparation,
);

// Contrôle final
router.get(
  "/:id/controle-final",
  protect,
  checkModuleAccess("prep_commande", "read"),
  getControleFinal,
);
router.post(
  "/:id/controle-final",
  protect,
  checkModuleAccess("prep_commande", "write"),
  traiterControleFinal,
);

// Commentaire
router.put(
  "/:id/commentaire",
  protect,
  checkModuleAccess("prep_commande", "write"),
  updateCommentaire,
);

// Génération des sorties (PDF + email + fichier transfert) -> clôture
router.post(
  "/:id/generer-rapport",
  protect,
  checkModuleAccess("prep_commande", "write"),
  genererRapport,
);

// Détail + suppression — EN DERNIER (routes génériques)
router.get(
  "/:id",
  protect,
  checkModuleAccess("prep_commande", "read"),
  getPreparationById,
);
router.delete(
  "/:id",
  protect,
  checkModuleAccess("prep_commande", "delete"),
  deletePreparation,
);

export default router;