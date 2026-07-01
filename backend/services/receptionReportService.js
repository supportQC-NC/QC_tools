// // backend/services/receptionReportService.js
// import fs from "fs";
// import path from "path";
// import sendEmail from "../utils/sendEmail.js";

// // ===========================================
// // HELPERS GÉNÉRIQUES
// // ===========================================

// /** Nettoie un nom pour en faire un nom de fichier valide (Windows/Linux). */
// export const sanitizeFileName = (nom) =>
//   String(nom || "")
//     .replace(/[\\/:*?"<>|]/g, "_")
//     .replace(/\s+/g, " ")
//     .trim()
//     .slice(0, 150) || "rapport";

// const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// const pad2 = (n) => String(n).padStart(2, "0");

// /** Date -> "AAAA-MM-JJ" (ou "" si invalide). */
// const dateToYmd = (d) => {
//   if (!(d instanceof Date) || isNaN(d.getTime())) {
//     const parsed = d ? new Date(d) : null;
//     if (!parsed || isNaN(parsed.getTime())) return "";
//     d = parsed;
//   }
//   return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
// };

// /** Date -> "JJ/MM/AAAA HH:mm" (fr). */
// const formatDateFr = (d) =>
//   new Date(d).toLocaleString("fr-FR", {
//     day: "2-digit",
//     month: "2-digit",
//     year: "numeric",
//     hour: "2-digit",
//     minute: "2-digit",
//   });

// /** Date -> "JJ/MM/AAAA" (ou "" si vide/invalide). */
// const formatDateOnly = (d) => {
//   if (!d) return "";
//   const dd = d instanceof Date ? d : new Date(d);
//   if (isNaN(dd.getTime())) return "";
//   return `${pad2(dd.getDate())}/${pad2(dd.getMonth() + 1)}/${dd.getFullYear()}`;
// };

// // ===========================================
// // NOM DE FICHIER : n°commande_date_nomFournisseur.pdf
// // ===========================================
// export const genererNomFichier = (reception) => {
//   const numcde = safeTrim(reception.numcde) || "commande";
//   const dateStr =
//     dateToYmd(reception.commandeInfo?.arrivee) ||
//     dateToYmd(reception.controleDebutAt) ||
//     dateToYmd(new Date());
//   const fournisseur =
//     safeTrim(reception.commandeInfo?.fournisseurNom) ||
//     (reception.commandeInfo?.fourn != null
//       ? `fourn${reception.commandeInfo.fourn}`
//       : "fournisseur");
//   return `${sanitizeFileName(`${numcde}_${dateStr}_${fournisseur}`)}.pdf`;
// };

// // ===========================================
// // CONSTRUCTION DES LIGNES DU RAPPORT
// // ===========================================
// /**
//  * Construit les lignes du tableau du rapport à partir d'une session de réception.
//  * - Détail des articles : lignes de la commande DANS L'ORDRE (NL), enrichies du comptage.
//  *   Les articles non trouvés apparaissent avec 0 compté et un écart.
//  * - Articles hors commande / gencodes inconnus : listés ensuite (gencode dans
//  *   la colonne "Genecode nouveau").
//  *
//  * @returns { rows, stats }
//  */
// export const construireLignesRapport = (reception) => {
//   const lignesCommande = reception.lignesCommande || [];
//   const comptages = reception.comptages || [];

//   // Index des comptages "dans la commande" par NART (clé normalisée)
//   const normNart = (s) => String(s || "").trim().toUpperCase();
//   const comptageByNart = new Map();
//   comptages.forEach((c) => {
//     if (c.nart && !c.isInconnu) comptageByNart.set(normNart(c.nart), c);
//   });

//   const rows = [];
//   let n = 0;
//   let nbEcarts = 0;
//   let nbNonTrouves = 0;

//   // --- Détail des articles de la commande (ordre commande) ---
//   lignesCommande.forEach((l) => {
//     n += 1;
//     const c = comptageByNart.get(normNart(l.nart));
//     const qteComptee = c ? c.qteComptee : 0;
//     const qteValidee = c
//       ? c.qteValidee != null
//         ? c.qteValidee
//         : c.qteComptee
//       : 0;
//     const ecart = qteValidee - (l.qteCommandee || 0);
//     const nonTrouve = !c;
//     if (nonTrouve) nbNonTrouves += 1;
//     if (ecart !== 0) nbEcarts += 1;

//     rows.push({
//       n,
//       code: l.nart,
//       designation: l.designation,
//       gencode: l.gencod,
//       qteCmd: l.qteCommandee,
//       qteBip: qteComptee,
//       qteVal: qteValidee,
//       ecart,
//       ecartType: ecart > 0 ? "surplus" : ecart < 0 ? "manquant" : "",
//       nouv: (l.estNouveau || c?.estNouveau) ? "OUI" : "",
//       estNouveau: !!(l.estNouveau || c?.estNouveau),
//       gencodeNouveau: c?.nouveauGencode?.gencode || "",
//       enDefaut: ecart !== 0,
//       section: "commande",
//     });
//   });

