// backend/services/etiquetteService.js
//
// Générateur d'étiquettes PDF — portage fidèle du module Python (reportlab).
// 6 types : standard (grille 5x4cm), promo / solde / destockage / sans_prix / normal
// (pleine page A4 paysage). Option "demi A4" pour les types pleine page :
// 2 articles différents par feuille A4 portrait (chacun = demi-page A5 paysage).
// Code-barres EAN-13 vectoriel (scannable). Polices Helvetica/Helvetica-Bold.
//
// Coordonnées : la classe RL émule l'API reportlab (origine bas-gauche, Y vers le
// haut, drawString = ligne de base) au-dessus de pdfkit (origine haut-gauche).

import fs from "fs";

const CM = 28.346456692913385; // 1 cm en points PDF
const ASCENT = 0.718; // ascender Helvetica (718/1000)

// Dimensions A4
const LAND_W = 841.89; // A4 paysage : largeur
const LAND_H = 595.28; // A4 paysage : hauteur
const PORTRAIT_W = 595.28; // A4 portrait : largeur
const PORTRAIT_H = 841.89; // A4 portrait : hauteur

// ----------------------------------------------------------------------------
// EAN-13 (vectoriel)
// ----------------------------------------------------------------------------
const EAN_L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const EAN_G = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
const EAN_R = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];
const EAN_PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

// Clé de contrôle modulo 10 d'un corps de longueur quelconque (EAN/UPC) :
// poids 3 et 1 alternés en partant de la DROITE du corps. Sert à reconnaître
// un UPC-A (12 chiffres, clé sur les 11 premiers) d'un EAN-13 amputé de sa clé.
const cleModulo10 = (corps) => {
  let s = 0;
  for (let i = corps.length - 1, p = 3; i >= 0; i -= 1, p = p === 3 ? 1 : 3) {
    s += parseInt(corps[i], 10) * p;
  }
  return String((10 - (s % 10)) % 10);
};

const ean13CheckDigit = (d12) => {
  let s = 0;
  for (let i = 0; i < 12; i++) s += parseInt(d12[i], 10) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (s % 10)) % 10);
};

const ean13Bits = (code) => {
  let d = String(code == null ? "" : code).replace(/\D/g, "");
  // ⚠️ Un code à 12 chiffres est un UPC-A : il PORTE DÉJÀ sa clé de contrôle,
  // son EAN-13 est « 0 » + le code. Lui ajouter une clé calculée imprimait un
  // code-barres inexistant (« 076501207828 » → « 0765012078287 »), illisible au
  // rescan. On ne complète par une clé que les codes à 12 chiffres dont la
  // dernière position n'est pas déjà une clé valide.
  if (d.length === 12) {
    d = cleModulo10(d.slice(0, 11)) === d[11] ? `0${d}` : d + ean13CheckDigit(d);
  }
  if (d.length !== 13) return null;
  const first = parseInt(d[0], 10);
  const left = d.slice(1, 7);
  const right = d.slice(7, 13);
  const par = EAN_PARITY[first];
  let bits = "101";
  for (let i = 0; i < 6; i++) {
    const n = parseInt(left[i], 10);
    bits += par[i] === "L" ? EAN_L[n] : EAN_G[n];
  }
  bits += "01010";
  for (let i = 0; i < 6; i++) bits += EAN_R[parseInt(right[i], 10)];
  bits += "101";
  return { bits, full: d };
};

const drawEAN13 = (rl, code, x, y, w, h) => {
  const res = ean13Bits(code);
  if (!res) return;
  const textH = Math.min(10, h * 0.22);
  const barsH = h - textH;
  const mw = w / 95;
  rl.setFillColorRGB(0, 0, 0);
  for (let i = 0; i < 95; i++) {
    if (res.bits[i] === "1") {
      rl.rect(x + i * mw, y + textH, mw, barsH, { fill: true, stroke: false });
    }
  }
  rl.setFont("Helvetica", Math.min(8, textH));
  rl.drawCentredString(x + w / 2, y + 1, res.full);
};

// ----------------------------------------------------------------------------
// Formatage (équivalents du script Python)
// ----------------------------------------------------------------------------
const groupThousands = (intStr) =>
  String(intStr).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const fmtInt = (n) => {
  const v = Math.trunc(Number(n) || 0);
  const sign = v < 0 ? "-" : "";
  return sign + groupThousands(Math.abs(v).toString());
};
const fmtRound = (n) => {
  const v = Math.round(Number(n) || 0);
  const sign = v < 0 ? "-" : "";
  return sign + groupThousands(Math.abs(v).toString());
};

const safe = (v) => (v == null ? "" : String(v)).trim();

const fmtPromoDate = (v) => {
  if (v == null || v === "") return "N/A";
  if (v instanceof Date && !isNaN(v.getTime())) {
    const dd = String(v.getDate()).padStart(2, "0");
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${v.getFullYear()}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return s.slice(0, 10);
  return "N/A";
};

const wrapText = (text, width) => {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const wd of words) {
    if (!cur) cur = wd;
    else if ((cur + " " + wd).length <= width) cur += " " + wd;
    else { lines.push(cur); cur = wd; }
    while (cur.length > width) { lines.push(cur.slice(0, width)); cur = cur.slice(width); }
  }
  if (cur) lines.push(cur);
  return lines;
};

