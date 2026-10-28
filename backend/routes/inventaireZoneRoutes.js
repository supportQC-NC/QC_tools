// backend/routes/inventaireZoneRoutes.js
import express from "express";
import {
  initInventaireZone,
  setFiltreProformas,
  annulerInventaireZone,
  biperZone,
  getAgentsPossibles,
  getActiveSession,
  getProgress,
  getHistorique,
  setPhaseManuelle,
  deleteSession,
  telechargerDossierZip,
} from "../controllers/inventaireZoneController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Toutes les routes : admin only + accès entreprise (param :entrepriseId)

// Initialisation (archive l'actif puis crée)
router.post(
  "/init/:entrepriseId",
  protect,
  admin,
  checkEntrepriseAccess,
  initInventaireZone,
);

// Annulation de l'inventaire actif (table rase : supprime dossier + session)
router.post(
  "/:entrepriseId/annuler",
  protect,
  admin,
  checkEntrepriseAccess,
  annulerInventaireZone,
);

// Sélection des proformas du « comptage sans collecteur » : définie une fois
// pour tout l'inventaire, modifiable ensuite.
router.put(
  "/:entrepriseId/filtre-proformas",
  protect,
  admin,
  checkEntrepriseAccess,
  setFiltreProformas,
);

// Bip d'un code-barres
router.post(
  "/:entrepriseId/bip",
  protect,
  admin,
  checkEntrepriseAccess,
  biperZone,
);

// Utilisateurs sélectionnables comme agent au scan d'un coupon (tous, pas
// seulement ceux de la société : cf. commentaire du contrôleur)
router.get(
  "/:entrepriseId/agents-possibles",
  protect,
  admin,
  checkEntrepriseAccess,
  getAgentsPossibles,
);

// Session active détaillée
router.get(
  "/:entrepriseId/active",
  protect,
  admin,
  checkEntrepriseAccess,
  getActiveSession,
);

// Progression légère (% global + par phase)
router.get(
  "/:entrepriseId/progress",
  protect,
  admin,
  checkEntrepriseAccess,
  getProgress,
);

// Dossier complet de l'inventaire (FTP + partage fusionnés) en ZIP, pour
// l'enregistrer en local sur le poste de l'utilisateur.
router.get(
  "/:entrepriseId/dossier-zip",
  protect,
  admin,
  checkEntrepriseAccess,
  telechargerDossierZip,
);

// Historique des sessions archivées
router.get(
  "/:entrepriseId/historique",
  protect,
  admin,
  checkEntrepriseAccess,
  getHistorique,
);

// Correction manuelle d'une phase
router.put(
  "/:entrepriseId/zone/:code/:phase",
  protect,
  admin,
  checkEntrepriseAccess,
  setPhaseManuelle,
);

// Suppression d'une session archivée
router.delete(
  "/:entrepriseId/:id",
  protect,
  admin,
  checkEntrepriseAccess,
  deleteSession,
);

export default router;