// backend/controllers/mailingController.js
import asyncHandler from "../middleware/asyncHandler.js";
import MailCampaign from "../models/MailCampaignModel.js";
import MailSegment from "../models/MailSegmentModel.js";
import MailUnsubscribe from "../models/MailUnsubscribeModel.js";
import MailEvent from "../models/MailEventModel.js";
import MailAutomation from "../models/MailAutomationModel.js";
import MailAutomationEnrollment from "../models/MailAutomationEnrollmentModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import clientCacheService from "../services/clientCacheService.js";
import { renderCampaign } from "../services/mailRenderService.js";
import { sendTest } from "../services/mailingSender.js";
import { seedBaseline, testAutomation, addContacts } from "../services/automationService.js";
import { verify, PIXEL_GIF } from "../services/mailTracking.js";
import ExcelJS from "exceljs";
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

// Résout les destinataires d'un SEGMENT : clients DBF filtrés (CATEGORIE/PROFES)
// UNION emails CSV, dédoublonnés.
const resolveSegmentRecipients = async (entreprise, seg) => {
  const parts = [];
  if ((seg.categories?.length || 0) || (seg.profes?.length || 0)) {
    const r = await clientCacheService.getMailRecipients(entreprise, {
      categories: seg.categories || [],
      profes: seg.profes || [],
    });
    parts.push(...r);
  }
  if (seg.csvEmails?.length) {
    parts.push(...cleanEmails(seg.csvEmails).map((email) => ({ email, nom: "" })));
  }
  const seen = new Set();
  const out = [];
  for (const r of parts) {
    if (!r.email || seen.has(r.email)) continue;
    seen.add(r.email);
    out.push(r);
  }
  return out;
};

// Set des emails DÉSINSCRITS d'une société (à exclure des envois).
const getUnsubSet = async (entrepriseId) => {
  const list = await MailUnsubscribe.find({ entreprise: entrepriseId }).select(
    "email -_id",
  );
  return new Set(list.map((u) => u.email));
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
  const { entrepriseId, nom, subject, replyTo, design, scope, batchSize, pauseMinutes, abTest } = req.body;
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
    abTest: abTest || { enabled: false, subjectB: "" },
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
  const { nom, subject, replyTo, design, scope, batchSize, pauseMinutes, abTest } = req.body;
  if (nom !== undefined) campaign.nom = nom;
  if (subject !== undefined) campaign.subject = subject;
  if (replyTo !== undefined) campaign.replyTo = replyTo;
  if (design !== undefined) campaign.design = design;
  if (scope !== undefined) campaign.scope = scope;
  if (batchSize !== undefined) campaign.batchSize = batchSize;
  if (pauseMinutes !== undefined) campaign.pauseMinutes = pauseMinutes;
  if (abTest !== undefined) campaign.abTest = abTest;
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
  } else if (scope.type === "segment") {
    const entreprise = await Entreprise.findById(campaign.entreprise);
    const seg = await MailSegment.findById(scope.segmentId);
    if (!seg || String(seg.entreprise) !== String(campaign.entreprise)) {
      res.status(400);
      throw new Error("Segment introuvable pour cette société.");
    }
    recipients = await resolveSegmentRecipients(entreprise, seg);
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

  // Exclut les clients DÉSINSCRITS de cette société.
  const unsub = await getUnsubSet(campaign.entreprise);
  const excluded = recipients.length;
  recipients = recipients.filter((r) => !unsub.has(r.email));
  const removed = excluded - recipients.length;

  if (recipients.length === 0) {
    res.status(400);
    throw new Error("Aucun destinataire avec un email valide pour cette cible.");
  }

  // A/B testing : assigne alternativement le variant A / B (≈ 50/50).
  if (campaign.abTest?.enabled && (campaign.abTest.subjectB || "").trim()) {
    recipients = recipients.map((r, i) => ({ ...r, variant: i % 2 === 0 ? "A" : "B" }));
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
    excludedUnsub: removed,
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
  res.json({ html: html.split("{{unsubscribe_url}}").join("#") });
});

// ── Segments (société-scopés, module gaté par la route) ──

// @route GET /api/mailing/segments?entrepriseId=...
const getSegments = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.query;
  if (!entrepriseId || !(await canUseEntreprise(req.user, entrepriseId))) {
    res.status(403);
    throw new Error("Société hors de votre périmètre");
  }
  const list = await MailSegment.find({ entreprise: entrepriseId }).sort({
    updatedAt: -1,
  });
  res.json(list);
});

