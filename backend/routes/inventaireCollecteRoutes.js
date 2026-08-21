// backend/routes/inventaireCollecteRoutes.js
import express from "express";
import {
  resoudreZone,
  getSessionActive,
  createCollecte,
  getCollectesEnCours,
  getCollecteById,
  scanArticleCollecte,
  addLigneCollecte,
  updateLigneCollecte,
  deleteLigneCollecte,
  exportCollecte,
  getRecapZones,
  getRecapZonePdf,
  deleteCollecte,
  getSuiviBipage,
  updateObservationCollecte,
} from "../controllers/inventaireCollecteController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Routes littérales d'abord, puis routes paramétrées
router.route("/resoudre-zone").post(protect, resoudreZone);
// Porte d'entrée mobile : un inventaire est-il en cours ?
router.route("/session-active/:entrepriseId").get(protect, getSessionActive);
router.route("/en-cours/:entrepriseId").get(protect, getCollectesEnCours);
// Récap de la session active, regroupé par zone (avec écarts qté + XPF)
router.route("/recap-zones/:entrepriseId").get(protect, getRecapZones);
// PDF "fiche de contrôle" d'UNE zone (même moteur que les fiches de contrôle)
router.route("/recap-zones/:entrepriseId/pdf").get(protect, getRecapZonePdf);

// ─── Suivi bipage (écran web) ──────────────────────────────────────────────
// Contrairement au reste du routeur (appelé par le collecteur, `protect` seul),
// ces routes sont des routes d'ADMINISTRATION : elles sont gardées par le
// module « inventaire » et par l'accès société.
router
  .route("/suivi-bipage/:entrepriseId")
  .get(
    protect,
    checkEntrepriseAccess,
    checkModuleAccess("inventaire", "read"),
    getSuiviBipage,
  );
router
  .route("/suivi-bipage/:entrepriseId/:id/observation")
  .patch(
    protect,
    checkEntrepriseAccess,
    checkModuleAccess("inventaire", "write"),
    updateObservationCollecte,
  );
router.route("/").post(protect, createCollecte);

router.route("/:id").get(protect, getCollecteById).delete(protect, deleteCollecte);
router.route("/:id/scan").post(protect, scanArticleCollecte);
router.route("/:id/lignes").post(protect, addLigneCollecte);
router
  .route("/:id/lignes/:ligneId")
  .put(protect, updateLigneCollecte)
  .delete(protect, deleteLigneCollecte);
router.route("/:id/export").post(protect, exportCollecte);

export default router;