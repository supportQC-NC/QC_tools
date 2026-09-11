// backend/services/badgeUtilisateurService.js
//
// PDF des BADGES utilisateurs : le code-barres qui permet de désigner une
// personne d'un bip (coupon d'inventaire, notamment) au lieu de la chercher
// dans une liste déroulante.
//
// Deux documents, deux usages distincts :
//
//   · « liste »  — une feuille de poste. Un utilisateur par ligne, code-barres
//                  à droite, nom à gauche. Elle reste au poste de saisie : on y
//                  bipe la personne qui vient de rendre son coupon. Triée par
//                  nom, ou groupée par société avec un titre par groupe.
//
//   · « cartes » — des badges à DÉCOUPER et plastifier, format carte bancaire
//                  (85,6 × 54 mm), distribués aux agents le temps de
//                  l'inventaire. Traits de coupe imprimés.
//
// ⚠️ Un utilisateur sans code-barres n'est PAS rendu silencieusement vide : il
// est listé à part par l'appelant (voir le contrôleur), parce qu'une carte sans
// code est indétectable une fois la feuille imprimée et découpée.

import PDFDocument from "pdfkit";
import { drawEAN13Pdf } from "../utils/ean13.js";

const MM = 2.834645669; // 1 mm en points PDF

const A4_W = 595.28;
const A4_H = 841.89;

// Carte bancaire (ISO/IEC 7810 ID-1).
const CARTE_W = 85.6 * MM;
const CARTE_H = 54 * MM;

const safe = (v) => (v == null ? "" : String(v)).trim();

/** « Prénom Nom » (repli e-mail) — même formatage que partout ailleurs. */
export const nomAffiche = (u) =>
  u ? `${safe(u.prenom)} ${safe(u.nom)}`.trim() || safe(u.email) : "";

/**
 * Réduit la taille de police jusqu'à ce que le texte tienne dans `maxW`.
 * Un nom long débordait de la carte et chevauchait le trait de coupe.
 */
const tailleQuiTient = (doc, texte, maxW, depart, mini = 6) => {
  let t = depart;
  doc.font("Helvetica-Bold");
  while (t > mini && doc.fontSize(t).widthOfString(texte) > maxW) t -= 0.5;
  return t;
};

// ===========================================================================
// 1. FEUILLE DE POSTE (liste à biper)
// ===========================================================================

const LIGNE_H = 46;
const MARGE = 40;

const enTeteListe = (doc, titre, sousTitre) => {
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .fillColor("#000000")
    .text(titre, MARGE, MARGE, { width: A4_W - 2 * MARGE });
  if (sousTitre) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#555555")
      .text(sousTitre, MARGE, doc.y + 2, { width: A4_W - 2 * MARGE });
  }
  doc.fillColor("#000000");
  return doc.y + 12;
};

/**
 * @param {Array} groupes [{ titre, utilisateurs: [user] }] — un seul groupe
 *        sans titre pour un tri alphabétique simple.
 */
export const genererListePDF = ({ titre, sousTitre, groupes }) => {
  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });
  let y = enTeteListe(doc, titre, sousTitre);

  const nouvellePage = () => {
    doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
    y = MARGE;
  };

  for (const groupe of groupes) {
    if (groupe.titre) {
      // Un titre de groupe seul en bas de page n'a aucun intérêt : on le pousse
      // avec au moins une ligne.
      if (y + 22 + LIGNE_H > A4_H - MARGE) nouvellePage();
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#000000")
        .text(groupe.titre, MARGE, y, { width: A4_W - 2 * MARGE });
      y += 18;
      doc
        .moveTo(MARGE, y)
        .lineTo(A4_W - MARGE, y)
        .lineWidth(0.8)
        .strokeColor("#000000")
        .stroke();
      y += 6;
    }

    for (const u of groupe.utilisateurs) {
      if (y + LIGNE_H > A4_H - MARGE) nouvellePage();

      const nom = nomAffiche(u);
      const largeurCode = 150;
      const xCode = A4_W - MARGE - largeurCode;

      doc
        .font("Helvetica-Bold")
        .fontSize(12)
        .fillColor("#000000")
        .text(nom, MARGE, y + 6, {
          width: xCode - MARGE - 12,
          lineBreak: false,
          ellipsis: true,
        });
      if (safe(u.email)) {
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#666666")
          .text(safe(u.email), MARGE, y + 22, {
            width: xCode - MARGE - 12,
            lineBreak: false,
            ellipsis: true,
          });
      }

      drawEAN13Pdf(doc, safe(u.codeBarre), xCode, y + 2, largeurCode, LIGNE_H - 8);

      doc
        .moveTo(MARGE, y + LIGNE_H - 2)
        .lineTo(A4_W - MARGE, y + LIGNE_H - 2)
        .lineWidth(0.3)
        .strokeColor("#bbbbbb")
        .stroke();

      y += LIGNE_H;
    }

    y += 10;
  }

  doc.end();
  return doc;
};

// ===========================================================================
// 2. BADGES À DÉCOUPER (format carte bancaire)
// ===========================================================================

const dessinerCarte = (doc, u, x, y) => {
  // Trait de coupe : fin et gris, il guide le massicot sans salir la carte.
  doc
    .save()
    .rect(x, y, CARTE_W, CARTE_H)
    .lineWidth(0.4)
    .strokeColor("#999999")
    .dash(3, { space: 2 })
    .stroke()
    .undash()
    .restore();

  const padX = 6 * MM;
  const utileW = CARTE_W - 2 * padX;

  // Code-barres en haut, il occupe l'essentiel de la carte : c'est lui qu'on
  // vient lire, le nom ne sert qu'à rendre la carte au bon propriétaire.
  const codeH = 22 * MM;
  drawEAN13Pdf(doc, safe(u.codeBarre), x + padX, y + 7 * MM, utileW, codeH);

  const nom = nomAffiche(u);
  const t = tailleQuiTient(doc, nom, utileW, 15);
  doc
    .font("Helvetica-Bold")
    .fontSize(t)
    .fillColor("#000000")
    .text(nom, x + padX, y + 7 * MM + codeH + 5 * MM, {
      width: utileW,
      align: "center",
      lineBreak: false,
    });
};

export const genererCartesPDF = ({ utilisateurs }) => {
  const doc = new PDFDocument({ size: "A4", layout: "portrait", margin: 0 });

  const gap = 4 * MM;
  const cols = Math.max(1, Math.floor((A4_W + gap) / (CARTE_W + gap)));
  const rows = Math.max(1, Math.floor((A4_H + gap) / (CARTE_H + gap)));
  const parPage = cols * rows;

  const grilleW = cols * CARTE_W + (cols - 1) * gap;
  const grilleH = rows * CARTE_H + (rows - 1) * gap;
  const x0 = (A4_W - grilleW) / 2;
  const y0 = (A4_H - grilleH) / 2;

  utilisateurs.forEach((u, i) => {
    const surPage = i % parPage;
    if (surPage === 0 && i > 0) {
      doc.addPage({ size: "A4", layout: "portrait", margin: 0 });
    }
    const c = surPage % cols;
    const r = Math.floor(surPage / cols);
    dessinerCarte(doc, u, x0 + c * (CARTE_W + gap), y0 + r * (CARTE_H + gap));
  });

  doc.end();
  return doc;
};

export default { genererListePDF, genererCartesPDF, nomAffiche };
