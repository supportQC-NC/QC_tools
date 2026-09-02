// backend/services/fichePreparationPdfService.js
//
// FICHE DE PRÉPARATION DE COMMANDE — version PAPIER (module « préparation manuelle »).
//
// PDF A4 PAYSAGE destiné à être imprimé et rempli À LA MAIN dans les allées :
//   - page 1 = PAGE D'EN-TÊTE : proforma, CLIENT et VENDEUR, qui prépare, puis
//     4 grandes cases séparées (manquants / écarts / hors liste / commentaires) ;
//   - pages suivantes = le parcours, en DEUX SECTIONS successives :
//       1) DOCK (stock S2)  — on commence toujours par là ;
//       2) MAGASIN (stock S1) — le reliquat de chaque article.
//     Un même article peut donc apparaître deux fois, avec la quantité à
//     prendre PROPRE À LA ZONE.
//
// RÈGLE MÉTIER (inverse de la fiche de contrôle réception) : ici la QUANTITÉ À
// PRENDRE EST IMPRIMÉE — c'est l'instruction donnée à l'agent. La seule case
// laissée vide est la colonne « CTRL », où il note la quantité réellement prise
// quand elle diffère (rupture, casse, erreur de stock).
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
const ROUGE = "#b91c1c";

// Couleurs de repérage des deux zones de prélèvement.
const ZONES = {
  dock: {
    titre: "1 · DOCK",
    detail: "stock dock (S2) — à faire EN PREMIER",
    couleur: "#0f766e",
    fond: "#e6f4f1",
  },
  magasin: {
    titre: "2 · MAGASIN",
    detail: "reliquat en rayon (S1) — après le dock",
    couleur: "#b45309",
    fond: "#fdf3e3",
  },
};

const ROW_H = 19; // hauteur d'une ligne article (place pour écrire à la main)
const HEAD_H = 18; // hauteur de l'en-tête de tableau
const BAND_H = 20; // hauteur du bandeau de section (DOCK / MAGASIN)
const FOOTER_H = 24;

const PAGE_OPTS = { size: "A4", layout: "landscape", margin: 0 };

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const fmtNb = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  // toLocaleString("fr-FR") sépare les milliers par une espace fine insécable
  // (U+202F), absente du jeu WinAnsi de pdfkit -> espace normale.
  return Math.round(n).toLocaleString("fr-FR").replace(/[  ]/g, " ");
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
  const hMax =
    doc.heightOfString("A", { width: largeur, lineBreak: false }) * 1.5;
  const tient = (s) =>
    doc.heightOfString(s, { width: largeur, lineBreak: false }) <= hMax;
  if (tient(t)) return t;
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
// « Désignation » est prioritaire (300 pt) ; le RAYON prend le reste, car c'est
// lui qui guide le déplacement de l'agent au magasin. « À PRENDRE » est la
// colonne IMPRIMÉE la plus lue, « CTRL » la seule laissée vide.
// ---------------------------------------------------------------------------
const DESIGNATION_W = 300;

const buildColonnes = () => {
  const cols = [
    { key: "check", label: "", w: 16, align: "center" },
    { key: "nl", label: "NL", w: 22, align: "center" },
    { key: "nart", label: "CODE", w: 44, align: "left" },
    { key: "flag", label: "", w: 18, align: "center" },
    {
      key: "designation",
      label: "DÉSIGNATION",
      w: DESIGNATION_W,
      align: "left",
    },
    { key: "gencod", label: "GENCODE", w: 58, align: "left" },
    { key: "refer", label: "RÉF.", w: 46, align: "left" },
    { key: "rayon", label: "RAYON / EMPLACEMENT", w: 0, align: "left" },
    { key: "stock", label: "STOCK", w: 42, align: "center" },
    { key: "aPrendre", label: "À PRENDRE", w: 62, align: "center" },
    { key: "ctrl", label: "CTRL", w: 52, align: "center", saisie: true },
  ];
  const fixe = cols.reduce((s, c) => s + c.w, 0);
  cols.find((c) => c.key === "rayon").w = CW - fixe;

  let x = M;
  let xSaisie = M + CW;
  cols.forEach((c) => {
    c.x = x;
    if (c.saisie) xSaisie = Math.min(xSaisie, x);
    x += c.w;
  });
  return { cols, xSaisie };
};

