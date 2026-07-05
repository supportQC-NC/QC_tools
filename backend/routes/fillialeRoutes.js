// backend/routes/filialesRoutes.js
import express from "express";
import {
  getReseaux,
  getReseauProgress,
  refreshReseau,
  getReseau,
} from "../controllers/filialesController.js";
import { protect } from "../middleware/authMiddleware.js";
import { superAdmin } from "../middleware/accessControl.js";

const router = express.Router();

// Analyse Filiales = consolidation MULTI-sociétés par réseau -> réservée aux
// SUPER-ADMINS (un admin scopé ne voit que ses propres sociétés).
// Liste des réseaux
router.get("/", protect, superAdmin, getReseaux);

// Progression — AVANT la route générique /:reseau
router.get("/:reseau/progress", protect, superAdmin, getReseauProgress);

// Invalidation du cache
router.post("/:reseau/refresh", protect, superAdmin, refreshReseau);

// Consolidation d'un réseau — EN DERNIER (route générique)
router.get("/:reseau", protect, superAdmin, getReseau);

export default router;