//   // --- Articles hors commande / gencodes inconnus ---
//   const horsCommande = comptages.filter((c) => !c.dansCommande || c.isInconnu);
//   if (horsCommande.length > 0) {
//     rows.push({ separator: "ARTICLES HORS COMMANDE / GENCODES INCONNUS" });
//     horsCommande.forEach((c) => {
//       n += 1;
//       const qteVal = c.qteValidee != null ? c.qteValidee : c.qteComptee;
//       rows.push({
//         n,
//         code: c.nart || "",
//         designation: c.isInconnu ? "GENCODE INCONNU" : c.designation,
//         gencode: c.gencod || "",
//         qteCmd: "",
//         qteBip: c.qteComptee,
//         qteVal,
//         ecart: "",
//         nouv: c.estNouveau ? "OUI" : "",
//         estNouveau: !!c.estNouveau,
//         gencodeNouveau: c.nouveauGencode?.gencode || c.gencodeScanne || "",
//         enDefaut: c.isInconnu,
//         section: "hors",
//       });
//     });
//   }

//   const stats = {
//     totalLignesCommande: lignesCommande.length,
//     nbEcarts,
//     nbNonTrouves,
//     nbHorsCommande: horsCommande.length,
//   };

//   return { rows, stats };
// };

// // ===========================================
// // GÉNÉRATION PDF (même gabarit que ficheControleService)
// // ===========================================
// const COLS = [
//   { key: "n", label: "N°", w: 24, align: "center" },
//   { key: "code", label: "CODE", w: 50, align: "left" },
//   { key: "designation", label: "DÉSIGNATION", w: 132, align: "left" },
//   { key: "gencode", label: "GENCODE", w: 72, align: "left" },
//   { key: "qteCmd", label: "CMD", w: 38, align: "center" },
//   { key: "qteBip", label: "BIP", w: 38, align: "center" },
//   { key: "qteVal", label: "VAL", w: 38, align: "center" },
//   { key: "ecart", label: "ÉCART", w: 38, align: "center" },
//   { key: "nouv", label: "NOUV.", w: 30, align: "center" },
//   { key: "gencodeNouveau", label: "GENCODE NOUV.", w: 75, align: "left" },
// ];

// /** Tronque un texte avec … pour qu'il tienne dans maxWidth (police courante). */
// const fitText = (doc, text, maxWidth) => {
//   const str = text == null ? "" : String(text);
//   if (!str) return "";
//   if (doc.widthOfString(str) <= maxWidth) return str;
//   let t = str;
//   while (t.length > 1 && doc.widthOfString(t + "…") > maxWidth) {
//     t = t.slice(0, -1);
//   }
//   return t + "…";
// };

// /**
//  * Écrit le PDF du rapport de réception.
//  * @param {{ header: object, rows: array, commentaire: string, outPath: string }}
//  */
// export const ecrirePDFReception = async ({
//   header,
//   rows,
//   commentaire,
//   outPath,
// }) => {
//   const mod = await import("pdfkit").catch(() => {
//     throw new Error(
//       "Module 'pdfkit' introuvable. Lancez : npm i pdfkit (backend).",
//     );
//   });
//   const PDFDocument = mod.default;

//   const margin = 30;
//   const doc = new PDFDocument({ size: "A4", margin });
//   const stream = fs.createWriteStream(outPath);
//   doc.pipe(stream);

//   const left = margin;
//   const right = doc.page.width - margin;
//   const tableWidth = COLS.reduce((s, c) => s + c.w, 0);

//   // ---- Titre ----
//   doc
//     .font("Helvetica-Bold")
//     .fontSize(16)
//     .text("RAPPORT DE RÉCEPTION DE MARCHANDISES", left, margin, {
//       width: right - left,
//       align: "center",
//     });

//   let y = margin + 30;

//   // ---- Bloc informations générales (2 colonnes, 3 lignes) ----
//   const infoH = 18;
//   const colB = left + (right - left) / 2;
//   const drawInfo = (x, w, label, value) => {
//     doc
//       .font("Helvetica-Bold")
//       .fontSize(9)
//       .text(`${label} :`, x + 4, y + 5, { width: 78 });
//     doc
//       .font("Helvetica")
//       .fontSize(9)
//       .text(value || "", x + 84, y + 5, { width: w - 88, lineBreak: false });
//   };

//   const blocH = infoH * 3;
//   doc.rect(left, y, right - left, blocH).stroke();
//   doc.moveTo(colB, y).lineTo(colB, y + blocH).stroke();
//   doc.moveTo(left, y + infoH).lineTo(right, y + infoH).stroke();
//   doc.moveTo(left, y + infoH * 2).lineTo(right, y + infoH * 2).stroke();