// ----------------------------------------------------------------------------
// Couche compatible reportlab au-dessus de pdfkit (origine bas-gauche)
// ----------------------------------------------------------------------------
class RL {
  constructor(doc) {
    this.doc = doc;
    this.W = doc.page.width;
    this.H = doc.page.height;
    this.fill = [0, 0, 0];
    this.stroke = [0, 0, 0];
    this.lw = 1;
    this.font = "Helvetica";
    this.size = 12;
  }
  _resync() { this.W = this.doc.page.width; this.H = this.doc.page.height; }
  setFillColorRGB(r, g, b) { this.fill = [r * 255, g * 255, b * 255]; }
  setStrokeColorRGB(r, g, b) { this.stroke = [r * 255, g * 255, b * 255]; }
  setLineWidth(w) { this.lw = w; }
  setFont(name, size) { this.font = name; this.size = size; }
  rect(x, y, w, h, opts = {}) {
    const fill = !!opts.fill;
    const stroke = opts.stroke === undefined ? true : !!opts.stroke;
    const top = this.H - (y + h);
    if (fill && stroke) {
      this.doc.lineWidth(this.lw).rect(x, top, w, h).fillAndStroke(this.fill, this.stroke);
    } else if (fill) {
      this.doc.rect(x, top, w, h).fill(this.fill);
    } else {
      this.doc.lineWidth(this.lw).rect(x, top, w, h).stroke(this.stroke);
    }
  }
  line(x1, y1, x2, y2) {
    this.doc.lineWidth(this.lw)
      .moveTo(x1, this.H - y1)
      .lineTo(x2, this.H - y2)
      .stroke(this.stroke);
  }
  drawString(x, y, text) {
    const top = (this.H - y) - ASCENT * this.size;
    this.doc.font(this.font).fontSize(this.size).fillColor(this.fill)
      .text(String(text), x, top, { lineBreak: false });
  }
  drawCentredString(x, y, text) {
    this.doc.font(this.font).fontSize(this.size);
    const w = this.doc.widthOfString(String(text));
    this.drawString(x - w / 2, y, text);
  }
  drawImage(buf, x, y, w, h) {
    const top = this.H - (y + h);
    // `fit` : préserve le RATIO (jamais d'étirement), centré dans la zone w×h.
    this.doc.image(buf, x, top, { fit: [w, h], align: "center", valign: "center" });
  }
  showPage(opts = { size: "A4", layout: "landscape", margin: 0 }) {
    this.doc.addPage(opts);
    this._resync();
  }
  save() { this.doc.end(); }
}

const drawLogo = (rl, logoBuf, x, y) => {
  if (!logoBuf) return;
  try {
    rl.drawImage(logoBuf, x + 10, y - 90, 80, 80);
  } catch (e) {
    console.warn(
      `[etiquettes] Logo non dessiné (pdfkit n'accepte que PNG/JPEG) : ${e.message}`,
    );
  }
};

// pdfkit n'accepte que PNG / JPEG : on vérifie la signature du fichier.
const isPngOrJpeg = (buf) => {
  if (!buf || buf.length < 4) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true; // PNG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
  return false;
};

// Décode un logo UPLOADÉ stocké en base64 (data URL "data:image/png;base64,…").
// Renvoie un Buffer PNG/JPEG (accepté par pdfkit) ou null.
const bufferFromLogoDataUrl = (logo) => {
  const s = logo == null ? "" : String(logo).trim();
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(s);
  if (!m) return null;
  try {
    const buf = Buffer.from(m[2], "base64");
    return isPngOrJpeg(buf) ? buf : null;
  } catch {
    return null;
  }
};

/**
 * Résout et lit le logo de l'entreprise (PNG/JPEG). Renvoie un Buffer ou null.
 * PRIORITÉ au logo UPLOADÉ (entreprise.logo, base64) ; à défaut, REPLI sur le
 * fichier pointé par cheminLogoEtiquettes.
 * Gère :
 *  - dev Windows : chemin UNC lu tel quel,
 *  - prod Linux (RCOMMON_STOCK_ROOT défini) : traduction du chemin UNC vers le
 *    point de montage en CONSERVANT les sous-dossiers après "STOCK".
 * Écrit un message explicite dans les logs si le logo est ignoré.
 */
const resolveLogoBuffer = (entreprise) => {
  // 1) Logo uploadé (base64) prioritaire.
  const uploaded = bufferFromLogoDataUrl(entreprise && entreprise.logo);
  if (uploaded) return uploaded;

  // 2) Repli : fichier configuré via cheminLogoEtiquettes.
  const raw = entreprise && entreprise.cheminLogoEtiquettes;
  const p = raw == null ? "" : String(raw).trim();
  if (!p) return null; // aucun logo configuré → silencieux

  const candidates = [p]; // tel quel (Windows / chemin Linux direct)
  const root = process.env.RCOMMON_STOCK_ROOT;
  if (root) {
    const r = root.replace(/[\\/]+$/, "");
    const segs = p.split(/[\\/]+/).filter(Boolean);
    const iStock = segs.findIndex((s) => s.toUpperCase() === "STOCK");
    if (iStock >= 0 && iStock < segs.length - 1) {
      candidates.push(`${r}/${segs.slice(iStock + 1).join("/")}`); // sous-dossiers conservés
    }
    if (segs.length) candidates.push(`${r}/${segs[segs.length - 1]}`); // dernier segment
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const buf = fs.readFileSync(c);
        if (!isPngOrJpeg(buf)) {
          console.warn(
            `[etiquettes] Logo "${c}" ignoré : format non supporté (PNG ou JPEG requis).`,
          );
          return null;
        }
        return buf;
      }
    } catch {
      /* candidat suivant */
    }
  }

  console.warn(
    `[etiquettes] Logo introuvable/illisible. Chemin configuré : "${p}". ` +
      `Candidats testés : ${candidates.join(" | ")}`,
  );
  return null;
};

