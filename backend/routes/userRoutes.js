// backend/routes/userRoutes.js
import express from "express";
import {
  authUser,
  logoutUser,
  getUserProfile,
  updateUserProfile,
  forgotPassword,
  resetPassword,
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  toggleUserActive,
} from "../controllers/userControlleur.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("users_admin", "read");
const canWrite = checkModuleAccess("users_admin", "write");
const canDelete = checkModuleAccess("users_admin", "delete");

// Public — DOIVENT être avant /:id
router.post("/login", authUser);
router.post("/forgot-password", forgotPassword);
router.put("/reset-password/:token", resetPassword);

// Private (utilisateur connecté) — self-service, jamais gaté par module
router.post("/logout", protect, logoutUser);
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, updateUserProfile);

// Administration des utilisateurs (module "users_admin")
router.post("/", protect, canWrite, createUser);
router.get("/", protect, canRead, getUsers);
router.get("/:id", protect, canRead, getUserById);
router.put("/:id", protect, canWrite, updateUser);
router.delete("/:id", protect, canDelete, deleteUser);
router.patch("/:id/toggle-active", protect, canWrite, toggleUserActive);

export default router;