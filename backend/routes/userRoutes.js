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
import { superAdmin } from "../middleware/accessControl.js";

const router = express.Router();

// Public — DOIVENT être avant /:id
router.post("/login", authUser);
router.post("/forgot-password", forgotPassword);
router.put("/reset-password/:token", resetPassword);

// Private (utilisateur connecté)
router.post("/logout", protect, logoutUser);
router.get("/profile", protect, getUserProfile);
router.put("/profile", protect, updateUserProfile);

// Gestion des utilisateurs — RÉSERVÉE AUX SUPER-ADMINS
// (un admin scopé ne doit pas pouvoir créer/éditer des comptes ni des permissions).
router.post("/", protect, superAdmin, createUser);
router.get("/", protect, superAdmin, getUsers);
router.get("/:id", protect, superAdmin, getUserById);
router.put("/:id", protect, superAdmin, updateUser);
router.delete("/:id", protect, superAdmin, deleteUser);
router.patch("/:id/toggle-active", protect, superAdmin, toggleUserActive);

export default router;