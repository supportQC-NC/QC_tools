// backend/routes/menuLayoutRoutes.js
//
// Organisation de la sidebar. GET = tout utilisateur connecté (affichage) ;
// PUT = admin (constructeur de menu).
import express from "express";
import { getMenuLayout, saveMenuLayout } from "../controllers/menuLayoutController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getMenuLayout);
router.put("/", protect, admin, saveMenuLayout);

export default router;
