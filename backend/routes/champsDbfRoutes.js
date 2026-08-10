// backend/routes/champsDbfRoutes.js
//
// Droits « champ par champ » sur les bases DBF — administration.
// Même garde que la gestion des utilisateurs : c'est bien un droit utilisateur.
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";
import {
  getTables,
  getChampsTable,
  getConfigUtilisateur,
  setConfigUtilisateur,
} from "../controllers/champsDbfController.js";

const router = express.Router();

const canRead = checkModuleAccess("users_admin", "read");
const canWrite = checkModuleAccess("users_admin", "write");

router.get("/tables", protect, canRead, getTables);
router.get("/utilisateur/:userId", protect, canRead, getConfigUtilisateur);
router.put("/utilisateur/:userId", protect, canWrite, setConfigUtilisateur);
// Après les routes fixes pour ne pas capter « tables » / « utilisateur ».
router.get("/:table/champs", protect, canRead, getChampsTable);

export default router;
