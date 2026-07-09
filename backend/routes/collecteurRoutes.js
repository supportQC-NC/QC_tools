// backend/routes/collecteurRoutes.js
import express from "express";
import {
  getCollecteurs,
  getCollecteurById,
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

router
  .route("/")
  .get(protect, canRead, getCollecteurs)
  .post(protect, canWrite, createCollecteur);

router
  .route("/:id")
  .get(protect, canRead, getCollecteurById)
  .put(protect, canWrite, updateCollecteur)
  .delete(protect, canDelete, deleteCollecteur);

export default router;