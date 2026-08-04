// backend/routes/menuHintRoutes.js
//
// Infobulles des onglets sidebar. GET = tout utilisateur connecté (affichage),
// PUT = admin (écran d'administration).
import express from "express";
import {
  getMenuHints,
  upsertMenuHint,
  reorderMenu,
} from "../controllers/menuHintController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getMenuHints);
router.put("/reorder", protect, admin, reorderMenu);
router.put("/", protect, admin, upsertMenuHint);

export default router;
