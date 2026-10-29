// backend/routes/statsCommerciauxRoutes.js
//
// Stats commerciaux (classeurs stats_<TRIG>.xlsx du FTPS robot-documents).
// Module de permission dédié : `stats_commerciaux_admin`.

import express from "express";
import {
  listerSources,
  getSynthese,
  getClients,
  exportPortefeuille,
} from "../controllers/statsCommerciauxController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("stats_commerciaux_admin", "read");

// Sources disponibles (sociétés du périmètre ayant un classeur).
router.get("/", protect, canRead, listerSources);

// Synthèse société (totaux + agrégats par commercial + catégories).
router.get(
  "/societe/:nomDossierDBF",
  protect,
  canRead,
  checkEntrepriseAccess,
  getSynthese,
);

// Portefeuille clients d'un commercial (?commercial=NOM, défaut GLOBAL).
router.get(
  "/societe/:nomDossierDBF/clients",
  protect,
  canRead,
  checkEntrepriseAccess,
  getClients,
);

// Téléchargement du portefeuille sélectionné (?commercial=…&format=xlsx|pdf).
router.get(
  "/societe/:nomDossierDBF/portefeuille-export",
  protect,
  canRead,
  checkEntrepriseAccess,
  exportPortefeuille,
);

export default router;