// ----------------------------------------------------------------------------
// ÉTIQUETTES STANDARD (grille 5x4 cm) — grille CENTRÉE avec marge de sécurité
// pour éviter tout rognage en haut / sur les bords par l'imprimante.
// ----------------------------------------------------------------------------
const drawStandardCell = (rl, record, x, y, labelW, labelH, opts = {}) => {
  const { showPrice = true } = opts;
  rl.setStrokeColorRGB(0, 0, 0);
  rl.setLineWidth(1);
  rl.rect(x, y, labelW, labelH);

  rl.setFillColorRGB(0, 0, 0);
  rl.setFont("Helvetica", 6);
  rl.drawString(x + 2, y + labelH - 8, safe(record.NART));

  rl.setFont("Helvetica-Bold", 7);
  const product = safe(record.DESIGN || "Désignation non spécifié").slice(0, 80);
  let wrapped = wrapText(product, 28);
  if (wrapped.length > 2) { wrapped = wrapped.slice(0, 2); wrapped[1] = wrapped[1] + "..."; }
  let yp = y + labelH - 23;
  for (const line of wrapped) { rl.drawString(x + 5, yp, line); yp -= 8; }

  // Bloc central : prix (Standard) ou NART (Standard sans prix), même emplacement.
  rl.setFillColorRGB(0.95, 0.95, 0.95);
  const pbh = 15;
  rl.rect(x + 5, yp - pbh, labelW - 10, pbh, { fill: true, stroke: false });
  rl.setFillColorRGB(0, 0, 0);
  rl.setFont("Helvetica-Bold", 12);
  const centralText = showPrice
    ? `${fmtInt(record.PVTETTC || 0)} XPF`
    : safe(record.NART);
  rl.drawCentredString(x + labelW / 2, yp - pbh + 3, centralText);
  yp -= pbh;

  if (showPrice) {
    let klText = "";
    if (record.VOL && Number(record.VOL) !== 0) {
      const ppu = (Number(record.PVTETTC) || 0) / Number(record.VOL);
      klText = `soit ${fmtRound(ppu)} XPF / ${safe(record.KL) || "N/A"}`;
    }
    if (klText) { rl.setFont("Helvetica-Bold", 8); rl.drawCentredString(x + labelW / 2, yp - 10, klText); }
  }

  const gencod = String(record.GENCOD || "").replace(/\D/g, "");
  if (gencod.length === 13) {
    const bw = labelW - 10;
    const bh = 46;
    const bx = x + (labelW - bw) / 2;
    const by = y + 1;
    drawEAN13(rl, gencod, bx, by, bw, bh);
  }
};

// Distance entre le HAUT de la feuille et la ligne de base du titre de section.
//
// ⚠️ 1,2 cm et pas moins : à 0,55 cm (premier essai), le haut des lettres
// arrivait à ~2 mm du bord et la plupart des imprimantes le rognaient — le
// groupe était illisible sur les tirages. À 1,2 cm, le texte commence à ~9 mm
// du bord, au-delà de la zone non imprimable habituelle (~5 mm), et son bas
// reste à ~25 pt au-dessus de la première rangée d'étiquettes.
const TITRE_SECTION_Y = 1.2 * CM;
const TITRE_SECTION_TAILLE = 13;

/**
 * Titre de section, en HAUT À DROITE de la feuille A4, en gras.
 *
 * ⚠️ Il est dessiné dans la MARGE de la feuille, jamais sur une étiquette : la
 * grille est centrée verticalement et laisse ~62 pt libres en haut (5x4 cm sur
 * A4 paysage). La taille et le nombre d'étiquettes par page ne changent donc
 * pas d'un iota.
 *
 * `xDroite` = bord droit de la GRILLE (et non de la feuille) : le titre tombe
 * ainsi dans l'alignement de la dernière colonne d'étiquettes, ce qui le place
 * à ~55 pt du bord de la feuille — hors de portée du rognage latéral.
 */
const drawTitreSection = (rl, titre, xDroite) => {
  if (!titre) return;
  rl.setFillColorRGB(0, 0, 0);
  rl.setFont("Helvetica-Bold", TITRE_SECTION_TAILLE);
  // Aligné à droite : on mesure pour poser le coin gauche du texte.
  rl.doc.font("Helvetica-Bold").fontSize(TITRE_SECTION_TAILLE);
  const w = rl.doc.widthOfString(String(titre));
  rl.drawString(xDroite - w, rl.H - TITRE_SECTION_Y, titre);
};

// Marque de ligne : le même code que le titre, répété dans la marge DROITE en
// face de chaque rangée d'étiquettes.
//
// POURQUOI : la feuille se découpe en BANDES horizontales, une par rangée. Le
// titre en haut à droite disparaît alors sur toutes les bandes sauf la
// première, et un paquet de bandes coupées n'est plus identifiable. Le code
// répété en bout de rangée reste sur chaque bande.
//
// Il est écrit HORIZONTALEMENT, dans le sens de lecture des étiquettes : une
// bande posée à plat se lit sans la tourner. La taille s'adapte à la marge
// disponible (~1,9 cm sur A4 paysage) et le texte est tronqué en dernier
// recours, plutôt que de déborder dans la zone rognée par l'imprimante.
const MARQUE_LIGNE_MAX = 10;
const MARQUE_LIGNE_MIN = 6;
const MARQUE_LIGNE_ECART = 5; // écart entre le bord des étiquettes et la marque

const drawMarqueLigne = (rl, titre, x, largeur, yCentre) => {
  if (!titre || largeur <= 8) return;
  let texte = String(titre);

  // 1) réduire la taille tant que ça dépasse ; 2) tronquer si ça dépasse encore.
  let taille = MARQUE_LIGNE_MAX;
  const mesure = (t, s) =>
    rl.doc.font("Helvetica-Bold").fontSize(s).widthOfString(t);
  while (taille > MARQUE_LIGNE_MIN && mesure(texte, taille) > largeur) {
    taille -= 0.5;
  }
  while (texte.length > 1 && mesure(texte + "…", taille) > largeur) {
    texte = texte.slice(0, -1);
  }
  if (texte !== String(titre)) texte += "…";

  rl.setFillColorRGB(0, 0, 0);
  rl.setFont("Helvetica-Bold", taille);
  // Centrage optique sur la hauteur de la rangée.
  rl.drawString(x, yCentre - taille * 0.35, texte);
};

