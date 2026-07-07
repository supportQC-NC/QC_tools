// backend/routes/journalCaisseRoutes.js
import express from "express";
import { getJournal } from "../controllers/journalCaisseController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkEntrepriseAccess } from "../middleware/checkEntrepriseAccess.js";
import { checkAnalyseAccess } from "../middleware/accessControl.js";

const router = express.Router();

// Accès : droit d'analyse « journalCaisse » (admins ET users) + accès entreprise.
router.get(
  "/:nomDossierDBF",
  protect,
  checkAnalyseAccess("journalCaisse"),
  checkEntrepriseAccess,
  getJournal,
);

export default router;