// backend/services/reportScheduler.js
//
// Planificateur d'envoi des rapports Excel par email.
// ⚠️ Remplace la version précédente : la logique d'envoi a été déplacée dans
//    reportDelivery.js (réutilisée par le controller pour l'envoi de test).
//
// Prérequis : npm i node-cron
// Démarrage (server.js, après connexion Mongo) :
//     import { startReportScheduler } from "./services/reportScheduler.js";
//     startReportScheduler();
//
// Toutes les minutes :
//   1. Sélectionne les abonnements dus (actif + nextRunAt <= maintenant).
//   2. Les « réclame » atomiquement (verrou optimiste sur nextRunAt) : en cas
//      de plusieurs instances, une seule gagne -> pas de double envoi.
//   3. Délègue l'envoi à deliverSubscription (re-check des droits + email).
//
// Fuseau imposé : "Pacific/Noumea" (robuste à un futur hébergement en UTC).

import cron from "node-cron";

import ReportSubscription from "../models/ReportSubscriptionModel.js";
import { deliverSubscription } from "./reportDelivery.js";

const TIMEZONE = "Pacific/Noumea";
const CADENCE = "* * * * *"; // toutes les minutes

let running = false; // évite le chevauchement de deux cycles dans un même process

async function runDueSubscriptions(now = new Date()) {
  const due = await ReportSubscription.find({
    actif: true,
    nextRunAt: { $lte: now },
  });

  for (const sub of due) {
    const previous = sub.nextRunAt;
    const next = sub.computeNextRunAt(now); // occurrence strictement après `now`

    // Verrou optimiste : ne réussit que si nextRunAt vaut encore `previous`.
    const claimed = await ReportSubscription.findOneAndUpdate(
      { _id: sub._id, nextRunAt: previous, actif: true },
      { $set: { nextRunAt: next } },
      { new: true },
    );

    if (!claimed) continue; // déjà pris par une autre instance / un autre tick
    await deliverSubscription(claimed, now);
  }
}

export function startReportScheduler() {
  cron.schedule(
    CADENCE,
    async () => {
      if (running) return;
      running = true;
      try {
        await runDueSubscriptions(new Date());
      } catch (err) {
        console.error("[reportScheduler] cycle en erreur :", err);
      } finally {
        running = false;
      }
    },
    { timezone: TIMEZONE },
  );

  console.log(`[reportScheduler] démarré (cadence "${CADENCE}", TZ ${TIMEZONE}).`);
}

export default startReportScheduler;