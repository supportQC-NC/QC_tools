// backend/services/ficheAjoutControleService.js
//
// FICHE DE SAISIE VIERGE du module « Ajout contrôle inventaire » (demande
// client du 18/11/2026) : un A4 PAYSAGE avec des lignes vides reprenant les
// champs du formulaire web — le contrôleur note à la main les bipages oubliés
// découverts en rayon, puis quelqu'un les saisit dans l'écran.
//
// Chaque PAGE est un formulaire autonome (en-tête + « Contrôlé par / Date »
// répétés) : plusieurs contrôleurs peuvent se partager les feuilles.
// Pagination « n/N » en bas à gauche + date de génération en bas à droite,
// comme la liste de prix (même piège pdfkit : écrire sous la marge basse crée
// une page automatique — on annule la marge le temps du pied de page).
import fs from "fs";
import { resolveLogoBuffer } from "./etiquetteService.js";

/**
 * Écrit le PDF de fiches vierges.
 * `pages` = nombre de feuilles identiques (1 à 10) ; `sessionNom` = libellé de
 * l'inventaire en cours, affiché dans l'en-tête.
 */
export const ecrireFicheAjoutControleVierge = async ({
  entreprise,
  sessionNom = "",
  pages = 1,
  outPath,
}) => {
  const mod = await import("pdfkit").catch(() => {
    throw new Error("Module 'pdfkit' introuvable. Lancez : npm i pdfkit (backend).");
  });
  const PDFDocument = mod.default;

  const margin = 28;
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin,
    autoFirstPage: false,
    bufferPages: true,
  });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const logoBuf = resolveLogoBuffer(entreprise);
  const dateGen = new Date().toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // A4 paysage : 841,89 × 595,28. Largeur utile = 786.
  // OBSERVATION absorbe le reste ; QTÉ et ZONE restent assez larges pour une
  // écriture manuscrite.
  const COLS = [
    { key: "n", label: "N°", w: 28 },
    { key: "code", label: "NART / GENCODE", w: 140 },
    { key: "design", label: "DÉSIGNATION", w: 240 },
    { key: "qte", label: "QTÉ", w: 60 },
    { key: "empl", label: "EMPLACEMENT", w: 100 },
    { key: "zone", label: "ZONE (facultatif)", w: 100 },
    { key: "obs", label: "OBSERVATION", w: 118 },
  ];
  const left = margin;
  const tableW = COLS.reduce((s, c) => s + c.w, 0);
  // Lignes hautes (26 pt) : la fiche se remplit AU STYLO, pas au clavier.
  const rowH = 26;
  const headerRowH = 16;

  const dessinerPage = () => {
    doc.addPage();
    let y = margin;

    if (logoBuf) {
      try {
        doc.image(logoBuf, left, y, { fit: [100, 44] });
      } catch {
        /* logo illisible : on continue sans */
      }
    }
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor("#000")
      .text("AJOUT CONTRÔLE INVENTAIRE — FICHE DE SAISIE", left, y + 4, {
        width: tableW,
        align: "center",
      });
    const sousTitre = [entreprise?.nom, sessionNom].filter(Boolean).join(" — ");
    if (sousTitre) {
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#555")
        .text(sousTitre, left, y + 26, { width: tableW, align: "center" })
        .fillColor("#000");
    }
    y += 48;

    // Identité du contrôleur, par FEUILLE : plusieurs personnes peuvent se
    // partager les pages.
    doc
      .font("Helvetica")
      .fontSize(10)
      .text(
        "Contrôlé par : ______________________________        Date : ____ / ____ / ________",
        left,
        y,
        { lineBreak: false },
      );
    doc
      .fontSize(8)
      .fillColor("#666")
      .text(
        "Zone facultative : sans zone, la saisie sera rattachée à CONTROLE.",
        left,
        y + 2,
        { width: tableW, align: "right", lineBreak: false },
      )
      .fillColor("#000");
    y += 20;

    // En-tête du tableau.
    let x = left;
    doc.rect(left, y, tableW, headerRowH).fillAndStroke("#333", "#333");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8);
    COLS.forEach((c) => {
      doc.text(c.label, x + 3, y + 4, { width: c.w - 6, align: "left" });
      x += c.w;
    });
    doc.fillColor("#000");
    y += headerRowH;

    // Lignes VIERGES : autant que la page en contient (pied de page réservé).
    const basUtile = doc.page.height - margin - 14;
    doc.strokeColor("#999").lineWidth(0.6);
    let n = 1;
    while (y + rowH <= basUtile) {
      let cx = left;
      COLS.forEach((c) => {
        doc.rect(cx, y, c.w, rowH).stroke();
        cx += c.w;
      });
      // Seul le numéro de ligne est pré-imprimé.
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#888")
        .text(String(n), left + 3, y + 9, {
          width: COLS[0].w - 6,
          align: "center",
          lineBreak: false,
        })
        .fillColor("#000");
      y += rowH;
      n += 1;
    }
    doc.lineWidth(1).strokeColor("#000");
  };

  const nbPages = Math.min(10, Math.max(1, Math.trunc(Number(pages) || 1)));
  for (let p = 0; p < nbPages; p++) dessinerPage();

  // Pieds de page en dernière passe (bufferPages) : « n/N » à gauche, date de
  // génération à droite. ⚠️ Marge basse annulée le temps d'écrire, sinon
  // pdfkit ajoute une page automatique.
  const plage = doc.bufferedPageRange();
  for (let p = plage.start; p < plage.start + plage.count; p++) {
    doc.switchToPage(p);
    const margeBasse = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor("#666");
    doc.text(`${p + 1}/${plage.count}`, left, doc.page.height - 20, {
      lineBreak: false,
    });
    doc.text(`Généré le ${dateGen}`, left, doc.page.height - 20, {
      width: tableW,
      align: "right",
      lineBreak: false,
    });
    doc.fillColor("#000");
    doc.page.margins.bottom = margeBasse;
  }

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
};

export default { ecrireFicheAjoutControleVierge };
