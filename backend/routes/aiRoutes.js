// backend/routes/aiRoutes.js
//
// Assistant IA. Le périmètre société est géré DANS le contrôleur (société précise
// ou « toutes mes sociétés »), toujours borné aux sociétés autorisées. Gate =
// connecté + module « assistant_ia ».
import express from "express";
import {
  getMyCompanies,
  getConversations,
  getConversation,
  createConversation,
  deleteConversation,
  chat,
} from "../controllers/aiAssistantController.js";
import { protect } from "../middleware/authMiddleware.js";
import { checkModuleAccess } from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();
const canRead = checkModuleAccess("assistant_ia", "read");

router.use(protect);

router.get("/companies", canRead, getMyCompanies);
router.get("/conversations", canRead, getConversations);
router.post("/conversations", canRead, createConversation);
router.get("/conversations/:id", canRead, getConversation);
router.delete("/conversations/:id", canRead, deleteConversation);
router.post("/chat", canRead, chat);

export default router;
