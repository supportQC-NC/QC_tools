// backend/routes/inventaireRoutes.js
import express from "express";
import {
  createInventaire,
  getInventaireEnCours,
  scanArticle,
  addLigne,
  updateLigne,
  deleteLigne,
  exportInventaire,
  downloadInventaire,
  deleteInventaire,
  getHistorique,
} from "../controllers/inventaireController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.route("/").post(protect, createInventaire);
router.route("/historique").get(protect, getHistorique);
router.route("/en-cours/:entrepriseId").get(protect, getInventaireEnCours);
router.route("/:id").delete(protect, deleteInventaire);
router.route("/:id/scan").post(protect, scanArticle);
router.route("/:id/lignes").post(protect, addLigne);
router
  .route("/:id/lignes/:ligneId")
  .put(protect, updateLigne)
  .delete(protect, deleteLigne);
router.route("/:id/export").post(protect, exportInventaire);
router.route("/:id/download").post(protect, downloadInventaire);

export default router;