/**
 * Grille d'étiquettes standard (5x4 cm).
 *
 * `sections` = [{ titre, articles }]. Une section NE PARTAGE JAMAIS une feuille
 * avec une autre (décision client du 08/09/2026) : imprimer un gisement, c'est
 * imprimer un paquet d'étiquettes qu'on emporte dans le rayon, et deux rayons
 * sur la même feuille obligent à découper puis trier. Le titre rappelle en haut
 * à droite de quel gisement ou groupe il s'agit.
 *
 * Une section sans titre (impression par NART, par proforma, par commande…) se
 * comporte exactement comme avant : remplissage continu, aucun en-tête.
 */
const drawStandard = (rl, sections, opts = {}) => {
  const W = rl.W;
  const H = rl.H;
  const labelW = 5 * CM;
  const labelH = 4 * CM;
  const gap = 0.2 * CM;
  const minMargin = 0.6 * CM; // ~6 mm de sécurité anti-rognage

  const cols = Math.max(1, Math.floor((W - 2 * minMargin + gap) / (labelW + gap)));
  const rows = Math.max(1, Math.floor((H - 2 * minMargin + gap) / (labelH + gap)));
  const gridW = cols * labelW + (cols - 1) * gap;
  const gridH = rows * labelH + (rows - 1) * gap;
  const startX = (W - gridW) / 2; // grille centrée -> marges symétriques
  const startYTop = (H - gridH) / 2; // marge haute (mesurée depuis le haut)
  const perPage = cols * rows;

  // Marge droite disponible pour la marque de ligne (grille centrée → elle vaut
  // startX), moins l'écart aux étiquettes et une sécurité anti-rognage.
  const xMarque = startX + gridW + MARQUE_LIGNE_ECART;
  // 0,5 cm réservé au bord droit : c'est la zone non imprimable habituelle
  // (~5 mm), la même qui avait déjà obligé à descendre le titre de section.
  const largeurMarque = W - xMarque - 0.5 * CM;

  let premierePage = true;
  sections.forEach((section) => {
    const articles = section.articles || [];
    if (articles.length === 0) return;

    // Pages parcourues explicitement : il faut savoir combien de RANGÉES sont
    // occupées sur la page pour ne marquer que celles-là (une marque en face
    // d'une rangée vide ferait croire à une bande manquante).
    for (let debut = 0; debut < articles.length; debut += perPage) {
      // Nouvelle section OU page suivante = nouvelle feuille (sauf la toute
      // première). Le titre est répété sur chaque feuille : un paquet de
      // 3 feuilles doit rester identifiable après avoir été séparé.
      if (!premierePage) rl.showPage();
      premierePage = false;
      drawTitreSection(rl, section.titre, startX + gridW);

      const surLaPage = Math.min(perPage, articles.length - debut);
      const lignesOccupees = Math.ceil(surLaPage / cols);
      for (let row = 0; row < lignesOccupees; row++) {
        const yHaut = H - (startYTop + row * (labelH + gap));
        drawMarqueLigne(
          rl,
          section.titre,
          xMarque,
          largeurMarque,
          yHaut - labelH / 2,
        );
      }

      for (let k = 0; k < surLaPage; k++) {
        const col = k % cols;
        const row = Math.floor(k / cols);
        const x = startX + col * (labelW + gap);
        const y = H - (startYTop + row * (labelH + gap)) - labelH;
        drawStandardCell(rl, articles[debut + k], x, y, labelW, labelH, opts);
      }
    }
  });
};

// ----------------------------------------------------------------------------
// DESSINATEURS "UN ARTICLE" (pleine page logique A4 paysage, sans gestion de page)
// ----------------------------------------------------------------------------
const drawBigOne = (rl, record, logoBuf, title, dateLineFn) => {
  const W = rl.W;
  const H = rl.H;
  const labelW = W;
  const labelH = H;
  const x = 0;
  let y = H;

  rl.rect(x, y - labelH, labelW, labelH);
  drawLogo(rl, logoBuf, x, y);

  rl.setFont("Helvetica-Bold", 60);
  rl.setFillColorRGB(1, 0, 0);
  rl.drawCentredString(x + labelW / 2, y - 60, title);

  const gencod = String(record.GENCOD || "");
  if (gencod && /^\d+$/.test(gencod)) {
    // Code-barres agrandi pour être SCANNABLE (module ~0.6mm au lieu de ~0.37mm).
    // On garde le bord haut à la même position (by + bh = y - 10) et on agrandit
    // vers le bas et la gauche ; marge droite = zone de silence.
    const bw = 175;
    const bh = 72;
    const bx = x + labelW - bw - 18;
    const by = y - 82;
    drawEAN13(rl, gencod, bx, by, bw, bh);
    rl.setFont("Helvetica-Bold", 14);
    rl.setFillColorRGB(0, 0, 0);
    rl.drawCentredString(bx + bw / 2, by - 15, `${safe(record.NART) || "N/A"}`);
  }

  y -= 120;

  rl.setFont("Helvetica-Bold", 36);
  rl.setFillColorRGB(0, 0, 0);
  let product = safe(record.DESIGN || "Produit sans nom").replace(/\*/g, "");
  product = product.replace(/\s+/g, " ").trim();
  const wrapped = wrapText(product, 30);
  let yp = y - 50;
  for (const line of wrapped) { rl.drawCentredString(x + labelW / 2, yp, line); yp -= 40; }

  rl.setFont("Helvetica-Bold", 36);
  const pvtttc = record.PVTETTC || 0;
  if (pvtttc) {
    const priceX = x + labelW / 2;
    const priceY = yp - 50;
    rl.drawCentredString(priceX, priceY, `${fmtInt(pvtttc)} XPF`);
    const lineY = priceY + 10;
    rl.setStrokeColorRGB(0, 0, 0);
    rl.setLineWidth(2);
    rl.line(priceX - 80, lineY, priceX + 80, lineY);
  }

  const pvpromo = Number(record.PVPROMO) || 0;
  const atva = Number(record.ATVA) || 0;
  const pvpromoTtc = Math.trunc(pvpromo * (1 + atva / 100));

  rl.setFont("Helvetica-Bold", 96);
  const ppX = x + labelW / 2;
  const ppY = yp - 150;
  rl.drawCentredString(ppX, ppY, `${fmtInt(pvpromoTtc)} XPF`);

  const vol = record.VOL;
  const kl = record.KL;
  if (vol != null && Number(vol) !== 0) {
    const ppu = Number(pvpromoTtc) / Number(vol);
    rl.setFont("Helvetica", 16);
    rl.drawCentredString(x + labelW / 2, ppY - 40, `soit ${fmtRound(ppu)} XPF / ${safe(kl)}`);
  }

  rl.setFont("Helvetica-Bold", 25);
  rl.drawCentredString(x + labelW / 2, 30, dateLineFn(record));
};

