// backend/routes/bipageCollecteRoutes.js
// Routes du BIPAGE terminal (clone de reapproRoutes).
// Permissions : réutilise le module "reapro" (un opérateur qui fait du réappro
// fait aussi du bipage). Pour un module de permission "bipage" dédié, remplacer
// checkModuleAccess("reapro", …) par checkModuleAccess("bipage", …) après avoir
// ajouté le module côté PermissionModel.
import express from "express";
import {
  createBipage,
  getBipageEnCours,
  scanArticleBipage,
  addLigneBipage,
  updateLigneBipage,
  deleteLigneBipage,
  exportBipage,
  downloadBipage,
  deleteBipage,
  getHistoriqueBipage,
  getBipageById,
} from "../controllers/bipageCollecteController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

router
  .route("/")
  .post(protect, checkModuleAccess("reapro", "write"), createBipage);

router
  .route("/historique")
  .get(protect, checkModuleAccess("reapro", "read"), getHistoriqueBipage);

router
  .route("/en-cours/:entrepriseId")
  .get(protect, checkModuleAccess("reapro", "read"), getBipageEnCours);

router
  .route("/:id")
  .get(protect, checkModuleAccess("reapro", "read"), getBipageById)
  .delete(protect, checkModuleAccess("reapro", "delete"), deleteBipage);

router
  .route("/:id/scan")
  .post(protect, checkModuleAccess("reapro", "write"), scanArticleBipage);

router
  .route("/:id/lignes")
  .post(protect, checkModuleAccess("reapro", "write"), addLigneBipage);

router
  .route("/:id/lignes/:ligneId")
  .put(protect, checkModuleAccess("reapro", "write"), updateLigneBipage)
  .delete(protect, checkModuleAccess("reapro", "delete"), deleteLigneBipage);

router
  .route("/:id/export")
  .post(protect, checkModuleAccess("reapro", "write"), exportBipage);

router
  .route("/:id/download")
  .post(protect, checkModuleAccess("reapro", "write"), downloadBipage);

export default router;