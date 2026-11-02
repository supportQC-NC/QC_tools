// backend/services/repertoirePersonnelPdfService.js
//
// PDF du RÉPERTOIRE DU PERSONNEL (module Dictionnaires) — A4 portrait.
//
// La mise en page est une GRILLE À POSITIONS FIXES, tenue par un curseur `y`
// géré à la main : chaque cellule est dessinée à son x/largeur de colonne,
// qu'elle soit remplie ou vide — un champ vide ne décale JAMAIS les suivants
// (doc.y de pdfkit n'est jamais utilisé, c'est lui qui dérivait dans la
// première version). Une personne = UNE ligne, texte tronqué avec « … ».
//
// Habillage : bandeau de titre à la couleur de la société (couleurPrimaire de
// la fiche, repli bleu nuit), encart STANDARD/permanence, une section par
// service (bandeau + en-têtes répétés après un saut de page), lignes zébrées
// et filets légers, pied de page sur chaque page (société · mise à jour ·
// n° de page).
//
// Le PDF est streamé directement dans `res` (pas de fichier temporaire).

import PDFDocument from "pdfkit";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

const MARGE = 36;
const LARGEUR_PAGE = 595.28; // A4 portrait
const HAUTEUR_PAGE = 841.89;
const LARGEUR_UTILE = LARGEUR_PAGE - 2 * MARGE; // 523
const BAS_UTILE = HAUTEUR_PAGE - MARGE - 24; // au-dessus du pied de page

// Grille : Σ largeurs = LARGEUR_UTILE (523).
const COLS = [
  { key: "nom", label: "NOM", w: 115, align: "left", bold: true },
  { key: "poste", label: "POSTE", w: 50, align: "center" },
  { key: "telExterieur", label: "TÉL. EXT.", w: 78, align: "center" },
  { key: "portable", label: "PORTABLE", w: 78, align: "center" },
  { key: "email", label: "EMAIL", w: 202, align: "left" },
];

const H_LIGNE = 17;
const H_ENTETE_COLS = 16;
const H_BANDEAU = 19;

// Palette sobre (le bandeau prend la couleur de la société).
const C_TEXTE = "#111827";
const C_TEXTE_DOUX = "#6b7280";
const C_FILET = "#e5e7eb";
const C_ZEBRE = "#f3f4f6";
const C_ENTETE_FOND = "#eceef2";
const C_BANDEAU_DEFAUT = "#1f2937";

// Couleur hex valide (#RRGGBB) ou repli.
const couleurBande = (c) =>
  /^#[0-9a-fA-F]{6}$/.test(safeTrim(c)) ? safeTrim(c) : C_BANDEAU_DEFAUT;

// Couleur du TEXTE posé sur un bandeau : NOIR sur fond clair (jaune, pastel…),
// BLANC sur fond foncé — sinon illisible (constaté client sur une société à
// couleur primaire jaune). Luminance perçue (pondération Rec. 601).
const texteSurBande = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111827" : "#ffffff";
};

// Tronque pour tenir dans `largeur` avec la police COURANTE du doc.
const fit = (doc, texte, largeur) => {
  const brut = safeTrim(texte);
  if (!brut) return "";
  if (doc.widthOfString(brut) <= largeur) return brut;
  let t = brut;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > largeur) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
};

/**
 * Écrit le PDF du répertoire dans un flux Writable (réponse HTTP).
 * @param {object} opts { societe, standard, note, entrees, majLe, couleur }
 */
