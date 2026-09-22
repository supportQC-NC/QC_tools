// backend/services/gisementLabelService.js
//
// Génère un PDF d'étiquettes de GISEMENT au format A8 (plusieurs par feuille A4),
// à coller à l'entrée des rayons du magasin / du dock.
//
// Chaque étiquette = nom du gisement en GRAS + code-barres Code128 encodant
// l'identité (le code) du gisement + le code en clair sous le code-barres.
//
// Code128 est utilisé (et non EAN-13) car les codes de gisement sont
// alphanumériques (ex. « R12 », « A03 »). Rendu VECTORIEL via pdfkit
// (coordonnées natives : origine en haut à gauche).

const MM = 2.834645669; // 1 mm en points PDF

// A4 portrait (points)
const A4_W = 595.28;
const A4_H = 841.89;

// A8 : 52 × 74 mm
const A8_W = 52 * MM;
const A8_H = 74 * MM;

// ── Code128 (sous-jeu B, ASCII imprimable) — table des motifs ────────────────
// 107 motifs de 6 largeurs (barre d'abord) + STOP (index 106) sur 7 largeurs.
const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112",
];
const CODE128_START_B = 104;
const CODE128_STOP = 106;

const safe = (v) => (v == null ? "" : String(v)).trim();

// Restreint aux caractères imprimables ASCII 32..126 (sous-jeu B).
const sanitizeCode128 = (text) =>
  [...safe(text)]
    .map((c) => {
      const code = c.charCodeAt(0);
      return code >= 32 && code <= 126 ? c : "?";
    })
    .join("");

// Calcule les runs de barres noires (en modules) pour un texte Code128-B.
const code128Runs = (text) => {
  const s = sanitizeCode128(text);
  const values = [CODE128_START_B];
  for (const ch of s) values.push(ch.charCodeAt(0) - 32);

  // Somme de contrôle (StartB pèse position 0, puis position croissante).
  let sum = CODE128_START_B;
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103);
  values.push(CODE128_STOP);

  const runs = []; // { start, len } en modules pour les barres noires
  let pos = 0;
  for (const v of values) {
    const pat = CODE128_PATTERNS[v];
    let isBar = true;
    for (const chW of pat) {
      const w = parseInt(chW, 10);
      if (isBar) runs.push({ start: pos, len: w });
      pos += w;
      isBar = !isBar;
    }
  }
  return { runs, totalModules: pos };
};

// Dessine un code-barres Code128 (barres noires) dans le rectangle (x,y,w,h),
// avec quiet zones de 10 modules de chaque côté. Coords pdfkit natives.
const drawCode128 = (doc, text, x, y, w, h) => {
  const { runs, totalModules } = code128Runs(text);
  const QUIET = 10;
  const mw = w / (totalModules + 2 * QUIET);
  doc.save().fillColor("#000000");
  for (const r of runs) {
    doc.rect(x + (QUIET + r.start) * mw, y, r.len * mw, h).fill();
  }
  doc.restore();
};

// Ajuste la taille de police pour que `text` tienne dans `maxW` (gras Helvetica).
const fitBoldFontSize = (doc, text, maxW, startSize, minSize = 10) => {
  let size = startSize;
  doc.font("Helvetica-Bold");
  while (size > minSize) {
    doc.fontSize(size);
    if (doc.widthOfString(text) <= maxW) break;
    size -= 1;
  }
  return size;
};

// Dessine un QR code (vectoriel) encodant `text` dans un carré (x,y,size),
// avec quiet zone de 4 modules. Coords pdfkit natives.
const drawQrCode = (QRCode, doc, text, x, y, size) => {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
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
        // Léger débord (+0.3) pour éviter les fentes blanches entre modules.
        doc.rect(ox + c * mw, oy + r * mw, mw + 0.3, mw + 0.3).fill();
      }
    }
  }
  doc.restore();
};

