// backend/services/ficheArticleService.js
//
// FICHE ARTICLE PDF — à destination des CLIENTS (A4, fond BLANC, sobre).
// - AUCUNE donnée d'achat : pas de fournisseur, pas de prix d'achat/revient.
// - Identité visuelle par entreprise : logo (base64) + couleurs, en touches.
// - Codes-barres GRAPHIQUES scannables : EAN-13 (gencod) + Code 39 (NART).
import fs from "fs";
import path from "path";
import articleService from "./articleService.js";
import Entreprise from "../models/EntrepriseModel.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const fmtNb = (n) => Math.round(num(n)).toLocaleString("fr-FR");
const fmtPrix = (n) => `${Math.round(num(n)).toLocaleString("fr-FR")} F`;

const GRIS_TXT = "#1f2937";
const GRIS_LABEL = "#6b7280";
const GRIS_LIGNE = "#e5e7eb";
const GRIS_FOND = "#f9fafb";

// ---- EAN-13 vectoriel (mêmes tables que le module étiquettes) ---------------
const EAN_L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const EAN_G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const EAN_R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const EAN_PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];

const ean13CheckDigit = (d12) => {
  let s = 0;
  for (let i = 0; i < 12; i += 1) s += parseInt(d12[i], 10) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (s % 10)) % 10);
};
const ean13Bits = (code) => {
  let d = String(code == null ? "" : code).replace(/\D/g, "");
  if (d.length === 12) d += ean13CheckDigit(d);
  if (d.length !== 13) return null;
  const par = EAN_PARITY[parseInt(d[0], 10)];
  let bits = "101";
  for (let i = 0; i < 6; i += 1) {
    const n = parseInt(d[i + 1], 10);
    bits += par[i] === "L" ? EAN_L[n] : EAN_G[n];
  }
  bits += "01010";
  for (let i = 0; i < 6; i += 1) bits += EAN_R[parseInt(d[i + 7], 10)];
  bits += "101";
  return { bits, full: d };
};
// Dessine un EAN-13 (pdfkit) : barres + texte dessous. Renvoie true si dessiné.
const drawEAN13 = (doc, code, x, y, w, h) => {
  const res = ean13Bits(code);
  if (!res) return false;
  const textH = 10;
  const barsH = h - textH;
  const mw = w / 95;
  doc.save().fillColor("#000");
  for (let i = 0; i < 95; i += 1) {
    if (res.bits[i] === "1") doc.rect(x + i * mw, y, mw, barsH).fill();
  }
  doc.font("Helvetica").fontSize(7.5).fillColor(GRIS_TXT)
    .text(res.full, x, y + barsH + 2, { width: w, align: "center" });
  doc.restore();
  return true;
};

// ---- Code 39 (pour le NART, alphanumérique) ---------------------------------
const C39 = {
  "0":"101001101101","1":"110100101011","2":"101100101011","3":"110110010101",
  "4":"101001101011","5":"110100110101","6":"101100110101","7":"101001011011",
  "8":"110100101101","9":"101100101101","A":"110101001011","B":"101101001011",
  "C":"110110100101","D":"101011001011","E":"110101100101","F":"101101100101",
  "G":"101010011011","H":"110101001101","I":"101101001101","J":"101011001101",
  "K":"110101010011","L":"101101010011","M":"110110101001","N":"101011010011",
  "O":"110101101001","P":"101101101001","Q":"101010110011","R":"110101011001",
  "S":"101101011001","T":"101011011001","U":"110010101011","V":"100110101011",
  "W":"110011010101","X":"100101101011","Y":"110010110101","Z":"100110110101",
  "-":"100101011011",".":"110010101101"," ":"100110101101","*":"100101101101",
};
const drawCode39 = (doc, text, x, y, w, h) => {
  const clean = String(text || "").toUpperCase().replace(/[^0-9A-Z\-. ]/g, "");
  if (!clean) return false;
  const seq = `*${clean}*`;
  let bits = "";
  for (const ch of seq) {
    if (!C39[ch]) return false;
    bits += C39[ch] + "0"; // inter-caractère
  }
  bits = bits.slice(0, -1);
  const textH = 10;
  const barsH = h - textH;
  const mw = w / bits.length;
  doc.save().fillColor("#000");
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i] === "1") doc.rect(x + i * mw, y, mw, barsH).fill();
  }
  doc.font("Helvetica").fontSize(7.5).fillColor(GRIS_TXT)
    .text(clean, x, y + barsH + 2, { width: w, align: "center" });
  doc.restore();
  return true;
};