export function ecrirePdfRepertoire(res, opts) {
  const { societe, standard, note, entrees = [], majLe, couleur } = opts;
  const brand = couleurBande(couleur);
  const encreBande = texteSurBande(brand);
  const maj = (majLe ? new Date(majLe) : new Date()).toLocaleDateString(
    "fr-FR",
    { day: "numeric", month: "long", year: "numeric" },
  );

  const doc = new PDFDocument({ size: "A4", margin: MARGE, bufferPages: true });
  doc.pipe(res);

  let y = MARGE;

  // ---- Cellules d'une ligne de grille (en-tête ou donnée) ----
  const dessinerCellules = (valeurs, yLigne, hauteur, style) => {
    let x = MARGE;
    for (let i = 0; i < COLS.length; i += 1) {
      const c = COLS[i];
      doc
        .font(style.boldNom && c.bold ? "Helvetica-Bold" : style.font)
        .fontSize(style.size)
        .fillColor(style.couleur);
      const texte = fit(doc, valeurs[i], c.w - 10);
      if (texte) {
        doc.text(texte, x + 5, yLigne + (hauteur - style.size) / 2 - 1, {
          width: c.w - 10,
          align: c.align,
          lineBreak: false,
        });
      }
      x += c.w;
    }
  };

  // ---- En-têtes de colonnes (répétés après chaque saut de page) ----
  const dessinerEnteteCols = () => {
    doc.rect(MARGE, y, LARGEUR_UTILE, H_ENTETE_COLS).fill(C_ENTETE_FOND);
    dessinerCellules(
      COLS.map((c) => c.label),
      y,
      H_ENTETE_COLS,
      { font: "Helvetica-Bold", size: 7.5, couleur: C_TEXTE_DOUX },
    );
    y += H_ENTETE_COLS;
  };

  // ---- Bandeau de section (service) ----
  const dessinerBandeau = (libelle, nb) => {
    doc.rect(MARGE, y, LARGEUR_UTILE, H_BANDEAU).fill(brand);
    doc
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .fillColor(encreBande)
      .text(libelle.toUpperCase(), MARGE + 7, y + 5.5, {
        width: LARGEUR_UTILE - 60,
        lineBreak: false,
      });
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(encreBande)
      .text(`${nb}`, MARGE + LARGEUR_UTILE - 40, y + 6.5, {
        width: 33,
        align: "right",
        lineBreak: false,
      });
    y += H_BANDEAU;
  };

  const nouvellePage = () => {
    doc.addPage();
    y = MARGE;
  };

  // ---- En-tête de la 1re page ----
  doc.rect(MARGE, y, LARGEUR_UTILE, 54).fill(brand);
  doc
    .font("Helvetica-Bold")
    .fontSize(17)
    .fillColor(encreBande)
    .text("RÉPERTOIRE DU PERSONNEL", MARGE + 14, y + 11, { lineBreak: false });
  doc
    .font("Helvetica")
    .fontSize(10.5)
    .fillColor(encreBande)
    .opacity(0.9)
    .text(safeTrim(societe), MARGE + 14, y + 33, { lineBreak: false });
  doc.opacity(1);
  y += 54;

  // Encart standard / permanence, sous le bandeau.
  const lignesInfo = [];
  if (safeTrim(standard)) lignesInfo.push(`STANDARD : ${safeTrim(standard)}`);
  if (safeTrim(note)) lignesInfo.push(safeTrim(note));
  if (lignesInfo.length) {
    const hInfo = 10 + lignesInfo.length * 12;
    doc.rect(MARGE, y, LARGEUR_UTILE, hInfo).fill("#f9fafb");
    doc
      .moveTo(MARGE, y)
      .lineTo(MARGE, y + hInfo)
      .lineWidth(2)
      .strokeColor(brand)
      .stroke();
    lignesInfo.forEach((l, i) => {
      doc
        .font(i === 0 && safeTrim(standard) ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8.5)
        .fillColor(C_TEXTE)
        .text(l, MARGE + 10, y + 7 + i * 12, {
          width: LARGEUR_UTILE - 20,
          lineBreak: false,
        });
    });
    y += hInfo;
  }
  y += 12;

  // ---- Sections par service (ordre d'apparition, puis `ordre`) ----
  const services = [];
  const parService = new Map();
  for (const e of entrees) {
    const s = safeTrim(e.service) || "Autres";
    if (!parService.has(s)) {
      parService.set(s, []);
      services.push(s);
    }
    parService.get(s).push(e);
  }
  for (const s of services) {
    parService.get(s).sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  }

  for (const service of services) {
    const lignes = parService.get(service);
    // Jamais de bandeau orphelin : il faut la place du bandeau + en-têtes +
    // au moins une ligne.
    if (y + H_BANDEAU + H_ENTETE_COLS + H_LIGNE > BAS_UTILE) nouvellePage();

    dessinerBandeau(service, lignes.length);
    dessinerEnteteCols();

    const yDebutTable = y - H_ENTETE_COLS; // pour le cadre extérieur
    let yCadre = yDebutTable;

    lignes.forEach((e, i) => {
      if (y + H_LIGNE > BAS_UTILE) {
        // Cadre de la portion écoulée, puis reprise avec en-têtes.
        doc
          .rect(MARGE, yCadre, LARGEUR_UTILE, y - yCadre)
          .lineWidth(0.6)
          .strokeColor(C_FILET)
          .stroke();
        nouvellePage();
        dessinerEnteteCols();
        yCadre = y - H_ENTETE_COLS;
      }
      if (i % 2 === 1) {
        doc.rect(MARGE, y, LARGEUR_UTILE, H_LIGNE).fill(C_ZEBRE);
      }
      dessinerCellules(
        COLS.map((c) => e[c.key]),
        y,
        H_LIGNE,
        { font: "Helvetica", size: 8.5, couleur: C_TEXTE, boldNom: true },
      );
      // Filet bas de ligne.
      doc
        .moveTo(MARGE, y + H_LIGNE)
        .lineTo(MARGE + LARGEUR_UTILE, y + H_LIGNE)
        .lineWidth(0.4)
        .strokeColor(C_FILET)
        .stroke();
      y += H_LIGNE;
    });

    // Cadre extérieur de la table de la section.
    doc
      .rect(MARGE, yCadre, LARGEUR_UTILE, y - yCadre)
      .lineWidth(0.6)
      .strokeColor(C_FILET)
      .stroke();

    y += 12;
  }

  // ---- Pied de page sur TOUTES les pages (bufferPages) ----
  const plage = doc.bufferedPageRange();
  for (let p = plage.start; p < plage.start + plage.count; p += 1) {
    doc.switchToPage(p);
    // ⚠️ Le pied est SOUS la marge basse : sans ça, pdfkit AJOUTE une page à
    // chaque text() (9 pages au lieu de 3, constaté au test). On neutralise la
    // marge le temps du dessin.
    doc.page.margins.bottom = 0;
    const yPied = HAUTEUR_PAGE - MARGE + 6;
    doc
      .moveTo(MARGE, yPied - 5)
      .lineTo(MARGE + LARGEUR_UTILE, yPied - 5)
      .lineWidth(0.5)
      .strokeColor(C_FILET)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(C_TEXTE_DOUX)
      .text(`Répertoire du personnel — ${safeTrim(societe)}`, MARGE, yPied, {
        lineBreak: false,
      });
    doc.text(`Mise à jour au ${maj}`, MARGE, yPied, {
      width: LARGEUR_UTILE,
      align: "center",
      lineBreak: false,
    });
    doc.text(`Page ${p - plage.start + 1}/${plage.count}`, MARGE, yPied, {
      width: LARGEUR_UTILE,
      align: "right",
      lineBreak: false,
    });
    doc.page.margins.bottom = MARGE;
  }

  doc.end();
}

export default { ecrirePdfRepertoire };