const drawSansPrixOne = (rl, record, logoBuf) => {
  const W = rl.W;
  const H = rl.H;
  const labelW = W;
  const labelH = H;
  const x = 0;
  let y = H;

  rl.rect(x, y - labelH, labelW, labelH);
  drawLogo(rl, logoBuf, x, y);

  const gencod = String(record.GENCOD || "");
  if (gencod && /^\d+$/.test(gencod)) {
    // Code-barres agrandi pour être SCANNABLE (module ~0.6mm au lieu de ~0.37mm).
    // On garde le bord haut à la même position (by + bh = y - 10) et on agrandit
    // vers le bas et la gauche ; marge droite = zone de silence.
    const bw = 175;
    const bh = 72;
    const bx = x + labelW - bw - 18;
    const by = y - 82;
    drawEAN13(rl, gencod, bx, by, bw, bh);
    rl.setFont("Helvetica-Bold", 14);
    rl.setFillColorRGB(0, 0, 0);
    rl.drawCentredString(bx + bw / 2, by - 15, `${safe(record.NART) || "N/A"}`);
  }

  y -= 200;

  // NART bien visible (centré)
  rl.setFont("Helvetica-Bold", 30);
  rl.setFillColorRGB(0, 0, 0);
  rl.drawCentredString(x + labelW / 2, y - 30, safe(record.NART) || "N/A");

  // Désignation agrandie
  rl.setFont("Helvetica-Bold", 56);
  let product = safe(record.DESIGN || "Produit sans nom").replace(/\*/g, "");
  product = product.replace(/\s+/g, " ").trim();
  const wrapped = wrapText(product, 21);
  let yp = y - 95;
  for (const line of wrapped) { rl.drawCentredString(x + labelW / 2, yp, line); yp -= 66; }
};

const drawNormalOne = (rl, record, logoBuf) => {
  const W = rl.W;
  const H = rl.H;
  const labelW = W;
  const labelH = H;
  const x = 0;
  let y = H;

  rl.rect(x, y - labelH, labelW, labelH);
  drawLogo(rl, logoBuf, x, y);

  const gencod = String(record.GENCOD || "");
  if (gencod && /^\d+$/.test(gencod)) {
    // Code-barres agrandi pour être SCANNABLE (module ~0.6mm au lieu de ~0.37mm).
    // On garde le bord haut à la même position (by + bh = y - 10) et on agrandit
    // vers le bas et la gauche ; marge droite = zone de silence.
    const bw = 175;
    const bh = 72;
    const bx = x + labelW - bw - 18;
    const by = y - 82;
    drawEAN13(rl, gencod, bx, by, bw, bh);
    rl.setFont("Helvetica-Bold", 14);
    rl.setFillColorRGB(0, 0, 0);
    rl.drawCentredString(bx + bw / 2, by - 15, `${safe(record.NART) || "N/A"}`);
  }

  y -= 120;

  rl.setFont("Helvetica-Bold", 49);
  rl.setFillColorRGB(0, 0, 0);
  let product = safe(record.DESIGN || "Produit sans designation").replace(/\*/g, "");
  product = product.replace(/\s+/g, " ").trim();
  const wrapped = wrapText(product, 20);
  let yp = y - 70;
  for (const line of wrapped) { rl.drawCentredString(x + labelW / 2, yp, line); yp -= 50; }

  rl.setFont("Helvetica-Bold", 80);
  const pvtttc = record.PVTETTC || 0;
  if (pvtttc) {
    const priceX = x + labelW / 2;
    const priceY = yp - 150;
    rl.drawCentredString(priceX, priceY, `${fmtInt(pvtttc)} XPF`);
  }

  let klText = "";
  if (record.VOL && Number(record.VOL) !== 0) {
    const ppu = (Number(record.PVTETTC) || 0) / Number(record.VOL);
    klText = `soit ${fmtRound(ppu)} XPF / ${safe(record.KL) || "N/A"}`;
  }
  if (klText) { rl.setFont("Helvetica-Bold", 15); rl.drawCentredString(x + labelW / 2, yp - 10, klText); }
};

