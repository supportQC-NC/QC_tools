// backend/routes/releveRoutes.js
import express from "express";
import {
  createReleve,
  getReleveEnCours,
  getRelevesEnCoursParEntreprise,
  scanArticleReleve,
  addLigneReleve,
  updateLigneReleve,
  deleteLigneReleve,
  downloadReleve,
  deleteReleve,
  getHistoriqueReleves,
  getReleveById,
  getRelevesStats,
} from "../controllers/ReleveControlleur.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// ==========================================
// ROUTES PRINCIPALES
// ==========================================

// Créer un nouveau relevé
router.post("/", protect, checkModuleAccess("releve", "write"), createReleve);

// Historique des relevés de l'utilisateur
router.get(
  "/historique",
  protect,
  checkModuleAccess("releve", "read"),
  getHistoriqueReleves,
);

// Statistiques des relevés (admin)
router.get("/stats", protect, admin, getRelevesStats);

// Obtenir tous les relevés en cours pour une entreprise
router.get(
  "/en-cours/:entrepriseId",
  protect,
  checkModuleAccess("releve", "read"),
  getRelevesEnCoursParEntreprise,
);

// Obtenir le relevé en cours pour une entreprise et un concurrent spécifique
router.get(
  "/en-cours/:entrepriseId/:concurrentId",
  protect,
  checkModuleAccess("releve", "read"),
  getReleveEnCours,
);

// ==========================================
// ROUTES AVEC ID DE RELEVÉ
// ==========================================

// Obtenir un relevé par ID
router.get("/:id", protect, checkModuleAccess("releve", "read"), getReleveById);

// Supprimer un relevé
router.delete(
  "/:id",
  protect,
  checkModuleAccess("releve", "delete"),
  deleteReleve,
);

// Scanner un article (par GENCOD)
router.post(
  "/:id/scan",
  protect,
  checkModuleAccess("releve", "write"),
  scanArticleReleve,
);

// Ajouter une ligne au relevé
router.post(
  "/:id/lignes",
  protect,
  checkModuleAccess("releve", "write"),
  addLigneReleve,
);

// Modifier une ligne du relevé
router.put(
  "/:id/lignes/:ligneId",
  protect,
  checkModuleAccess("releve", "write"),
  updateLigneReleve,
);

// Supprimer une ligne du relevé
router.delete(
  "/:id/lignes/:ligneId",
  protect,
  checkModuleAccess("releve", "delete"),
  deleteLigneReleve,
);

// Télécharger le fichier Excel
router.post(
  "/:id/download",
  protect,
  checkModuleAccess("releve", "read"),
  downloadReleve,
);

export default router;
