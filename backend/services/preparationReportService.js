// // backend/services/preparationReportService.js
// //
// // Sorties de fin de préparation :
// //   1) PDF « Prepa_cde_<client>_<numpro>.pdf » déposé dans
// //      <collecteur>/prepa_cmd/<TRIGRAMME>/<NUMPRO>_<date>_<client>/  (+ email).
// //   2) Fichier de transfert de stock (quantités prélevées au DOCK), déposé dans
// //      collect_sec (cheminExportInventaire) ET copié dans le dossier prepa_cmd
// //      (à côté du PDF), sous « tsf_prepa_<client>_<numpro>.dat ».
// //      Nom volontairement HORS motif "stock.dat …" -> ignoré par le watcher inventaire.
// //      Format .dat standard : CODE(13, gauche, espaces) | QTE(8, zéros) | 000 + CRLF,
// //      CODE = GENCOD si présent sinon NART.

// import fs from "fs";
// import path from "path";
// import sendEmail from "../utils/sendEmail.js";
// import {
//   buildPrepaCmdDir,
//   buildPrepaPdfFileName,
// } from "../utils/preparationPaths.js";

// const safeTrim = (v) => (v == null ? "" : String(v)).trim();
// const num = (v) => {
//   const n = Number(v);
//   return Number.isFinite(n) ? n : 0;
// };
// const pad2 = (n) => String(n).padStart(2, "0");

// const sanitizeFileName = (nom) =>
//   String(nom || "")
//     .replace(/[\\/:*?"<>|]/g, "_")
//     .replace(/\s+/g, " ")
//     .trim()
//     .slice(0, 150) || "prepa";

// const formatDateFr = (d) =>
//   new Date(d).toLocaleString("fr-FR", {
//     day: "2-digit",
//     month: "2-digit",
//     year: "numeric",
//     hour: "2-digit",
//     minute: "2-digit",
//   });

// const formatDateOnly = (d) => {
//   if (!d) return "";
//   const dd = d instanceof Date ? d : new Date(d);
//   if (isNaN(dd.getTime())) return "";
//   return `${pad2(dd.getDate())}/${pad2(dd.getMonth() + 1)}/${dd.getFullYear()}`;
// };

// // Total réellement préparé d'une ligne (quantité retenue prioritaire).
// const totalPrepare = (l) =>
//   l.qteRetenue != null
//     ? l.qteRetenue
//     : num(l.qtePrepareeDock) + num(l.qtePrepareeMagasin);

// // ===========================================
// // LIGNES DU RAPPORT (§11 CDC)
// // Articles présentés dans L'ORDRE DE LA PROFORMA (NL croissant).
// // Colonnes : code, désignation, Gencode bipé, fournisseur, qté commandée,
// //            qté préparée dock, qté préparée magasin, total préparé, écart.
// // ===========================================
// const construireLignes = (preparation) => {
//   const lignes = (preparation.lignes || []).slice();
//   // Ordre de la proforma (NL croissant).
//   lignes.sort((a, b) => (a.nl ?? 0) - (b.nl ?? 0));

//   let n = 0;
//   let nbManquants = 0;
//   let nbSurplus = 0;
//   let nbIntrouvables = 0;

//   const rows = lignes.map((l) => {
//     n += 1;
//     const total = totalPrepare(l);
//     const ecart = total - num(l.qteCommandee);
//     if (l.introuvable) nbIntrouvables += 1;
//     if (ecart < 0) nbManquants += 1;
//     if (ecart > 0) nbSurplus += 1;
//     // Gencode réellement bipé : dock en priorité, sinon magasin.
//     const gencodeBipe =
//       safeTrim(l.gencodeBipeDock) || safeTrim(l.gencodeBipeMagasin);
//     return {
//       n,
//       code: safeTrim(l.nart),
//       designation: safeTrim(l.designation),
//       gencodeBipe,
//       fournisseur: safeTrim(l.fournisseurNom),
//       qteCmd: num(l.qteCommandee),
//       qteDock: num(l.qtePrepareeDock),
//       qteMag: num(l.qtePrepareeMagasin),
//       qtePrep: total,
//       ecart,
//       introuvable: !!l.introuvable,
//       enDefaut: l.introuvable || ecart !== 0,
//     };
//   });

