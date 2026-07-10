// backend/routes/reportSubscriptionRoutes.js
import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
  getAvailableOptions,
  getMySubscriptions,
  testConfig,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  testSubscription,
} from "../controllers/reportSubscriptionController.js";

const router = express.Router();

// Routes statiques AVANT les routes dynamiques (/:id).
router.get("/available", protect, getAvailableOptions);
router.post("/test", protect, testConfig); // test à la volée (sans créer)

router
  .route("/")
  .get(protect, getMySubscriptions)
  .post(protect, createSubscription);

router
  .route("/:id")
  .put(protect, updateSubscription)
  .delete(protect, deleteSubscription);

router.post("/:id/test", protect, testSubscription); // test d'un abonnement existant

export default router;