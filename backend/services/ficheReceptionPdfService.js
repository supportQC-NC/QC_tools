// backend/services/ficheReceptionPdfService.js
//
// FICHE DE CONTRÔLE RÉCEPTION — version PAPIER (module « contrôle manuel »).
//
// PDF A4 PAYSAGE destiné à être imprimé et rempli À LA MAIN sur le quai :
//   - page 1 = PAGE D'EN-TÊTE : infos globales de la commande, qui contrôle,
//     puis 4 grandes cases séparées (avaries / manquants-casse / surplus /
//     commentaires) ;
//   - pages suivantes = le détail des lignes, une ligne par article, avec des
//     cases vides « Qté reçue », « Écart » et « Observation ».
//
// RÈGLE MÉTIER : la QUANTITÉ COMMANDÉE n'apparaît JAMAIS sur une fiche de
// contrôle (ni par ligne, ni en total) — le comptage se fait toujours à
// l'aveugle pour ne pas être influencé par la quantité attendue.
//
// Le PDF est diffusé dans un stream (res) — rien n'est écrit sur disque.

// A4 PAYSAGE (points PDF).
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const M = 24;
const CW = PAGE_W - 2 * M;

const NOIR = "#111827";
const GRIS_TXT = "#1f2937";
const GRIS_LABEL = "#6b7280";
const GRIS_LIGNE = "#d1d5db";
const GRIS_FOND = "#f3f4f6";
const GRIS_BANDE = "#f7f8f9";
const GRIS_REGLURE = "#e5e7eb";

const ROW_H = 19; // hauteur d'une ligne article (place pour écrire à la main)
const HEAD_H = 18; // hauteur de l'en-tête de tableau
const FOOTER_H = 24;

