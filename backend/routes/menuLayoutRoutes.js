// backend/routes/menuLayoutRoutes.js
//
// Organisation de la sidebar.
// - GET  /            = config GLOBALE (tout utilisateur connecté, affichage)
// - PUT  /            = config GLOBALE (admin, constructeur de menu)
// - */me              = config PERSONNELLE de l'utilisateur connecté (switch Perso)
import express from "express";
import {
  getMenuLayout,
  saveMenuLayout,
  getMyMenuLayout,
  saveMyMenuLayout,
  setMyMenuMode,
  resetMyMenuLayout,
} from "../controllers/menuLayoutController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// Config personnelle (avant "/" pour la lisibilité ; l'ordre importe peu ici).
router.get("/me", protect, getMyMenuLayout);
router.put("/me", protect, saveMyMenuLayout);
router.patch("/me/mode", protect, setMyMenuMode);
router.delete("/me", protect, resetMyMenuLayout);

// Config globale.
router.get("/", protect, getMenuLayout);
router.put("/", protect, admin, saveMenuLayout);

export default router;
