// backend/routes/aiRoutes.js
//
// Assistant IA — scopé société (:nomDossierDBF) + module « assistant_ia ».
import express from "express";
import {
  getConversations,
  getConversation,
  createConversation,
  deleteConversation,
  chat,
} from "../controllers/aiAssistantController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const canRead = checkModuleAccess("assistant_ia", "read");

router.use(protect);

router.get("/:nomDossierDBF/conversations", checkEntrepriseAccess, canRead, getConversations);
router.post("/:nomDossierDBF/conversations", checkEntrepriseAccess, canRead, createConversation);
router.get("/:nomDossierDBF/conversations/:id", checkEntrepriseAccess, canRead, getConversation);
router.delete("/:nomDossierDBF/conversations/:id", checkEntrepriseAccess, canRead, deleteConversation);
router.post("/:nomDossierDBF/chat", checkEntrepriseAccess, canRead, chat);

export default router;