// @route POST /api/mailing/segments
const createSegment = asyncHandler(async (req, res) => {
  const { entrepriseId, nom, description, categories, profes, csvEmails } =
    req.body;
  if (!entrepriseId || !nom) {
    res.status(400);
    throw new Error("Société et nom du segment requis");
  }
  if (!(await canUseEntreprise(req.user, entrepriseId))) {
    res.status(403);
    throw new Error("Société hors de votre périmètre");
  }
  const seg = await MailSegment.create({
    user: req.user._id,
    entreprise: entrepriseId,
    nom,
    description: description || "",
    categories: categories || [],
    profes: profes || [],
    csvEmails: cleanEmails(csvEmails),
  });
  res.status(201).json(seg);
});

const loadSegmentWithAccess = async (req, res) => {
  const seg = await MailSegment.findById(req.params.id);
  if (!seg) {
    res.status(404);
    throw new Error("Segment introuvable");
  }
  if (!(await canUseEntreprise(req.user, seg.entreprise))) {
    res.status(403);
    throw new Error("Segment hors de votre périmètre");
  }
  return seg;
};

// @route PUT /api/mailing/segments/:id
const updateSegment = asyncHandler(async (req, res) => {
  const seg = await loadSegmentWithAccess(req, res);
  const { nom, description, categories, profes, csvEmails } = req.body;
  if (nom !== undefined) seg.nom = nom;
  if (description !== undefined) seg.description = description;
  if (categories !== undefined) seg.categories = categories;
  if (profes !== undefined) seg.profes = profes;
  if (csvEmails !== undefined) seg.csvEmails = cleanEmails(csvEmails);
  await seg.save();
  res.json(seg);
});

// @route DELETE /api/mailing/segments/:id
const deleteSegment = asyncHandler(async (req, res) => {
  const seg = await loadSegmentWithAccess(req, res);
  await MailSegment.deleteOne({ _id: seg._id });
  res.json({ message: "Segment supprimé" });
});

// @route GET /api/mailing/segments/:id/count  → nb destinataires (hors désinscrits)
const getSegmentCount = asyncHandler(async (req, res) => {
  const seg = await loadSegmentWithAccess(req, res);
  const entreprise = await Entreprise.findById(seg.entreprise);
  let recipients = await resolveSegmentRecipients(entreprise, seg);
  const unsub = await getUnsubSet(seg.entreprise);
  recipients = recipients.filter((r) => !unsub.has(r.email));
  res.json({ count: recipients.length });
});

// ── Automatisations (société-scopées, façon Brevo) ──

const EMAIL_LIST = (arr) => cleanEmails(arr);

// @route GET /api/mailing/automations?entrepriseId=...
const getAutomations = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.query;
  if (!entrepriseId || !(await canUseEntreprise(req.user, entrepriseId))) {
    res.status(403);
    throw new Error("Société hors de votre périmètre");
  }
  const list = await MailAutomation.find({ entreprise: entrepriseId }).sort({
    updatedAt: -1,
  });
  res.json(list);
});

// @route POST /api/mailing/automations
const createAutomation = asyncHandler(async (req, res) => {
  const { entrepriseId, nom, description, trigger, steps } = req.body;
  if (!entrepriseId || !nom) {
    res.status(400);
    throw new Error("Société et nom de l'automatisation requis");
  }
  if (!(await canUseEntreprise(req.user, entrepriseId))) {
    res.status(403);
    throw new Error("Société hors de votre périmètre");
  }
  const auto = await MailAutomation.create({
    user: req.user._id,
    entreprise: entrepriseId,
    nom,
    description: description || "",
    trigger: { type: trigger?.type || "nouveau_client" },
    steps: Array.isArray(steps) ? steps : [],
  });
  res.status(201).json(auto);
});

const loadAutomationWithAccess = async (req, res) => {
  const auto = await MailAutomation.findById(req.params.id);
  if (!auto) {
    res.status(404);
    throw new Error("Automatisation introuvable");
  }
  if (!(await canUseEntreprise(req.user, auto.entreprise))) {
    res.status(403);
    throw new Error("Automatisation hors de votre périmètre");
  }
  return auto;
};

// @route PUT /api/mailing/automations/:id
const updateAutomation = asyncHandler(async (req, res) => {
  const auto = await loadAutomationWithAccess(req, res);
  const { nom, description, trigger, steps } = req.body;
  if (nom !== undefined) auto.nom = nom;
  if (description !== undefined) auto.description = description;
  if (trigger !== undefined) auto.trigger = { type: trigger.type || auto.trigger.type };
  if (steps !== undefined) auto.steps = steps;
  await auto.save();
  res.json(auto);
});

