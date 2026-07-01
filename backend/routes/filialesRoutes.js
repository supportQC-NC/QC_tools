// backend/routes/filialesRoutes.js
import express from "express";
import {
  getReseaux,
  getReseauProgress,
  refreshReseau,
  getReseau,
} from "../controllers/filialesController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Liste des réseaux
router.get("/", protect, admin, getReseaux);

// Progression — AVANT la route générique /:reseau
router.get("/:reseau/progress", protect, admin, getReseauProgress);

// Invalidation du cache
router.post("/:reseau/refresh", protect, admin, refreshReseau);

// Consolidation d'un réseau — EN DERNIER (route générique)
router.get("/:reseau", protect, admin, getReseau);

export default router;