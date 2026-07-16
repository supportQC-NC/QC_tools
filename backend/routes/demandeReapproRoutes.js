// backend/routes/demandeReapproRoutes.js
import express from "express";
import {
  createDemandes,
  getDemandes,
  getDemandeById,
  deleteDemande,
  getMobileDemandes,
  realiserDemande,
} from "../controllers/demandeReapproController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("analyse_reappro_admin", "read");
const canWrite = checkModuleAccess("analyse_reappro_admin", "write");
const canDelete = checkModuleAccess("analyse_reappro_admin", "delete");

// Détail (par id) — statique avant /:nomDossierDBF
router.get("/detail/:id", protect, canRead, getDemandeById);
router.delete("/:id", protect, canDelete, deleteDemande);

// MOBILE : liste active (module reapro) + réalisation
const canReapproRead = checkModuleAccess("reapro", "read");
const canReapproWrite = checkModuleAccess("reapro", "write");
router.get("/mobile/list", protect, canReapproRead, getMobileDemandes);
router.patch("/mobile/:id/realiser", protect, canReapproWrite, realiserDemande);

// Liste + création (scopées entreprise)
router.get("/:nomDossierDBF", protect, canRead, checkEntrepriseAccess, getDemandes);
router.post("/:nomDossierDBF", protect, canWrite, checkEntrepriseAccess, createDemandes);

export default router;