//   const stats = {
//     totalLignes: rows.length,
//     nbManquants,
//     nbSurplus,
//     nbIntrouvables,
//   };
//   return { rows, stats };
// };

// // ===========================================
// // PDF
// // ===========================================
// const COLS = [
//   { key: "n", label: "N°", w: 20, align: "center" },
//   { key: "code", label: "CODE", w: 42, align: "left" },
//   { key: "designation", label: "DÉSIGNATION", w: 132, align: "left" },
//   { key: "gencodeBipe", label: "GENCODE BIPÉ", w: 76, align: "left" },
//   { key: "fournisseur", label: "FOURNISSEUR", w: 78, align: "left" },
//   { key: "qteCmd", label: "CMD", w: 30, align: "center" },
//   { key: "qteDock", label: "DOCK", w: 32, align: "center" },
//   { key: "qteMag", label: "MAG", w: 32, align: "center" },
//   { key: "qtePrep", label: "TOTAL", w: 34, align: "center" },
//   { key: "ecart", label: "ÉCART", w: 36, align: "center" },
// ];

// const fitText = (doc, text, maxWidth) => {
//   const str = text == null ? "" : String(text);
//   if (!str) return "";
//   if (doc.widthOfString(str) <= maxWidth) return str;
//   let t = str;
//   while (t.length > 1 && doc.widthOfString(t + "…") > maxWidth) t = t.slice(0, -1);
//   return t + "…";
// };

// const ecrirePDFPreparation = async ({ header, rows, commentaire, outPath }) => {
//   const mod = await import("pdfkit").catch(() => {
//     throw new Error("Module 'pdfkit' introuvable. Lancez : npm i pdfkit (backend).");
//   });
//   const PDFDocument = mod.default;

//   const margin = 30;
//   const doc = new PDFDocument({ size: "A4", margin });
//   const stream = fs.createWriteStream(outPath);
//   doc.pipe(stream);

//   const left = margin;
//   const right = doc.page.width - margin;
//   const tableWidth = COLS.reduce((s, c) => s + c.w, 0);

//   doc
//     .font("Helvetica-Bold")
//     .fontSize(16)
//     .text("RAPPORT DE PRÉPARATION DE COMMANDE", left, margin, {
//       width: right - left,
//       align: "center",
//     });

//   let y = margin + 30;

//   // Bloc infos (2 colonnes, 3 lignes)
//   const infoH = 18;
//   const colB = left + (right - left) / 2;
//   const halfW = (right - left) / 2;
//   const drawInfo = (x, w, label, value) => {
//     doc.font("Helvetica-Bold").fontSize(9).text(`${label} :`, x + 4, y + 5, { width: 78 });
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

//   drawInfo(left, halfW, "Proforma", header.numpro);
//   drawInfo(colB, halfW, "Client", header.client);
//   y += infoH;
//   drawInfo(left, halfW, "Date proforma", header.dateProforma);
//   drawInfo(colB, halfW, "Date prépa", header.datePrepa);
//   y += infoH;
//   drawInfo(left, halfW, "Opérateur", header.operateur);
//   drawInfo(colB, halfW, "Client n°", header.clientCode);
//   y += infoH + 10;

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
//     let x = left;

//     if (r.enDefaut) {
//       const fill = r.introuvable
//         ? "#e6e6e6" // introuvable = gris
//         : r.ecart < 0
//           ? "#f3dede" // manquant = rouge clair
//           : "#dbe7f5"; // surplus = bleu clair
//       doc.save();
//       doc.rect(left, y, tableWidth, rowH).fill(fill);
//       doc.restore();
//     }

//     doc.strokeColor("#999");
//     COLS.forEach((c) => {
//       doc.rect(x, y, c.w, rowH).stroke();
//       let raw = r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key]);
//       let color = "#000";
//       if (c.key === "ecart" && typeof r.ecart === "number" && r.ecart !== 0) {
//         raw = r.ecart > 0 ? `+${r.ecart}` : String(r.ecart);
//         color = r.ecart > 0 ? "#1f6feb" : "#c0392b";
//       }
//       if (c.key === "code" && r.introuvable) color = "#7a7a7a";
//       const val = fitText(doc, raw, c.w - 4);
//       doc.fillColor(color).text(val, x + 2, y + 5, {
//         width: c.w - 4,
//         align: c.align,
//         lineBreak: false,
//       });
//       x += c.w;
//     });
//     y += rowH;
//   });

