// backend/routes/mediathequeRoutes.js
//
// Médiathèque (banque d'images / HTML pour les signatures mail).
// ⚠️ /public/:slug est volontairement SANS protect : les clients mail chargent
// les images d'une signature sans cookie. La route ne sert que le binaire d'un
// fichier explicitement mis en ligne — aucune donnée DBF ni Mongo n'y passe.

import express from "express";
import multer from "multer";
import {
  getMedias,
  createMedias,
  updateMedia,
  deleteMedia,
  serveMediaPublic,
  getDossiers,
  createDossier,
  updateDossier,
  deleteDossier,
} from "../controllers/mediathequeController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();
const MODULE = "mediatheque";

// Upload en mémoire (le buffer part ensuite vers GridFS).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo max par fichier
});

// --- Lien public (signatures mail) : AUCUNE authentification ---
router.get("/public/:slug", serveMediaPublic);

// --- Dossiers de classement (rangement d'écran, sans effet sur les liens) ---
router.get("/dossiers", protect, checkModuleAccess(MODULE, "read"), getDossiers);
router.post(
  "/dossiers",
  protect,
  checkModuleAccess(MODULE, "write"),
  createDossier,
);
router.patch(
  "/dossiers/:id",
  protect,
  checkModuleAccess(MODULE, "write"),
  updateDossier,
);
router.delete(
  "/dossiers/:id",
  protect,
  checkModuleAccess(MODULE, "delete"),
  deleteDossier,
);

// --- Gestion interne : module mediatheque ---
router.get("/", protect, checkModuleAccess(MODULE, "read"), getMedias);
router.post(
  "/",
  protect,
  checkModuleAccess(MODULE, "write"),
  upload.array("fichiers", 20),
  createMedias,
);
router.patch("/:id", protect, checkModuleAccess(MODULE, "write"), updateMedia);
router.delete("/:id", protect, checkModuleAccess(MODULE, "delete"), deleteMedia);

export default router;
