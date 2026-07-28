// backend/services/automationService.js
//
// Moteur des AUTOMATISATIONS (façon Brevo). Deux tâches :
//  1) detectAndEnroll()    : détecte les NOUVEAUX clients (DBF vs référentiel) et
//     les enrôle dans les automatisations « nouveau client » actives.
//  2) processDueEnrollments() : envoie l'étape due de chaque inscription active,
//     puis planifie l'étape suivante (délai) jusqu'à épuisement.
//
// SÉCURITÉ (jamais d'envoi massif rétroactif) :
//  - une automatisation est INACTIVE par défaut ;
//  - à l'activation, on SEED le référentiel (tous les clients actuels marqués
//    « connus ») SANS enrôler personne ;
//  - la détection n'enrôle QUE les emails apparus après le seed ;
//  - garde-fou : au plus MAX_ENROLL_PER_RUN nouvelles inscriptions par passe ;
//  - un contact désinscrit stoppe son inscription (pas d'envoi).

import MailAutomation from "../models/MailAutomationModel.js";
import MailAutomationEnrollment from "../models/MailAutomationEnrollmentModel.js";
import MailKnownContact from "../models/MailKnownContactModel.js";
import MailUnsubscribe from "../models/MailUnsubscribeModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import clientCacheService from "./clientCacheService.js";
import { sendToRecipients } from "./mailingSender.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ENROLL_PER_RUN = 300; // garde-fou anti-envoi massif
const MAX_PROCESS_PER_TICK = 50;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Emails clients actuels (avec ADMAIL valide) d'une société → Map email→nom.
const currentContacts = async (entreprise) => {
  const list = await clientCacheService.getMailRecipients(entreprise, {});
  const map = new Map();
  for (const r of list) if (r.email && !map.has(r.email)) map.set(r.email, r.nom || "");
  return map;
};

// Seed du référentiel « contacts connus » (à l'activation) — n'enrôle personne.
export const seedBaseline = async (entrepriseId) => {
  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) return 0;
  const map = await currentContacts(entreprise);
  const ops = [...map.keys()].map((email) => ({
    updateOne: {
      filter: { entreprise: entrepriseId, email },
      update: { $setOnInsert: { entreprise: entrepriseId, email } },
      upsert: true,
    },
  }));
  if (ops.length) await MailKnownContact.bulkWrite(ops, { ordered: false });
  return ops.length;
};

// Ajoute une liste de contacts {email, nom} à une automatisation « liste » :
// enrôle les nouveaux (dédup via l'index unique). Envoi effectif au prochain tick
// SI l'automatisation est active (sinon en attente jusqu'à l'activation).
export const addContacts = async (automation, contacts) => {
  let added = 0;
  let skipped = 0;
  let invalid = 0;
  for (const c of contacts || []) {
    const email = String(c?.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      invalid++;
      continue;
    }
    const ok = await enroll(automation, email, String(c?.nom || "").trim());
    if (ok) added++;
    else skipped++;
  }
  return { added, skipped, invalid };
};

// Enrôle un email dans une automatisation (idempotent via l'index unique).
const enroll = async (automation, email, nom) => {
  if (!automation.steps?.length) return false;
  const first = automation.steps[0];
  const nextRunAt = new Date(Date.now() + (first.delayDays || 0) * DAY_MS);
  try {
    await MailAutomationEnrollment.create({
      automation: automation._id,
      entreprise: automation.entreprise,
      email,
      nom,
      stepIndex: 0,
      nextRunAt,
      status: "active",
    });
    await MailAutomation.updateOne({ _id: automation._id }, { $inc: { enrolledCount: 1 } });
    return true;
  } catch {
    // doublon (déjà enrôlé) → ignoré
    return false;
  }
};

