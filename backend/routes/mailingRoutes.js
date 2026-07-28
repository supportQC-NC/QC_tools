// backend/routes/mailingRoutes.js
import express from "express";
import multer from "multer";
import {
  getFilters,
  getRecipientsCount,
  getMyCampaigns,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  testCampaign,
  launchCampaign,
  pauseCampaign,
  resumeCampaign,
  previewCampaign,
  uploadImage,
  getImage,
} from "../controllers/mailingController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  checkEntrepriseAccess,
  checkModuleAccess,
} from "../middleware/checkEntrepriseAccess.js";

const router = express.Router();

const uploadImg = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("image");

const canRead = checkModuleAccess("mailing", "read");
const canWrite = checkModuleAccess("mailing", "write");

// PUBLIC : image d'email servie sans auth (les clients mail la chargent). AVANT protect.
router.get("/img/:id", getImage);

// Tout le reste exige d'être connecté + le module mailing.
router.use(protect);

router.post("/preview", canRead, previewCampaign);
router.post("/img", canWrite, uploadImg, uploadImage);

// Campagnes (user-scopées)
router.get("/campaigns", canRead, getMyCampaigns);
router.post("/campaigns", canWrite, createCampaign);
router.put("/campaigns/:id", canWrite, updateCampaign);
router.delete("/campaigns/:id", canWrite, deleteCampaign);
router.post("/campaigns/:id/test", canWrite, testCampaign);
router.post("/campaigns/:id/launch", canWrite, launchCampaign);
router.post("/campaigns/:id/pause", canWrite, pauseCampaign);
router.post("/campaigns/:id/resume", canWrite, resumeCampaign);

// Clients d'une société (filtres + comptage) — société + module.
router.get("/:nomDossierDBF/filters", checkEntrepriseAccess, canRead, getFilters);
router.get(
  "/:nomDossierDBF/recipients/count",
  checkEntrepriseAccess,
  canRead,
  getRecipientsCount,
);

export default router;