const PAGE_OPTS = { size: "A4", layout: "landscape", margin: 0 };

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const fmtNb = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  // toLocaleString("fr-FR") sépare les milliers par une espace fine insécable
  // (U+202F), absente du jeu WinAnsi de pdfkit -> espace normale.
  return Math.round(n).toLocaleString("fr-FR").replace(/[  ]/g, " ");
};
const fmtDate = (d) => {
  if (!d) return "—";
  const dd = d instanceof Date ? d : new Date(d);
  if (isNaN(dd.getTime())) return "—";
  return dd.toLocaleDateString("fr-FR");
};
const fmtDateHeure = (d) => {
  const dd = d instanceof Date ? d : new Date(d);
  if (isNaN(dd.getTime())) return "";
  return `${dd.toLocaleDateString("fr-FR")} à ${dd.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

// Tronque un texte à la largeur disponible (police/taille COURANTES du document).
// pdfkit renvoie quand même le texte à la ligne malgré `lineBreak: false`, et son
// calcul interne diffère légèrement de widthOfString : on valide donc la coupe
// avec heightOfString (une seule ligne rendue) pour garantir UNE ligne par cellule.
const tronquer = (doc, texte, largeur) => {
  let t = safeTrim(texte);
  if (!t || largeur <= 0) return "";
  // Référence « une ligne » mesurée avec la même méthode (currentLineHeight()
  // n'inclut pas la même interligne que heightOfString).
  const hMax =
    doc.heightOfString("A", { width: largeur, lineBreak: false }) * 1.5;
  const tient = (s) =>
    doc.heightOfString(s, { width: largeur, lineBreak: false }) <= hMax;
  if (tient(t)) return t;
  // Estimation rapide par largeur, puis ajustement fin caractère par caractère.
  const ratio = (largeur - 6) / doc.widthOfString(t);
  if (ratio < 1) t = t.slice(0, Math.max(1, Math.floor(t.length * ratio)));
  while (t.length > 1 && !tient(`${t}…`)) t = t.slice(0, -1);
  return `${t}…`;
};

// Logo base64 de l'entreprise -> Buffer (null si absent / illisible).
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

// ---------------------------------------------------------------------------
// COLONNES DU TABLEAU (paysage)
// « Désignation » est PRIORITAIRE : 330 pt, de quoi écrire 50 caractères en
// entier (même en majuscules larges) sans troncature. « Code art. » est réduit
// (jamais plus de 6 caractères), le gencode a sa propre colonne, et le reste
// de la largeur va à « Observation ».
// Aucune colonne « Qté cdée » : le comptage est toujours à l'aveugle.
// ---------------------------------------------------------------------------
const DESIGNATION_W = 320;

const buildColonnes = () => {
  const cols = [
    { key: "check", label: "", w: 16, align: "center" },
    { key: "nl", label: "NL", w: 22, align: "center" },
    { key: "nart", label: "CODE", w: 44, align: "left" },
    { key: "flag", label: "", w: 24, align: "center" },
    { key: "designation", label: "DÉSIGNATION", w: DESIGNATION_W, align: "left" },
    { key: "gencod", label: "GENCODE", w: 58, align: "left" },
    { key: "refer", label: "RÉF. FRN", w: 52, align: "left" },
    { key: "qteRecue", label: "QTÉ REÇUE", w: 60, align: "center", saisie: true },
    { key: "ecart", label: "ÉCART", w: 45, align: "center", saisie: true },
    { key: "obs", label: "OBSERVATION", w: 0, align: "left", saisie: true },
  ];
  const fixe = cols.reduce((s, c) => s + c.w, 0);
  cols.find((c) => c.key === "obs").w = CW - fixe;

  let x = M;
  let xSaisie = M + CW;
  cols.forEach((c) => {
    c.x = x;
    if (c.saisie) xSaisie = Math.min(xSaisie, x);
    x += c.w;
  });
  return { cols, xSaisie };
};

// Cadre libellé à remplir (« Contrôlé par », « Date »…).
const drawChamp = (doc, label, x, y, w, h) => {
  doc.save().lineWidth(0.7).strokeColor(GRIS_LIGNE).rect(x, y, w, h).stroke().restore();
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(GRIS_LABEL)
    .text(label.toUpperCase(), x + 4, y + 3, { width: w - 8, lineBreak: false });
};

// Écrit un texte en gras à la plus grande taille qui tient sur UNE ligne dans
// `w` (les noms de fournisseurs vont de « ETS X » à 40 caractères) ; si même la
// plus petite ne tient pas, on tronque.
const drawTitreAdaptatif = (doc, texte, x, y, w, tailles, align = "left") => {
  const t = safeTrim(texte) || "—";
  doc.font("Helvetica-Bold");
  const taille =
    tailles.find((s) => {
      doc.fontSize(s);
      return doc.widthOfString(t) <= w;
    }) || tailles[tailles.length - 1];
  doc.fontSize(taille);
  doc.text(tronquer(doc, t, w), x, y, { width: w, align, lineBreak: false });
  return taille;
};

// Couple libellé / valeur du bloc d'identité de la commande.
const drawInfo = (doc, label, valeur, x, y, w) => {
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(GRIS_LABEL)
    .text(label.toUpperCase(), x, y, { width: w, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(9).fillColor(GRIS_TXT);
  doc.text(tronquer(doc, valeur, w) || "—", x, y + 9, { width: w, lineBreak: false });
};

// Grande case à remplir à la main (avaries, manquants, surplus, commentaires).
const drawGrandeCase = (doc, { titre, aide, x, y, w, h }) => {
  const bandeH = 18;
  doc.save().lineWidth(0.9).strokeColor("#9ca3af").rect(x, y, w, h).stroke().restore();
  doc.save().fillColor(GRIS_FOND).rect(x + 0.5, y + 0.5, w - 1, bandeH).fill().restore();
  doc.save().lineWidth(0.6).strokeColor(GRIS_LIGNE);
  doc.moveTo(x, y + bandeH).lineTo(x + w, y + bandeH).stroke();
  doc.restore();

  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(NOIR)
    .text(titre.toUpperCase(), x + 8, y + 5, { width: w - 16, lineBreak: false });
  if (aide) {
    doc.font("Helvetica").fontSize(6.2).fillColor(GRIS_LABEL);
    doc.text(tronquer(doc, aide, w - 16), x + 8, y + 6.5, {
      width: w - 16,
      align: "right",
      lineBreak: false,
    });
  }

  // Réglure pour l'écriture manuscrite.
  doc.save().lineWidth(0.4).strokeColor(GRIS_REGLURE);
  for (let ly = y + bandeH + 20; ly < y + h - 6; ly += 20) {
    doc.moveTo(x + 8, ly).lineTo(x + w - 8, ly).stroke();
  }
  doc.restore();
};

// ---------------------------------------------------------------------------
// PAGE 1 — EN-TÊTE DE LA COMMANDE + 4 GRANDES CASES
// ---------------------------------------------------------------------------
const drawPageEntete = (doc, { entreprise, commande, lignes, commentaires, options }) => {
  const couleur = safeTrim(entreprise?.couleurPrimaire) || "#0f766e";
  let y = M;

  const logo = logoBuffer(entreprise);
  if (logo) {
    try {
      doc.image(logo, M, y, { fit: [110, 40] });
    } catch {
      /* logo illisible : ignoré */
    }
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor(GRIS_LABEL)
    .text(
      safeTrim(
        entreprise?.nomComplet || entreprise?.nom || entreprise?.nomDossierDBF,
      ).toUpperCase(),
      M,
      y + 1,
      { width: CW, align: "right" },
    );
  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor(NOIR)
    .text("FICHE DE CONTRÔLE RÉCEPTION", M, y + 12, { width: CW, align: "right" });
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(GRIS_LABEL)
    .text(
      `Éditée le ${fmtDateHeure(new Date())}${
        options?.editePar ? ` par ${options.editePar}` : ""
      } · comptage à l'aveugle`,
      M,
      y + 33,
      { width: CW, align: "right" },
    );

  y += 46;
  doc.save().lineWidth(1.6).strokeColor(couleur);
  doc.moveTo(M, y).lineTo(M + CW, y).stroke();
  doc.restore();

  // ── Bloc d'identité de la commande ────────────────────────────────────────
  y += 10;
  // Deux étages : (1) n° de commande + FOURNISSEUR en gros, (2) les autres
  // infos sur une seule ligne.
  const blocH = 74;
  doc.save().lineWidth(0.7);
  doc.rect(M, y, CW, blocH).fillAndStroke(GRIS_FOND, GRIS_LIGNE);
  doc.restore();

  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(GRIS_LABEL)
    .text("N° DE COMMANDE", M + 12, y + 8, { width: 150, lineBreak: false });
  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor(NOIR)
    .text(safeTrim(commande?.numcde) || "—", M + 12, y + 19, {
      width: 150,
      lineBreak: false,
    });

  // Le FOURNISSEUR est l'information la plus lue sur le quai : il sort de la
  // grille d'infos et prend sa propre colonne, en gras et en grand (taille
  // adaptée à la longueur du nom).
  const fournX = M + 175;
  const fournW = CW - 175 - 12;
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(GRIS_LABEL)
    .text("FOURNISSEUR", fournX, y + 8, { width: fournW, lineBreak: false });
  doc.fillColor(NOIR);
  drawTitreAdaptatif(
    doc,
    commande?.fournisseurNom,
    fournX,
    y + 17,
    fournW,
    [24, 21, 18, 15, 12],
  );

  // ⚠️ Aucune quantité commandée ici non plus (même en total) : comptage à l'aveugle.
  // Le 3e membre est un poids de largeur (nom de bateau et libellé d'état sont
  // longs, les compteurs tiennent en 3 chiffres).
  const infos = [
    ["Bateau / vol", commande?.bateau, 2],
    ["Arrivée prévue", fmtDate(commande?.arrivee), 1],
    ["Date commande", fmtDate(commande?.datcde), 1],
    [
      "État",
      commande?.etatLabel || (commande?.etat != null ? `État ${commande.etat}` : ""),
      1.4,
    ],
    ["Lignes à contrôler", String(lignes.length), 1],
    ["Nouveautés", String(lignes.filter((l) => l.estNouveau).length), 1],
    [
      "Réservations",
      options?.resaDisponible === false
        ? "n/d"
        : String(lignes.filter((l) => l.estReserve).length),
      1,
    ],
  ];
  const unite = (CW - 24) / infos.reduce((s, [, , p]) => s + p, 0);
  let cx = M + 12;
  infos.forEach(([label, valeur, poids]) => {
    drawInfo(doc, label, valeur, cx, y + 46, poids * unite - 10);
    cx += poids * unite;
  });

  y += blocH + 10;

  // ── Qui contrôle ? (cadres à remplir) ─────────────────────────────────────
  const champH = 30;
  const gap = 10;
  const champW = (CW - 4 * gap) / 5;
  [
    "Contrôlé par",
    "Date du contrôle",
    "Heure début / fin",
    "Nb de colis reçus",
    "Signature",
  ].forEach((label, i) => {
    drawChamp(doc, label, M + i * (champW + gap), y, champW, champH);
  });
  y += champH + 10;

  // ── Commentaires de la commande (lignes « ! » du DBF) ─────────────────────
  if (commentaires.length) {
    doc
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .fillColor(GRIS_LABEL)
      .text("COMMENTAIRES DE LA COMMANDE", M, y, { width: CW, lineBreak: false });
    y += 9;
    doc.font("Helvetica").fontSize(7.5).fillColor(GRIS_TXT);
    commentaires.slice(0, 3).forEach((c) => {
      doc.text(tronquer(doc, `• ${c}`, CW), M, y, { width: CW, lineBreak: false });
      y += 10;
    });
    y += 4;
  }

  // ── 4 grandes cases (2 × 2) jusqu'au bas de page ───────────────────────────
  const bas = PAGE_H - M - FOOTER_H;
  const gapC = 12;
  const caseW = (CW - gapC) / 2;
  const caseH = (bas - y - gapC) / 2;
  const cases = [
    { titre: "Avaries", aide: "article · qté · nature du dommage" },
    { titre: "Manquants / casse", aide: "article · qté manquante ou cassée" },
    { titre: "Surplus", aide: "article · qté en trop ou hors commande" },
    { titre: "Commentaires", aide: "observations générales sur la livraison" },
  ];
  cases.forEach((c, i) => {
    drawGrandeCase(doc, {
      ...c,
      x: M + (i % 2) * (caseW + gapC),
      y: y + Math.floor(i / 2) * (caseH + gapC),
      w: caseW,
      h: caseH,
    });
  });
};