//   const halfW = (right - left) / 2;
//   drawInfo(left, halfW, "Commande", header.numcde);
//   drawInfo(colB, halfW, "Fournisseur", header.fournisseur);
//   y += infoH;
//   drawInfo(left, halfW, "Arrivée", header.arrivee);
//   drawInfo(colB, halfW, "Bateau", header.bateau);
//   y += infoH;
//   drawInfo(left, halfW, "Date contrôle", header.dateControle);
//   drawInfo(colB, halfW, "Opérateur", header.operateur);
//   y += infoH + 10;

//   // ---- Table ----
//   const rowH = 16;
//   const drawHeader = () => {
//     let x = left;
//     doc.rect(left, y, tableWidth, rowH).fillAndStroke("#e8e8e8", "#000");
//     doc.fillColor("#000").font("Helvetica-Bold").fontSize(7.5);
//     COLS.forEach((c) => {
//       doc.text(c.label, x + 2, y + 5, { width: c.w - 4, align: c.align, lineBreak: false });
//       x += c.w;
//     });
//     y += rowH;
//   };

//   const ensureSpace = () => {
//     if (y + rowH > doc.page.height - margin - 24) {
//       doc.addPage();
//       y = margin;
//       drawHeader();
//     }
//   };

//   drawHeader();
//   doc.font("Helvetica").fontSize(7.5);

//   rows.forEach((r) => {
//     ensureSpace();

//     // Ligne séparateur de section
//     if (r.separator) {
//       doc.save();
//       doc.rect(left, y, tableWidth, rowH).fill("#cfd8e3");
//       doc.restore();
//       doc
//         .fillColor("#000")
//         .font("Helvetica-Bold")
//         .fontSize(7.5)
//         .text(r.separator, left + 4, y + 5, {
//           width: tableWidth - 8,
//           align: "left",
//           lineBreak: false,
//         });
//       doc.strokeColor("#999").rect(left, y, tableWidth, rowH).stroke();
//       y += rowH;
//       doc.font("Helvetica").fontSize(7.5);
//       return;
//     }

//     let x = left;

//     // Ligne en défaut : teinte selon le type (surplus / manquant / autre).
//     // Couleurs claires -> restent lisibles, et impriment toutes en gris clair en N&B.
//     if (r.enDefaut) {
//       const fill =
//         r.ecartType === "surplus"
//           ? "#dbe7f5" // bleu clair = surplus
//           : r.ecartType === "manquant"
//             ? "#f3dede" // rouge clair = manquant
//             : "#e6e6e6"; // gris clair = inconnu / autre
//       doc.save();
//       doc.rect(left, y, tableWidth, rowH).fill(fill);
//       doc.restore();
//     }

//     doc.strokeColor("#999");
//     COLS.forEach((c) => {
//       doc.rect(x, y, c.w, rowH).stroke();

//       let raw =
//         r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key]);
//       let color = "#000";

//       // Colonne ÉCART : signe explicite (+/-) et couleur (lisible à l'écran,
//       // le signe restant la distinction fiable en impression N&B).
//       if (c.key === "ecart" && typeof r.ecart === "number" && r.ecart !== 0) {
//         raw = r.ecart > 0 ? `+${r.ecart}` : String(r.ecart);
//         color = r.ecart > 0 ? "#1f6feb" : "#c0392b";
//       }

//       // Colonne NOUV. : "OUI" en orange si nouveauté.
//       if (c.key === "nouv" && r.estNouveau) {
//         color = "#b9770e";
//       }

//       const val = fitText(doc, raw, c.w - 4);
//       doc
//         .fillColor(color)
//         .text(val, x + 2, y + 5, {
//           width: c.w - 4,
//           align: c.align,
//           lineBreak: false,
//         });
//       x += c.w;
//     });
//     y += rowH;
//   });

//   // ---- Légende ----
//   y += 8;
//   if (y > doc.page.height - margin - 90) {
//     doc.addPage();
//     y = margin;
//   }
//   doc
//     .fillColor("#000")
//     .font("Helvetica")
//     .fontSize(7.5)
//     .text("Légende écart :  ", left, y, { continued: true })
//     .fillColor("#1f6feb")
//     .text("+N = surplus", { continued: true })
//     .fillColor("#000")
//     .text("   |   ", { continued: true })
//     .fillColor("#c0392b")
//     .text("-N = manquant", { continued: true })
//     .fillColor("#000")
//     .text("   |   ", { continued: true })
//     .fillColor("#b9770e")
//     .text("NOUV. = nouveauté (V1..V12 = 0)", { continued: true })
//     .fillColor("#000")
//     .text("   |   lignes grisées = écart à traiter / gencode inconnu");

//   // ---- Commentaire ----
//   y += 16;
//   if (y > doc.page.height - margin - 60) {
//     doc.addPage();
//     y = margin;
//   }
//   doc
//     .fillColor("#000")
//     .font("Helvetica-Bold")
//     .fontSize(9)
//     .text("COMMENTAIRE :", left, y);
//   y += 14;
//   const commentH = 50;
//   doc.strokeColor("#000").rect(left, y, right - left, commentH).stroke();
//   doc
//     .font("Helvetica")
//     .fontSize(9)
//     .text(safeTrim(commentaire) || "—", left + 6, y + 6, {
//       width: right - left - 12,
//       height: commentH - 12,
//     });

