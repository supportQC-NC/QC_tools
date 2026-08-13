// backend/routes/frequentationContexteRoutes.js
//
// Contexte du module « Fréquentation magasin » : vacances scolaires,
// événements spéciaux et météo. Ces données décrivent le TERRITOIRE, pas une
// société : pas de :nomDossierDBF, donc pas de checkEntrepriseAccess — seul le
// module frequentation_admin est requis (écriture pour la saisie).
import express from "express";
import {
  listVacances,
  createVacances,
  updateVacances,
  deleteVacances,
  getEvenementTypes,
  listEvenements,
  createEvenement,
  updateEvenement,
  deleteEvenement,
  genererFeries,
  listMeteo,
  collecteMeteo,
  upsertMeteoJour,
  deverrouillerMeteoJour,
} from "../controllers/frequentationContexteController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("frequentation_admin", "read");
const canWrite = checkModuleAccess("frequentation_admin", "write");
const canDelete = checkModuleAccess("frequentation_admin", "delete");

// ── Vacances scolaires ─────────────────────────────────────────────────────
router.get("/vacances", protect, canRead, listVacances);
router.post("/vacances", protect, canWrite, createVacances);
router.put("/vacances/:id", protect, canWrite, updateVacances);
router.delete("/vacances/:id", protect, canDelete, deleteVacances);

// ── Événements spéciaux (routes statiques AVANT /:id) ──────────────────────
router.get("/evenements/types", protect, canRead, getEvenementTypes);
router.post("/evenements/feries", protect, canWrite, genererFeries);
router.get("/evenements", protect, canRead, listEvenements);
router.post("/evenements", protect, canWrite, createEvenement);
router.put("/evenements/:id", protect, canWrite, updateEvenement);
router.delete("/evenements/:id", protect, canDelete, deleteEvenement);

// ── Météo (collecte automatique + correction manuelle) ─────────────────────
router.get("/meteo", protect, canRead, listMeteo);
router.post("/meteo/collecte", protect, canWrite, collecteMeteo);
router.put("/meteo/:lieu/:date", protect, canWrite, upsertMeteoJour);
router.delete("/meteo/:lieu/:date/verrou", protect, canWrite, deverrouillerMeteoJour);

export default router;
