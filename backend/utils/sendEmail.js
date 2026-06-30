import nodemailer from "nodemailer";

/**
 * Envoi d'email via SMTP.
 *
 * options:
 *   - email       : destinataire(s) — string ou tableau de strings
 *   - subject     : sujet
 *   - html        : corps HTML
 *   - text        : (optionnel) corps texte
 *   - cc, bcc     : (optionnel) copie / copie cachée
 *   - attachments : (optionnel) tableau de pièces jointes nodemailer
 *                   ex: [{ filename: "rapport.pdf", path: "/chemin/rapport.pdf" }]
 *                       [{ filename: "x.pdf", content: <Buffer>, contentType: "application/pdf" }]
 */
const sendEmail = async (options) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

  // Destinataires : accepte string ou tableau
  const to = Array.isArray(options.email)
    ? options.email.filter(Boolean).join(", ")
    : options.email;

  const mailOptions = {
    from: `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_USER}>`,
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