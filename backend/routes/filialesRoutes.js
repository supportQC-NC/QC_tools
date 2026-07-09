// backend/routes/filialesRoutes.js
import express from "express";
import {
  getReseaux,
  getReseauProgress,
  refreshReseau,
  getReseau,
} from "../controllers/filialesController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("filiales_admin", "read");

// Liste des réseaux
router.get("/", protect, canRead, getReseaux);

// Progression — AVANT la route générique /:reseau
router.get("/:reseau/progress", protect, canRead, getReseauProgress);

// Invalidation du cache
router.post("/:reseau/refresh", protect, canRead, refreshReseau);

// Consolidation d'un réseau — EN DERNIER (route générique)
router.get("/:reseau", protect, canRead, getReseau);

export default router;