// Étiquette INVENTAIRE : REF + NART en gros, désignation en gros, grande case
// vide « Quantité : » à remplir au stylo. Compatible A4 et demi A4.
const drawInventaireOne = (rl, record, logoBuf) => {
  const W = rl.W;
  const H = rl.H;
  const x = 0;
  const y = H;

  rl.rect(x, y - H, W, H); // cadre

  // Logo optionnel en haut à droite (n'empiète pas sur REF/NART)
  if (logoBuf) {
    try { rl.drawImage(logoBuf, W - 110, y - 100, 80, 80); } catch { /* ignore */ }
  }

  // REF + NART (en gros, en haut à gauche)
  rl.setFillColorRGB(0, 0, 0);
  rl.setFont("Helvetica", 18);
  rl.drawString(x + 40, y - 52, "REF");
  rl.setFont("Helvetica-Bold", 60);
  rl.drawString(x + 110, y - 70, safe(record.NART) || "N/A");

  // Désignation (en GROS, centrée)
  rl.setFont("Helvetica-Bold", 48);
  let product = safe(record.DESIGN || "Produit sans désignation")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const wrapped = wrapText(product, 23);
  let yp = y - 165;
  for (const line of wrapped.slice(0, 3)) {
    rl.drawCentredString(W / 2, yp, line);
    yp -= 58;
  }

  // « Quantité : » + grande case vide pour écriture manuelle
  const boxW = 400;
  const boxH = 170;
  const boxX = 270;
  const boxY = 45;
  rl.setFont("Helvetica-Bold", 28);
  rl.drawString(boxX - 190, boxY + boxH / 2 - 12, "Quantité :");
  rl.setLineWidth(2);
  rl.setStrokeColorRGB(0, 0, 0);
  rl.rect(boxX, boxY, boxW, boxH);
};

// Table des dessinateurs "un article" par type pleine page
const ONE_DRAWERS = {
  promo: (rl, r, logo) =>
    drawBigOne(rl, r, logo, "PROMO",
      (x) => `PROMO du ${fmtPromoDate(x.DPROMOD)} au ${fmtPromoDate(x.DPROMOF)}`),
  solde: (rl, r, logo) =>
    drawBigOne(rl, r, logo, "SOLDE",
      (x) => `Solde du ${fmtPromoDate(x.DPROMOD)} au ${fmtPromoDate(x.DPROMOF)}`),
  destockage: (rl, r, logo) =>
    drawBigOne(rl, r, logo, "DESTOCKAGE",
      (x) => `Du ${fmtPromoDate(x.DPROMOD)} Jusqu'à épuisement du stock.`),
  sans_prix: drawSansPrixOne,
  normal: drawNormalOne,
  inventaire: drawInventaireOne,
};

// ----------------------------------------------------------------------------
// Rendu pleine page A4 (un article par page paysage)
// ----------------------------------------------------------------------------
const drawFullPage = (rl, records, logoBuf, drawOne) => {
  records.forEach((record, i) => {
    if (i > 0) rl.showPage({ size: "A4", layout: "landscape", margin: 0 });
    drawOne(rl, record, logoBuf);
  });
};

// ----------------------------------------------------------------------------
// Rendu DEMI A4 : 2 articles différents par feuille A4 portrait.
// Chaque article = demi-page (A5 paysage) = visuel pleine page réduit à l'échelle.
// ----------------------------------------------------------------------------
const drawDemi = (rl, doc, sections, logoBuf, drawOne) => {
  // Coordonnées logiques = A4 paysage ; le contenu est réduit puis placé dans
  // une moitié de la feuille A4 portrait.
  rl.W = LAND_W;
  rl.H = LAND_H;
  const s = PORTRAIT_W / LAND_W; // 1/√2 ≈ 0.7071 (largeur paysage -> largeur portrait)
  const halfH = PORTRAIT_H / 2;

  // Comme la grille standard : une section ne partage jamais une feuille avec
  // une autre. Deux étiquettes tiennent ici sur une A4, donc le découpage est
  // nécessaire — au prix, parfois, d'une demi-feuille vide en fin de section.
  // Pas de titre en revanche : l'étiquette occupe toute la demi-page, il n'y a
  // aucune marge où l'écrire sans mordre dessus.
  let premiere = true;
  sections.forEach((section) => {
    const articles = section.articles || [];
    if (articles.length === 0) return;
    if (!premiere) doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
    premiere = false;

    articles.forEach((record, i) => {
      const slot = i % 2; // 0 = haut, 1 = bas
      if (slot === 0 && i > 0) {
        doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
      }
      const ty = slot === 0 ? 0 : halfH;
      doc.save();
      doc.translate(0, ty);
      doc.scale(s);
      drawOne(rl, record, logoBuf);
      doc.restore();
    });
  });
};

export const TYPES_ETIQUETTES = [
  "standard", "standard_sans_prix", "promo", "solde", "destockage", "sans_prix", "normal", "inventaire", "custom",
];

// ----------------------------------------------------------------------------
// ÉTIQUETTE PERSONNALISÉE (« custom ») — l'utilisateur choisit la taille et place
// librement des éléments texte. On tuile autant d'exemplaires que possible sur
// une feuille A4 (même logique que la grille standard).
// ----------------------------------------------------------------------------
const PX = 72 / 96; // 1 px @96dpi -> 0.75 pt (préserve les cm : cm->px@96 puis px->pt)

const hexToRgb01 = (hex) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex == null ? "" : hex).trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

