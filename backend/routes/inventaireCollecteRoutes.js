// backend/routes/inventaireCollecteRoutes.js
import express from "express";
import {
  resoudreZone,
  createCollecte,
  getCollectesEnCours,
  getCollecteById,
  scanArticleCollecte,
  addLigneCollecte,
  updateLigneCollecte,
  deleteLigneCollecte,
  exportCollecte,
  deleteCollecte,
} from "../controllers/inventaireCollecteController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Routes littérales d'abord, puis routes paramétrées
router.route("/resoudre-zone").post(protect, resoudreZone);
router.route("/en-cours/:entrepriseId").get(protect, getCollectesEnCours);
router.route("/").post(protect, createCollecte);

router.route("/:id").get(protect, getCollecteById).delete(protect, deleteCollecte);
router.route("/:id/scan").post(protect, scanArticleCollecte);
router.route("/:id/lignes").post(protect, addLigneCollecte);
router
  .route("/:id/lignes/:ligneId")
  .put(protect, updateLigneCollecte)
  .delete(protect, deleteLigneCollecte);
router.route("/:id/export").post(protect, exportCollecte);

export default router;