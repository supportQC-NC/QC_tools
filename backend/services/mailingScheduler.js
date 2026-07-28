// backend/services/mailingScheduler.js
//
// Envoi des campagnes PAR LOTS en tâche de fond (node-cron, chaque minute). Une
// campagne « en_cours » dont `nextBatchAt <= now` envoie ses `batchSize` (25)
// destinataires suivants (depuis `cursor`), puis planifie le lot suivant à
// `now + pauseMinutes` (60 min) — jusqu'à épuisement. VERROU OPTIMISTE : on
// « réserve » la campagne en repoussant `nextBatchAt` avant de traiter, pour ne
// pas la traiter deux fois. REPRENABLE : le curseur persistant évite de
// re-spammer toute la liste après un redémarrage.

import cron from "node-cron";
import MailCampaign from "../models/MailCampaignModel.js";
import { sendToRecipients } from "./mailingSender.js";

let running = false;

const sendNextBatch = async (campaign) => {
  const recipients = campaign.recipients || [];
  const start = campaign.cursor || 0;
  const batch = recipients.slice(start, start + (campaign.batchSize || 25));

  if (batch.length === 0) {
    campaign.status = "termine";
    campaign.nextBatchAt = null;
    campaign.finishedAt = new Date();
    await campaign.save();
    return;
  }

  const { sent, failed, errors } = await sendToRecipients(campaign, batch);
  campaign.sentCount = (campaign.sentCount || 0) + sent;
  campaign.failedCount = (campaign.failedCount || 0) + failed;
  campaign.cursor = start + batch.length;
  if (errors.length) campaign.lastError = errors.slice(0, 3).join(" | ");

  if (campaign.cursor >= recipients.length) {
    campaign.status = "termine";
    campaign.nextBatchAt = null;
    campaign.finishedAt = new Date();
  } else {
    const pause = campaign.pauseMinutes == null ? 60 : campaign.pauseMinutes;
    campaign.nextBatchAt = new Date(Date.now() + pause * 60000);
  }
  await campaign.save();
  console.log(
    `[mailing] ${campaign.nom}: +${sent} envoyé(s) (${campaign.cursor}/${recipients.length})`,
  );
};

const processDue = async () => {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    // Traite (au plus) toutes les campagnes dues, une par une.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Verrou optimiste : on repousse nextBatchAt (réservation 15 min) pour
      // qu'un autre tick ne reprenne pas la même campagne pendant l'envoi.
      const campaign = await MailCampaign.findOneAndUpdate(
        { status: "en_cours", nextBatchAt: { $lte: now } },
        { $set: { nextBatchAt: new Date(Date.now() + 15 * 60000) } },
        { sort: { nextBatchAt: 1 }, new: true },
      );
      if (!campaign) break;
      try {
        await sendNextBatch(campaign);
      } catch (e) {
        campaign.lastError = e.message;
        campaign.status = "erreur";
        campaign.nextBatchAt = null;
        await campaign.save();
        console.error(`[mailing] Campagne ${campaign._id} en erreur: ${e.message}`);
      }
    }
  } catch (e) {
    console.error("[mailingScheduler]", e.message);
  } finally {
    running = false;
  }
};

export const startMailingScheduler = () => {
  cron.schedule("* * * * *", processDue, { timezone: "Pacific/Noumea" });
  console.log("[mailingScheduler] démarré (envoi par lots)");
};

export default { startMailingScheduler };
