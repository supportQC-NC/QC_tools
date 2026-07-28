// backend/controllers/mailingController.js
import asyncHandler from "../middleware/asyncHandler.js";
import MailCampaign from "../models/MailCampaignModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import clientCacheService from "../services/clientCacheService.js";
import { renderCampaign } from "../services/mailRenderService.js";
import { sendTest } from "../services/mailingSender.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";
import {
  uploadBufferToGridFS,
  findGridFSFile,
  openDownloadStream,
} from "../utils/gridfsBucket.js";

const MAIL_IMG_BUCKET = "mailimages";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const cleanEmails = (arr) => [
  ...new Set(
    (Array.isArray(arr) ? arr : [])
      .map((e) => String(e || "").trim().toLowerCase())
      .filter((e) => EMAIL_RE.test(e)),
  ),
];

// L'acteur a-t-il accès à cette société ? (le module est déjà gaté par la route)
const canUseEntreprise = async (user, entrepriseId) => {
  const scope = await getAccessibleEntreprises(user);
  return scope.all || scope.ids.includes(String(entrepriseId));
};

// ── Clients (routes société : :nomDossierDBF + checkEntrepriseAccess) ──

// @route GET /api/mailing/:nomDossierDBF/filters
const getFilters = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const all = await clientCacheService.getAllFilterValues(entreprise);
  const withEmail = await clientCacheService.getMailRecipients(entreprise, {});
  res.json({
    categories: all.categories || [],
    professions: all.professions || [],
    totalAvecEmail: withEmail.length,
    brand: {
      primary: entreprise.couleurPrimaire || "",
      secondary: entreprise.couleurSecondaire || "",
    },
  });
});

// @route GET /api/mailing/:nomDossierDBF/recipients/count?categories=a,b&profes=x
const getRecipientsCount = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const split = (v) =>
    String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
  const recipients = await clientCacheService.getMailRecipients(entreprise, {
    categories: split(req.query.categories),
    profes: split(req.query.profes),
  });
  res.json({ count: recipients.length });
});

// ── Campagnes (user-scopées) ──

const populateCampaign = (q) =>
  q.populate("entreprise", "nomComplet trigramme nomDossierDBF");

// @route GET /api/mailing/campaigns
const getMyCampaigns = asyncHandler(async (req, res) => {
  const list = await populateCampaign(
    MailCampaign.find({ user: req.user._id })
      .select("-recipients") // tableau potentiellement énorme
      .sort({ updatedAt: -1 }),
  );
  res.json(list);
});

// @route POST /api/mailing/campaigns
const createCampaign = asyncHandler(async (req, res) => {
  const { entrepriseId, nom, subject, replyTo, design, scope, batchSize, pauseMinutes } = req.body;
  if (!entrepriseId || !nom) {
    res.status(400);
    throw new Error("Société et nom de campagne requis");
  }
  if (!(await canUseEntreprise(req.user, entrepriseId))) {
    res.status(403);
    throw new Error("Société hors de votre périmètre");
  }
  const campaign = await MailCampaign.create({
    user: req.user._id,
    entreprise: entrepriseId,
    nom,
    subject: subject || "",
    replyTo: replyTo || "",
    design: design || { blocks: [] },
    scope: scope || { type: "tous" },
    batchSize: batchSize || 25,
    pauseMinutes: pauseMinutes == null ? 60 : pauseMinutes,
  });
  res.status(201).json(await populateCampaign(MailCampaign.findById(campaign._id)));
});

const loadOwnedCampaign = async (req, res) => {
  const campaign = await MailCampaign.findById(req.params.id);
  if (!campaign || String(campaign.user) !== String(req.user._id)) {
    res.status(404);
    throw new Error("Campagne introuvable");
  }
  return campaign;
};

// @route PUT /api/mailing/campaigns/:id
const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await loadOwnedCampaign(req, res);
  if (campaign.status === "en_cours") {
    res.status(400);
    throw new Error("Impossible de modifier une campagne en cours d'envoi.");
  }
  const { nom, subject, replyTo, design, scope, batchSize, pauseMinutes } = req.body;
  if (nom !== undefined) campaign.nom = nom;
  if (subject !== undefined) campaign.subject = subject;
  if (replyTo !== undefined) campaign.replyTo = replyTo;
  if (design !== undefined) campaign.design = design;
  if (scope !== undefined) campaign.scope = scope;
  if (batchSize !== undefined) campaign.batchSize = batchSize;
  if (pauseMinutes !== undefined) campaign.pauseMinutes = pauseMinutes;
  await campaign.save();
  res.json(await populateCampaign(MailCampaign.findById(campaign._id)));
});

// @route DELETE /api/mailing/campaigns/:id
const deleteCampaign = asyncHandler(async (req, res) => {
  const campaign = await loadOwnedCampaign(req, res);
  await MailCampaign.deleteOne({ _id: campaign._id });
  res.json({ message: "Campagne supprimée" });
});

