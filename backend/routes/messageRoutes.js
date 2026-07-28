// backend/routes/messageRoutes.js
import express from "express";
import multer from "multer";
import {
  getMessages,
  getRoomMedia,
  sendMessage,
  downloadMessageFile,
  editMessage,
  pinMessage,
  getPinned,
  searchMessages,
  deleteMessage,
  reactToMessage,
  getReads,
} from "../controllers/messageController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Upload en mémoire (buffer → GridFS). Fichiers de chat : 25 Mo, max 10.
const uploadFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
}).array("files", 10);

router.use(protect);

router.route("/").get(getMessages).post(uploadFiles, sendMessage);
// Accusés de lecture + médias + épingles + recherche — AVANT /:id/*.
router.get("/reads", getReads);
router.get("/media", getRoomMedia);
router.get("/pinned", getPinned);
router.get("/search", searchMessages);
router.get("/:id/files/:fileId", downloadMessageFile);
router.post("/:id/react", reactToMessage);
router.post("/:id/pin", pinMessage);
router.put("/:id", editMessage);
router.delete("/:id", deleteMessage);

export default router;