//   doc.end();
//   await new Promise((resolve, reject) => {
//     stream.on("finish", resolve);
//     stream.on("error", reject);
//   });
// };

// // ===========================================
// // ORCHESTRATION : génère le PDF, le dépose sur RCOMMUN, envoie l'email
// // ===========================================
// /**
//  * @param {object} reception  Document Reception (Mongo)
//  * @param {object} entreprise Document Entreprise (avec getters chemin -> cheminRapportReception)
//  * @param {object} operateur  { prenom, nom }
//  * @returns {Promise<{fileName, filePath, emailTo, emailSentAt, emailError}>}
//  */
// export const genererEtEnvoyerRapport = async (
//   reception,
//   entreprise,
//   operateur,
// ) => {
//   const { rows, stats } = construireLignesRapport(reception);

//   // Dossier de dépôt (RCOMMUN/controle commande), traduit dev/prod par le getter
//   const dossier = entreprise.cheminRapportReception;
//   if (!dossier) {
//     throw new Error(
//       "Chemin de dépôt du rapport (cheminRapportReception) non configuré pour cette entreprise.",
//     );
//   }
//   try {
//     if (!fs.existsSync(dossier)) {
//       fs.mkdirSync(dossier, { recursive: true });
//     }
//   } catch (error) {
//     throw new Error(
//       `Impossible d'accéder au dossier des rapports: ${dossier} (${error.message})`,
//     );
//   }

//   const fileName = genererNomFichier(reception);
//   const filePath = path.join(dossier, fileName);

//   const header = {
//     numcde: safeTrim(reception.numcde),
//     fournisseur:
//       `${reception.commandeInfo?.fourn ?? ""} ${safeTrim(
//         reception.commandeInfo?.fournisseurNom,
//       )}`.trim(),
//     arrivee: formatDateOnly(reception.commandeInfo?.arrivee),
//     bateau: safeTrim(reception.commandeInfo?.bateau),
//     dateControle: formatDateFr(reception.controleFinAt || new Date()),
//     operateur: operateur
//       ? `${safeTrim(operateur.prenom)} ${safeTrim(operateur.nom)}`.trim()
//       : "",
//   };

//   await ecrirePDFReception({
//     header,
//     rows,
//     commentaire: reception.commentaire,
//     outPath: filePath,
//   });

//   // ---- Email d'alerte avec PDF en pièce jointe ----
//   const destinataires = (entreprise.emailsRapportReception || []).filter(
//     Boolean,
//   );
//   let emailSentAt = null;
//   let emailError = "";

//   if (destinataires.length === 0) {
//     emailError = "Aucun destinataire configuré pour cette entreprise.";
//   } else {
//     try {
//       await sendEmail({
//         email: destinataires,
//         subject: `Rapport de réception — Commande ${header.numcde} (${safeTrim(
//           reception.commandeInfo?.fournisseurNom,
//         )})`,
//         html: buildEmailHtml(header, stats, reception),
//         attachments: [{ filename: fileName, path: filePath }],
//       });
//       emailSentAt = new Date();
//     } catch (error) {
//       emailError = error.message || "Échec de l'envoi de l'email";
//       console.error("Erreur envoi email rapport réception:", error);
//     }
//   }

//   return {
//     fileName,
//     filePath,
//     emailTo: destinataires,
//     emailSentAt,
//     emailError,
//     stats,
//   };
// };

// // Corps HTML de l'email d'alerte.
// const buildEmailHtml = (header, stats, reception) => `
//   <div style="font-family: Arial, sans-serif; font-size: 14px; color: #222;">
//     <h2 style="margin:0 0 12px;">Rapport de réception de marchandises</h2>
//     <table style="border-collapse:collapse;">
//       <tr><td style="padding:2px 8px;"><b>Commande</b></td><td style="padding:2px 8px;">${header.numcde}</td></tr>
//       <tr><td style="padding:2px 8px;"><b>Fournisseur</b></td><td style="padding:2px 8px;">${header.fournisseur}</td></tr>
//       <tr><td style="padding:2px 8px;"><b>Arrivée</b></td><td style="padding:2px 8px;">${header.arrivee || "—"} ${header.bateau ? `(${header.bateau})` : ""}</td></tr>
//       <tr><td style="padding:2px 8px;"><b>Date du contrôle</b></td><td style="padding:2px 8px;">${header.dateControle}</td></tr>
//       <tr><td style="padding:2px 8px;"><b>Opérateur</b></td><td style="padding:2px 8px;">${header.operateur}</td></tr>
//     </table>
//     <p style="margin:12px 0 4px;"><b>Synthèse :</b></p>
//     <ul style="margin:0 0 12px;">
//       <li>Lignes de commande : ${stats.totalLignesCommande}</li>
//       <li>Articles avec écart : ${stats.nbEcarts}</li>
//       <li>Articles non trouvés : ${stats.nbNonTrouves}</li>
//       <li>Articles hors commande / gencodes inconnus : ${stats.nbHorsCommande}</li>
//     </ul>
//     ${
//       reception.commentaire
//         ? `<p style="margin:8px 0;"><b>Commentaire :</b><br/>${String(
//             reception.commentaire,
//           ).replace(/</g, "&lt;")}</p>`
//         : ""
//     }
//     <p style="color:#666;">Le rapport détaillé est en pièce jointe (PDF).</p>
//   </div>
// `;