//   // Légende
//   y += 8;
//   if (y > doc.page.height - margin - 80) {
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
//     .text("   |   lignes grisées = article introuvable   |   DOCK/MAG = qté préparée par zone");

//   // Commentaire
//   y += 16;
//   if (y > doc.page.height - margin - 60) {
//     doc.addPage();
//     y = margin;
//   }
//   doc.fillColor("#000").font("Helvetica-Bold").fontSize(9).text("COMMENTAIRE :", left, y);
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
// // FICHIER DE TRANSFERT DE STOCK (DOCK)
// // ===========================================
// // Une ligne par article prélevé au dock (qtePrepareeDock > 0).
// const construireContenuTransfert = (preparation) => {
//   let contenu = "";
//   (preparation.lignes || []).forEach((l) => {
//     const q = num(l.qtePrepareeDock);
//     if (q <= 0) return;
//     const codeSrc = safeTrim(l.gencod) || safeTrim(l.nart);
//     if (!codeSrc) return;
//     const code = codeSrc.padEnd(13, " ");
//     const qte = String(Math.round(q)).padStart(8, "0");
//     contenu += `${code}|${qte}|000\r\n`;
//   });
//   return contenu;
// };

// const dossierCollectSec = (entreprise) =>
//   safeTrim(entreprise?.cheminExportInventaire) || "/mnt/rcommun/STOCK/collect_sec";

// // ===========================================
// // ORCHESTRATION
// // ===========================================
// /**
//  * Génère le PDF (+ email) et le fichier de transfert dock.
//  * @returns {{ rapport, transfert }}
//  */
// export const genererSorties = async (preparation, entreprise, operateur) => {
//   const { rows, stats } = construireLignes(preparation);

//   // ---- 1) PDF dans prepa_cmd ----
//   const dossier = buildPrepaCmdDir(entreprise, preparation);
//   if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
//   const fileName = buildPrepaPdfFileName(preparation);
//   const filePath = path.join(dossier, fileName);

//   const header = {
//     numpro: safeTrim(preparation.numpro),
//     client: safeTrim(preparation.proformaInfo?.clientNom),
//     clientCode:
//       preparation.proformaInfo?.clientCode != null
//         ? String(preparation.proformaInfo.clientCode)
//         : "",
//     dateProforma: formatDateOnly(preparation.proformaInfo?.datfact),
//     datePrepa: formatDateFr(preparation.preparationFinAt || new Date()),
//     operateur: operateur
//       ? `${safeTrim(operateur.prenom)} ${safeTrim(operateur.nom)}`.trim()
//       : "",
//   };

//   await ecrirePDFPreparation({
//     header,
//     rows,
//     commentaire: preparation.commentaire,
//     outPath: filePath,
//   });

//   // ---- Email ----
//   const destinataires = (entreprise.emailsRapportPreparation || []).filter(Boolean);
//   let emailSentAt = null;
//   let emailError = "";
//   if (destinataires.length === 0) {
//     emailError = "Aucun destinataire configuré (emailsRapportPreparation).";
//   } else {
//     try {
//       await sendEmail({
//         email: destinataires,
//         subject: `Préparation commande — Proforma ${header.numpro} (${header.client})`,
//         html: buildEmailHtml(header, stats, preparation),
//         attachments: [{ filename: fileName, path: filePath }],
//       });
//       emailSentAt = new Date();
//     } catch (error) {
//       emailError = error.message || "Échec de l'envoi de l'email";
//       console.error("Erreur envoi email préparation:", error);
//     }
//   }

//   const rapport = {
//     fileName,
//     filePath,
//     dossier,
//     generatedAt: new Date(),
//     emailTo: destinataires,
//     emailSentAt,
//     emailError,
//     stats,
//   };

//   // ---- 2) Fichier de transfert dock : collect_sec (Stock XL) + copie dans prepa_cmd ----
//   let transfert = { fileName: "", filePath: "", chemins: [], lignes: 0 };
//   try {
//     const contenu = construireContenuTransfert(preparation);
//     const nbLignes = contenu
//       ? contenu.trimEnd().split("\r\n").filter(Boolean).length
//       : 0;
//     if (nbLignes > 0) {
//       const nomTsf =
//         sanitizeFileName(`tsf_prepa_${header.client}_${header.numpro}`) + ".dat";
//       const chemins = [];