// Dessine UNE étiquette gisement dans la cellule (x,y,cw,ch).
//   item = { code, libelle }   codeType = "barcode" | "qr"
const drawGisementLabel = (doc, QRCode, item, niveauLabel, codeType, x, y, cw, ch) => {
  const pad = 6;
  const code = safe(item.code);
  const libelle = safe(item.libelle);
  const innerW = cw - 2 * pad;
  const innerX = x + pad;

  // Cadre (aide à la découpe).
  doc.save().lineWidth(0.7).strokeColor("#111111").rect(x, y, cw, ch).stroke().restore();

  let cy = y + pad;

  // Bandeau niveau (petit).
  if (niveauLabel) {
    doc.font("Helvetica").fontSize(8).fillColor("#666666");
    doc.text(niveauLabel, innerX, cy, { width: innerW, align: "center" });
    cy = doc.y + 2;
  }

  // Libellé du gisement en GRAS (principal), sur 2 lignes max.
  if (libelle) {
    const libSize = fitBoldFontSize(doc, libelle, innerW * 1.9, 22, 11);
    doc.font("Helvetica-Bold").fontSize(libSize).fillColor("#000000");
    doc.text(libelle, innerX, cy, { width: innerW, align: "center", height: libSize * 2.6 });
    cy = doc.y + 3;
  }

  // Code du gisement en gras (gros si pas de libellé, sinon plus discret).
  const codeSize = libelle
    ? fitBoldFontSize(doc, code, innerW, 18, 10)
    : fitBoldFontSize(doc, code, innerW, 46, 14);
  doc.font("Helvetica-Bold").fontSize(codeSize).fillColor("#000000");
  doc.text(code, innerX, cy, { width: innerW, align: "center", lineBreak: false });
  cy = doc.y + 4;

  // Zone du code visuel (bas de l'étiquette) + code en clair.
  const captionH = 12;
  if (codeType === "qr") {
    const dispo = y + ch - pad - captionH - cy;
    const qrSize = Math.max(48, Math.min(innerW, dispo, 96));
    const qx = x + (cw - qrSize) / 2;
    const qy = y + ch - pad - captionH - qrSize;
    drawQrCode(QRCode, doc, code, qx, qy, qrSize);
    doc.font("Helvetica").fontSize(9).fillColor("#000000");
    doc.text(code, innerX, qy + qrSize + 2, { width: innerW, align: "center", lineBreak: false });
  } else {
    const barH = 40;
    const barY = y + ch - pad - captionH - barH;
    drawCode128(doc, code, innerX, barY, innerW, barH);
    doc.font("Helvetica").fontSize(9).fillColor("#000000");
    doc.text(code, innerX, barY + barH + 2, { width: innerW, align: "center", lineBreak: false });
  }
};

/**
 * Génère le PDF des étiquettes de gisement et le diffuse dans `stream` (res).
 * @param {object}   p
 * @param {Array<{code:string,libelle?:string}>} p.items  1 étiquette par entrée
 * @param {string}   [p.niveauLabel] libellé du niveau (ex. "GISM2")
 * @param {"barcode"|"qr"} [p.codeType] type de code visuel (défaut "barcode")
 * @param {WritableStream} p.stream  destination (res)
 * @returns {Promise<number>} nombre d'étiquettes générées
 */
