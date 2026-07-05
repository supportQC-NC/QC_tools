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
  getRepresentantsCodes,
} from "../controllers/EntrepriseControlleur.js";
import { protect } from "../middleware/authMiddleware.js";
import { superAdmin } from "../middleware/accessControl.js";

const router = express.Router();

// Private (user connecté) — liste filtrée selon le périmètre de l'utilisateur.
router.get("/my-entreprises", protect, getMyEntreprises);
router.get("/trigramme/:trigramme", protect, getEntrepriseByTrigramme);
router.get("/dossier/:nomDossierDBF", protect, getEntrepriseByDossier);

// Gestion des entreprises — RÉSERVÉE AUX SUPER-ADMINS
// (un admin scopé ne doit pas pouvoir créer/éditer des entreprises ni s'en octroyer).
router.get("/", protect, superAdmin, getEntreprises);
router.post("/", protect, superAdmin, createEntreprise);
// Codes vendeurs (REPRES) détectés dans facture.dbf — route à 2 segments,
// placée avant /:id (1 segment) pour rester sans ambiguïté.
router.get(
  "/:nomDossierDBF/representants",
  protect,
  superAdmin,
  getRepresentantsCodes,
);
router.get("/:id", protect, superAdmin, getEntrepriseById);
router.put("/:id", protect, superAdmin, updateEntreprise);
router.delete("/:id", protect, superAdmin, deleteEntreprise);
router.patch("/:id/toggle-active", protect, superAdmin, toggleEntrepriseActive);

export default router;