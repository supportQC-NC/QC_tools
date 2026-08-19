// backend/routes/veilleRoutes.js
//
// Module « Veille ». Aucun scoping société : une veille est PERSONNELLE et ne
// touche à aucune donnée DBF. Gate = connecté + module « veille ».
import express from "express";
import {
  getEtat,
  listConfigs,
  createConfig,
  updateConfig,
  deleteConfig,
  apercuPrompt,
  genererMaintenant,
  listRapports,
  getRapport,
  getRapportHtml,
  deleteRapport,
} from "../controllers/veilleController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("veille", "read");
const canWrite = checkModuleAccess("veille", "write");
const canDelete = checkModuleAccess("veille", "delete");

router.use(protect);

router.get("/etat", canRead, getEtat);

// ─── Mes veilles ───────────────────────────────────────────────────────────
router.get("/configs", canRead, listConfigs);
router.post("/configs", canWrite, createConfig);
router.put("/configs/:id", canWrite, updateConfig);
router.delete("/configs/:id", canDelete, deleteConfig);
router.get("/configs/:id/apercu-prompt", canRead, apercuPrompt);
router.post("/configs/:id/generer", canWrite, genererMaintenant);

// ─── Rapports ──────────────────────────────────────────────────────────────
router.get("/rapports", canRead, listRapports);
router.get("/rapports/:id", canRead, getRapport);
// Le livrable, ouvert dans un nouvel onglet (cookie de session -> `protect` OK).
router.get("/rapports/:id/html", canRead, getRapportHtml);
router.delete("/rapports/:id", canDelete, deleteRapport);

export default router;
