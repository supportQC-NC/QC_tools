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
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("concurrents", "read");
const canWrite = checkModuleAccess("concurrents", "write");
const canDelete = checkModuleAccess("concurrents", "delete");

// Routes accessibles à tout utilisateur authentifié
// Liste des concurrents (pour les sélectionner lors d'un relevé)
router.get("/", protect, getConcurrents);

// Statistiques des concurrents (écran admin) — AVANT la route générique /:id
router.get("/admin/stats", protect, canRead, getConcurrentsStats);

// Détail d'un concurrent
router.get("/:id", protect, getConcurrentById);

// Gestion (module "concurrents")
router.post("/", protect, canWrite, createConcurrent);
router.put("/:id", protect, canWrite, updateConcurrent);
router.delete("/:id", protect, canDelete, deleteConcurrent);
router.patch("/:id/toggle-active", protect, canWrite, toggleConcurrentActive);

export default router;