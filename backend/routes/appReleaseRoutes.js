// backend/routes/appReleaseRoutes.js
import express from "express";
import {
  getCurrentRelease,
  getReleases,
  createRelease,
} from "../controllers/appReleaseControlleur.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

// PUBLIC : la page d'installation lit la release courante sans authentification.
router.get("/current", getCurrentRelease);

// ADMIN : historique + publication d'une nouvelle release (upload QR).
router.get("/", protect, admin, getReleases);
router.post("/", protect, admin, createRelease);

export default router;