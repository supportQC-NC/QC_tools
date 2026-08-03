// backend/routes/dictionnaireRayonsRoutes.js
import express from "express";
import multer from "multer";
import {
  getDictionnaire,
  saveDictionnaire,
  genererEtiquettesRayons,
  importDictionnaire,
  telechargerDictionnaire,
  telechargerRayonsSansSousZones,
} from "../controllers/dictionnaireRayonsController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("export_gisements_admin", "read");
const canWrite = checkModuleAccess("export_gisements_admin", "write");

// Upload en mémoire pour l'import Excel de masse (5 Mo max, 1 fichier).
const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("file");

// Lecture du dictionnaire des rayons
router.get("/:nomDossierDBF", protect, checkEntrepriseAccess, canRead, getDictionnaire);

// Téléchargement d'une copie du fichier (xlsx brut, sous-zones incluses)
router.get(
  "/:nomDossierDBF/fichier",
  protect,
  checkEntrepriseAccess,
  canRead,
  telechargerDictionnaire,
);

// Téléchargement des RAYONS SEULS (sans sous-zones), filtrable ?emplacement=
router.get(
  "/:nomDossierDBF/rayons",
  protect,
  checkEntrepriseAccess,
  canRead,
  telechargerRayonsSansSousZones,
);

// Enregistrement (remplace le fichier)
router.put("/:nomDossierDBF", protect, checkEntrepriseAccess, canWrite, saveDictionnaire);

// Import de masse (fusion) depuis un Excel uploadé
router.post(
  "/:nomDossierDBF/import",
  protect,
  checkEntrepriseAccess,
  canWrite,
  uploadExcel,
  importDictionnaire,
);

// Étiquettes (A8, Code128/QR) par sous-zone
router.post(
  "/:nomDossierDBF/etiquettes",
  protect,
  checkEntrepriseAccess,
  canRead,
  genererEtiquettesRayons,
);

export default router;
