// backend/routes/concurrentRoutes.js
import express from "express";
import {
  getConcurrents,
  getConcurrentById,
  createConcurrent,
  updateConcurrent,
  deleteConcurrent,
  toggleConcurrentActive,
  getConcurrentsStats,
} from "../controllers/concurrentController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Routes accessibles aux utilisateurs authentifiés
// Liste des concurrents (pour les sélectionner lors d'un relevé)
router.get("/", protect, getConcurrents);

// Détail d'un concurrent
router.get("/:id", protect, getConcurrentById);

// Routes Admin uniquement
// Statistiques des concurrents
router.get("/admin/stats", protect, admin, getConcurrentsStats);

// Créer un concurrent
router.post("/", protect, admin, createConcurrent);

// Modifier un concurrent
router.put("/:id", protect, admin, updateConcurrent);

// Supprimer un concurrent
router.delete("/:id", protect, admin, deleteConcurrent);

// Activer/Désactiver un concurrent
router.patch("/:id/toggle-active", protect, admin, toggleConcurrentActive);

export default router;