// @route POST /api/mailing/campaigns/:id/test   { emails: [] }
const testCampaign = asyncHandler(async (req, res) => {
  const campaign = await loadOwnedCampaign(req, res);
  const emails = cleanEmails(req.body.emails);
  if (emails.length === 0) {
    res.status(400);
    throw new Error("Fournissez au moins un email de test valide.");
  }
  const { sent, failed } = await sendTest(campaign, emails);
  if (campaign.status === "brouillon") {
    campaign.status = "test_envoye";
    campaign.testEmails = emails;
    await campaign.save();
  }
  res.json({ sent, failed });
});

// @route POST /api/mailing/campaigns/:id/launch
const launchCampaign = asyncHandler(async (req, res) => {
  const campaign = await loadOwnedCampaign(req, res);
  if (campaign.status === "en_cours") {
    res.status(400);
    throw new Error("Campagne déjà en cours.");
  }

  // Résolution + SNAPSHOT des destinataires.
  let recipients = [];
  const scope = campaign.scope || { type: "tous" };
  if (scope.type === "csv") {
    recipients = cleanEmails(scope.csvEmails).map((email) => ({ email, nom: "" }));
  } else {
    const entreprise = await Entreprise.findById(campaign.entreprise);
    if (!entreprise) {
      res.status(404);
      throw new Error("Société de la campagne introuvable");
    }
    recipients = await clientCacheService.getMailRecipients(entreprise, {
      categories: scope.type === "categorie" ? scope.categories : [],
      profes: scope.type === "profes" ? scope.profes : [],
    });
  }

  if (recipients.length === 0) {
    res.status(400);
    throw new Error("Aucun destinataire avec un email valide pour cette cible.");
  }

  campaign.recipients = recipients;
  campaign.recipientsTotal = recipients.length;
  campaign.cursor = 0;
  campaign.sentCount = 0;
  campaign.failedCount = 0;
  campaign.lastError = "";
  campaign.status = "en_cours";
  campaign.startedAt = new Date();
  campaign.finishedAt = null;
  campaign.nextBatchAt = new Date(); // 1er lot au prochain tick du scheduler
  await campaign.save();

  res.json({
    message: "Campagne lancée",
    total: recipients.length,
    batchSize: campaign.batchSize,
    pauseMinutes: campaign.pauseMinutes,
  });
});

// @route POST /api/mailing/campaigns/:id/pause
const pauseCampaign = asyncHandler(async (req, res) => {
  const campaign = await loadOwnedCampaign(req, res);
  if (campaign.status !== "en_cours") {
    res.status(400);
    throw new Error("La campagne n'est pas en cours.");
  }
  campaign.status = "pause";
  campaign.nextBatchAt = null;
  await campaign.save();
  res.json({ message: "Campagne en pause" });
});

// @route POST /api/mailing/campaigns/:id/resume
const resumeCampaign = asyncHandler(async (req, res) => {
  const campaign = await loadOwnedCampaign(req, res);
  if (campaign.status !== "pause") {
    res.status(400);
    throw new Error("La campagne n'est pas en pause.");
  }
  campaign.status = "en_cours";
  campaign.nextBatchAt = new Date();
  await campaign.save();
  res.json({ message: "Campagne reprise" });
});

// @route POST /api/mailing/preview   { design }
const previewCampaign = asyncHandler(async (req, res) => {
  const { html } = renderCampaign(req.body.design || {}, {
    baseUrl: process.env.FRONTEND_URL || process.env.CLIENT_URL || "",
  });
  res.json({ html });
});

// @route POST /api/mailing/img   (multipart, champ "image")
const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file || !(req.file.mimetype || "").startsWith("image/")) {
    res.status(400);
    throw new Error("Image requise");
  }
  const fileId = await uploadBufferToGridFS(
    req.file.buffer,
    req.file.originalname || "image",
    req.file.mimetype,
    MAIL_IMG_BUCKET,
  );
  res.json({ id: String(fileId), url: `/api/mailing/img/${fileId}` });
});

// @route GET /api/mailing/img/:id   (PUBLIC — chargé par les clients mail)
const getImage = asyncHandler(async (req, res) => {
  const gf = await findGridFSFile(req.params.id, MAIL_IMG_BUCKET);
  if (!gf) {
    res.status(404);
    throw new Error("Image introuvable");
  }
  res.setHeader("Content-Type", gf.contentType || "image/png");
  if (gf.length) res.setHeader("Content-Length", gf.length);
  res.setHeader("Cache-Control", "public, max-age=604800");
  const stream = openDownloadStream(req.params.id, MAIL_IMG_BUCKET);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  stream.pipe(res);
});

export {
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
};