export const generateGisementLabelsPDF = async ({
  items,
  niveauLabel,
  codeType = "barcode",
  stream,
}) => {
  const PDFDocument = (await import("pdfkit")).default;
  const QRCode = codeType === "qr" ? (await import("qrcode")).default : null;

  const liste = (Array.isArray(items) ? items : [])
    .map((it) => ({ code: safe(it.code), libelle: safe(it.libelle) }))
    .filter((it) => it.code);

  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
  doc.pipe(stream);

  // Grille centrée d'étiquettes A8, avec marge de sécurité anti-rognage.
  const cellW = A8_W;
  const cellH = A8_H;
  const gap = 0; // étiquettes jointives : découpe au massicot bord à bord
  const minMargin = 5 * MM;

  const cols = Math.max(1, Math.floor((A4_W - 2 * minMargin + gap) / (cellW + gap)));
  const rows = Math.max(1, Math.floor((A4_H - 2 * minMargin + gap) / (cellH + gap)));
  const gridW = cols * cellW + (cols - 1) * gap;
  const gridH = rows * cellH + (rows - 1) * gap;
  const startX = (A4_W - gridW) / 2;
  const startY = (A4_H - gridH) / 2;
  const perPage = cols * rows;

  liste.forEach((item, i) => {
    const idxOnPage = i % perPage;
    if (idxOnPage === 0 && i > 0) doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
    const col = idxOnPage % cols;
    const row = Math.floor(idxOnPage / cols);
    const x = startX + col * (cellW + gap);
    const y = startY + row * (cellH + gap);
    drawGisementLabel(doc, QRCode, item, niveauLabel, codeType, x, y, cellW, cellH);
  });

  return await new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(liste.length));
    stream.on("error", reject);
    doc.on("error", reject);
    doc.end();
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// PANNEAUX QR « GONDOLE » (un par rayon, grand format)
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce n'est pas une étiquette d'article : c'est le panneau affiché EN GONDOLE
// pour identifier un rayon (GISM1, magasin) ou un emplacement de réserve
// (GISM2, dock). Le QR encode le CODE du gisement — exactement ce qu'encode
// déjà l'étiquette A8, pour que la douchette et l'app collecteur y lisent la
// même chose ; le libellé et le code en clair sont là pour l'humain.
//
// Format (demande client) : QR d'environ 5 cm de côté, 1 à 2 cm de marge, et le
// maximum de panneaux par feuille A4.
//   pas de 65 × 70 mm  →  3 colonnes × 4 rangées = 12 panneaux par A4,
//   avec 7,5 mm de marge latérale et 8,5 mm en haut/bas — le pied de page tient
//   dans la marge basse SANS entrer dans la bande non imprimable (5 mm) des
//   imprimantes du parc.
// Le carré QR fait 58 mm zone de silence comprise, soit un symbole noir de
// 42 à 45 mm selon la longueur du code : deux QR voisins sont donc séparés par
// ~20 mm de blanc. Un pas plus large (le texte SOUS la marge au lieu de DANS)
// ne tiendrait que 3 rangées, soit 9 panneaux par feuille au lieu de 12 — et
// gagner 2 mm de QR obligerait à réduire le libellé sous 9 pt, illisible en
// rayon. Toute retouche de ces trois constantes doit être revérifiée : le
// libellé (12 pt) et le code (12,5 pt) occupent 10,3 mm, il ne reste rien :
// 1,2 + 58 + 0,2 + 5,04 + 5,25 = 69,7 mm dans une cellule de 70 mm.
const GONDOLE_CELL_W = 65 * MM;
const GONDOLE_CELL_H = 70 * MM;
const GONDOLE_QR = 58 * MM;

// Dessine UN panneau dans la cellule (x, y, cw, ch) : QR en haut, libellé du
// rayon en gras dessous, code en clair en bas.
const drawQrGondole = (doc, QRCode, item, x, y, cw, ch) => {
  const pad = 3 * MM;
  const innerX = x + pad;
  const innerW = cw - 2 * pad;
  const code = safe(item.code);
  const libelle = safe(item.libelle);

  // Repère de découpe : trait fin et clair, il ne doit pas concurrencer le QR.
  doc.save().lineWidth(0.5).strokeColor("#cccccc").rect(x, y, cw, ch).stroke().restore();

  const qx = x + (cw - GONDOLE_QR) / 2;
  const qy = y + 1.2 * MM;
  drawQrCode(QRCode, doc, code, qx, qy, GONDOLE_QR);

  // Libellé du rayon : une seule ligne, taille ajustée à la largeur.
  // `lineBreak: false` + `ellipsis` : un libellé trop long est tronqué, il ne
  // déborde jamais sur le panneau voisin.
  let ty = qy + GONDOLE_QR + 0.2 * MM;
  if (libelle) {
    const libSize = fitBoldFontSize(doc, libelle, innerW, 12, 6);
    doc.font("Helvetica-Bold").fontSize(libSize).fillColor("#000000");
    doc.text(libelle, innerX, ty, {
      width: innerW,
      align: "center",
      lineBreak: false,
      ellipsis: true,
    });
    ty = doc.y;
  }

  // Code du gisement en clair (ce que lit l'agent sans douchette).
  const codeSize = fitBoldFontSize(doc, code, innerW, 12.5, 8);
  doc.font("Helvetica-Bold").fontSize(codeSize).fillColor("#000000");
  doc.text(code, innerX, ty, {
    width: innerW,
    align: "center",
    lineBreak: false,
  });
};

