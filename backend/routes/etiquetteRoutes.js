// backend/routes/etiquetteRoutes.js
import express from "express";
import {
  genererEtiquettes,
  controlerGencod,
  exporterComptageGisements,
} from "../controllers/etiquetteController.js";
import {
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "../controllers/etiquetteTemplateController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("etiquettes", "read");
const canWrite = checkModuleAccess("etiquettes", "write");

// Génération du PDF d'étiquettes (proforma ou NART manuels)
router.post(
  "/:nomDossierDBF/generer",
  protect,
  checkEntrepriseAccess,
  canRead,
  genererEtiquettes,
);

// Contrôle préalable : articles de la sélection sans code-barres imprimable.
// Même corps de requête et mêmes gardes que /generer — c'est la même lecture.
router.post(
  "/:nomDossierDBF/controle-gencod",
  protect,
  checkEntrepriseAccess,
  canRead,
  controlerGencod,
);

// Comptage des gisements au format Excel (gisement | nb d'articles | libellé),
// option du bloc « QR gisement » : ?emplacement=MAGASIN|DOCK|TOUS
router.get(
  "/:nomDossierDBF/gisements-excel",
  protect,
  checkEntrepriseAccess,
  canRead,
  exporterComptageGisements,
);

// Templates d'étiquettes personnalisées (SCOPÉS SOCIÉTÉ, partagés entre users).
router.get("/:nomDossierDBF/templates", protect, checkEntrepriseAccess, canRead, getTemplates);
router.post("/:nomDossierDBF/templates", protect, checkEntrepriseAccess, canWrite, createTemplate);
router.put("/:nomDossierDBF/templates/:id", protect, checkEntrepriseAccess, canWrite, updateTemplate);
router.delete("/:nomDossierDBF/templates/:id", protect, checkEntrepriseAccess, canWrite, deleteTemplate);

export default router;