// En-tête allégé des pages de détail.
const drawEntetePageDetail = (doc, { entreprise, commande }) => {
  let y = M;
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(NOIR)
    .text(
      `FICHE DE CONTRÔLE RÉCEPTION — Cde ${safeTrim(commande?.numcde) || "—"}`,
      M,
      y,
      { width: CW * 0.7, lineBreak: false },
    );
  // Même logique qu'en page 1 : le fournisseur est mis en avant (gras, plus
  // gros) ; le reste du contexte reste en petit, sur la ligne du dessous.
  const contexte = [safeTrim(commande?.bateau), safeTrim(entreprise?.trigramme).toUpperCase()]
    .filter(Boolean)
    .join(" · ");
  doc.fillColor(NOIR);
  drawTitreAdaptatif(
    doc,
    commande?.fournisseurNom,
    M + CW * 0.62,
    y - 2,
    CW * 0.38,
    [13, 11.5, 10],
    "right",
  );
  if (contexte) {
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(GRIS_LABEL)
      .text(contexte, M, y + 13, { width: CW, align: "right", lineBreak: false });
  }
  y += 24;
  doc.save().lineWidth(0.7).strokeColor(GRIS_LIGNE);
  doc.moveTo(M, y).lineTo(M + CW, y).stroke();
  doc.restore();
  return y + 8;
};