/**
 * Génère le PDF des panneaux QR de gisement (format gondole) dans `stream`.
 *
 * Les panneaux sont regroupés en SECTIONS, chacune démarrant sur une nouvelle
 * feuille et portant son propre pied de page. C'est ce qui permet de sortir le
 * magasin ET le dock en un seul PDF sans jamais mélanger les deux sur la même
 * feuille : une feuille découpée doit rester identifiable, or chez QC 53 codes
 * existent aux DEUX emplacements, 34 avec un libellé différent.
 *
 * @param {object} p
 * @param {Array<{piedDePage?:string,items:Array<{code:string,libelle?:string}>}>} [p.sections]
 *   sections dans l'ordre d'impression ; les sections vides sont ignorées.
 * @param {Array<{code:string,libelle?:string}>} [p.items]  raccourci pour une
 *   section unique (équivaut à `sections: [{ piedDePage, items }]`).
 * @param {string} [p.piedDePage]  pied de page de la section unique.
 * @param {WritableStream} p.stream  destination (res)
 * @returns {Promise<number>} nombre total de panneaux générés
 */
export const generateQrGondolePDF = async ({
  sections,
  items,
  piedDePage = "",
  stream,
}) => {
  const PDFDocument = (await import("pdfkit")).default;
  const QRCode = (await import("qrcode")).default;

  const brut =
    Array.isArray(sections) && sections.length
      ? sections
      : [{ piedDePage, items }];
  const lots = brut
    .map((sec) => ({
      piedDePage: safe(sec && sec.piedDePage),
      items: (Array.isArray(sec && sec.items) ? sec.items : [])
        .map((it) => ({ code: safe(it.code), libelle: safe(it.libelle) }))
        .filter((it) => it.code),
    }))
    .filter((sec) => sec.items.length > 0);

  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
  doc.pipe(stream);

  const cols = Math.max(1, Math.floor(A4_W / GONDOLE_CELL_W));
  const rows = Math.max(1, Math.floor(A4_H / GONDOLE_CELL_H));
  const startX = (A4_W - cols * GONDOLE_CELL_W) / 2;
  const startY = (A4_H - rows * GONDOLE_CELL_H) / 2;
  const perPage = cols * rows;

  const ecrirePied = (texte) => {
    if (!texte) return;
    doc.font("Helvetica").fontSize(7).fillColor("#999999");
    doc.text(texte, 0, A4_H - 7.5 * MM, {
      width: A4_W,
      align: "center",
      lineBreak: false,
    });
  };

  // pdfkit ouvre déjà la première feuille : on ne l'ajoute qu'à partir de la
  // deuxième, sinon le PDF commence par une page blanche.
  let pageOuverte = false;
  let total = 0;

  for (const lot of lots) {
    lot.items.forEach((item, i) => {
      const idxOnPage = i % perPage;
      if (idxOnPage === 0) {
        if (pageOuverte)
          doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
        pageOuverte = true;
        ecrirePied(lot.piedDePage);
      }
      const col = idxOnPage % cols;
      const row = Math.floor(idxOnPage / cols);
      drawQrGondole(
        doc,
        QRCode,
        item,
        startX + col * GONDOLE_CELL_W,
        startY + row * GONDOLE_CELL_H,
        GONDOLE_CELL_W,
        GONDOLE_CELL_H,
      );
    });
    total += lot.items.length;
  }

  return await new Promise((resolve, reject) => {
    stream.on("finish", () => resolve(total));
    stream.on("error", reject);
    doc.on("error", reject);
    doc.end();
  });
};

export default { generateGisementLabelsPDF, generateQrGondolePDF };
