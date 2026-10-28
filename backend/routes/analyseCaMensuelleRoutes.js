// backend/routes/analyseCaMensuelleRoutes.js
//
// Analyse CA mensuelle (classeurs Excel du Rcommun STOCK/doc_temp/CA_MENSUELLE).
// Module de permission dédié : `analyse_ca_mensuelle_admin`.

import express from "express";
import {
  listerSources,
  getClasseur,
} from "../controllers/analyseCaMensuelleController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("analyse_ca_mensuelle_admin", "read");

// Sources disponibles (sociétés du périmètre).
router.get("/", protect, canRead, listerSources);

// Classeur complet d'une société.
router.get(
  "/societe/:nomDossierDBF",
  protect,
  canRead,
  checkEntrepriseAccess,
  getClasseur,
);

export default router;