// ---- Photo article (réplique de la résolution photoController) --------------
const PHOTOS_DOSSIER_PAR_TRIGRAMME = { QC: "photos", LD: "photo_LD" };
const EXTS = ["jpg", "jpeg", "png"];
const trouverPhoto = (entreprise, nart) => {
  try {
    const trig = String(entreprise?.trigramme || "").toUpperCase();
    let base = null;
    if (process.env.PHOTOS_BASE_PATH) {
      const dossier = PHOTOS_DOSSIER_PAR_TRIGRAMME[trig];
      if (!dossier) return null;
      base = path.join(process.env.PHOTOS_BASE_PATH, dossier);
    } else if (entreprise?.cheminPhotos) {
      base = entreprise.cheminPhotos;
    }
    if (!base || !fs.existsSync(base)) return null;
    const clean = safeTrim(nart);
    for (const ext of EXTS) {
      for (const cand of [
        path.join(base, `${clean}.${ext}`),
        path.join(base, `${clean}.${ext.toUpperCase()}`),
        path.join(base, `${clean.toUpperCase()}.${ext}`),
      ]) {
        if (fs.existsSync(cand)) return cand;
      }
    }
    return null;
  } catch {
    return null;
  }
};

const logoBuffer = (entreprise) => {
  try {
    const raw = safeTrim(entreprise?.logo);
    if (!raw.startsWith("data:image/")) return null;
    const b64 = raw.split(",")[1];
    return b64 ? Buffer.from(b64, "base64") : null;
  } catch {
    return null;
  }
};

const isPromoActive = (a) => {
  const promo = num(a.PVPROMO);
  if (promo <= 0) return false;
  const now = new Date();
  const d = a.DPROMOD ? new Date(a.DPROMOD) : null;
  const f = a.DPROMOF ? new Date(a.DPROMOF) : null;
  if (d && !isNaN(d) && now < d) return false;
  if (f && !isNaN(f) && now > f) return false;
  return true;
};

/**
 * Génère le PDF de la fiche article (client) et le stream dans `res`.
 */