// export default {
//   genererNomFichier,
//   construireLignesRapport,
//   ecrirePDFReception,
//   genererEtEnvoyerRapport,
//   sanitizeFileName,
// };


// backend/services/receptionReportService.js
import fs from "fs";
import path from "path";
import sendEmail from "../utils/sendEmail.js";

// ===========================================
// HELPERS GÉNÉRIQUES
// ===========================================

/** Nettoie un nom pour en faire un nom de fichier valide (Windows/Linux). */
export const sanitizeFileName = (nom) =>
  String(nom || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "rapport";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

const pad2 = (n) => String(n).padStart(2, "0");

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * L'article porte-t-il au moins une réservation ?
 * Basé sur le champ RESERV de l'article (mobile : "reserv"), avec quelques
 * alias défensifs + un éventuel booléen déjà calculé en amont.
 */
const aReservation = (o) => {
  if (!o) return false;
  if (o.estReserve === true || o.aReservation === true || o.hasReserv === true)
    return true;
  return num(o.reserv ?? o.RESERV ?? o.qteReservee ?? o.qteReservation) > 0;
};

/** Construit le libellé de la colonne R/N : "R", "N", "R/N" ou "". */
const construireRN = (estReserve, estNouveau) => {
  const parts = [];
  if (estReserve) parts.push("R");
  if (estNouveau) parts.push("N");
  return parts.join("/");
};

/** Date -> "AAAA-MM-JJ" (ou "" si invalide). */
const dateToYmd = (d) => {
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    const parsed = d ? new Date(d) : null;
    if (!parsed || isNaN(parsed.getTime())) return "";
    d = parsed;
  }
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Date -> "JJ/MM/AAAA HH:mm" (fr). */
const formatDateFr = (d) =>
  new Date(d).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Date -> "JJ/MM/AAAA" (ou "" si vide/invalide). */
const formatDateOnly = (d) => {
  if (!d) return "";
  const dd = d instanceof Date ? d : new Date(d);
  if (isNaN(dd.getTime())) return "";
  return `${pad2(dd.getDate())}/${pad2(dd.getMonth() + 1)}/${dd.getFullYear()}`;
};

// ===========================================
// NOM DE FICHIER : n°commande_date_nomFournisseur.pdf
// ===========================================
export const genererNomFichier = (reception) => {
  const numcde = safeTrim(reception.numcde) || "commande";
  const dateStr =
    dateToYmd(reception.commandeInfo?.arrivee) ||
    dateToYmd(reception.controleDebutAt) ||
    dateToYmd(new Date());
  const fournisseur =
    safeTrim(reception.commandeInfo?.fournisseurNom) ||
    (reception.commandeInfo?.fourn != null
      ? `fourn${reception.commandeInfo.fourn}`
      : "fournisseur");
  return `${sanitizeFileName(`${numcde}_${dateStr}_${fournisseur}`)}.pdf`;
};

// ===========================================
// CONSTRUCTION DES LIGNES DU RAPPORT
// ===========================================
/**
 * Construit les lignes du tableau du rapport à partir d'une session de réception.
 * - Détail des articles : lignes de la commande DANS L'ORDRE (NL), enrichies du comptage.
 *   Les articles non trouvés apparaissent avec 0 compté et un écart.
 * - Articles hors commande / gencodes inconnus : listés ensuite (gencode dans
 *   la colonne "Genecode nouveau").
 *
 * Colonne R/N : R = article réservé (RESERV > 0), N = nouveauté (estNouveau),
 * R/N = les deux.
 *
 * @returns { rows, stats }
 */
export const construireLignesRapport = (reception) => {
  const lignesCommande = reception.lignesCommande || [];
  const comptages = reception.comptages || [];

  // Index des comptages "dans la commande" par NART (clé normalisée)
  const normNart = (s) => String(s || "").trim().toUpperCase();
  const comptageByNart = new Map();
  comptages.forEach((c) => {
    if (c.nart && !c.isInconnu) comptageByNart.set(normNart(c.nart), c);
  });

  const rows = [];
  let n = 0;
  let nbEcarts = 0;
  let nbNonTrouves = 0;

  // --- Détail des articles de la commande (ordre commande) ---
  lignesCommande.forEach((l) => {
    n += 1;
    const c = comptageByNart.get(normNart(l.nart));
    const qteComptee = c ? c.qteComptee : 0;
    const qteValidee = c
      ? c.qteValidee != null
        ? c.qteValidee
        : c.qteComptee
      : 0;
    const ecart = qteValidee - (l.qteCommandee || 0);
    const nonTrouve = !c;
    if (nonTrouve) nbNonTrouves += 1;
    if (ecart !== 0) nbEcarts += 1;

    const estNouveau = !!(l.estNouveau || c?.estNouveau);
    const estReserve = aReservation(l) || aReservation(c);

    rows.push({
      n,
      code: l.nart,
      designation: l.designation,
      gencode: l.gencod,
      qteCmd: l.qteCommandee,
      qteBip: qteComptee,
      qteVal: qteValidee,
      ecart,
      ecartType: ecart > 0 ? "surplus" : ecart < 0 ? "manquant" : "",
      nouv: construireRN(estReserve, estNouveau),
      estNouveau,
      estReserve,
      gencodeNouveau: c?.nouveauGencode?.gencode || "",
      enDefaut: ecart !== 0,
      section: "commande",
    });
  });

  // --- Articles hors commande / gencodes inconnus ---
  const horsCommande = comptages.filter((c) => !c.dansCommande || c.isInconnu);
  if (horsCommande.length > 0) {
    rows.push({ separator: "ARTICLES HORS COMMANDE / GENCODES INCONNUS" });
    horsCommande.forEach((c) => {
      n += 1;
      const qteVal = c.qteValidee != null ? c.qteValidee : c.qteComptee;
      const estNouveau = !!c.estNouveau;
      const estReserve = aReservation(c);
      rows.push({
        n,
        code: c.nart || "",
        designation: c.isInconnu ? "GENCODE INCONNU" : c.designation,
        gencode: c.gencod || "",
        qteCmd: "",
        qteBip: c.qteComptee,
        qteVal,
        ecart: "",
        nouv: construireRN(estReserve, estNouveau),
        estNouveau,
        estReserve,
        gencodeNouveau: c.nouveauGencode?.gencode || c.gencodeScanne || "",
        enDefaut: c.isInconnu,
        section: "hors",
      });
    });
  }

  const stats = {
    totalLignesCommande: lignesCommande.length,
    nbEcarts,
    nbNonTrouves,
    nbHorsCommande: horsCommande.length,
  };

  return { rows, stats };
};

// ===========================================
// GÉNÉRATION PDF (même gabarit que ficheControleService)
// ===========================================
const COLS = [
  { key: "n", label: "N°", w: 24, align: "center" },
  { key: "code", label: "CODE", w: 50, align: "left" },
  { key: "designation", label: "DÉSIGNATION", w: 132, align: "left" },
  { key: "gencode", label: "GENCODE", w: 72, align: "left" },
  { key: "qteCmd", label: "CMD", w: 38, align: "center" },
  { key: "qteBip", label: "BIP", w: 38, align: "center" },
  { key: "qteVal", label: "CONF", w: 38, align: "center" },
  { key: "ecart", label: "ÉCART", w: 38, align: "center" },
  { key: "nouv", label: "R/N", w: 34, align: "center" },
  { key: "gencodeNouveau", label: "GENCODE NOUV.", w: 71, align: "left" },
];

/** Tronque un texte avec … pour qu'il tienne dans maxWidth (police courante). */
const fitText = (doc, text, maxWidth) => {
  const str = text == null ? "" : String(text);
  if (!str) return "";
  if (doc.widthOfString(str) <= maxWidth) return str;
  let t = str;
  while (t.length > 1 && doc.widthOfString(t + "…") > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
};

/**
 * Écrit le PDF du rapport de réception.
 * @param {{ header: object, rows: array, commentaire: string, outPath: string }}
 */
export const ecrirePDFReception = async ({
  header,
  rows,
  commentaire,
  outPath,
}) => {
  const mod = await import("pdfkit").catch(() => {
    throw new Error(
      "Module 'pdfkit' introuvable. Lancez : npm i pdfkit (backend).",
    );
  });
  const PDFDocument = mod.default;

  const margin = 30;
  const doc = new PDFDocument({ size: "A4", margin });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const left = margin;
  const right = doc.page.width - margin;
  const tableWidth = COLS.reduce((s, c) => s + c.w, 0);

  // ---- Titre ----
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("RAPPORT DE RÉCEPTION DE MARCHANDISES", left, margin, {
      width: right - left,
      align: "center",
    });

  let y = margin + 30;

  // ---- Bloc informations générales (2 colonnes, 3 lignes) ----
  const infoH = 18;
  const colB = left + (right - left) / 2;
  const drawInfo = (x, w, label, value) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`${label} :`, x + 4, y + 5, { width: 78 });
    doc
      .font("Helvetica")
      .fontSize(9)
      .text(value || "", x + 84, y + 5, { width: w - 88, lineBreak: false });
  };

  const blocH = infoH * 3;
  doc.rect(left, y, right - left, blocH).stroke();
  doc.moveTo(colB, y).lineTo(colB, y + blocH).stroke();
  doc.moveTo(left, y + infoH).lineTo(right, y + infoH).stroke();
  doc.moveTo(left, y + infoH * 2).lineTo(right, y + infoH * 2).stroke();

  const halfW = (right - left) / 2;
  drawInfo(left, halfW, "Commande", header.numcde);
  drawInfo(colB, halfW, "Fournisseur", header.fournisseur);
  y += infoH;
  drawInfo(left, halfW, "Arrivée", header.arrivee);
  drawInfo(colB, halfW, "Bateau", header.bateau);
  y += infoH;
  drawInfo(left, halfW, "Date contrôle", header.dateControle);
  drawInfo(colB, halfW, "Opérateur", header.operateur);
  y += infoH + 10;

  // ---- Table ----
  const rowH = 16;
  const drawHeader = () => {
    let x = left;
    doc.rect(left, y, tableWidth, rowH).fillAndStroke("#e8e8e8", "#000");
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(7.5);
    COLS.forEach((c) => {
      doc.text(c.label, x + 2, y + 5, { width: c.w - 4, align: c.align, lineBreak: false });
      x += c.w;
    });
    y += rowH;
  };

  const ensureSpace = () => {
    if (y + rowH > doc.page.height - margin - 24) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
  };

  drawHeader();
  doc.font("Helvetica").fontSize(7.5);

  rows.forEach((r) => {
    ensureSpace();

    // Ligne séparateur de section
    if (r.separator) {
      doc.save();
      doc.rect(left, y, tableWidth, rowH).fill("#cfd8e3");
      doc.restore();
      doc
        .fillColor("#000")
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(r.separator, left + 4, y + 5, {
          width: tableWidth - 8,
          align: "left",
          lineBreak: false,
        });
      doc.strokeColor("#999").rect(left, y, tableWidth, rowH).stroke();
      y += rowH;
      doc.font("Helvetica").fontSize(7.5);
      return;
    }

    let x = left;

    // Ligne en défaut : teinte selon le type (surplus / manquant / autre).
    // Couleurs claires -> restent lisibles, et impriment toutes en gris clair en N&B.
    if (r.enDefaut) {
      const fill =
        r.ecartType === "surplus"
          ? "#dbe7f5" // bleu clair = surplus
          : r.ecartType === "manquant"
            ? "#f3dede" // rouge clair = manquant
            : "#e6e6e6"; // gris clair = inconnu / autre
      doc.save();
      doc.rect(left, y, tableWidth, rowH).fill(fill);
      doc.restore();
    }

    doc.strokeColor("#999");
    COLS.forEach((c) => {
      doc.rect(x, y, c.w, rowH).stroke();

      let raw =
        r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key]);
      let color = "#000";

      // Colonne ÉCART : signe explicite (+/-) et couleur (lisible à l'écran,
      // le signe restant la distinction fiable en impression N&B).
      if (c.key === "ecart" && typeof r.ecart === "number" && r.ecart !== 0) {
        raw = r.ecart > 0 ? `+${r.ecart}` : String(r.ecart);
        color = r.ecart > 0 ? "#1f6feb" : "#c0392b";
      }

      // Colonne R/N : couleur selon le flag (N nouveauté = orange, R seul = vert).
      if (c.key === "nouv" && (r.estReserve || r.estNouveau)) {
        color = r.estNouveau ? "#b9770e" : "#0a7d55";
      }

      const val = fitText(doc, raw, c.w - 4);
      doc
        .fillColor(color)
        .text(val, x + 2, y + 5, {
          width: c.w - 4,
          align: c.align,
          lineBreak: false,
        });
      x += c.w;
    });
    y += rowH;
  });

  // ---- Légende ----
  y += 8;
  if (y > doc.page.height - margin - 90) {
    doc.addPage();
    y = margin;
  }
  doc
    .fillColor("#000")
    .font("Helvetica")
    .fontSize(7.5)
    .text("Légende écart :  ", left, y, { continued: true })
    .fillColor("#1f6feb")
    .text("+N = surplus", { continued: true })
    .fillColor("#000")
    .text("   |   ", { continued: true })
    .fillColor("#c0392b")
    .text("-N = manquant", { continued: true })
    .fillColor("#000")
    .text("   |   ", { continued: true })
    .fillColor("#0a7d55")
    .text("R = réservation", { continued: true })
    .fillColor("#000")
    .text("   |   ", { continued: true })
    .fillColor("#b9770e")
    .text("N = nouveauté (V1..V12 = 0)", { continued: true })
    .fillColor("#000")
    .text("   |   lignes grisées = écart à traiter / gencode inconnu");

  // ---- Commentaire ----
  y += 16;
  if (y > doc.page.height - margin - 60) {
    doc.addPage();
    y = margin;
  }
  doc
    .fillColor("#000")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("COMMENTAIRE :", left, y);
  y += 14;
  const commentH = 50;
  doc.strokeColor("#000").rect(left, y, right - left, commentH).stroke();
  doc
    .font("Helvetica")
    .fontSize(9)
    .text(safeTrim(commentaire) || "—", left + 6, y + 6, {
      width: right - left - 12,
      height: commentH - 12,
    });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
};

