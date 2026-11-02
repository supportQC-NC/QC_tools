// backend/routes/historiquePromosRoutes.js
//
// Historique promos (fichiers <trig>.json du FTPS robot-documents, dossier
// historique_promos/). Module de permission dédié : `historique_promos_admin`.
// Lecture seule — le robot est le seul à écrire ces fichiers.

import express from "express";
import {
  listerSources,
  getHistorique,
} from "../controllers/historiquePromosController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("historique_promos_admin", "read");

// Sources disponibles (sociétés du périmètre ayant un historique).
router.get("/", protect, canRead, listerSources);

// Historique complet d'une société.
router.get(
  "/societe/:nomDossierDBF",
  protect,
  canRead,
  checkEntrepriseAccess,
  getHistorique,
);

export default router;