// @route DELETE /api/mailing/automations/:id
const deleteAutomation = asyncHandler(async (req, res) => {
  const auto = await loadAutomationWithAccess(req, res);
  await MailAutomationEnrollment.deleteMany({ automation: auto._id });
  await MailAutomation.deleteOne({ _id: auto._id });
  res.json({ message: "Automatisation supprimée" });
});

// @route POST /api/mailing/automations/:id/activate
// nouveau_client → SEED le référentiel (les clients EXISTANTS ne reçoivent rien).
// liste → pas de seed (les contacts ajoutés/importés déclenchent l'envoi).
const activateAutomation = asyncHandler(async (req, res) => {
  const auto = await loadAutomationWithAccess(req, res);
  if (!auto.steps?.length) {
    res.status(400);
    throw new Error("Ajoutez au moins une étape (email) avant d'activer.");
  }
  let seeded = 0;
  let note = "Les contacts ajoutés à la liste recevront la séquence de bienvenue.";
  if (auto.trigger?.type === "nouveau_client") {
    seeded = await seedBaseline(auto.entreprise);
    note =
      "Les clients existants ne sont pas contactés — seuls les nouveaux clients entreront dans le parcours.";
  }
  auto.active = true;
  auto.baselineSeededAt = new Date();
  await auto.save();
  res.json({ message: "Automatisation activée", seeded, note });
});

// Parse des lignes → contacts {email, nom} (détecte colonnes email/nom).
const rowsToContacts = (rows) => {
  const clean = (rows || []).map((r) => (r || []).map((c) => String(c == null ? "" : c).trim()));
  if (!clean.length) return [];
  let start = 0;
  let emailCol = 0;
  let nomCol = 1;
  const header = clean[0].map((c) => c.toLowerCase());
  const eIdx = header.findIndex((h) => /mail|courriel|e-mail/.test(h));
  const nIdx = header.findIndex((h) => /nom|name|client|prénom|prenom/.test(h));
  if (eIdx >= 0) {
    emailCol = eIdx;
    nomCol = nIdx >= 0 ? nIdx : eIdx === 0 ? 1 : 0;
    start = 1;
  } else {
    const ci = clean[0].findIndex((c) => c.includes("@"));
    if (ci >= 0) {
      emailCol = ci;
      nomCol = ci === 0 ? 1 : 0;
    }
  }
  const out = [];
  for (let i = start; i < clean.length; i++) {
    const email = (clean[i][emailCol] || "").toLowerCase();
    const nom = clean[i][nomCol] || "";
    if (email.includes("@")) out.push({ email, nom });
  }
  return out;
};

const parseCsvBuffer = (buf) => {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const semi = (lines[0].match(/;/g) || []).length;
  const comma = (lines[0].match(/,/g) || []).length;
  const delim = semi > comma ? ";" : lines[0].includes("\t") ? "\t" : ",";
  const rows = lines.map((l) =>
    l.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")),
  );
  return rowsToContacts(rows);
};

const parseXlsxBuffer = async (buf) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows = [];
  ws.eachRow((row) => {
    const vals = (row.values || []).slice(1).map((v) => {
      if (v == null) return "";
      if (typeof v === "object") return v.text || v.hyperlink || v.result || "";
      return v;
    });
    rows.push(vals);
  });
  return rowsToContacts(rows);
};

// @route POST /api/mailing/automations/:id/contacts   { contacts: [{email,nom}] }
const addAutomationContacts = asyncHandler(async (req, res) => {
  const auto = await loadAutomationWithAccess(req, res);
  const contacts = Array.isArray(req.body.contacts) ? req.body.contacts : [];
  if (!contacts.length) {
    res.status(400);
    throw new Error("Aucun contact fourni.");
  }
  const r = await addContacts(auto, contacts);
  res.json({ ...r, active: auto.active });
});

// @route POST /api/mailing/automations/:id/import   (multipart "file" CSV/XLSX)
const importAutomationContacts = asyncHandler(async (req, res) => {
  const auto = await loadAutomationWithAccess(req, res);
  if (!req.file) {
    res.status(400);
    throw new Error("Fichier requis (CSV ou Excel).");
  }
  const name = (req.file.originalname || "").toLowerCase();
  let contacts;
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    contacts = await parseXlsxBuffer(req.file.buffer);
  } else {
    contacts = parseCsvBuffer(req.file.buffer);
  }
  if (!contacts.length) {
    res.status(400);
    throw new Error("Aucun email trouvé dans le fichier (colonnes email / nom attendues).");
  }
  const r = await addContacts(auto, contacts);
  res.json({ ...r, parsed: contacts.length, active: auto.active });
});