// ===========================================
// ORCHESTRATION : génère le PDF, le dépose sur RCOMMUN, envoie l'email
// ===========================================
/**
 * @param {object} reception  Document Reception (Mongo)
 * @param {object} entreprise Document Entreprise (avec getters chemin -> cheminRapportReception)
 * @param {object} operateur  { prenom, nom }
 * @returns {Promise<{fileName, filePath, emailTo, emailSentAt, emailError}>}
 */
export const genererEtEnvoyerRapport = async (
  reception,
  entreprise,
  operateur,
) => {
  const { rows, stats } = construireLignesRapport(reception);

  // Dossier de dépôt (RCOMMUN/controle commande), traduit dev/prod par le getter
  const dossier = entreprise.cheminRapportReception;
  if (!dossier) {
    throw new Error(
      "Chemin de dépôt du rapport (cheminRapportReception) non configuré pour cette entreprise.",
    );
  }
  try {
    if (!fs.existsSync(dossier)) {
      fs.mkdirSync(dossier, { recursive: true });
    }
  } catch (error) {
    throw new Error(
      `Impossible d'accéder au dossier des rapports: ${dossier} (${error.message})`,
    );
  }

  const fileName = genererNomFichier(reception);
  const filePath = path.join(dossier, fileName);

  const header = {
    numcde: safeTrim(reception.numcde),
    fournisseur:
      `${reception.commandeInfo?.fourn ?? ""} ${safeTrim(
        reception.commandeInfo?.fournisseurNom,
      )}`.trim(),
    arrivee: formatDateOnly(reception.commandeInfo?.arrivee),
    bateau: safeTrim(reception.commandeInfo?.bateau),
    dateControle: formatDateFr(reception.controleFinAt || new Date()),
    operateur: operateur
      ? `${safeTrim(operateur.prenom)} ${safeTrim(operateur.nom)}`.trim()
      : "",
  };

  await ecrirePDFReception({
    header,
    rows,
    commentaire: reception.commentaire,
    outPath: filePath,
  });

  // ---- Email d'alerte avec PDF en pièce jointe ----
  const destinataires = (entreprise.emailsRapportReception || []).filter(
    Boolean,
  );
  let emailSentAt = null;
  let emailError = "";

  if (destinataires.length === 0) {
    emailError = "Aucun destinataire configuré pour cette entreprise.";
  } else {
    try {
      await sendEmail({
        email: destinataires,
        subject: `Rapport de réception — Commande ${header.numcde} (${safeTrim(
          reception.commandeInfo?.fournisseurNom,
        )})`,
        html: buildEmailHtml(header, stats, reception),
        attachments: [{ filename: fileName, path: filePath }],
      });
      emailSentAt = new Date();
    } catch (error) {
      emailError = error.message || "Échec de l'envoi de l'email";
      console.error("Erreur envoi email rapport réception:", error);
    }
  }

  return {
    fileName,
    filePath,
    emailTo: destinataires,
    emailSentAt,
    emailError,
    stats,
  };
};

