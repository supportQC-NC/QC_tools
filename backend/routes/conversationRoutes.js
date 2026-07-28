// backend/routes/conversationRoutes.js
import express from "express";
import multer from "multer";
import {
  getConversations,
  getRoomMembers,
  createConversation,
  deleteConversation,
  leaveConversation,
  uploadConversationPhoto,
  getConversationPhoto,
  deleteConversationPhoto,
} from "../controllers/conversationController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Photo de groupe : image unique en mémoire → GridFS, 5 Mo max.
const uploadPhoto = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("photo");

router.use(protect);

router.route("/").get(getConversations).post(createConversation);
router.get("/members", getRoomMembers); // AVANT /:id
router.delete("/:id", deleteConversation);
router.post("/:id/leave", leaveConversation);
router
  .route("/:id/photo")
  .get(getConversationPhoto)
  .post(uploadPhoto, uploadConversationPhoto)
  .delete(deleteConversationPhoto);

export default router;