// En-tête du tableau (répété sur chaque page de détail). Renvoie le y du corps.
const drawTableHeader = (doc, cols, y) => {
  doc.save();
  doc.rect(M, y, CW, HEAD_H).fillAndStroke(GRIS_FOND, GRIS_LIGNE);
  doc.restore();
  doc.font("Helvetica-Bold").fontSize(6.8).fillColor(GRIS_TXT);
  cols.forEach((c) => {
    if (!c.label) return;
    doc.text(tronquer(doc, c.label, c.w - 6), c.x + 3, y + 6, {
      width: c.w - 6,
      align: c.align === "right" ? "right" : c.align,
      lineBreak: false,
    });
  });
  doc.save().lineWidth(0.5).strokeColor(GRIS_LIGNE);
  cols.slice(1).forEach((c) => {
    doc.moveTo(c.x, y).lineTo(c.x, y + HEAD_H).stroke();
  });
  doc.restore();
  return y + HEAD_H;
};

// Une ligne article : partie gauche imprimée (bande grise alternée), partie
// droite (qté reçue / écart / observation) laissée BLANCHE pour l'écriture.
const drawLigne = (doc, cols, xSaisie, ligne, y, index) => {
  if (index % 2 === 1) {
    doc.save().fillColor(GRIS_BANDE).rect(M, y, xSaisie - M, ROW_H).fill().restore();
  }

  doc.save().lineWidth(0.5).strokeColor(GRIS_LIGNE);
  doc.rect(M, y, CW, ROW_H).stroke();
  cols.slice(1).forEach((c) => {
    doc.moveTo(c.x, y).lineTo(c.x, y + ROW_H).stroke();
  });
  doc.restore();

  const ty = y + 6;
  const cell = (key, texte, opts = {}) => {
    const c = cols.find((x) => x.key === key);
    if (!c) return;
    doc
      .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
      .fontSize(opts.size || 7.6)
      .fillColor(opts.color || GRIS_TXT);
    doc.text(tronquer(doc, texte, c.w - 6), c.x + 3, ty, {
      width: c.w - 6,
      align: c.align === "center" ? "center" : c.align,
      lineBreak: false,
    });
  };

  // Case à cocher (article contrôlé).
  const chk = cols[0];
  doc
    .save()
    .lineWidth(0.7)
    .strokeColor("#9ca3af")
    .rect(chk.x + (chk.w - 9) / 2, y + (ROW_H - 9) / 2, 9, 9)
    .stroke()
    .restore();

  cell("nl", ligne.nl ? fmtNb(ligne.nl) : "", { size: 6.8, color: GRIS_LABEL });
  cell("nart", ligne.nart, { bold: true });
  // Repères cumulables : R = réservé pour un client (à mettre de côté),
  // N = nouveauté (jamais vendue), ? = article absent de la base.
  const reperes = [
    ligne.inconnu ? "?" : "",
    ligne.estNouveau ? "N" : "",
    ligne.estReserve ? "R" : "",
  ].join("");
  cell("flag", reperes, {
    bold: true,
    size: 7.5,
    // La réservation prime à l'affichage : c'est elle qui change le geste de
    // l'agent (mettre de côté au lieu de ranger).
    color: ligne.estReserve ? "#1d4ed8" : ligne.inconnu ? "#b91c1c" : "#b45309",
  });
  cell("designation", ligne.designation);
  cell("gencod", ligne.gencod, { size: 7, color: GRIS_LABEL });
  cell("refer", ligne.refer, { size: 7, color: GRIS_LABEL });

  return y + ROW_H;
};

