// backend/routes/zoneRoutes.js
import express from "express";
import multer from "multer";
import {
  importZones,
  getZones,
  getZoneById,
  getZoneByCode,
  createZone,
  updateZone,
  deleteZone,
  deleteAllZones,
  genererZonesDepuisDictionnaire,
  genererFichesPDF,
} from "../controllers/zoneController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Multer en mémoire : le CSV est lu depuis req.file.buffer (pas d'écriture disque)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 Mo
  fileFilter: (req, file, cb) => {
    const nom = (file.originalname || "").toLowerCase();
    const ok =
      nom.endsWith(".csv") ||
      file.mimetype === "text/csv" ||
      file.mimetype === "text/plain" ||
      file.mimetype === "application/vnd.ms-excel" ||
      file.mimetype === "application/octet-stream";
    if (ok) cb(null, true);
    else cb(new Error("Seuls les fichiers CSV sont acceptés"));
  },
});

// ==========================================
// IMPORT CSV (remplacement total)
// ==========================================
router.post(
  "/import/:entrepriseId",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "write"),
  upload.single("fichier"),
  importZones,
);

// ==========================================
// GÉNÉRATION depuis le dictionnaire des rayons (remplacement total)
// ==========================================
router.post(
  "/generer-dictionnaire/:entrepriseId",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "write"),
  genererZonesDepuisDictionnaire,
);

// ==========================================
// CRUD — routes les plus spécifiques d'abord
// ==========================================

// Fiches PDF imprimables (préfixe statique /fiches-pdf : AVANT /:id)
router.post(
  "/:entrepriseId/fiches-pdf",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "read"),
  genererFichesPDF,
);

// Zone par code (préfixe statique /code/ : avant /:id)
router.get(
  "/:entrepriseId/code/:code",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "read"),
  getZoneByCode,
);

// Zone par ID
router.get(
  "/:entrepriseId/:id",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "read"),
  getZoneById,
);
router.put(
  "/:entrepriseId/:id",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "write"),
  updateZone,
);
router.delete(
  "/:entrepriseId/:id",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "delete"),
  deleteZone,
);

// Liste / création / suppression totale (1 segment)
router.get(
  "/:entrepriseId",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "read"),
  getZones,
);
router.post(
  "/:entrepriseId",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "write"),
  createZone,
);
router.delete(
  "/:entrepriseId",
  protect,
  checkEntrepriseAccess,
  checkModuleAccess("inventaire", "delete"),
  deleteAllZones,
);

export default router;