// Détecte les nouveaux clients et les enrôle dans les automatisations actives.
export const detectAndEnroll = async () => {
  const autos = await MailAutomation.find({
    active: true,
    "trigger.type": "nouveau_client",
  });
  if (!autos.length) return;

  // Regroupe les automatisations actives par société.
  const byEnt = new Map();
  for (const a of autos) {
    const k = String(a.entreprise);
    if (!byEnt.has(k)) byEnt.set(k, []);
    byEnt.get(k).push(a);
  }

  for (const [entId, list] of byEnt) {
    const entreprise = await Entreprise.findById(entId);
    if (!entreprise) continue;
    const map = await currentContacts(entreprise);
    const known = new Set(
      (await MailKnownContact.find({ entreprise: entId }).select("email -_id")).map((k) => k.email),
    );

    // Sécurité : si le référentiel est vide (jamais seedé), on seed SANS enrôler.
    if (known.size === 0) {
      await seedBaseline(entId);
      continue;
    }

    const fresh = [...map.keys()].filter((e) => !known.has(e)).slice(0, MAX_ENROLL_PER_RUN);
    if (!fresh.length) continue;

    // Marque connus + enrôle dans chaque automatisation active de la société.
    await MailKnownContact.bulkWrite(
      fresh.map((email) => ({
        updateOne: {
          filter: { entreprise: entId, email },
          update: { $setOnInsert: { entreprise: entId, email } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    for (const email of fresh) {
      for (const a of list) await enroll(a, email, map.get(email) || "");
    }
  }
};

// Construit une pseudo-campagne pour réutiliser le rendu + l'envoi.
const stepToPseudo = (automation, step) => ({
  _id: automation._id,
  entreprise: automation.entreprise,
  subject: step.subject || automation.nom,
  replyTo: step.replyTo || "",
  design: step.design || { blocks: [] },
});

// Traite les inscriptions dues (envoie l'étape courante puis avance).
export const processDueEnrollments = async () => {
  const now = new Date();
  const due = await MailAutomationEnrollment.find({
    status: "active",
    nextRunAt: { $lte: now },
  })
    .sort({ nextRunAt: 1 })
    .limit(MAX_PROCESS_PER_TICK);

  for (const enr of due) {
    const automation = await MailAutomation.findById(enr.automation);
    if (!automation) {
      // Automatisation supprimée → on stoppe l'inscription.
      enr.status = "stopped";
      await enr.save();
      continue;
    }
    if (!automation.active) {
      // En pause : on attend l'activation (report à +1 h, ne pas stopper).
      enr.nextRunAt = new Date(Date.now() + 60 * 60 * 1000);
      await enr.save();
      continue;
    }
    // Contact désinscrit → on stoppe (pas d'envoi).
    const unsub = await MailUnsubscribe.exists({ entreprise: enr.entreprise, email: enr.email });
    if (unsub) {
      enr.status = "stopped";
      await enr.save();
      continue;
    }
    const step = automation.steps[enr.stepIndex];
    if (!step) {
      enr.status = "done";
      await enr.save();
      continue;
    }
    try {
      await sendToRecipients(stepToPseudo(automation, step), [{ email: enr.email, nom: enr.nom }], {
        track: false,
        unsub: true,
      });
      await MailAutomation.updateOne({ _id: automation._id }, { $inc: { sentCount: 1 } });
    } catch (e) {
      console.error(`[automation] envoi échoué ${enr.email}: ${e.message}`);
    }
    enr.stepIndex += 1;
    if (enr.stepIndex >= automation.steps.length) {
      enr.status = "done";
      enr.nextRunAt = null;
    } else {
      const nextStep = automation.steps[enr.stepIndex];
      enr.nextRunAt = new Date(Date.now() + (nextStep.delayDays || 0) * DAY_MS);
    }
    await enr.save();
  }
};

// Envoi de TEST : toutes les étapes, immédiatement, vers des adresses de test
// (aucun enrôlement, aucun contact de la base touché).
export const testAutomation = async (automation, emails) => {
  const recipients = (emails || []).filter(Boolean).map((email) => ({ email, nom: "Test" }));
  let sent = 0;
  let failed = 0;
  for (const step of automation.steps || []) {
    const r = await sendToRecipients(stepToPseudo(automation, step), recipients, {
      track: false,
      unsub: false,
    });
    sent += r.sent;
    failed += r.failed;
  }
  return { sent, failed, steps: (automation.steps || []).length };
};

export default {
  seedBaseline,
  detectAndEnroll,
  processDueEnrollments,
  testAutomation,
  addContacts,
};
