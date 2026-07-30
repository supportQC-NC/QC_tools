// backend/routes/dictionnaireRayonsRoutes.js
import express from "express";
import {
  getDictionnaire,
  saveDictionnaire,
  genererEtiquettesRayons,
} from "../controllers/dictionnaireRayonsController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("export_gisements_admin", "read");
const canWrite = checkModuleAccess("export_gisements_admin", "write");

// Lecture du dictionnaire des rayons
router.get("/:nomDossierDBF", protect, checkEntrepriseAccess, canRead, getDictionnaire);

// Enregistrement (remplace le fichier)
router.put("/:nomDossierDBF", protect, checkEntrepriseAccess, canWrite, saveDictionnaire);

// Étiquettes (A8, Code128/QR) par sous-zone
router.post(
  "/:nomDossierDBF/etiquettes",
  protect,
  checkEntrepriseAccess,
  canRead,
  genererEtiquettesRayons,
);

export default router;
