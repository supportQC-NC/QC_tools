// backend/routes/dashboardLayoutRoutes.js
//
// Tableau de bord personnel. Aucune garde de module ici : le périmètre est
// calculé PAR BLOC dans le contrôleur / le moteur KPI (un utilisateur ne peut
// enregistrer ni évaluer un bloc dont il n'a pas le module).
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getCatalogue,
  getMaDisposition,
  setMaDisposition,
  resetMaDisposition,
  evaluerBlocs,
} from "../controllers/dashboardLayoutController.js";

const router = express.Router();

router.get("/catalogue", protect, getCatalogue);
router.get("/me", protect, getMaDisposition);
router.put("/me", protect, setMaDisposition);
router.delete("/me", protect, resetMaDisposition);
router.post("/evaluer", protect, evaluerBlocs);

export default router;