// Cadre libellé à remplir (« Préparé par », « Date »…).
const drawChamp = (doc, label, x, y, w, h) => {
  doc
    .save()
    .lineWidth(0.7)
    .strokeColor(GRIS_LIGNE)
    .rect(x, y, w, h)
    .stroke()
    .restore();
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(GRIS_LABEL)
    .text(label.toUpperCase(), x + 4, y + 3, { width: w - 8, lineBreak: false });
};

// Écrit un texte en gras à la plus grande taille qui tient sur UNE ligne dans
// `w` (les noms de clients vont de « SARL X » à 30 caractères) ; si même la
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

// Couple libellé / valeur du bloc d'identité de la proforma.
const drawInfo = (doc, label, valeur, x, y, w) => {
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(GRIS_LABEL)
    .text(label.toUpperCase(), x, y, { width: w, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(9).fillColor(GRIS_TXT);
  doc.text(tronquer(doc, valeur, w) || "—", x, y + 9, {
    width: w,
    lineBreak: false,
  });
};

// Grande case à remplir à la main (manquants, écarts, hors liste, commentaires).
const drawGrandeCase = (doc, { titre, aide, x, y, w, h }) => {
  const bandeH = 18;
  doc
    .save()
    .lineWidth(0.9)
    .strokeColor("#9ca3af")
    .rect(x, y, w, h)
    .stroke()
    .restore();
  doc
    .save()
    .fillColor(GRIS_FOND)
    .rect(x + 0.5, y + 0.5, w - 1, bandeH)
    .fill()
    .restore();
  doc.save().lineWidth(0.6).strokeColor(GRIS_LIGNE);
  doc.moveTo(x, y + bandeH).lineTo(x + w, y + bandeH).stroke();
  doc.restore();

  doc
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .fillColor(NOIR)
    .text(titre.toUpperCase(), x + 8, y + 5, {
      width: w - 16,
      lineBreak: false,
    });
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
// PAGE 1 — EN-TÊTE DE LA PROFORMA + 4 GRANDES CASES
// ---------------------------------------------------------------------------
const drawPageEntete = (
  doc,
  { entreprise, proforma, totaux, commentaires, options },
) => {
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
    .text("FICHE DE PRÉPARATION DE COMMANDE", M, y + 12, {
      width: CW,
      align: "right",
    });
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor(GRIS_LABEL)
    .text(
      `Éditée le ${fmtDateHeure(new Date())}${
        options?.editePar ? ` par ${options.editePar}` : ""
      } · parcours dock puis magasin`,
      M,
      y + 33,
      { width: CW, align: "right" },
    );

  y += 46;
  doc.save().lineWidth(1.6).strokeColor(couleur);
  doc.moveTo(M, y).lineTo(M + CW, y).stroke();
  doc.restore();

  // ── Bloc d'identité de la proforma ────────────────────────────────────────
  // Deux étages : (1) n° de proforma + CLIENT en gros, (2) les autres infos sur
  // une seule ligne.
  y += 10;
  const blocH = 74;
  doc.save().lineWidth(0.7);
  doc.rect(M, y, CW, blocH).fillAndStroke(GRIS_FOND, GRIS_LIGNE);
  doc.restore();

  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(GRIS_LABEL)
    .text("N° DE PROFORMA", M + 12, y + 8, { width: 150, lineBreak: false });
  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor(NOIR)
    .text(safeTrim(proforma?.numfact) || "—", M + 12, y + 19, {
      width: 150,
      lineBreak: false,
    });

  // Le CLIENT est l'information la plus lue à la préparation (c'est pour lui
  // qu'on met la marchandise de côté) : il sort de la grille d'infos et prend
  // sa propre colonne, en gras et en grand.
  const clientX = M + 175;
  const clientW = CW - 175 - 12;
  doc
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(GRIS_LABEL)
    .text("CLIENT", clientX, y + 8, { width: clientW, lineBreak: false });
  doc.fillColor(NOIR);
  drawTitreAdaptatif(
    doc,
    [
      safeTrim(proforma?.clientNom),
      proforma?.clientCode != null ? `(${proforma.clientCode})` : "",
    ]
      .filter(Boolean)
      .join(" "),
    clientX,
    y + 17,
    clientW,
    [24, 21, 18, 15, 12],
  );

  // Le 3e membre est un poids de largeur (le nom du vendeur et le libellé
  // d'état sont longs, les compteurs tiennent en 3 chiffres).
  const infos = [
    [
      "Vendeur",
      [safeTrim(proforma?.vendeurNom), proforma?.vendeurCode ? `(${proforma.vendeurCode})` : ""]
        .filter(Boolean)
        .join(" "),
      2,
    ],
    ["Date proforma", fmtDate(proforma?.datfact), 1.1],
    [
      "État",
      proforma?.etatLabel ||
        (proforma?.etat != null ? `État ${proforma.etat}` : ""),
      1.4,
    ],
    ["Articles", String(totaux?.nbArticles ?? 0), 0.8],
    ["Total à prendre", fmtNb(totaux?.totalDemande), 1],
    ["Dont dock", fmtNb(totaux?.totalDock), 1],
    ["Dont magasin", fmtNb(totaux?.totalMagasin), 1],
    ["Stock insuffisant", String(totaux?.nbManquants ?? 0), 1.1],
  ];
  const unite = (CW - 24) / infos.reduce((s, [, , p]) => s + p, 0);
  let cx = M + 12;
  infos.forEach(([label, valeur, poids]) => {
    drawInfo(doc, label, valeur, cx, y + 46, poids * unite - 10);
    cx += poids * unite;
  });

  y += blocH + 10;

  // ── Qui prépare ? (cadres à remplir) ──────────────────────────────────────
  const champH = 30;
  const gap = 10;
  const champW = (CW - 4 * gap) / 5;
  [
    "Préparé par",
    "Date de préparation",
    "Heure début / fin",
    "Nb de colis / palettes",
    "Signature",
  ].forEach((label, i) => {
    drawChamp(doc, label, M + i * (champW + gap), y, champW, champH);
  });
  y += champH + 10;

  // ── Commentaires de la proforma (TEXTE d'entête + lignes « ! ») ────────────
  if (commentaires.length) {
    doc
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .fillColor(GRIS_LABEL)
      .text("COMMENTAIRES DE LA PROFORMA", M, y, {
        width: CW,
        lineBreak: false,
      });
    y += 9;
    doc.font("Helvetica").fontSize(7.5).fillColor(GRIS_TXT);
    commentaires.slice(0, 3).forEach((c) => {
      doc.text(tronquer(doc, `• ${c}`, CW), M, y, {
        width: CW,
        lineBreak: false,
      });
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
    { titre: "Manquants / ruptures", aide: "article · qté manquante · zone" },
    { titre: "Écarts de quantité", aide: "article · qté prévue → qté prise" },
    {
      titre: "Substitutions / hors liste",
      aide: "article remplacé ou ajouté · qté",
    },
    { titre: "Commentaires", aide: "observations générales sur la préparation" },
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
const drawEntetePageDetail = (doc, { entreprise, proforma }) => {
  let y = M;
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(NOIR)
    .text(
      `FICHE DE PRÉPARATION — Proforma ${safeTrim(proforma?.numfact) || "—"}`,
      M,
      y,
      { width: CW * 0.6, lineBreak: false },
    );
  // Même logique qu'en page 1 : le client est mis en avant (gras, plus gros) ;
  // le vendeur et la société restent en petit, sur la ligne du dessous.
  const contexte = [
    proforma?.vendeurNom
      ? `Vendeur ${proforma.vendeurNom}`
      : proforma?.vendeurCode
        ? `Vendeur ${proforma.vendeurCode}`
        : "",
    safeTrim(entreprise?.trigramme).toUpperCase(),
  ]
    .filter(Boolean)
    .join(" · ");
  doc.fillColor(NOIR);
  drawTitreAdaptatif(
    doc,
    proforma?.clientNom,
    M + CW * 0.6,
    y - 2,
    CW * 0.4,
    [13, 11.5, 10],
    "right",
  );
  if (contexte) {
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(GRIS_LABEL)
      .text(contexte, M, y + 13, {
        width: CW,
        align: "right",
        lineBreak: false,
      });
  }
  y += 24;
  doc.save().lineWidth(0.7).strokeColor(GRIS_LIGNE);
  doc.moveTo(M, y).lineTo(M + CW, y).stroke();
  doc.restore();
  return y + 8;
};

// Bandeau de section (DOCK / MAGASIN), répété en haut de chaque page de la
// section : l'agent doit toujours savoir OÙ il prélève, même page 4.
const drawBandeZone = (doc, zone, y, { nbLignes, total, suite = false }) => {
  const z = ZONES[zone];
  doc.save().lineWidth(0.8);
  doc.rect(M, y, CW, BAND_H).fillAndStroke(z.fond, z.couleur);
  doc.restore();
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(z.couleur)
    .text(`${z.titre}${suite ? " (suite)" : ""}`, M + 8, y + 5.5, {
      width: CW * 0.4,
      lineBreak: false,
    });
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(GRIS_TXT)
    .text(
      `${z.detail}  ·  ${nbLignes} ligne${nbLignes > 1 ? "s" : ""}  ·  ${fmtNb(
        total,
      )} unité${total > 1 ? "s" : ""} à prendre`,
      M + 8,
      y + 7,
      { width: CW - 16, align: "right", lineBreak: false },
    );
  return y + BAND_H;
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

// Une ligne article : tout est imprimé (bande grise alternée) SAUF la colonne
// « CTRL », laissée BLANCHE pour que l'agent y note la quantité réellement
// prise en cas d'écart.
const drawLigne = (doc, cols, xSaisie, ligne, y, index, zone) => {
  if (index % 2 === 1) {
    doc
      .save()
      .fillColor(GRIS_BANDE)
      .rect(M, y, xSaisie - M, ROW_H)
      .fill()
      .restore();
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
    doc.text(tronquer(doc, texte, c.w - 6), c.x + 3, opts.ty || ty, {
      width: c.w - 6,
      align: c.align === "center" ? "center" : c.align,
      lineBreak: false,
    });
  };

  // Case à cocher (article pris).
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
  // Repères cumulables : ! = stock de la zone insuffisant (rupture probable),
  // > = l'article est aussi à prendre dans l'AUTRE zone (ne pas s'étonner de le
  // revoir plus loin sur la fiche).
  const reperes = [ligne.manquant > 0 ? "!" : "", ligne.autreZone ? ">" : ""].join(
    "",
  );
  cell("flag", reperes, {
    bold: true,
    size: 7.5,
    color: ligne.manquant > 0 ? ROUGE : ZONES[zone].couleur,
  });
  cell("designation", ligne.designation);
  cell("gencod", ligne.gencod, { size: 7, color: GRIS_LABEL });
  cell("refer", ligne.refer, { size: 7, color: GRIS_LABEL });
  // Au magasin le rayon guide le déplacement ; au dock il n'est qu'un repère.
  const emplacement = [ligne.rayon || ligne.gism1, ligne.sousRayon]
    .filter(Boolean)
    .join(" · ");
  cell("rayon", emplacement, { size: 7, color: GRIS_TXT });
  // Stock de la zone : sert à comprendre un « ! » d'un coup d'œil.
  cell("stock", fmtNb(ligne.stockZone), {
    size: 7,
    color: ligne.manquant > 0 ? ROUGE : GRIS_LABEL,
  });

  // Quantité à prendre : l'instruction — la plus grosse valeur de la ligne.
  cell("aPrendre", fmtNb(ligne.aPrendre), {
    bold: true,
    size: 11,
    color: NOIR,
    ty: y + 4.5,
  });

  return y + ROW_H;
};

/**
 * Génère la fiche de préparation PDF (A4 paysage) et la diffuse dans `stream`.
 *
 * @param {object} p
 * @param {object} p.entreprise    document Entreprise (logo, couleurs, nom)
 * @param {object} p.proforma      entête { numfact, clientNom, clientCode, vendeurCode, vendeurNom, datfact, etat, etatLabel }
 * @param {Array}  p.lignesDock    lignes à prendre au dock (S2), déjà ordonnées
 * @param {Array}  p.lignesMagasin lignes à prendre au magasin (S1), déjà ordonnées
 *                                 [{ nl, nart, designation, refer, gencod, gism1, rayon,
 *                                    sousRayon, aPrendre, stockZone, manquant, autreZone }]
 * @param {Array}  p.commentaires  commentaires de la proforma (TEXTE + lignes « ! »)
 * @param {object} p.totaux        { nbArticles, totalDemande, totalDock, totalMagasin, nbManquants }
 * @param {object} p.options       { editePar:string }
 * @param {WritableStream} p.stream
 * @returns {Promise<{nbPages:number, nbLignes:number}>}
 */
export const genererFichePreparationPDF = async ({
  entreprise,
  proforma,
  lignesDock = [],
  lignesMagasin = [],
  commentaires = [],
  totaux = null,
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
      Title: `Fiche de préparation ${safeTrim(proforma?.numfact)}`,
      Author: safeTrim(entreprise?.nomComplet || entreprise?.nomDossierDBF),
    },
  });
  doc.pipe(stream);

  // ── Page 1 : en-tête de proforma + 4 grandes cases ────────────────────────
  drawPageEntete(doc, {
    entreprise,
    proforma,
    totaux,
    commentaires,
    options,
  });

  // ── Pages suivantes : le parcours, DOCK d'abord puis MAGASIN ──────────────
  const limiteBas = PAGE_H - M - FOOTER_H;
  let index = 0; // compteur global (bandes alternées continues)

  const sections = [
    { zone: "dock", lignes: lignesDock, total: totaux?.totalDock ?? 0 },
    { zone: "magasin", lignes: lignesMagasin, total: totaux?.totalMagasin ?? 0 },
  ];

  doc.addPage(PAGE_OPTS);
  let y = drawEntetePageDetail(doc, { entreprise, proforma });

  sections.forEach(({ zone, lignes, total }) => {
    const infosBande = { nbLignes: lignes.length, total };

    // Une section ne commence jamais en bas de page : bandeau + en-tête + au
    // moins une ligne doivent tenir, sinon on passe à la page suivante.
    if (y + BAND_H + HEAD_H + ROW_H > limiteBas) {
      doc.addPage(PAGE_OPTS);
      y = drawEntetePageDetail(doc, { entreprise, proforma });
    }
    y = drawBandeZone(doc, zone, y, infosBande);
    y = drawTableHeader(doc, cols, y);

    if (lignes.length === 0) {
      doc
        .font("Helvetica-Oblique")
        .fontSize(8.5)
        .fillColor(GRIS_LABEL)
        .text(
          zone === "dock"
            ? "Rien à prendre au dock : aucun article de cette proforma n'a de stock dock (S2)."
            : "Rien à prendre au magasin : le dock couvre la totalité de la commande.",
          M + 8,
          y + 6,
          { width: CW - 16, lineBreak: false },
        );
      y += 22;
      return;
    }

    lignes.forEach((ligne) => {
      if (y + ROW_H > limiteBas) {
        doc.addPage(PAGE_OPTS);
        y = drawEntetePageDetail(doc, { entreprise, proforma });
        y = drawBandeZone(doc, zone, y, { ...infosBande, suite: true });
        y = drawTableHeader(doc, cols, y);
      }
      y = drawLigne(doc, cols, xSaisie, ligne, y, index, zone);
      index += 1;
    });

    y += 8; // respiration entre les deux sections
  });

  // ── Pieds de page (numérotation connue une fois toutes les pages écrites) ──
  const range = doc.bufferedPageRange();
  const legende =
    "Parcours : DOCK (S2) puis MAGASIN (S1) · CTRL = quantité réellement prise si elle diffère · ! = stock insuffisant · > = article aussi à prendre dans l'autre zone";
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const fy = PAGE_H - M - 10;
    doc.save().lineWidth(0.5).strokeColor(GRIS_LIGNE);
    doc.moveTo(M, fy - 4).lineTo(M + CW, fy - 4).stroke();
    doc.restore();
    doc.font("Helvetica").fontSize(6.5).fillColor(GRIS_LABEL);
    doc.text(legende, M, fy, { width: CW * 0.75, lineBreak: false });
    doc.text(
      `Proforma ${safeTrim(proforma?.numfact)} — page ${i + 1}/${range.count}`,
      M,
      fy,
      { width: CW, align: "right", lineBreak: false },
    );
  }

  return await new Promise((resolve, reject) => {
    stream.on("finish", () =>
      resolve({
        nbPages: range.count,
        nbLignes: lignesDock.length + lignesMagasin.length,
      }),
    );
    stream.on("error", reject);
    doc.on("error", reject);
    doc.end();
  });
};

export default { genererFichePreparationPDF };
