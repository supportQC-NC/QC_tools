// backend/services/mailingSender.js
//
// Envoi des mailings. UN transport nodemailer POOLÉ réutilisé (≠ utils/sendEmail
// qui recrée un transport à chaque appel), envoi PAR DESTINATAIRE (jamais un To:
// partagé → pas de fuite d'adresses + meilleure délivrabilité). From = adresse
// SMTP configurée (alignée SPF/DKIM), Reply-To de la campagne.

import nodemailer from "nodemailer";
import { renderCampaign } from "./mailRenderService.js";
import {
  recipientToken,
  unsubToken,
  unsubUrl,
  injectTracking,
} from "./mailTracking.js";

let _transport = null;
const getTransport = () => {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      pool: true,
      maxConnections: 2,
      maxMessages: 50,
    });
  }
  return _transport;
};

const fromHeader = () =>
  `"${process.env.SMTP_FROM_NAME || "Quincaillerie"}" <${process.env.SMTP_USER}>`;

// Domaine PUBLIC des emails (pixel d'ouverture, liens traçés, désinscription).
// On N'UTILISE PLUS CLIENT_URL (souvent = http://localhost en dev) : des liens
// localhost dans un vrai email sont injoignables ET un fort signal SPAM. On force
// le domaine de PROD par défaut. Override possible via FRONTEND_URL.
const baseUrl = () => process.env.FRONTEND_URL || "https://robot-nc.com";

// Variables de personnalisation : {{nom}}, {{email}} avec repli {{nom|Cher client}}.
const TAG_RE = /\{\{\s*([a-zA-Z]+)\s*(?:\|([^}]*))?\}\}/g;
const applyMerge = (str, r) =>
  String(str == null ? "" : str).replace(TAG_RE, (_m, key, fallback) => {
    const k = String(key).toLowerCase();
    const raw = k === "nom" ? r.nom : k === "email" ? r.email : "";
    const val = raw && String(raw).trim();
    return val || (fallback != null ? fallback : "");
  });

// Envoie le rendu de la campagne à une liste de destinataires (1 mail chacun).
// opts.track = suivi ouvertures/clics + lien de désinscription réel (envoi RÉEL) ;
// opts.startIndex = index global du 1er destinataire du lot (pour le rid unique).
// En mode test (track=false), aucun suivi et {{unsubscribe_url}} → "#".
export const sendToRecipients = async (campaign, recipients, opts = {}) => {
  const { track = false, startIndex = 0 } = opts;
  // Lien de désinscription RÉEL dès qu'on suit la campagne OU si demandé
  // explicitement (automatisations : pas de tracking mais désinscription active).
  const realUnsub = track || opts.unsub === true;
  const base = baseUrl();
  const { html, text } = renderCampaign(campaign.design || {}, { baseUrl: base });
  const transporter = getTransport();
  const subject = campaign.subject || "(sans objet)";
  const subjectB = campaign.abTest?.subjectB || subject;
  const replyTo = campaign.replyTo || undefined;

  let sent = 0;
  let failed = 0;
  const errors = [];
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const rec = typeof r === "string" ? { email: r, nom: "" } : r || {};
    const to = rec.email;
    if (!to) continue;

    const uUrl = realUnsub ? unsubUrl(base, unsubToken(campaign.entreprise, to)) : "#";
    let htmlOut = applyMerge(html, rec);
    if (track) {
      htmlOut = injectTracking(htmlOut, base, recipientToken(campaign._id, startIndex + i));
    }
    htmlOut = htmlOut.split("{{unsubscribe_url}}").join(uUrl);
    const textOut = applyMerge(text, rec).split("{{unsubscribe_url}}").join(uUrl);

    const headers = track
      ? {
          "List-Unsubscribe": `<${uUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        }
      : undefined;

    try {
      const subj = rec.variant === "B" ? subjectB : subject;
      await transporter.sendMail({
        from: fromHeader(),
        to,
        replyTo,
        subject: applyMerge(subj, rec),
        html: htmlOut,
        text: textOut,
        headers,
      });
      sent++;
    } catch (e) {
      failed++;
      if (errors.length < 5) errors.push(`${to}: ${e.message}`);
    }
  }
  return { sent, failed, errors };
};

// Envoi de TEST immédiat vers une liste d'emails (aucun suivi, aucune blacklist).
export const sendTest = async (campaign, emails) =>
  sendToRecipients(campaign, (emails || []).filter(Boolean), { track: false });

export default { sendToRecipients, sendTest };
