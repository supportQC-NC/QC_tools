// backend/services/repertoirePersonnelPdfService.js
//
// PDF du RÉPERTOIRE DU PERSONNEL (module Dictionnaires) : reproduction sobre
// du répertoire papier — en-tête (société, standard, note), puis une section
// par SERVICE (Dock, Magasin, Comptabilité…) avec une ligne par personne :
// Nom | Poste | Tél. extérieur | Portable | Email. A4 portrait.
//
// Le PDF est streamé directement dans `res` (pas de fichier temporaire).

import PDFDocument from "pdfkit";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Colonnes : positions x et largeurs (A4 portrait, marge 36 → 523 utiles).
const COLS = [
  { key: "nom", label: "Nom", w: 120 },
  { key: "poste", label: "Poste", w: 60 },
  { key: "telExterieur", label: "Tél. ext.", w: 75 },
  { key: "portable", label: "Portable", w: 75 },
  { key: "email", label: "Email", w: 193 },
];

const MARGE = 36;

// Tronque une valeur pour tenir dans sa colonne (pas de retour à la ligne :
// une personne = UNE ligne, comme sur le papier).
const fit = (doc, texte, largeur) => {
  let t = safeTrim(texte);
  if (!t) return "";
  while (t.length > 1 && doc.widthOfString(t) > largeur - 6) {
    t = t.slice(0, -1);
  }
  return t.length < safeTrim(texte).length ? `${t}…` : t;
};

/**
 * Écrit le PDF du répertoire dans un flux Writable (réponse HTTP).
 * @param {object} opts { societe, standard, note, entrees, majLe }
 */
export function ecrirePdfRepertoire(res, opts) {
  const { societe, standard, note, entrees = [], majLe } = opts;

  const doc = new PDFDocument({ size: "A4", margin: MARGE });
  doc.pipe(res);

  const largeurUtile = doc.page.width - 2 * MARGE;

  // ---- En-tête ----
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(`Répertoire du Personnel — ${safeTrim(societe)}`, { lineBreak: true });
  if (safeTrim(standard)) {
    doc
      .moveDown(0.3)
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(`STANDARD : ${safeTrim(standard)}`);
  }
  if (safeTrim(note)) {
    doc.font("Helvetica").fontSize(9).text(safeTrim(note));
  }
  doc.moveDown(0.6);

  // ---- Regroupement par service, ordre d'apparition (puis `ordre`) ----
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

  const lignePleine = () =>
    doc
      .moveTo(MARGE, doc.y)
      .lineTo(MARGE + largeurUtile, doc.y)
      .lineWidth(0.5)
      .strokeColor("#999999")
      .stroke();

  const enTeteColonnes = () => {
    let x = MARGE;
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#555555");
    const y = doc.y;
    for (const c of COLS) {
      doc.text(c.label, x + 2, y, { width: c.w - 4, lineBreak: false });
      x += c.w;
    }
    doc.y = y + 11;
    lignePleine();
    doc.fillColor("#000000");
  };

  const sautSiBasDePage = (hauteur) => {
    if (doc.y + hauteur > doc.page.height - MARGE - 20) {
      doc.addPage();
    }
  };

  for (const service of services) {
    sautSiBasDePage(46);
    // Bandeau de section.
    doc
      .rect(MARGE, doc.y, largeurUtile, 16)
      .fillColor("#2a2a3a")
      .fill()
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(10)
      .text(service.toUpperCase(), MARGE + 6, doc.y + 4, { lineBreak: false });
    doc.y += 20;
    doc.fillColor("#000000");
    enTeteColonnes();

    for (const e of parService.get(service)) {
      sautSiBasDePage(14);
      let x = MARGE;
      const y = doc.y;
      doc.font("Helvetica").fontSize(9);
      for (const c of COLS) {
        const brut = e[c.key];
        if (c.key === "nom") doc.font("Helvetica-Bold");
        doc.text(fit(doc, brut, c.w), x + 2, y, {
          width: c.w - 4,
          lineBreak: false,
        });
        if (c.key === "nom") doc.font("Helvetica");
        x += c.w;
      }
      doc.y = y + 13;
    }
    doc.moveDown(0.6);
  }

  // ---- Pied ----
  const maj = majLe ? new Date(majLe) : new Date();
  doc
    .font("Helvetica-Oblique")
    .fontSize(8)
    .fillColor("#555555")
    .text(
      `Mise à jour au ${maj.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}.`,
      MARGE,
      doc.page.height - MARGE - 12,
      { lineBreak: false },
    );

  doc.end();
}

export default { ecrirePdfRepertoire };