//       // a) collect_sec (destination principale pour Stock XL)
//       try {
//         const dir = dossierCollectSec(entreprise);
//         if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
//         const p1 = path.join(dir, nomTsf);
//         fs.writeFileSync(p1, contenu, "utf8");
//         chemins.push(p1);
//       } catch (e) {
//         console.error("[PREPA transfert collect_sec] écriture impossible:", e.message);
//       }

//       // b) copie dans le dossier prepa_cmd (à côté du PDF)
//       try {
//         if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
//         const p2 = path.join(dossier, nomTsf);
//         fs.writeFileSync(p2, contenu, "utf8");
//         chemins.push(p2);
//       } catch (e) {
//         console.error("[PREPA transfert prepa_cmd] écriture impossible:", e.message);
//       }

//       transfert = {
//         fileName: nomTsf,
//         filePath: chemins[0] || "", // rétro-compat (1er emplacement écrit)
//         chemins,
//         lignes: nbLignes,
//       };
//     }
//   } catch (error) {
//     transfert = { error: error.message };
//     console.error("[PREPA transfert] génération impossible:", error.message);
//   }

//   return { rapport, transfert };
// };

// const buildEmailHtml = (header, stats, preparation) => `
//   <div style="font-family: Arial, sans-serif; font-size: 14px; color: #222;">
//     <h2 style="margin:0 0 12px;">Rapport de préparation de commande</h2>
//     <table style="border-collapse:collapse;">
//       <tr><td style="padding:2px 8px;"><b>Proforma</b></td><td style="padding:2px 8px;">${header.numpro}</td></tr>
//       <tr><td style="padding:2px 8px;"><b>Client</b></td><td style="padding:2px 8px;">${header.client}</td></tr>
//       <tr><td style="padding:2px 8px;"><b>Date prépa</b></td><td style="padding:2px 8px;">${header.datePrepa}</td></tr>
//       <tr><td style="padding:2px 8px;"><b>Opérateur</b></td><td style="padding:2px 8px;">${header.operateur}</td></tr>
//     </table>
//     <p style="margin:12px 0 4px;"><b>Synthèse :</b></p>
//     <ul style="margin:0 0 12px;">
//       <li>Lignes : ${stats.totalLignes}</li>
//       <li>Manquants : ${stats.nbManquants}</li>
//       <li>Surplus : ${stats.nbSurplus}</li>
//       <li>Introuvables : ${stats.nbIntrouvables}</li>
//     </ul>
//     ${
//       preparation.commentaire
//         ? `<p style="margin:8px 0;"><b>Commentaire :</b><br/>${String(
//             preparation.commentaire,
//           ).replace(/</g, "&lt;")}</p>`
//         : ""
//     }
//     <p style="color:#666;">Le détail est en pièce jointe (PDF).</p>
//   </div>
// `;

// export default {
//   genererSorties,
//   construireLignes,
// };

// backend/services/preparationReportService.js
//
// Sorties de fin de préparation :
//   1) PDF « Prepa_cde_<client>_<numpro>.pdf » déposé dans
//      <collecteur>/prepa_cmd/<TRIGRAMME>/<NUMPRO>_<date>_<client>/  (+ email).
//   2) Fichier de transfert de stock (quantités prélevées au DOCK), déposé dans
//      collect_sec (cheminExportInventaire) ET copié dans le dossier prepa_cmd
//      (à côté du PDF), sous « tsf_prepa_<client>_<numpro>.dat ».
//      Nom volontairement HORS motif "stock.dat …" -> ignoré par le watcher inventaire.
//      Format .dat standard : CODE(13, gauche, espaces) | QTE(8, zéros) | 000 + CRLF,
//      CODE = NART (toujours ; jamais le GENCODE).

import fs from "fs";
import path from "path";
import sendEmail from "../utils/sendEmail.js";
import {
  buildPrepaCmdDir,
  buildPrepaPdfFileName,
} from "../utils/preparationPaths.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const pad2 = (n) => String(n).padStart(2, "0");

