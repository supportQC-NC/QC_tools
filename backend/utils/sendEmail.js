import nodemailer from "nodemailer";
import { resolveSmtp, buildFrom } from "../services/smtpConfigService.js";

/**
 * Envoi d'email via SMTP.
 *
 * La config SMTP est résolue dynamiquement : .env (défaut) < surcharge « global »
 * (base) < surcharge du module (base). Le .env n'est jamais modifié.
 *
 * options:
 *   - email       : destinataire(s) — string ou tableau de strings
 *   - subject     : sujet
 *   - html        : corps HTML
 *   - text        : (optionnel) corps texte
 *   - cc, bcc     : (optionnel) copie / copie cachée
 *   - attachments : (optionnel) tableau de pièces jointes nodemailer
 *   - module      : (optionnel) clé de module pour une surcharge SMTP dédiée
 *                   (ex. "envoi_cde_fournisseur", "rapports", "comptes")
 *   - from        : (optionnel) force l'expéditeur ("Nom" <email>) — sinon résolu
 */
const sendEmail = async (options) => {
  const cfg = await resolveSmtp(options.module || null);

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });

  // Destinataires : accepte string ou tableau
  const to = Array.isArray(options.email)
    ? options.email.filter(Boolean).join(", ")
    : options.email;

  const mailOptions = {
    from: options.from || buildFrom(cfg),
    to,
    subject: options.subject,
    html: options.html,
  };

  if (options.text) mailOptions.text = options.text;
  if (options.cc) {
    mailOptions.cc = Array.isArray(options.cc)
      ? options.cc.filter(Boolean).join(", ")
      : options.cc;
  }
  if (options.bcc) {
    mailOptions.bcc = Array.isArray(options.bcc)
      ? options.bcc.filter(Boolean).join(", ")
      : options.bcc;
  }
  if (Array.isArray(options.attachments) && options.attachments.length > 0) {
    mailOptions.attachments = options.attachments;
  }

  await transporter.sendMail(mailOptions);
};

export default sendEmail;
