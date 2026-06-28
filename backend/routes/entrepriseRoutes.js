import express from "express";
import {
  getEntreprises,
  getEntrepriseById,
  getEntrepriseByDossier,
  createEntreprise,
  updateEntreprise,
  deleteEntreprise,
  toggleEntrepriseActive,
  getMyEntreprises,
  getEntrepriseByTrigramme,
} from "../controllers/EntrepriseControlleur.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Private (user connecté)
router.get("/my-entreprises", protect, getMyEntreprises);
router.get("/trigramme/:trigramme", protect, getEntrepriseByTrigramme);
router.get("/dossier/:nomDossierDBF", protect, getEntrepriseByDossier);

// Admin only
router.get("/", protect, admin, getEntreprises);
router.post("/", protect, admin, createEntreprise);
router.get("/:id", protect, admin, getEntrepriseById);
router.put("/:id", protect, admin, updateEntreprise);
router.delete("/:id", protect, admin, deleteEntreprise);
router.patch("/:id/toggle-active", protect, admin, toggleEntrepriseActive);

export default router;