// Valeur d'un CHAMP article (mêmes données que les autres étiquettes).
// Cas particulier « import Excel » : un champ `imp<N>` lit la N-ième colonne de la
// ligne importée (record.__cols), permettant de placer des données libres.
const getFieldValue = (record, field) => {
  if (!record) return "";
  const imp = /^imp(\d+)$/.exec(String(field || ""));
  if (imp) {
    const arr = record.__cols;
    return Array.isArray(arr) ? safe(arr[Number(imp[1])]) : "";
  }
  switch (field) {
    case "ref":
      return safe(record.NART);
    case "design":
      return safe(record.DESIGN).replace(/\*/g, "").replace(/\s+/g, " ").trim();
    case "prix":
      return record.PVTETTC ? `${fmtInt(record.PVTETTC)} XPF` : "";
    case "prixPromo": {
      const pvpromo = Number(record.PVPROMO) || 0;
      const atva = Number(record.ATVA) || 0;
      if (!pvpromo) return "";
      return `${fmtInt(Math.trunc(pvpromo * (1 + atva / 100)))} XPF`;
    }
    case "contenance": {
      if (record.VOL && Number(record.VOL) !== 0) {
        const ppu = (Number(record.PVTETTC) || 0) / Number(record.VOL);
        return `soit ${fmtRound(ppu)} XPF / ${safe(record.KL) || "N/A"}`;
      }
      return "";
    }
    case "gencod":
      return String(record.GENCOD || "").replace(/\D/g, "");
    case "datesPromo":
      return `du ${fmtPromoDate(record.DPROMOD)} au ${fmtPromoDate(record.DPROMOF)}`;
    default:
      return "";
  }
};

// Dessine un bloc de texte (multi-ligne) ancré en haut-gauche (px depuis le haut).
const drawTextEl = (rl, cellX, cellBottomY, hpt, el, text) => {
  let raw = text == null ? "" : String(text);
  if (!raw) return;
  // `wrap` (nb de caractères/ligne, défini sur les champs) : coupe le texte en
  // plusieurs lignes. Les retours manuels (\n) existants sont préservés.
  const wrap = Number(el.wrap) || 0;
  if (wrap > 0) {
    raw = raw
      .split("\n")
      .map((line) => wrapText(line, wrap).join("\n"))
      .join("\n");
  }
  const sizePt = Math.max(1, (Number(el.fontSize) || 12) * PX);
  rl.setFont(el.bold ? "Helvetica-Bold" : "Helvetica", sizePt);
  const [r, g, b] = hexToRgb01(el.color || "#000000");
  rl.setFillColorRGB(r, g, b);
  const exPt = (Number(el.x) || 0) * PX;
  const eyPt = (Number(el.y) || 0) * PX;
  const lineH = sizePt * 1.2;
  raw.split("\n").forEach((line, li) => {
    const topY = cellBottomY + hpt - eyPt - li * lineH; // Y-up du haut de ligne
    rl.drawString(cellX + exPt, topY - ASCENT * sizePt, line);
  });
};

// Dessine UNE étiquette custom dans la cellule. Éléments positionnés en px depuis
// le HAUT-GAUCHE. Kinds : text | field | line | rect | logo | barcode.
const drawCustomLabel = (rl, layout, cellX, cellBottomY, wpt, hpt, ctx = {}) => {
  const { record = null, logoBuf = null } = ctx;
  if (layout.border !== false) {
    rl.setStrokeColorRGB(0, 0, 0);
    rl.setLineWidth(0.7);
    rl.rect(cellX, cellBottomY, wpt, hpt);
  }
  const elements = Array.isArray(layout.elements) ? layout.elements : [];
  for (const el of elements) {
    const kind = el.kind || "text";
    const exPt = (Number(el.x) || 0) * PX;
    const eyPt = (Number(el.y) || 0) * PX;

    if (kind === "text") {
      drawTextEl(rl, cellX, cellBottomY, hpt, el, el.text);
    } else if (kind === "field") {
      drawTextEl(rl, cellX, cellBottomY, hpt, el, getFieldValue(record, el.field));
    } else if (kind === "line") {
      const [r, g, b] = hexToRgb01(el.color || "#000000");
      rl.setStrokeColorRGB(r, g, b);
      rl.setLineWidth(Math.max(0.3, (Number(el.thickness) || 1) * PX));
      const lenPt = (Number(el.length) || 0) * PX;
      const yTop = cellBottomY + hpt - eyPt;
      const x1 = cellX + exPt;
      if (el.orientation === "v") rl.line(x1, yTop, x1, yTop - lenPt);
      else rl.line(x1, yTop, x1 + lenPt, yTop);
    } else if (kind === "rect") {
      const wPt = (Number(el.w) || 0) * PX;
      const hPt = (Number(el.h) || 0) * PX;
      const yBottom = cellBottomY + hpt - eyPt - hPt;
      const [sr, sg, sb] = hexToRgb01(el.color || "#000000");
      rl.setStrokeColorRGB(sr, sg, sb);
      rl.setLineWidth(Math.max(0.3, (Number(el.lineWidth) || 1) * PX));
      if (el.fill) {
        const [fr, fg, fb] = hexToRgb01(el.fillColor || el.color || "#000000");
        rl.setFillColorRGB(fr, fg, fb);
        rl.rect(cellX + exPt, yBottom, wPt, hPt, { fill: true, stroke: true });
      } else {
        rl.rect(cellX + exPt, yBottom, wPt, hPt, { fill: false, stroke: true });
      }
    } else if (kind === "logo") {
      if (logoBuf) {
        const wPt = (Number(el.w) || 0) * PX;
        const hPt = (Number(el.h) || 0) * PX;
        const yBottom = cellBottomY + hpt - eyPt - hPt;
        try {
          rl.drawImage(logoBuf, cellX + exPt, yBottom, wPt, hPt);
        } catch {
          /* pdfkit : PNG/JPEG uniquement */
        }
      }
    } else if (kind === "barcode") {
      // `el.field` (facultatif) : colonne importée / champ article source du code ;
      // sinon on retombe sur le GENCOD de l'article.
      const raw = el.field
        ? getFieldValue(record, el.field)
        : getFieldValue(record, "gencod");
      const code = String(raw || "").replace(/\D/g, "");
      if (code && code.length === 13) {
        const wPt = Math.max(30, (Number(el.w) || 100) * PX);
        const hPt = Math.max(20, (Number(el.h) || 40) * PX);
        const yBottom = cellBottomY + hpt - eyPt - hPt;
        drawEAN13(rl, code, cellX + exPt, yBottom, wPt, hPt);
      }
    }
  }
};

