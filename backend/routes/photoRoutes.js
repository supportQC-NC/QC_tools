// backend/routes/photoRoutes.js
import express from "express";
import {
  getArticlePhoto,
  checkPhotoExists,
} from "../controllers/photoController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Route pour obtenir une photo d'article
// GET /api/photos/:trigramme/:nart
router.get("/:trigramme/:nart", protect, getArticlePhoto);

// Route HEAD pour vérifier si une photo existe
router.head("/:trigramme/:nart", protect, checkPhotoExists);

export default router;
