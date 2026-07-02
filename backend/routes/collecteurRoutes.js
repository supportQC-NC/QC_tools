// backend/routes/collecteurRoutes.js
import express from "express";
import {
  getCollecteurs,
  getCollecteurById,
  createCollecteur,
  updateCollecteur,
  deleteCollecteur,
} from "../controllers/collecteurController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

router
  .route("/")
  .get(protect, admin, getCollecteurs)
  .post(protect, admin, createCollecteur);

router
  .route("/:id")
  .get(protect, admin, getCollecteurById)
  .put(protect, admin, updateCollecteur)
  .delete(protect, admin, deleteCollecteur);

export default router;