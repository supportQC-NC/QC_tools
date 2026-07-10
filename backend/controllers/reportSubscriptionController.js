// backend/controllers/reportSubscriptionController.js
//
// Gestion par l'utilisateur de SES propres abonnements aux rapports planifiés.
// Toutes les routes sont protégées (protect) et limitées au user courant.

import asyncHandler from "../middleware/asyncHandler.js";
import ReportSubscription from "../models/ReportSubscriptionModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import Permission from "../models/PermissionModel.js";
import { listReports, getReport } from "../config/reportRegistry.js";
import {
  deliverSubscription,
  sendReportOnce,
  hasModuleAccess,
  hasEntrepriseAccess,
} from "../services/reportDelivery.js";

// GET /api/report-subscriptions/available
// -> rapports autorisés + entreprises accessibles (pour le formulaire).
const getAvailableOptions = asyncHandler(async (req, res) => {
  const permission = await Permission.findOne({ user: req.user._id });

  const reports = listReports()
    .filter((r) => hasModuleAccess(req.user, permission, r.moduleKey))
    .map((r) => ({
      key: r.key,
      label: r.label,
      periodes: r.periodes,
      periodeDefaut: r.periodeDefaut,
    }));

  let entreprises = [];
  if (permission?.allEntreprises) {
    entreprises = await Entreprise.find({ isActive: true }).select(
      "_id nom nomDossierDBF",
    );
  } else if (permission?.entreprises?.length) {
    entreprises = await Entreprise.find({
      _id: { $in: permission.entreprises },
      isActive: true,
    }).select("_id nom nomDossierDBF");
  }

  res.json({ reports, entreprises });
});

// GET /api/report-subscriptions  -> abonnements du user courant.
const getMySubscriptions = asyncHandler(async (req, res) => {
  const subs = await ReportSubscription.find({ user: req.user._id })
    .populate("entreprise", "nom nomDossierDBF")
    .sort({ createdAt: -1 });
  res.json(subs);
});

// Valide l'accès du user à un rapport + une entreprise. Jette une 400/403 sinon.
async function assertAccess(req, res, reportKey, entrepriseId) {
  const report = getReport(reportKey);
  if (!report || !report.disponible) {
    res.status(400);
    throw new Error("Rapport inconnu ou indisponible.");
  }

  const permission = await Permission.findOne({ user: req.user._id });
  if (!hasModuleAccess(req.user, permission, report.moduleKey)) {
    res.status(403);
    throw new Error("Vous n'avez pas accès à ce rapport.");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise || !entreprise.isActive) {
    res.status(400);
    throw new Error("Entreprise inconnue ou désactivée.");
  }
  if (!hasEntrepriseAccess(permission, entreprise._id)) {
    res.status(403);
    throw new Error("Vous n'avez pas accès à cette entreprise.");
  }

  if (req.body.periode && !report.periodes.includes(req.body.periode)) {
    res.status(400);
    throw new Error("Période non supportée pour ce rapport.");
  }
}

// Cohérence de la planification (champ « jour » selon la fréquence).
function assertPlanning(req, res) {
  const { frequence, jourDuMois, jourDeSemaine } = req.body;
  if (!["journalier", "hebdomadaire", "mensuel"].includes(frequence)) {
    res.status(400);
    throw new Error("Fréquence invalide (journalier, hebdomadaire ou mensuel).");
  }
  if (frequence === "mensuel" && (jourDuMois == null || jourDuMois < 1 || jourDuMois > 28)) {
    res.status(400);
    throw new Error("jourDuMois requis (1 à 28) pour une fréquence mensuelle.");
  }
  if (frequence === "hebdomadaire" && (jourDeSemaine == null || jourDeSemaine < 0 || jourDeSemaine > 6)) {
    res.status(400);
    throw new Error("jourDeSemaine requis (0=dimanche à 6=samedi) pour une fréquence hebdomadaire.");
  }
}

// POST /api/report-subscriptions/test  -> envoi immédiat SANS créer d'abonnement.
const testConfig = asyncHandler(async (req, res) => {
  const { reportKey, entreprise, periode, emailDestination } = req.body;
  if (!reportKey || !entreprise) {
    res.status(400);
    throw new Error("Choisissez un rapport et une entreprise.");
  }
  await assertAccess(req, res, reportKey, entreprise);

  const result = await sendReportOnce({
    userId: req.user._id,
    entrepriseId: entreprise,
    reportKey,
    periode,
    emailDestination: emailDestination?.trim() || "",
    now: new Date(),
  });
  if (!result.ok) {
    res.status(400);
    throw new Error(result.error || "Échec de l'envoi de test.");
  }
  res.json({ message: "Rapport envoyé." });
});

// POST /api/report-subscriptions
const createSubscription = asyncHandler(async (req, res) => {
  const {
    reportKey,
    entreprise,
    frequence,
    jourDuMois,
    jourDeSemaine,
    heure,
    minute,
    periode,
    emailDestination,
  } = req.body;

  assertPlanning(req, res);
  await assertAccess(req, res, reportKey, entreprise);

  try {
    const sub = await ReportSubscription.create({
      user: req.user._id,
      reportKey,
      entreprise,
      frequence,
      jourDuMois,
      jourDeSemaine,
      heure,
      minute,
      periode,
      emailDestination: emailDestination?.trim() || "",
    });
    res.status(201).json(sub);
  } catch (err) {
    if (err.code === 11000) {
      res.status(400);
      throw new Error("Vous êtes déjà abonné à ce rapport pour cette entreprise.");
    }
    throw err;
  }
});

// PUT /api/report-subscriptions/:id
const updateSubscription = asyncHandler(async (req, res) => {
  const sub = await ReportSubscription.findOne({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!sub) {
    res.status(404);
    throw new Error("Abonnement introuvable.");
  }

  const reportKey = req.body.reportKey ?? sub.reportKey;
  const entreprise = req.body.entreprise ?? sub.entreprise;

  if (req.body.frequence !== undefined) assertPlanning(req, res);
  await assertAccess(req, res, reportKey, entreprise);

  const champs = [
    "reportKey",
    "entreprise",
    "frequence",
    "jourDuMois",
    "jourDeSemaine",
    "heure",
    "minute",
    "periode",
    "emailDestination",
    "actif",
  ];
  champs.forEach((c) => {
    if (req.body[c] !== undefined) sub[c] = req.body[c];
  });

  const updated = await sub.save();
  res.json(updated);
});

// DELETE /api/report-subscriptions/:id
const deleteSubscription = asyncHandler(async (req, res) => {
  const sub = await ReportSubscription.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!sub) {
    res.status(404);
    throw new Error("Abonnement introuvable.");
  }
  res.json({ message: "Abonnement supprimé." });
});

// POST /api/report-subscriptions/:id/test  -> envoi immédiat d'un abonnement existant.
const testSubscription = asyncHandler(async (req, res) => {
  const sub = await ReportSubscription.findOne({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!sub) {
    res.status(404);
    throw new Error("Abonnement introuvable.");
  }

  const result = await deliverSubscription(sub, new Date());
  if (!result.ok) {
    res.status(400);
    throw new Error(result.error || "Échec de l'envoi de test.");
  }
  res.json({ message: "Rapport envoyé.", lastRun: sub.lastRun });
});

export {
  getAvailableOptions,
  getMySubscriptions,
  testConfig,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  testSubscription,
};