/**
 * Génère la fiche de contrôle PDF (A4 paysage) et la diffuse dans `stream`.
 *
 * @param {object} p
 * @param {object} p.entreprise    document Entreprise (logo, couleurs, nom)
 * @param {object} p.commande      entête { numcde, fournisseurNom, bateau, arrivee, datcde, etat, etatLabel }
 * @param {Array}  p.lignes        [{ nl, nart, designation, refer, gencod, estNouveau, estReserve, inconnu }]
 *                                 (la quantité commandée n'est jamais imprimée)
 * @param {Array}  p.commentaires  lignes de commentaire de la commande (NART « ! »)
 * @param {object} p.options       { editePar:string, resaDisponible?:boolean }
 * @param {WritableStream} p.stream
 * @returns {Promise<{nbPages:number, nbLignes:number}>}
 */
export const genererFicheReceptionPDF = async ({
  entreprise,
  commande,
  lignes = [],
  commentaires = [],
  options = {},
  stream,
}) => {
  const mod = await import("pdfkit").catch(() => {
    throw new Error("Module 'pdfkit' introuvable (npm i pdfkit).");
  });
  const PDFDocument = mod.default;

  const { cols, xSaisie } = buildColonnes();

  const doc = new PDFDocument({
    ...PAGE_OPTS,
    bufferPages: true,
    info: {
      Title: `Fiche de contrôle réception ${safeTrim(commande?.numcde)}`,
      Author: safeTrim(entreprise?.nomComplet || entreprise?.nomDossierDBF),
    },
  });
  doc.pipe(stream);

  // ── Page 1 : en-tête de commande + 4 grandes cases ────────────────────────
  drawPageEntete(doc, {
    entreprise,
    commande,
    lignes,
    commentaires,
    options,
  });

  // ── Pages suivantes : détail des lignes ───────────────────────────────────
  const limiteBas = PAGE_H - M - FOOTER_H;
  doc.addPage(PAGE_OPTS);
  let y = drawEntetePageDetail(doc, { entreprise, commande });
  y = drawTableHeader(doc, cols, y);

  lignes.forEach((ligne, i) => {
    if (y + ROW_H > limiteBas) {
      doc.addPage(PAGE_OPTS);
      y = drawEntetePageDetail(doc, { entreprise, commande });
      y = drawTableHeader(doc, cols, y);
    }
    y = drawLigne(doc, cols, xSaisie, ligne, y, i);
  });

  if (lignes.length === 0) {
    doc
      .font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor(GRIS_LABEL)
      .text("Aucune ligne article dans cette commande.", M, y + 8, { width: CW });
  }

  // ── Pieds de page (numérotation connue une fois toutes les pages écrites) ──
  const range = doc.bufferedPageRange();
  // Si l'index des réservations n'a pas répondu, on le DIT sur le papier :
  // une fiche sans « R » ne doit jamais laisser croire qu'il n'y a aucune
  // réservation.
  const legende =
    options?.resaDisponible === false
      ? "ATTENTION : réservations non disponibles à l'édition (aucun repère R) · N = nouveauté · ? = article inconnu · comptage à l'aveugle"
      : "R = réservé pour un client (mettre de côté) · N = nouveauté · ? = article inconnu · comptage à l'aveugle (quantité commandée jamais imprimée)";
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const fy = PAGE_H - M - 10;
    doc.save().lineWidth(0.5).strokeColor(GRIS_LIGNE);
    doc.moveTo(M, fy - 4).lineTo(M + CW, fy - 4).stroke();
    doc.restore();
    doc.font("Helvetica").fontSize(6.5).fillColor(GRIS_LABEL);
    doc.text(legende, M, fy, { width: CW * 0.7, lineBreak: false });
    doc.text(
      `Cde ${safeTrim(commande?.numcde)} — page ${i + 1}/${range.count}`,
      M,
      fy,
      { width: CW, align: "right", lineBreak: false },
    );
  }

  return await new Promise((resolve, reject) => {
    stream.on("finish", () =>
      resolve({ nbPages: range.count, nbLignes: lignes.length }),
    );
    stream.on("error", reject);
    doc.on("error", reject);
    doc.end();
  });
};

export default { genererFicheReceptionPDF };
