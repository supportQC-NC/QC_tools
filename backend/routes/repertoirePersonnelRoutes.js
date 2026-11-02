// backend/routes/repertoirePersonnelRoutes.js
import express from "express";
import {
  getRepertoires,
  upsertRepertoire,
  getRepertoirePdf,
} from "../controllers/repertoirePersonnelController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

// ⚠️ PAS de checkEntrepriseAccess : décision client (02/11/2026), le module
// « Dictionnaires » est transverse — chaque utilisateur ayant le module voit
// les répertoires de TOUTES les sociétés.
const read = [protect, checkModuleAccess("dictionnaires", "read")];
const write = [protect, checkModuleAccess("dictionnaires", "write")];

router.get("/", read, getRepertoires);
router.get("/:entrepriseId/pdf", read, getRepertoirePdf);
router.put("/:entrepriseId", write, upsertRepertoire);

export default router;
