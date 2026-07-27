// backend/routes/notificationRoutes.js
import express from "express";
import {
  getCounts,
  markChatSeen,
  markTasksSeen,
} from "../controllers/notificationController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

router.get("/counts", getCounts);
router.post("/chat/seen", markChatSeen);
router.post("/tasks/seen", markTasksSeen);

export default router;
