// backend/routes/performanceDockRoutes.js
//
// Performance réappro magasin. Désormais scopé par société : la mesure se lit
// dans la fiche article (S1..S5), elle n'a plus rien de propre à QC — l'ancien
// module dépendait d'un dossier de classeurs nommés `reapro_mag_qc_*`.
import express from "express";
import {
  getReport,
  exportExcel,
  prendrePhotoMaintenant,
  rattraperHistorique,
} from "../controllers/performanceDockController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkModuleAccess,
  checkEntrepriseAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const MODULE = "performance_dock_admin";
// Les deux dimensions habituelles : le bon module ET la bonne société.
const lecture = [protect, checkEntrepriseAccess, checkModuleAccess(MODULE, "read")];
// Photo à la demande et rattrapage écrivent des `ReapproSnapshot` : droit
// d'écriture, même si l'ERP reste en lecture seule.
const ecriture = [protect, checkEntrepriseAccess, checkModuleAccess(MODULE, "write")];

// ⚠️ `/:nomDossierDBF/excel` doit être déclaré AVANT `/:nomDossierDBF`, sinon
// « excel » serait pris pour un nom de société.
router.get("/:nomDossierDBF/excel", lecture, exportExcel);
router.post("/:nomDossierDBF/photo", ecriture, prendrePhotoMaintenant);
router.post("/:nomDossierDBF/rattrapage", ecriture, rattraperHistorique);
router.get("/:nomDossierDBF", lecture, getReport);

export default router;
