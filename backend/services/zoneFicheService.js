// backend/services/zoneFicheService.js
//
// Génère les fiches rayons (Zones d'inventaire) et leur PDF imprimable À PARTIR du
// dictionnaire des rayons — alternative à l'import CSV du programme externe.
//
//   - Une fiche = un rayon (ligne « zone » du dictionnaire), JAMAIS une sous-zone.
//   - Les 3 EAN de phase (papillonnage/bipage/contrôle) sont MINTÉS (EAN-13 internes
//     déterministes préfixe « 2 »).
//   - Le code « principal » (identité de la zone) = le code rayon lui-même, imprimé
//     en QR (et non en code-barres) : eanPrincipal = code, donc le scan du QR reste
//     résolu par inventaireZoneController.resoudreCode sans changement.

import { readDictionnaire } from "./dictionnaireRayonsService.js";
import { drawEAN13Pdf, genererEanInterne } from "../utils/ean13.js";

const safe = (v) => (v == null ? "" : String(v)).trim();

// Construit les documents Zone à partir du dictionnaire des rayons de l'entreprise.
// Renvoie { fichier, zones:[{ code, libelle, type, metreLineaire, eanPrincipal,
//   eanPapillonnage, eanBipage, eanControle }], doublons }. Lève une erreur si dico
//   absent/vide. Les codes en double dans le dictionnaire sont DÉDOUBLONNÉS (dernier
//   gagne, comme l'import CSV) — l'index unique { entreprise, code } l'exige.
export const construireZonesDepuisDictionnaire = async (entreprise) => {
  const { fichier, exists, rows } = await readDictionnaire(entreprise);
  if (!exists) {
    const e = new Error(
      "Aucun dictionnaire des rayons pour cette société. Renseignez-le d'abord dans « Dictionnaire des rayons ».",
    );
    e.statusCode = 404;
    throw e;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    const e = new Error("Le dictionnaire des rayons est vide : aucun rayon à générer.");
    e.statusCode = 400;
    throw e;
  }

  const trig = safe(entreprise?.trigramme).toUpperCase() || "XXX";
  // Identité = code + emplacement (un même code peut exister en MAGASIN ET en DOCK).
  // Dédoublonnage par (code + emplacement), dernier gagne (comme l'index unique).
  const parCle = new Map();
  const ordre = [];
  let doublons = 0;
  for (const r of rows) {
    const code = safe(r?.gism1);
    if (!code) continue;
    const empl = safe(r?.emplacement) || "MAGASIN";
    const cle = `${code} ${empl}`;
    if (parCle.has(cle)) doublons += 1;
    else ordre.push(cle);
    parCle.set(cle, {
      code,
      libelle: safe(r?.libelle),
      type: empl,
      metreLineaire: Math.max(0, Math.round(Number(r?.metrage) || 0)),
      // Principal = « code|emplacement » (rendu en QR) → unique par zone et résolu par
      // resoudreCode, pour distinguer le même code en MAGASIN vs DOCK.
      eanPrincipal: `${code}|${empl}`,
      eanPapillonnage: genererEanInterne(`${trig}|${code}|${empl}|papillonnage`),
      eanBipage: genererEanInterne(`${trig}|${code}|${empl}|bipage`),
      eanControle: genererEanInterne(`${trig}|${code}|${empl}|controle`),
    });
  }

  const zones = ordre.map((c) => parCle.get(c));
  return { fichier, zones, doublons };
};

// ── Rendu QR (réplique locale de gisementLabelService.drawQrCode, pdfkit natif) ──
const drawQrCode = (QRCode, doc, text, x, y, size) => {
  const qr = QRCode.create(text || " ", { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const QUIET = 4;
  const mw = size / (n + 2 * QUIET);
  const ox = x + QUIET * mw;
  const oy = y + QUIET * mw;
  doc.save().fillColor("#000000");
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (data[r * n + c] & 1) {
        doc.rect(ox + c * mw, oy + r * mw, mw + 0.3, mw + 0.3).fill();
      }
    }
  }
  doc.restore();
};

// A4 portrait (points PDF).
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 28; // ~1 cm

// Ligne de découpe pointillée (coupon détachable) avec repère « ✂ à détacher ».
const drawCutLine = (doc, x, y, w) => {
  doc.save().lineWidth(0.8).strokeColor("#888888").dash(5, { space: 4 });
  doc.moveTo(x, y).lineTo(x + w, y).stroke();
  doc.undash().restore();
  doc.save().font("Helvetica").fontSize(7).fillColor("#888888");
  // « à détacher » sur fond blanc au milieu de la ligne.
  const label = "- - -  à détacher  - - -";
  const lw = doc.widthOfString(label);
  const lx = x + (w - lw) / 2;
  doc.rect(lx - 3, y - 5, lw + 6, 10).fill("#FFFFFF");
  doc.fillColor("#888888").text(label, lx, y - 4, { lineBreak: false });
  doc.restore();
};

// Ligne de découpe verticale pointillée (entre deux coupons).
const drawVCutLine = (doc, x, y, h) => {
  doc.save().lineWidth(0.8).strokeColor("#888888").dash(5, { space: 4 });
  doc.moveTo(x, y).lineTo(x, y + h).stroke();
  doc.undash().restore();
};

// Cadre libellé (« Agent », « Signature »…) : rectangle + petit intitulé en haut.
const drawChamp = (doc, label, x, y, w, h) => {
  doc.save().lineWidth(0.6).strokeColor("#555555").rect(x, y, w, h).stroke().restore();
  doc.save().font("Helvetica").fontSize(7.5).fillColor("#666666");
  doc.text(label.toUpperCase(), x + 4, y + 3, { lineBreak: false });
  doc.restore();
};

