// backend/services/reportDelivery.js
//
// Logique d'ENVOI d'un rapport, isolée du scheduler pour être réutilisable :
//   - deliverSubscription : envoi pour un abonnement existant (journalise lastRun).
//   - sendReportOnce      : envoi à la volée (test avant création), sans persistance.
//
// Les droits sont TOUJOURS re-vérifiés ici, au moment de l'envoi (module +
// entreprise + user actif), car ils ont pu changer depuis la configuration.

import User from "../models/UserModel.js";
import Permission from "../models/PermissionModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import sendEmail from "../utils/sendEmail.js";
import { getReport } from "../config/reportRegistry.js";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ── Miroir de checkModuleAccess : admin -> OK ; sinon allModules ou modules[k].read
export function hasModuleAccess(user, permission, moduleKey, action = "read") {
  if (user?.role === "admin") return true;
  if (!permission) return false;
  if (permission.allModules) return true;
  return !!permission.modules?.[moduleKey]?.[action];
}

// ── Miroir de checkEntrepriseAccess : PAS de bypass admin ; société accordée.
export function hasEntrepriseAccess(permission, entrepriseId) {
  if (!permission) return false;
  if (permission.allEntreprises) return true;
  return permission.entreprises.some(
    (e) => e.toString() === entrepriseId.toString(),
  );
}

// Charge et vérifie tout ce qu'il faut. Jette une erreur explicite sinon.
async function resolveAndCheck({ userId, entrepriseId, reportKey }) {
  const report = getReport(reportKey);
  if (!report || !report.disponible) {
    throw new Error(`Rapport « ${reportKey} » indisponible.`);
  }

  const user = await User.findById(userId);
  if (!user || !user.isActive) {
    throw new Error("Utilisateur inexistant ou désactivé.");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise || !entreprise.isActive) {
    throw new Error("Entreprise inexistante ou désactivée.");
  }

  const permission = await Permission.findOne({ user: userId });
  if (!hasModuleAccess(user, permission, report.moduleKey)) {
    throw new Error(`Accès au module « ${report.moduleKey} » révoqué.`);
  }
  if (!hasEntrepriseAccess(permission, entreprise._id)) {
    throw new Error("Accès à cette entreprise révoqué.");
  }

  return { report, user, entreprise };
}

// Type MIME d'après l'extension du fichier.
function mimeFor(filename) {
  if (/\.pdf$/i.test(filename)) return "application/pdf";
  if (/\.xlsx$/i.test(filename)) return XLSX_MIME;
  return undefined;
}

// Génère le(s) fichier(s) et les envoie. Retourne le message de succès. Jette sinon.
// generate() peut renvoyer soit { buffer, filename }, soit { attachments: [...] }.
async function runReport({ report, user, entreprise, periode, emailDestination, now }) {
  const out = await report.generate(entreprise, { periode, now });
  const files =
    out.attachments && out.attachments.length
      ? out.attachments
      : [{ buffer: out.buffer, filename: out.filename }];

  const attachments = files.map((f) => ({
    filename: f.filename,
    content: f.buffer,
    contentType: mimeFor(f.filename),
  }));

  const destinataire = emailDestination || user.email;
  if (!destinataire) throw new Error("Aucune adresse email de destination.");

  const societe = entreprise.nom || entreprise.nomDossierDBF;
  await sendEmail({
    email: destinataire,
    subject: `${report.label} — ${societe}`,
    html: `<p>Bonjour ${user.prenom || ""},</p>
           <p>Veuillez trouver ci-joint le rapport <strong>${report.label}</strong>
           pour <strong>${societe}</strong>.</p>
           <p>Email généré automatiquement.</p>`,
    text: `Bonjour,\n\nCi-joint le rapport "${report.label}" pour ${societe}.`,
    attachments,
  });

  return `Envoyé à ${destinataire}`;
}

// ── Journalise le résultat sur l'abonnement ──────────────────────────────────
async function recordRun(sub, status, message) {
  sub.lastRun = {
    at: new Date(),
    status,
    message: (message || "").slice(0, 500),
  };
  await sub.save();
  const line = `[reportDelivery] ${sub.reportKey} (sub ${sub._id}) : ${message}`;
  status === "error" ? console.error(line) : console.log(line);
}

// ── Envoi pour un abonnement existant (persiste lastRun) ─────────────────────
export async function deliverSubscription(sub, now = new Date()) {
  try {
    const { report, user, entreprise } = await resolveAndCheck({
      userId: sub.user,
      entrepriseId: sub.entreprise,
      reportKey: sub.reportKey,
    });
    const message = await runReport({
      report,
      user,
      entreprise,
      periode: sub.periode,
      emailDestination: sub.emailDestination,
      now,
    });
    await recordRun(sub, "success", message);
    return { ok: true };
  } catch (err) {
    await recordRun(sub, "error", err.message);
    return { ok: false, error: err.message };
  }
}

// ── Envoi à la volée (test avant création), sans rien persister ──────────────
export async function sendReportOnce({
  userId,
  entrepriseId,
  reportKey,
  periode,
  emailDestination,
  now = new Date(),
}) {
  try {
    const { report, user, entreprise } = await resolveAndCheck({
      userId,
      entrepriseId,
      reportKey,
    });
    const message = await runReport({
      report,
      user,
      entreprise,
      periode: periode || report.periodeDefaut,
      emailDestination,
      now,
    });
    return { ok: true, message };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export default deliverSubscription;