/**
 * Génère un PDF d'étiquettes PERSONNALISÉES tuilées sur A4.
 *  - Sans `articles` : `copies` exemplaires du même visuel (texte/formes/logo).
 *  - Avec `articles`  : UNE étiquette par article, les éléments `field`/`barcode`
 *                       étant remplis depuis chaque enregistrement article.
 * @param {Object} p
 * @param {Object} p.layout      - { widthPx, heightPx, border?, elements: [...] }
 * @param {number} [p.copies]    - exemplaires (mode texte seul)
 * @param {Array}  [p.articles]  - enregistrements article.dbf (mode données)
 * @param {Object} [p.entreprise]- doc entreprise (logo)
 * @param {string} p.outPath     - chemin de sortie du PDF
 */
export const genererEtiquettesCustomPDF = async ({
  layout,
  copies,
  articles,
  entreprise,
  outPath,
}) => {
  const wpt = Math.max(4, (Number(layout.widthPx) || 0) * PX);
  const hpt = Math.max(4, (Number(layout.heightPx) || 0) * PX);
  const hasArticles = Array.isArray(articles) && articles.length > 0;
  const n = hasArticles
    ? articles.length
    : Math.max(1, Math.min(5000, Math.floor(Number(copies) || 1)));
  const logoBuf = resolveLogoBuffer(entreprise);

  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const rl = new RL(doc);
  const W = rl.W;
  const H = rl.H;
  const gap = 8;
  const margin = 14;

  const cols = Math.max(1, Math.floor((W - 2 * margin + gap) / (wpt + gap)));
  const rows = Math.max(1, Math.floor((H - 2 * margin + gap) / (hpt + gap)));
  const perPage = cols * rows;
  const gridW = cols * wpt + (cols - 1) * gap;
  const gridH = rows * hpt + (rows - 1) * gap;
  const startX = (W - gridW) / 2;
  const startTop = (H - gridH) / 2;

  for (let i = 0; i < n; i++) {
    const idx = i % perPage;
    if (idx === 0 && i > 0) rl.showPage({ size: "A4", layout: "portrait", margin: 0 });
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const cellLeft = startX + col * (wpt + gap);
    const cellTopFromTop = startTop + row * (hpt + gap);
    const cellBottomY = H - cellTopFromTop - hpt;
    const record = hasArticles ? articles[i] : null;
    drawCustomLabel(rl, layout, cellLeft, cellBottomY, wpt, hpt, { record, logoBuf });
  }
  rl.save();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return outPath;
};

/**
 * Génère le PDF d'étiquettes dans outPath.
 * @param {Object} p
 * @param {string} p.type      - standard | promo | solde | destockage | sans_prix | normal
 * @param {string} [p.format]  - "a4" (défaut) | "demi" (ignoré pour standard)
 * @param {Array}  p.articles  - enregistrements article.dbf (dans l'ordre voulu)
 * @param {Object} p.entreprise- doc entreprise (pour le chemin du logo)
 * @param {string} p.outPath   - chemin de sortie du PDF
 */
/**
 * @param {object} p
 * @param {Array}  p.articles  liste à plat (compat : tous les modes hors
 *                             gisement/groupe)
 * @param {Array}  [p.sections] [{ titre, articles }] — une section par gisement
 *                             ou par groupe. Chacune démarre une NOUVELLE
 *                             feuille, porte son titre en haut à droite et
 *                             le répète en marge de chaque rangée (découpage
 *                             en bandes).
 *                             N'a d'effet que sur les étiquettes « standard »,
 *                             les seules à en tuiler plusieurs par feuille ;
 *                             les autres types impriment déjà un article par
 *                             page (ou deux en demi-format).
 */
export const genererEtiquettesPDF = async ({
  type,
  format,
  articles,
  sections,
  entreprise,
  outPath,
}) => {
  const isStandard = type === "standard" || type === "standard_sans_prix";
  if (!isStandard && !ONE_DRAWERS[type]) {
    throw new Error(`Type d'étiquette inconnu: ${type}`);
  }
  const isDemi = !isStandard && format === "demi";

  const PDFDocument = (await import("pdfkit")).default;
  const docOpts = isDemi
    ? { size: "A4", layout: "portrait", margin: 0 }
    : { size: "A4", layout: "landscape", margin: 0 };
  const doc = new PDFDocument(docOpts);
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  // Logo entreprise (optionnel) — résolu + tracé dans les logs si ignoré
  const logoBuf = resolveLogoBuffer(entreprise);

  // Sans sections (impression par NART, proforma, commande…) : une seule
  // section sans titre, donc remplissage continu, exactement comme avant.
  const paquets =
    Array.isArray(sections) && sections.length
      ? sections
      : [{ titre: "", articles }];

  const rl = new RL(doc);
  if (isStandard) {
    drawStandard(rl, paquets, { showPrice: type === "standard" });
  } else if (isDemi) {
    drawDemi(rl, doc, paquets, logoBuf, ONE_DRAWERS[type]);
  } else {
    drawFullPage(rl, articles, logoBuf, ONE_DRAWERS[type]);
  }
  rl.save();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return outPath;
};

export default { genererEtiquettesPDF, genererEtiquettesCustomPDF, TYPES_ETIQUETTES };