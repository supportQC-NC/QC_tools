// backend/routes/demandeBipageRoutes.js
import express from "express";
import {
  createDemandeProforma,
  createDemandeGisement,
  createDemandePanier,
  getArticleBipage,
  getDemandes,
  getDemandeById,
  deleteDemande,
  getMobileDemandes,
  realiserDemande,
} from "../controllers/demandeBipageController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Web (admin) : module "bipage"
const canRead = checkModuleAccess("bipage", "read");
const canWrite = checkModuleAccess("bipage", "write");
const canDelete = checkModuleAccess("bipage", "delete");

// Détail (par id) + suppression — statiques avant /:nomDossierDBF
router.get("/detail/:id", protect, canRead, getDemandeById);
router.delete("/:id", protect, canDelete, deleteDemande);

// MOBILE : liste active + réalisation (module reapro, comme le collecteur)
const canReapproRead = checkModuleAccess("reapro", "read");
const canReapproWrite = checkModuleAccess("reapro", "write");
router.get("/mobile/list", protect, canReapproRead, getMobileDemandes);
router.patch("/mobile/:id/realiser", protect, canReapproWrite, realiserDemande);

// Résolution NART (manuel) + créations (scopées entreprise)
router.get(
  "/:nomDossierDBF/article/:nart",
  protect, canRead, checkEntrepriseAccess, getArticleBipage,
);
router.post(
  "/:nomDossierDBF/proforma",
  protect, canWrite, checkEntrepriseAccess, createDemandeProforma,
);
router.post(
  "/:nomDossierDBF/gisement",
  protect, canWrite, checkEntrepriseAccess, createDemandeGisement,
);
router.post(
  "/:nomDossierDBF/panier",
  protect, canWrite, checkEntrepriseAccess, createDemandePanier,
);

// Liste (scopée entreprise)
router.get("/:nomDossierDBF", protect, canRead, checkEntrepriseAccess, getDemandes);

export default router;
