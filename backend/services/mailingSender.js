// backend/services/mailingSender.js
//
// Envoi des mailings. UN transport nodemailer POOLÉ réutilisé (≠ utils/sendEmail
// qui recrée un transport à chaque appel), envoi PAR DESTINATAIRE (jamais un To:
// partagé → pas de fuite d'adresses + meilleure délivrabilité). From = adresse
// SMTP configurée (alignée SPF/DKIM), Reply-To de la campagne.

import nodemailer from "nodemailer";
import { renderCampaign } from "./mailRenderService.js";

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

const baseUrl = () =>
  process.env.FRONTEND_URL || process.env.CLIENT_URL || "https://robot-nc.com";

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
export const sendToRecipients = async (campaign, recipients) => {
  const { html, text } = renderCampaign(campaign.design || {}, {
    baseUrl: baseUrl(),
  });
  const transporter = getTransport();
  const subject = campaign.subject || "(sans objet)";
  const replyTo = campaign.replyTo || undefined;

  let sent = 0;
  let failed = 0;
  const errors = [];
  for (const r of recipients) {
    const rec = typeof r === "string" ? { email: r, nom: "" } : r || {};
    const to = rec.email;
    if (!to) continue;
    try {
      await transporter.sendMail({
        from: fromHeader(),
        to,
        replyTo,
        subject: applyMerge(subject, rec),
        html: applyMerge(html, rec),
        text: applyMerge(text, rec),
      });
      sent++;
    } catch (e) {
      failed++;
      if (errors.length < 5) errors.push(`${to}: ${e.message}`);
    }
  }
  return { sent, failed, errors };
};

// Envoi de TEST immédiat vers une liste d'emails.
export const sendTest = async (campaign, emails) =>
  sendToRecipients(campaign, (emails || []).filter(Boolean));

export default { sendToRecipients, sendTest };