const sanitizeFileName = (nom) =>
  String(nom || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "prepa";

const formatDateFr = (d) =>
  new Date(d).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const formatDateOnly = (d) => {
  if (!d) return "";
  const dd = d instanceof Date ? d : new Date(d);
  if (isNaN(dd.getTime())) return "";
  return `${pad2(dd.getDate())}/${pad2(dd.getMonth() + 1)}/${dd.getFullYear()}`;
};

// Total réellement préparé d'une ligne (quantité retenue prioritaire).
const totalPrepare = (l) =>
  l.qteRetenue != null
    ? l.qteRetenue
    : num(l.qtePrepareeDock) + num(l.qtePrepareeMagasin);

// ===========================================
// LIGNES DU RAPPORT (§11 CDC)
// Articles présentés dans L'ORDRE DE LA PROFORMA (NL croissant).
// Colonnes : code, désignation, Gencode bipé, fournisseur, qté commandée,
//            qté préparée dock, qté préparée magasin, total préparé, écart.
// ===========================================
const construireLignes = (preparation) => {
  const lignes = (preparation.lignes || []).slice();
  // Ordre de la proforma (NL croissant).
  lignes.sort((a, b) => (a.nl ?? 0) - (b.nl ?? 0));

  let n = 0;
  let nbManquants = 0;
  let nbSurplus = 0;
  let nbIntrouvables = 0;

  const rows = lignes.map((l) => {
    n += 1;
    const total = totalPrepare(l);
    const ecart = total - num(l.qteCommandee);
    if (l.introuvable) nbIntrouvables += 1;
    if (ecart < 0) nbManquants += 1;
    if (ecart > 0) nbSurplus += 1;
    // Gencode réellement bipé : dock en priorité, sinon magasin.
    const gencodeBipe =
      safeTrim(l.gencodeBipeDock) || safeTrim(l.gencodeBipeMagasin);
    return {
      n,
      code: safeTrim(l.nart),
      designation: safeTrim(l.designation),
      gencodeBipe,
      fournisseur: safeTrim(l.fournisseurNom),
      qteCmd: num(l.qteCommandee),
      qteDock: num(l.qtePrepareeDock),
      qteMag: num(l.qtePrepareeMagasin),
      qtePrep: total,
      ecart,
      introuvable: !!l.introuvable,
      enDefaut: l.introuvable || ecart !== 0,
    };
  });

  const stats = {
    totalLignes: rows.length,
    nbManquants,
    nbSurplus,
    nbIntrouvables,
  };
  return { rows, stats };
};

// ===========================================
// PDF
// ===========================================
const COLS = [
  { key: "n", label: "N°", w: 20, align: "center" },
  { key: "code", label: "CODE", w: 42, align: "left" },
  { key: "designation", label: "DÉSIGNATION", w: 132, align: "left" },
  { key: "gencodeBipe", label: "GENCODE BIPÉ", w: 76, align: "left" },
  { key: "fournisseur", label: "FOURNISSEUR", w: 78, align: "left" },
  { key: "qteCmd", label: "CMD", w: 30, align: "center" },
  { key: "qteDock", label: "DOCK", w: 32, align: "center" },
  { key: "qteMag", label: "MAG", w: 32, align: "center" },
  { key: "qtePrep", label: "TOTAL", w: 34, align: "center" },
  { key: "ecart", label: "ÉCART", w: 36, align: "center" },
];

const fitText = (doc, text, maxWidth) => {
  const str = text == null ? "" : String(text);
  if (!str) return "";
  if (doc.widthOfString(str) <= maxWidth) return str;
  let t = str;
  while (t.length > 1 && doc.widthOfString(t + "…") > maxWidth) t = t.slice(0, -1);
  return t + "…";
};

const ecrirePDFPreparation = async ({ header, rows, commentaire, outPath }) => {
  const mod = await import("pdfkit").catch(() => {
    throw new Error("Module 'pdfkit' introuvable. Lancez : npm i pdfkit (backend).");
  });
  const PDFDocument = mod.default;

  const margin = 30;
  const doc = new PDFDocument({ size: "A4", margin });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const left = margin;
  const right = doc.page.width - margin;
  const tableWidth = COLS.reduce((s, c) => s + c.w, 0);

  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("RAPPORT DE PRÉPARATION DE COMMANDE", left, margin, {
      width: right - left,
      align: "center",
    });

  let y = margin + 30;

  // Bloc infos (2 colonnes, 3 lignes)
  const infoH = 18;
  const colB = left + (right - left) / 2;
  const halfW = (right - left) / 2;
  const drawInfo = (x, w, label, value) => {
    doc.font("Helvetica-Bold").fontSize(9).text(`${label} :`, x + 4, y + 5, { width: 78 });
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

  drawInfo(left, halfW, "Proforma", header.numpro);
  drawInfo(colB, halfW, "Client", header.client);
  y += infoH;
  drawInfo(left, halfW, "Date proforma", header.dateProforma);
  drawInfo(colB, halfW, "Date prépa", header.datePrepa);
  y += infoH;
  drawInfo(left, halfW, "Opérateur", header.operateur);
  drawInfo(colB, halfW, "Client n°", header.clientCode);
  y += infoH + 10;

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
    let x = left;

    if (r.enDefaut) {
      const fill = r.introuvable
        ? "#e6e6e6" // introuvable = gris
        : r.ecart < 0
          ? "#f3dede" // manquant = rouge clair
          : "#dbe7f5"; // surplus = bleu clair
      doc.save();
      doc.rect(left, y, tableWidth, rowH).fill(fill);
      doc.restore();
    }

    doc.strokeColor("#999");
    COLS.forEach((c) => {
      doc.rect(x, y, c.w, rowH).stroke();
      let raw = r[c.key] === null || r[c.key] === undefined ? "" : String(r[c.key]);
      let color = "#000";
      if (c.key === "ecart" && typeof r.ecart === "number" && r.ecart !== 0) {
        raw = r.ecart > 0 ? `+${r.ecart}` : String(r.ecart);
        color = r.ecart > 0 ? "#1f6feb" : "#c0392b";
      }
      if (c.key === "code" && r.introuvable) color = "#7a7a7a";
      const val = fitText(doc, raw, c.w - 4);
      doc.fillColor(color).text(val, x + 2, y + 5, {
        width: c.w - 4,
        align: c.align,
        lineBreak: false,
      });
      x += c.w;
    });
    y += rowH;
  });

  // Légende
  y += 8;
  if (y > doc.page.height - margin - 80) {
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
    .text("   |   lignes grisées = article introuvable   |   DOCK/MAG = qté préparée par zone");

  // Commentaire
  y += 16;
  if (y > doc.page.height - margin - 60) {
    doc.addPage();
    y = margin;
  }
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(9).text("COMMENTAIRE :", left, y);
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
// FICHIER DE TRANSFERT DE STOCK (DOCK)
// ===========================================
// Une ligne par article prélevé au dock (qtePrepareeDock > 0).
const construireContenuTransfert = (preparation) => {
  let contenu = "";
  (preparation.lignes || []).forEach((l) => {
    const q = num(l.qtePrepareeDock);
    if (q <= 0) return;
    // Toujours le NART (jamais le GENCODE). Ligne ignorée si pas de NART.
    const codeSrc = safeTrim(l.nart);
    if (!codeSrc) return;
    const code = codeSrc.padEnd(13, " ");
    const qte = String(Math.round(q)).padStart(8, "0");
    contenu += `${code}|${qte}|000\r\n`;
  });
  return contenu;
};

const dossierCollectSec = (entreprise) =>
  safeTrim(entreprise?.cheminExportInventaire) || "/mnt/rcommun/STOCK/collect_sec";

// ===========================================
// ORCHESTRATION
// ===========================================
/**
 * Génère le PDF (+ email) et le fichier de transfert dock.
 * @returns {{ rapport, transfert }}
 */
export const genererSorties = async (preparation, entreprise, operateur) => {
  const { rows, stats } = construireLignes(preparation);

  // ---- 1) PDF dans prepa_cmd ----
  const dossier = buildPrepaCmdDir(entreprise, preparation);
  if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
  const fileName = buildPrepaPdfFileName(preparation);
  const filePath = path.join(dossier, fileName);

  const header = {
    numpro: safeTrim(preparation.numpro),
    client: safeTrim(preparation.proformaInfo?.clientNom),
    clientCode:
      preparation.proformaInfo?.clientCode != null
        ? String(preparation.proformaInfo.clientCode)
        : "",
    dateProforma: formatDateOnly(preparation.proformaInfo?.datfact),
    datePrepa: formatDateFr(preparation.preparationFinAt || new Date()),
    operateur: operateur
      ? `${safeTrim(operateur.prenom)} ${safeTrim(operateur.nom)}`.trim()
      : "",
  };

  await ecrirePDFPreparation({
    header,
    rows,
    commentaire: preparation.commentaire,
    outPath: filePath,
  });

  // ---- Email ----
  const destinataires = (entreprise.emailsRapportPreparation || []).filter(Boolean);
  let emailSentAt = null;
  let emailError = "";
  if (destinataires.length === 0) {
    emailError = "Aucun destinataire configuré (emailsRapportPreparation).";
  } else {
    try {
      await sendEmail({
        email: destinataires,
        subject: `Préparation commande — Proforma ${header.numpro} (${header.client})`,
        html: buildEmailHtml(header, stats, preparation),
        attachments: [{ filename: fileName, path: filePath }],
      });
      emailSentAt = new Date();
    } catch (error) {
      emailError = error.message || "Échec de l'envoi de l'email";
      console.error("Erreur envoi email préparation:", error);
    }
  }

  const rapport = {
    fileName,
    filePath,
    dossier,
    generatedAt: new Date(),
    emailTo: destinataires,
    emailSentAt,
    emailError,
    stats,
  };

  // ---- 2) Fichier de transfert dock : collect_sec (Stock XL) + copie dans prepa_cmd ----
  let transfert = { fileName: "", filePath: "", chemins: [], lignes: 0 };
  try {
    const contenu = construireContenuTransfert(preparation);
    const nbLignes = contenu
      ? contenu.trimEnd().split("\r\n").filter(Boolean).length
      : 0;
    if (nbLignes > 0) {
      const nomTsf =
        sanitizeFileName(`tsf_prepa_${header.client}_${header.numpro}`) + ".dat";
      const chemins = [];

      // a) collect_sec (destination principale pour Stock XL)
      try {
        const dir = dossierCollectSec(entreprise);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const p1 = path.join(dir, nomTsf);
        fs.writeFileSync(p1, contenu, "utf8");
        chemins.push(p1);
      } catch (e) {
        console.error("[PREPA transfert collect_sec] écriture impossible:", e.message);
      }

      // b) copie dans le dossier prepa_cmd (à côté du PDF)
      try {
        if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
        const p2 = path.join(dossier, nomTsf);
        fs.writeFileSync(p2, contenu, "utf8");
        chemins.push(p2);
      } catch (e) {
        console.error("[PREPA transfert prepa_cmd] écriture impossible:", e.message);
      }

      transfert = {
        fileName: nomTsf,
        filePath: chemins[0] || "", // rétro-compat (1er emplacement écrit)
        chemins,
        lignes: nbLignes,
      };
    }
  } catch (error) {
    transfert = { error: error.message };
    console.error("[PREPA transfert] génération impossible:", error.message);
  }

  return { rapport, transfert };
};

const buildEmailHtml = (header, stats, preparation) => `
  <div style="font-family: Arial, sans-serif; font-size: 14px; color: #222;">
    <h2 style="margin:0 0 12px;">Rapport de préparation de commande</h2>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:2px 8px;"><b>Proforma</b></td><td style="padding:2px 8px;">${header.numpro}</td></tr>
      <tr><td style="padding:2px 8px;"><b>Client</b></td><td style="padding:2px 8px;">${header.client}</td></tr>
      <tr><td style="padding:2px 8px;"><b>Date prépa</b></td><td style="padding:2px 8px;">${header.datePrepa}</td></tr>
      <tr><td style="padding:2px 8px;"><b>Opérateur</b></td><td style="padding:2px 8px;">${header.operateur}</td></tr>
    </table>
    <p style="margin:12px 0 4px;"><b>Synthèse :</b></p>
    <ul style="margin:0 0 12px;">
      <li>Lignes : ${stats.totalLignes}</li>
      <li>Manquants : ${stats.nbManquants}</li>
      <li>Surplus : ${stats.nbSurplus}</li>
      <li>Introuvables : ${stats.nbIntrouvables}</li>
    </ul>
    ${
      preparation.commentaire
        ? `<p style="margin:8px 0;"><b>Commentaire :</b><br/>${String(
            preparation.commentaire,
          ).replace(/</g, "&lt;")}</p>`
        : ""
    }
    <p style="color:#666;">Le détail est en pièce jointe (PDF).</p>
  </div>
`;

export default {
  genererSorties,
  construireLignes,
};