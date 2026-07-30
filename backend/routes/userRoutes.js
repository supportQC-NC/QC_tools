// backend/routes/userRoutes.js
import express from "express";
import multer from "multer";
import {
  authUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  changePassword,
  forgotPassword,
  resetPassword,
  createUser,
  getUsers,
  getAssignableUsers,
  getDirectoryUsers,
  uploadProfilePhoto,
  deleteProfilePhoto,
  getUserPhoto,
  getUserById,
  updateUser,
  deleteUser,
  toggleUserActive,
} from "../controllers/userControlleur.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";
import { allowUserManagement } from "../middleware/accessControl.js";

const router = express.Router();

// Upload photo de profil : image unique en mémoire → GridFS, 5 Mo max.
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("photo");

// Lecture / création / mise à jour / (dés)activation : admins, détenteurs du
// module users_admin, ET responsables (le périmètre fin est appliqué dans le
// contrôleur : scope d'équipe + atténuation des permissions).
const canRead = allowUserManagement("read");
const canWrite = allowUserManagement("write");
// Suppression de COMPTE : réservée aux admins / users_admin (PAS les responsables).
const canDelete = checkModuleAccess("users_admin", "delete");

// Public — DOIVENT être avant /:id
router.post("/login", authUser);
router.post("/forgot-password", forgotPassword);
router.put("/reset-password/:token", resetPassword);

// Private (utilisateur connecté) — self-service, jamais gaté par module
router.post("/logout", protect, logoutUser);
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, updateUserProfile);
// Changement de mot de passe (self) — AVANT /:id pour ne pas être capté par :id.
router.put("/profile/password", protect, changePassword);
// Photo de profil (self) — AVANT /:id pour ne pas être capté par :id.
router.post("/profile/photo", protect, uploadPhoto, uploadProfilePhoto);
router.delete("/profile/photo", protect, deleteProfilePhoto);

// Administration des utilisateurs (module "users_admin")
router.post("/", protect, canWrite, createUser);
router.get("/", protect, canRead, getUsers);
// Liste allégée pour le choix des membres d'équipe — AVANT /:id.
router.get("/assignable", protect, canRead, getAssignableUsers);
// Annuaire société pour créer une discussion — tout user connecté. AVANT /:id.
router.get("/directory", protect, getDirectoryUsers);
// Photo d'un user (image) — accessible à tout utilisateur connecté.
router.get("/:id/photo", protect, getUserPhoto);
router.get("/:id", protect, canRead, getUserById);
router.put("/:id", protect, canWrite, updateUser);
router.delete("/:id", protect, canDelete, deleteUser);
router.patch("/:id/toggle-active", protect, canWrite, toggleUserActive);

export default router;
