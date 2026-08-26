// backend/routes/raccourcisRoutes.js
//
// Raccourcis du tableau de bord personnel. `protect` seul : la préférence est
// personnelle et ne donne accès à rien (les droits sont vérifiés à l'ouverture
// de l'onglet visé, comme depuis la sidebar).
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getMesRaccourcis,
  setMesRaccourcis,
  resetMesRaccourcis,
} from "../controllers/raccourcisController.js";

const router = express.Router();

router.get("/me", protect, getMesRaccourcis);
router.put("/me", protect, setMesRaccourcis);
router.delete("/me", protect, resetMesRaccourcis);

export default router;
