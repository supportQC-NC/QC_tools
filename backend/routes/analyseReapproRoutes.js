// backend/routes/analyseReapproRoutes.js
import express from "express";
import { getAnalyseReappro } from "../controllers/analyseReapproController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Accès : module « analyse_reappro_admin » (paramétrable par utilisateur dans la
// gestion des droits ; admins = accès total) + accès entreprise par société.
router.get(
  "/:nomDossierDBF",
  protect,
  checkModuleAccess("analyse_reappro_admin", "read"),
  checkEntrepriseAccess,
  getAnalyseReappro,
);

export default router;