// Corps HTML de l'email d'alerte.
const buildEmailHtml = (header, stats, reception) => `
  <div style="font-family: Arial, sans-serif; font-size: 14px; color: #222;">
    <h2 style="margin:0 0 12px;">Rapport de réception de marchandises</h2>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:2px 8px;"><b>Commande</b></td><td style="padding:2px 8px;">${header.numcde}</td></tr>
      <tr><td style="padding:2px 8px;"><b>Fournisseur</b></td><td style="padding:2px 8px;">${header.fournisseur}</td></tr>
      <tr><td style="padding:2px 8px;"><b>Arrivée</b></td><td style="padding:2px 8px;">${header.arrivee || "—"} ${header.bateau ? `(${header.bateau})` : ""}</td></tr>
      <tr><td style="padding:2px 8px;"><b>Date du contrôle</b></td><td style="padding:2px 8px;">${header.dateControle}</td></tr>
      <tr><td style="padding:2px 8px;"><b>Opérateur</b></td><td style="padding:2px 8px;">${header.operateur}</td></tr>
    </table>
    <p style="margin:12px 0 4px;"><b>Synthèse :</b></p>
    <ul style="margin:0 0 12px;">
      <li>Lignes de commande : ${stats.totalLignesCommande}</li>
      <li>Articles avec écart : ${stats.nbEcarts}</li>
      <li>Articles non trouvés : ${stats.nbNonTrouves}</li>
      <li>Articles hors commande / gencodes inconnus : ${stats.nbHorsCommande}</li>
    </ul>
    ${
      reception.commentaire
        ? `<p style="margin:8px 0;"><b>Commentaire :</b><br/>${String(
            reception.commentaire,
          ).replace(/</g, "&lt;")}</p>`
        : ""
    }
    <p style="color:#666;">Le rapport détaillé est en pièce jointe (PDF).</p>
  </div>
`;

export default {
  genererNomFichier,
  construireLignesRapport,
  ecrirePDFReception,
  genererEtEnvoyerRapport,
  sanitizeFileName,
};