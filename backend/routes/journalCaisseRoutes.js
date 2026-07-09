// backend/routes/journalCaisseRoutes.js
import express from "express";
import { getJournal } from "../controllers/journalCaisseController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// Accès : module "journal_caisse_admin" (lecture) + accès à l'entreprise.
router.get(
  "/:nomDossierDBF",
  protect,
  checkModuleAccess("journal_caisse_admin", "read"),
  checkEntrepriseAccess,
  getJournal,
);

export default router;