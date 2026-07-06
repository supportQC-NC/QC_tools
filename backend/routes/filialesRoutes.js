// backend/routes/filialesRoutes.js
import express from "express";
import {
  getReseaux,
  getReseauProgress,
  refreshReseau,
  getReseau,
} from "../controllers/filialesController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkAnalyseAccess,
  checkFilialeReseauAccess,
} from "../middleware/accessControl.js";

const router = express.Router();

// Liste des réseaux : accès à l'écran Filiales dès qu'AU MOINS un réseau est
// autorisé (la liste renvoyée est ensuite filtrée réseau par réseau).
router.get("/", protect, checkAnalyseAccess("filiales"), getReseaux);

// Routes ciblant un réseau précis (DQ | QC | LD) : droit par réseau requis.
router.get(
  "/:reseau/progress",
  protect,
  checkFilialeReseauAccess,
  getReseauProgress,
);

router.post(
  "/:reseau/refresh",
  protect,
  checkFilialeReseauAccess,
  refreshReseau,
);

// Consolidation d'un réseau — EN DERNIER (route générique)
router.get("/:reseau", protect, checkFilialeReseauAccess, getReseau);

export default router;