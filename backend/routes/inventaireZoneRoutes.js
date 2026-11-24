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
  setZoneNeutralisee,
  deleteSession,
  telechargerDossierZip,
} from "../controllers/inventaireZoneController.js";
import {
  genererBilan,
  getBilans,
  getBilan,
  getBilanExcel,
  getBilanPdf,
  getComparaisonBilans,
  deleteBilan,
} from "../controllers/inventaireBilanController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Trois niveaux de garde (décision client du 24/11/2026 : les responsables —
// et tout utilisateur à qui l'admin accorde le module « inventaire » — suivent
// et pilotent l'inventaire ; seul le CYCLE DE VIE reste admin) :
//   read      — consultation (récap, progression, historique, bilans) ;
//   write     — actions de terrain (coupon, phase manuelle, neutralisation…) ;
//   adminOnly — créer / annuler / supprimer un inventaire, générer ou
//               supprimer un bilan de clôture.
// Les admins court-circuitent checkModuleAccess (règle globale) : rien ne
// change pour eux. Même motif que les routes web d'inventaireCollecteRoutes.
const read = [
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "read"),
];
const write = [
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "write"),
];
const adminOnly = [protect, admin, checkEntrepriseAccess];

// Initialisation (archive l'actif puis crée)
router.post("/init/:entrepriseId", adminOnly, initInventaireZone);

// Annulation de l'inventaire actif (table rase : supprime dossier + session)
router.post("/:entrepriseId/annuler", adminOnly, annulerInventaireZone);

// Sélection des proformas du « comptage sans collecteur » : définie une fois
// pour tout l'inventaire, modifiable ensuite.
router.put("/:entrepriseId/filtre-proformas", write, setFiltreProformas);

// Bip d'un code-barres
router.post("/:entrepriseId/bip", write, biperZone);

// Utilisateurs sélectionnables comme agent au scan d'un coupon (tous, pas
// seulement ceux de la société : cf. commentaire du contrôleur). `write`
// comme le bip qu'elle sert : la liste ne porte que l'identité (nom, e-mail).
router.get("/:entrepriseId/agents-possibles", write, getAgentsPossibles);

// Session active détaillée
router.get("/:entrepriseId/active", read, getActiveSession);

// Progression légère (% global + par phase)
router.get("/:entrepriseId/progress", read, getProgress);

// Dossier complet de l'inventaire (FTP + partage fusionnés) en ZIP, pour
// l'enregistrer en local sur le poste de l'utilisateur.
router.get("/:entrepriseId/dossier-zip", read, telechargerDossierZip);

// Historique des sessions archivées
router.get("/:entrepriseId/historique", read, getHistorique);

// ─── Bilans de clôture ────────────────────────────────────────────────────
// Figer le bilan de l'inventaire actif (+ clôture optionnelle de la session)
router.post("/:entrepriseId/bilan", adminOnly, genererBilan);
// ⚠️ « comparaison » AVANT "/bilans/:id" : sinon elle matcherait comme un id.
router.get("/:entrepriseId/bilans/comparaison", read, getComparaisonBilans);
router.get("/:entrepriseId/bilans", read, getBilans);
router.get("/:entrepriseId/bilans/:id", read, getBilan);
router.get("/:entrepriseId/bilans/:id/excel", read, getBilanExcel);
router.get("/:entrepriseId/bilans/:id/pdf", read, getBilanPdf);
router.delete("/:entrepriseId/bilans/:id", adminOnly, deleteBilan);

// Neutraliser / réactiver une zone (rayon qui n'existe plus physiquement).
// ⚠️ DÉCLARÉE AVANT la route de phase : "/zone/:code/:phase" matcherait aussi
// « neutraliser » et répondrait « phase invalide ».
router.put("/:entrepriseId/zone/:code/neutraliser", write, setZoneNeutralisee);

// Correction manuelle d'une phase
router.put("/:entrepriseId/zone/:code/:phase", write, setPhaseManuelle);

// Suppression d'une session archivée
router.delete("/:entrepriseId/:id", adminOnly, deleteSession);

export default router;