// Dessine UN coupon détachable de phase, EN COLONNE (nom → code-barres réduit →
// cadre Agent → cadre Signature). Adapté aux colonnes étroites (3 sur la largeur).
const drawCoupon = (doc, phase, ean, x, y, w, h) => {
  const pad = 8;
  const innerX = x + pad;
  const innerW = w - 2 * pad;
  let cy = y + pad;

  // Nom de la phase (centré).
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#000000");
  doc.text(phase, innerX, cy, { width: innerW, align: "center", lineBreak: false });
  cy += 17;

  // Code-barres EAN-13 (petit, largeur de la colonne).
  const barH = 40;
  drawEAN13Pdf(doc, ean, innerX, cy, innerW, barH);
  cy += barH + 12; // barres + numéro en clair

  // Cadre « Agent » (une ligne) puis « Signature » (hauteur réduite).
  const bottomInner = y + h - pad;
  const gap = 6;
  const agentH = 30;
  drawChamp(doc, "Agent", innerX, cy, innerW, agentH);
  cy += agentH + gap;
  const signH = Math.min(48, bottomInner - cy);
  if (signH > 16) drawChamp(doc, "Signature", innerX, cy, innerW, signH);
};

// Dessine UNE fiche rayon sur une page A4 portrait entière (origine 0,0).
const drawFiche = (doc, QRCode, zone) => {
  const x = MARGIN;
  const w = A4_W - 2 * MARGIN;

  // ── Bloc d'identité (haut) ────────────────────────────────────────────────
  let cy = MARGIN;

  const libelle = safe(zone.libelle) || safe(zone.code);
  doc.font("Helvetica-Bold").fontSize(26).fillColor("#000000");
  doc.text(libelle, x, cy, { width: w, align: "left", height: 32, ellipsis: true });
  cy = doc.y + 4;

  doc.font("Helvetica-Bold").fontSize(18).fillColor("#000000");
  doc.text(`Code : ${safe(zone.code)}`, x, cy, { width: w, lineBreak: false });
  cy = doc.y + 3;

  doc.font("Helvetica").fontSize(12).fillColor("#444444");
  doc.text(
    `Emplacement : ${safe(zone.type) || "MAGASIN"}      Métrage : ${zone.metreLineaire ?? 0} m`,
    x,
    cy,
    { width: w, lineBreak: false },
  );
  cy = doc.y + 10;

  // QR principal centré.
  const qrSize = 150;
  const qrX = x + (w - qrSize) / 2;
  drawQrCode(QRCode, doc, safe(zone.eanPrincipal), qrX, cy, qrSize);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000");
  doc.text("PRINCIPAL", qrX, cy + qrSize + 3, { width: qrSize, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor("#333333");
  doc.text(`${safe(zone.code)} · ${safe(zone.type)}`, qrX, cy + qrSize + 15, {
    width: qrSize,
    align: "center",
    lineBreak: false,
  });

  // ── 3 coupons détachables EN RANGÉE (3 colonnes sur la largeur) ────────────
  const phases = [
    { label: "PAPILLONNAGE", ean: zone.eanPapillonnage },
    { label: "BIPAGE", ean: zone.eanBipage },
    { label: "CONTRÔLE", ean: zone.eanControle },
  ];

  const rowGap = 18; // ligne de découpe horizontale au-dessus de la rangée
  const rowH = 174; // hauteur COMPACTE des coupons (ajustée au contenu)
  const bottom = A4_H - MARGIN;

  // Rangée COLLÉE EN BAS DE PAGE.
  const rowTop = bottom - rowH;

  // Ligne de découpe horizontale : détache toute la rangée de la feuille.
  drawCutLine(doc, x, rowTop - rowGap / 2, w);

  const colGap = 12;
  const colW = (w - (phases.length - 1) * colGap) / phases.length;

  phases.forEach((p, i) => {
    const cx = x + i * (colW + colGap);
    // Cadre du coupon.
    doc.save().lineWidth(0.9).strokeColor("#111111").rect(cx, rowTop, colW, rowH).stroke().restore();
    drawCoupon(doc, p.label, safe(p.ean), cx, rowTop, colW, rowH);
    // Ligne de découpe verticale entre les colonnes.
    if (i < phases.length - 1) {
      drawVCutLine(doc, cx + colW + colGap / 2, rowTop, rowH);
    }
  });
};

/**
 * Génère le PDF des fiches rayons et le diffuse dans `stream` (res).
 * UNE fiche par page A4 portrait : bloc d'identité (libellé, code, QR principal)
 * en haut, puis 3 coupons DÉTACHABLES (papillonnage / bipage / contrôle) en bas,
 * chacun avec son code-barres EAN-13 + un cadre « Agent » + un cadre « Signature ».
 * @param {object} p
 * @param {Array} p.zones  fiches à rendre
 * @param {WritableStream} p.stream
 * @returns {Promise<number>} nombre de fiches générées
 */
export const generateZoneFichesPDF = async ({ zones, stream }) => {
  const PDFDocument = (await import("pdfkit")).default;
  const QRCode = (await import("qrcode")).default;

  const liste = (Array.isArray(zones) ? zones : []).filter((z) => safe(z?.code));

  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
  doc.pipe(stream);

  liste.forEach((zone, i) => {
    if (i > 0) doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
    drawFiche(doc, QRCode, zone);
  });

  if (liste.length === 0) {
    doc.font("Helvetica").fontSize(14).text("Aucune fiche à générer.", MARGIN, MARGIN);
  }

  return await new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(liste.length));
    stream.on("error", reject);
    doc.on("error", reject);
    doc.end();
  });
};

export default { construireZonesDepuisDictionnaire, generateZoneFichesPDF };
