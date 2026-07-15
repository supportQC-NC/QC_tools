// backend/routes/collecteurRoutes.js
import express from "express";
import {
  getCollecteurs,
  getCollecteurById,
  getPositions,
  getMyCollecteurs,
  pingPosition,
  requestSonnerie,
  createCollecteur,
  updateCollecteur,
  deleteCollecteur,
} from "../controllers/collecteurController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("collecteurs_admin", "read");
const canWrite = checkModuleAccess("collecteurs_admin", "write");
const canDelete = checkModuleAccess("collecteurs_admin", "delete");

// ── Routes statiques AVANT /:id ──────────────────────────────────────────────
// Relevé de position : accessible à tout agent connecté (pas de module admin).
router.post("/ping", protect, pingPosition);
// Positions pour la carte : réservé au module collecteurs_admin (lecture).
router.get("/positions", protect, canRead, getPositions);
// Collecteurs de l'utilisateur connecté (profil) — pas de module requis.
router.get("/mine", protect, getMyCollecteurs);

router
  .route("/")
  .get(protect, canRead, getCollecteurs)
  .post(protect, canWrite, createCollecteur);

router
  .route("/:id")
  .get(protect, canRead, getCollecteurById)
  .put(protect, canWrite, updateCollecteur)
  .delete(protect, canDelete, deleteCollecteur);

// Faire sonner un collecteur (pour le retrouver).
router.post("/:id/sonnerie", protect, canWrite, requestSonnerie);

export default router;