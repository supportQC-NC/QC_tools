// backend/routes/smtpConfigRoutes.js
//
// Paramètres SMTP (global + par module). Réservé aux admins (données sensibles).
import express from "express";
import {
  getConfigs,
  saveConfigCtrl,
  resetConfigCtrl,
  testConfigCtrl,
} from "../controllers/smtpConfigController.js";
import { protect, admin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, admin, getConfigs);
router.put("/:scope", protect, admin, saveConfigCtrl);
router.delete("/:scope", protect, admin, resetConfigCtrl);
router.post("/:scope/test", protect, admin, testConfigCtrl);

export default router;