export const genererFicheArticle = async (entreprise, nart, res) => {
  const mod = await import("pdfkit").catch(() => {
    throw new Error("Module 'pdfkit' introuvable (npm i pdfkit).");
  });
  const PDFDocument = mod.default;

  const [artCache, entFull] = await Promise.all([
    articleService.getArticles(entreprise),
    Entreprise.findOne({ nomDossierDBF: entreprise.nomDossierDBF }).lean(),
  ]);
  const ent = entFull || entreprise;
  const wanted = safeTrim(nart).toUpperCase();
  const a = (artCache.records || []).find(
    (x) => safeTrim(x.NART).toUpperCase() === wanted,
  );
  if (!a) throw Object.assign(new Error("Article introuvable"), { status: 404 });

  const couleur = safeTrim(ent.couleurPrimaire) || "#4F46E5";
  const couleur2 = safeTrim(ent.couleurSecondaire) || "#10B981";
  const mapping = ent.mappingEntrepots || {
    S1: "Magasin", S2: "S2", S3: "S3", S4: "S4", S5: "S5",
  };

  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
  doc.pipe(res);
  const W = doc.page.width;
  const M = 40;
  const CW = W - M * 2;

  // ── En-tête : logo + entreprise + titre + filet couleur ──
  const logo = logoBuffer(ent);
  if (logo) {
    try { doc.image(logo, M, M, { fit: [110, 44] }); } catch { /* ignoré */ }
  }
  doc.font("Helvetica-Bold").fontSize(9).fillColor(GRIS_LABEL)
    .text((ent.nomComplet || ent.nom || ent.nomDossierDBF || "").toUpperCase(), M, M + 2, { width: CW, align: "right" });
  doc.font("Helvetica-Bold").fontSize(16).fillColor(GRIS_TXT)
    .text("FICHE ARTICLE", M, M + 14, { width: CW, align: "right" });
  doc.font("Helvetica").fontSize(8).fillColor(GRIS_LABEL)
    .text(`Éditée le ${new Date().toLocaleDateString("fr-FR")}`, M, M + 34, { width: CW, align: "right" });
  const headerBottom = M + 52;
  doc.moveTo(M, headerBottom).lineTo(W - M, headerBottom).lineWidth(1.4).strokeColor(couleur).stroke();

  // ── Identité article ──
  let y = headerBottom + 18;
  doc.font("Helvetica-Bold").fontSize(15).fillColor(GRIS_TXT)
    .text(safeTrim(a.DESIGN) || "(sans désignation)", M, y, { width: CW });
  y = doc.y + 2;
  if (safeTrim(a.DESIGN2)) {
    doc.font("Helvetica").fontSize(10).fillColor(GRIS_LABEL).text(safeTrim(a.DESIGN2), M, y, { width: CW });
    y = doc.y + 2;
  }
  y += 8;

  // ── Photo + identification + CODES-BARRES ──
  const photoPath = trouverPhoto(ent, a.NART);
  const colX = photoPath ? M + 150 : M;
  const colW = photoPath ? CW - 150 : CW;
  const blocTop = y;
  if (photoPath) {
    try {
      doc.roundedRect(M, y, 132, 132, 6).lineWidth(0.8).strokeColor(GRIS_LIGNE).stroke();
      doc.image(photoPath, M + 4, y + 4, { fit: [124, 124], align: "center", valign: "center" });
    } catch { /* image illisible */ }
  }

  // Identification (fiche client : pas de fournisseur)
  const identRows = [
    ["Référence", safeTrim(a.REFER) || "—"],
    ["Groupe", safeTrim(a.GROUPE) || "—"],
    ["Unité", safeTrim(a.UNITE) || "—"],
    ["Code douane", safeTrim(a.DOUANE) || "—"],
  ];
  let iy = y + 2;
  identRows.forEach(([label, val]) => {
    doc.font("Helvetica").fontSize(8).fillColor(GRIS_LABEL).text(label.toUpperCase(), colX, iy);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GRIS_TXT).text(val, colX + 100, iy - 1, { width: colW - 100 });
    iy += 20;
  });

  // Codes-barres : NART (Code 39) + EAN-13, côte à côte sous l'identification.
  const bcY = iy + 6;
  const bcH = 52;
  const bcW = Math.min(190, (colW - 20) / 2);
  // NART
  doc.font("Helvetica").fontSize(7).fillColor(GRIS_LABEL).text("CODE ARTICLE (NART)", colX, bcY);
  drawCode39(doc, safeTrim(a.NART), colX, bcY + 10, bcW, bcH - 10);
  // EAN
  if (safeTrim(a.GENCOD)) {
    const exX = colX + bcW + 20;
    doc.font("Helvetica").fontSize(7).fillColor(GRIS_LABEL).text("CODE BARRE (EAN)", exX, bcY);
    drawEAN13(doc, safeTrim(a.GENCOD), exX, bcY + 10, bcW, bcH - 10);
  }
  y = Math.max(blocTop + (photoPath ? 140 : 0), bcY + bcH + 8) + 6;

  // ── Section helper ──
  const section = (titre) => {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(couleur).text(titre.toUpperCase(), M, y);
    y = doc.y + 4;
    doc.moveTo(M, y).lineTo(W - M, y).lineWidth(0.6).strokeColor(GRIS_LIGNE).stroke();
    y += 8;
  };

  // ── Prix (client : vente uniquement) ──
  section("Prix");
  const promo = isPromoActive(a);
  const prix = [
    ["PV TTC", fmtPrix(a.PVTETTC), "strong"],
    ...(promo ? [["Prix promo", fmtPrix(a.PVPROMO), "promo"]] : []),
    ["PV HT", fmtPrix(a.PVTE)],
    ["TGC", `${num(a.ATVA)} %`],
  ];
  const pw = CW / prix.length;
  prix.forEach(([label, val, kind], i) => {
    const x = M + i * pw;
    if (kind) doc.roundedRect(x + 2, y - 2, pw - 8, 36, 4).fillColor(GRIS_FOND).fill();
    doc.font("Helvetica").fontSize(7.5).fillColor(GRIS_LABEL).text(label.toUpperCase(), x + 8, y + 4, { width: pw - 16 });
    doc.font("Helvetica-Bold").fontSize(kind ? 13 : 11)
      .fillColor(kind === "promo" ? couleur2 : GRIS_TXT)
      .text(val, x + 8, y + 15, { width: pw - 16 });
  });
  y += 48;

  // ── Disponibilité (stock total mis en avant + emplacements + en commande) ──
  section("Disponibilité");
  const stockTotal = num(a.S1) + num(a.S2) + num(a.S3) + num(a.S4) + num(a.S5);
  const dispo = [
    ["Stock total", fmtNb(stockTotal), true],
    [mapping.S1 || "S1", fmtNb(a.S1)],
    [mapping.S2 || "S2", fmtNb(a.S2)],
    [mapping.S3 || "S3", fmtNb(a.S3)],
    [mapping.S4 || "S4", fmtNb(a.S4)],
    [mapping.S5 || "S5", fmtNb(a.S5)],
    ["En commande", fmtNb(a.ENCDE)],
  ];
  const sw = CW / dispo.length;
  dispo.forEach(([label, val, strong], i) => {
    const x = M + i * sw;
    if (strong) doc.roundedRect(x + 1, y - 2, sw - 5, 38, 4).fillColor(GRIS_FOND).fill();
    doc.font("Helvetica").fontSize(7).fillColor(GRIS_LABEL)
      .text(String(label).toUpperCase(), x + 5, y + 4, { width: sw - 10 });
    doc.font("Helvetica-Bold").fontSize(strong ? 14 : 11.5)
      .fillColor(strong ? (stockTotal > 0 ? couleur : "#b91c1c") : GRIS_TXT)
      .text(val, x + 5, y + 15, { width: sw - 10 });
  });
  y += 50;

  // ── Emplacements / gisements ──
  const gisements = [
    ["Place", a.PLACE], ["Gisement 1", a.GISM1], ["Gisement 2", a.GISM2],
    ["Gisement 3", a.GISM3], ["Gisement 4", a.GISM4], ["Gisement 5", a.GISM5],
  ].filter(([, v]) => safeTrim(v));
  if (gisements.length > 0) {
    section("Emplacements");
    let gx = M;
    gisements.forEach(([label, v]) => {
      const txt = `${label} : ${safeTrim(v)}`;
      const wTxt = doc.widthOfString(txt) + 24;
      if (gx + wTxt > W - M) { gx = M; y += 24; }
      doc.roundedRect(gx, y - 2, wTxt, 18, 9).lineWidth(0.7).strokeColor(GRIS_LIGNE).stroke();
      doc.font("Helvetica").fontSize(8.5).fillColor(GRIS_TXT).text(txt, gx + 12, y + 2.5);
      gx += wTxt + 8;
    });
    y += 30;
  }

  // ── Ventes 12 mois ──
  section("Ventes (12 derniers mois)");
  const vAn = Array.from({ length: 12 }, (_, i) => Math.abs(num(a[`V${i + 1}`])));
  const totalVentes = vAn.reduce((s, v) => s + v, 0);
  const cw12 = CW / 12;
  vAn.forEach((v, i) => {
    const x = M + i * cw12;
    doc.font("Helvetica").fontSize(6.5).fillColor(GRIS_LABEL).text(`M${i + 1}`, x, y, { width: cw12, align: "center" });
    doc.font("Helvetica-Bold").fontSize(9).fillColor(GRIS_TXT).text(fmtNb(v), x, y + 9, { width: cw12, align: "center" });
  });
  y += 26;
  doc.font("Helvetica").fontSize(8.5).fillColor(GRIS_LABEL)
    .text("Vente annuelle : ", M, y, { continued: true })
    .font("Helvetica-Bold").fillColor(GRIS_TXT).text(fmtNb(totalVentes), { continued: true })
    .font("Helvetica").fillColor(GRIS_LABEL).text("   ·   Moyenne mensuelle : ", { continued: true })
    .font("Helvetica-Bold").fillColor(GRIS_TXT).text(fmtNb(totalVentes / 12));
  y = doc.y + 12;

  // ── Observations ──
  if (safeTrim(a.OBSERV)) {
    section("Observations");
    doc.font("Helvetica").fontSize(9).fillColor(GRIS_TXT).text(safeTrim(a.OBSERV), M, y, { width: CW });
    y = doc.y + 8;
  }

  // ── Pied de page ──
  const bottom = doc.page.height - 34;
  doc.moveTo(M, bottom - 8).lineTo(W - M, bottom - 8).lineWidth(0.6).strokeColor(GRIS_LIGNE).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(GRIS_LABEL)
    .text(
      `${ent.nomComplet || ent.nom || ent.nomDossierDBF} — Fiche article ${safeTrim(a.NART)}`,
      M, bottom - 2, { width: CW, align: "center" },
    );

  doc.end();
};

export default { genererFicheArticle };