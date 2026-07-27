// backend/routes/executableRoutes.js
import express from "express";
import multer from "multer";
import {
  getExecutables,
  createExecutable,
  updateExecutable,
  addDocuments,
  deleteDocument,
  deleteExecutable,
  downloadExecutable,
  downloadDocument,
} from "../controllers/executableController.js";
import { protect, admin } from "../middleware/authMiddleware.js";
import { superAdmin } from "../middleware/accessControl.js";

const router = express.Router();

// Upload en mémoire (le buffer part ensuite vers GridFS).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 Mo max par fichier
});

// Champs pour la création : 1 binaire + jusqu'à 10 documents.
const uploadCreate = upload.fields([
  { name: "executable", maxCount: 1 },
  { name: "documents", maxCount: 10 },
]);

// --- Lecture / téléchargement : tout administrateur ---
router.get("/", protect, admin, getExecutables);
router.get("/:id/download", protect, admin, downloadExecutable);
router.get("/:id/documents/:docId", protect, admin, downloadDocument);

// --- Gestion (upload / édition / suppression) : super-admin uniquement ---
router.post("/", protect, superAdmin, uploadCreate, createExecutable);
router.patch("/:id", protect, superAdmin, updateExecutable);
router.post(
  "/:id/documents",
  protect,
  superAdmin,
  upload.array("documents", 10),
  addDocuments,
);
router.delete("/:id/documents/:docId", protect, superAdmin, deleteDocument);
router.delete("/:id", protect, superAdmin, deleteExecutable);

export default router;