// @route POST /api/mailing/automations/:id/deactivate
const deactivateAutomation = asyncHandler(async (req, res) => {
  const auto = await loadAutomationWithAccess(req, res);
  auto.active = false;
  await auto.save();
  res.json({ message: "Automatisation désactivée" });
});

// @route POST /api/mailing/automations/:id/test   { emails: [] }
// Envoie TOUTES les étapes immédiatement aux adresses de TEST (jamais la base).
const testAutomationCtrl = asyncHandler(async (req, res) => {
  const auto = await loadAutomationWithAccess(req, res);
  const emails = EMAIL_LIST(req.body.emails);
  if (!emails.length) {
    res.status(400);
    throw new Error("Fournissez au moins un email de test valide.");
  }
  if (!auto.steps?.length) {
    res.status(400);
    throw new Error("Aucune étape à tester.");
  }
  const r = await testAutomation(auto, emails);
  res.json(r);
});

// @route GET /api/mailing/automations/:id/stats
const getAutomationStats = asyncHandler(async (req, res) => {
  const auto = await loadAutomationWithAccess(req, res);
  const [active, done, stopped, timelineAgg] = await Promise.all([
    MailAutomationEnrollment.countDocuments({ automation: auto._id, status: "active" }),
    MailAutomationEnrollment.countDocuments({ automation: auto._id, status: "done" }),
    MailAutomationEnrollment.countDocuments({ automation: auto._id, status: "stopped" }),
    MailAutomationEnrollment.aggregate([
      { $match: { automation: auto._id } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Pacific/Noumea" },
          },
          n: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);
  res.json({
    active: auto.active,
    trigger: auto.trigger?.type,
    steps: auto.steps?.length || 0,
    enrolledCount: auto.enrolledCount || 0,
    sentCount: auto.sentCount || 0,
    inProgress: active,
    completed: done,
    stopped,
    timeline: timelineAgg.map((t) => ({ day: t._id, inscrits: t.n })),
  });
});

// ── Statistiques d'une campagne (ouvertures / clics) ──

// @route GET /api/mailing/campaigns/:id/stats
const getCampaignStats = asyncHandler(async (req, res) => {
  const campaign = await loadOwnedCampaign(req, res);
  const cid = campaign._id;
  const [openedRids, totalOpens, uniqueClicks, totalClicks] = await Promise.all([
    MailEvent.distinct("rid", { campaign: cid, kind: "open" }),
    MailEvent.countDocuments({ campaign: cid, kind: "open" }),
    MailEvent.distinct("rid", { campaign: cid, kind: "click" }).then((a) => a.length),
    MailEvent.countDocuments({ campaign: cid, kind: "click" }),
  ]);
  const uniqueOpens = openedRids.length;

  // A/B testing : taux d'ouverture par variant d'objet.
  let ab = null;
  if (campaign.abTest?.enabled && (campaign.abTest.subjectB || "").trim()) {
    const recs = campaign.recipients || [];
    const openedSet = new Set(openedRids);
    let aTotal = 0, bTotal = 0, aOpens = 0, bOpens = 0;
    recs.forEach((r, i) => {
      if (r.variant === "A") { aTotal++; if (openedSet.has(i)) aOpens++; }
      else if (r.variant === "B") { bTotal++; if (openedSet.has(i)) bOpens++; }
    });
    const aRate = aTotal ? aOpens / aTotal : 0;
    const bRate = bTotal ? bOpens / bTotal : 0;
    ab = {
      subjectA: campaign.subject,
      subjectB: campaign.abTest.subjectB,
      aTotal, bTotal, aOpens, bOpens, aRate, bRate,
      winner: aTotal && bTotal ? (aRate >= bRate ? "A" : "B") : null,
    };
  }
  const timelineAgg = await MailEvent.aggregate([
    { $match: { campaign: cid } },
    {
      $group: {
        _id: {
          bucket: {
            $dateToString: {
              format: "%Y-%m-%d %H:00",
              date: "$at",
              timezone: "Pacific/Noumea",
            },
          },
          kind: "$kind",
        },
        n: { $sum: 1 },
      },
    },
    { $sort: { "_id.bucket": 1 } },
  ]);
  const buckets = {};
  for (const t of timelineAgg) {
    const k = t._id.bucket;
    if (!buckets[k]) buckets[k] = { bucket: k, open: 0, click: 0 };
    buckets[k][t._id.kind] = t.n;
  }
  const topLinksAgg = await MailEvent.aggregate([
    { $match: { campaign: cid, kind: "click", url: { $nin: [null, ""] } } },
    { $group: { _id: "$url", n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 8 },
  ]);
  const sent = campaign.sentCount || 0;
  res.json({
    status: campaign.status,
    sent,
    total: campaign.recipientsTotal || 0,
    failed: campaign.failedCount || 0,
    uniqueOpens,
    totalOpens,
    uniqueClicks,
    totalClicks,
    openRate: sent ? uniqueOpens / sent : 0,
    clickRate: sent ? uniqueClicks / sent : 0,
    ctr: uniqueOpens ? uniqueClicks / uniqueOpens : 0,
    timeline: Object.values(buckets),
    topLinks: topLinksAgg.map((t) => ({ url: t._id, n: t.n })),
    ab,
  });
});

// ── Suivi & désinscription (PUBLIC, sans auth) ──

const htmlPage = (titre, corps) =>
  `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${titre}</title></head><body style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f2f4f7;color:#222;"><div style="max-width:480px;margin:60px auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center;">${corps}</div></body></html>`;

// @route GET /api/mailing/o/:token   → pixel d'ouverture 1×1
const trackOpen = asyncHandler(async (req, res) => {
  const d = verify(req.params.token);
  if (d && d.t === "r") {
    try {
      await MailEvent.create({ campaign: d.c, kind: "open", rid: d.r });
    } catch {
      /* jamais bloquant */
    }
  }
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
  res.end(PIXEL_GIF);
});

// @route GET /api/mailing/c/:token?u=<url>  → enregistre le clic + redirige
const trackClick = asyncHandler(async (req, res) => {
  const d = verify(req.params.token);
  const target = typeof req.query.u === "string" ? req.query.u : "";
  const safe = /^https?:\/\//i.test(target)
    ? target
    : process.env.FRONTEND_URL || "https://robot-nc.com";
  if (d && d.t === "r") {
    try {
      await MailEvent.create({ campaign: d.c, kind: "click", rid: d.r, url: safe });
    } catch {
      /* jamais bloquant */
    }
  }
  res.redirect(302, safe);
});

// @route GET /api/mailing/u/:token  → page de confirmation de désinscription
const unsubscribePage = asyncHandler(async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const d = verify(req.params.token);
  if (!d || d.t !== "u") {
    return res
      .status(400)
      .end(htmlPage("Lien invalide", "<h2>Lien invalide</h2><p>Ce lien de désinscription n'est pas valide.</p>"));
  }
  const already = await MailUnsubscribe.exists({
    entreprise: d.e,
    email: String(d.m).toLowerCase(),
  });
  if (already) {
    return res.end(
      htmlPage(
        "Déjà désinscrit",
        `<h2>Vous êtes déjà désinscrit</h2><p>L'adresse <b>${d.m}</b> ne reçoit plus nos emails.</p>`,
      ),
    );
  }
  res.end(
    htmlPage(
      "Se désinscrire",
      `<h2>Se désinscrire</h2><p>Confirmez la désinscription de <b>${d.m}</b>. Vous ne recevrez plus nos communications.</p>
       <form method="POST" action="/api/mailing/u/${req.params.token}" style="margin-top:20px;">
         <button type="submit" style="background:#ef4444;color:#fff;border:none;border-radius:8px;padding:12px 24px;font-size:15px;font-weight:600;cursor:pointer;">Confirmer la désinscription</button>
       </form>`,
    ),
  );
});

// @route POST /api/mailing/u/:token  → enregistre la désinscription (one-click)
const unsubscribeConfirm = asyncHandler(async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const d = verify(req.params.token);
  if (!d || d.t !== "u") {
    return res
      .status(400)
      .end(htmlPage("Lien invalide", "<h2>Lien invalide</h2>"));
  }
  await MailUnsubscribe.updateOne(
    { entreprise: d.e, email: String(d.m).toLowerCase() },
    { $setOnInsert: { entreprise: d.e, email: String(d.m).toLowerCase() } },
    { upsert: true },
  );
  res.end(
    htmlPage(
      "Désinscription confirmée",
      `<h2 style="color:#10b981;">Désinscription confirmée</h2><p>L'adresse <b>${d.m}</b> ne recevra plus nos emails.</p>`,
    ),
  );
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
};
