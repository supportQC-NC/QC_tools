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
  getSegments,
  createSegment,
  updateSegment,
  deleteSegment,
  getSegmentCount,
  getAutomations,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  activateAutomation,
  deactivateAutomation,
  testAutomationCtrl,
  getAutomationStats,
  addAutomationContacts,
  importAutomationContacts,
  getCampaignStats,
  trackOpen,
  trackClick,
  unsubscribePage,
  unsubscribeConfirm,
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

// Import de contacts (CSV / Excel) pour les automatisations.
const uploadFile = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("file");

const canRead = checkModuleAccess("mailing", "read");
const canWrite = checkModuleAccess("mailing", "write");

// ── PUBLIC (sans auth — chargés par les clients mail / navigateurs). AVANT protect. ──
router.get("/img/:id", getImage); // image d'email
router.get("/o/:token", trackOpen); // pixel d'ouverture
router.get("/c/:token", trackClick); // clic → redirection traçée
router.get("/u/:token", unsubscribePage); // page de désinscription
router.post("/u/:token", unsubscribeConfirm); // confirmation (one-click)

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
router.get("/campaigns/:id/stats", canRead, getCampaignStats);

// Segments (société-scopés)
router.get("/segments", canRead, getSegments);
router.post("/segments", canWrite, createSegment);
router.put("/segments/:id", canWrite, updateSegment);
router.delete("/segments/:id", canWrite, deleteSegment);
router.get("/segments/:id/count", canRead, getSegmentCount);

// Automatisations (société-scopées)
router.get("/automations", canRead, getAutomations);
router.post("/automations", canWrite, createAutomation);
router.put("/automations/:id", canWrite, updateAutomation);
router.delete("/automations/:id", canWrite, deleteAutomation);
router.post("/automations/:id/activate", canWrite, activateAutomation);
router.post("/automations/:id/deactivate", canWrite, deactivateAutomation);
router.post("/automations/:id/test", canWrite, testAutomationCtrl);
router.get("/automations/:id/stats", canRead, getAutomationStats);
router.post("/automations/:id/contacts", canWrite, addAutomationContacts);
router.post("/automations/:id/import", canWrite, uploadFile, importAutomationContacts);

// Clients d'une société (filtres + comptage) — société + module.
router.get("/:nomDossierDBF/filters", checkEntrepriseAccess, canRead, getFilters);
router.get(
  "/:nomDossierDBF/recipients/count",
  checkEntrepriseAccess,
  canRead,
  getRecipientsCount,
);

export default router;
