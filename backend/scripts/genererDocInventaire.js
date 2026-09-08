// backend/scripts/genererDocInventaire.js
//
// Génère « Guide_utilisateur_Inventaire_Zones.pdf » à la racine du dépôt.
//
// C'est la documentation UTILISATEUR du module Inventaire Zones : elle couvre
// l'écran web (préparation, pilotage, contrôle) ET le collecteur (comptage sur
// le terrain). Elle décrit ce que voit et fait un utilisateur, pas le code.
//
//   node backend/scripts/genererDocInventaire.js
//
// Le contenu est déclaratif (tableau BLOCS ci-dessous) : pour mettre à jour la
// doc, on modifie ces blocs et on relance le script. Le sommaire et la
// pagination se recalculent seuls.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(__dirname, "..", "..");
const SORTIE = path.join(RACINE, "Guide_utilisateur_Inventaire_Zones.pdf");

// ── Charte ───────────────────────────────────────────────────────────────────
// Helvetica = police standard PDF (encodage WinAnsi) : pas de flèches Unicode
// ni de pictogrammes exotiques dans les textes, ils sortiraient en carrés.
const C = {
  texte: "#1a1a1a",
  gris: "#555555",
  grisClair: "#8a8a8a",
  trait: "#d5d5d5",
  bleu: "#1d4ed8",
  bleuPale: "#eef2ff",
  ambre: "#b45309",
  ambrePale: "#fef6e7",
  rouge: "#b91c1c",
  rougePale: "#fdecec",
  vert: "#15803d",
  vertPale: "#eefaf0",
  fondCode: "#f4f4f5",
};

const A4 = { w: 595.28, h: 841.89 };
const M = 52; // marge
const LARGEUR = A4.w - 2 * M;
const BAS = A4.h - 58; // limite basse du contenu (au-dessus du pied de page)

// ── Moteur de rendu ──────────────────────────────────────────────────────────

class Rendu {
  constructor(doc) {
    this.doc = doc;
    this.sommaire = []; // { niveau, titre, page }
    this.chapitreCourant = "";
  }

  get y() {
    return this.doc.y;
  }

  set y(v) {
    this.doc.y = v;
  }

  /** Numéro de page courant (1-based) pour le sommaire. */
  numeroPage() {
    return this.doc.bufferedPageRange().count;
  }

  /** Saut de page si le bloc à venir ne tient pas. */
  place(hauteur) {
    if (this.doc.y + hauteur > BAS) {
      this.doc.addPage();
      this.doc.y = M;
    }
  }

  espace(h = 10) {
    this.doc.y += h;
  }

  /** Titre de chapitre : toujours en haut d'une page neuve. */
  h1(titre, numero) {
    this.doc.addPage();
    this.doc.y = M;
    this.chapitreCourant = titre;
    this.sommaire.push({ niveau: 1, titre, numero, page: this.numeroPage() });

    this.doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(C.bleu)
      .text(`CHAPITRE ${numero}`, M, this.doc.y, { width: LARGEUR });
    this.doc.y += 2;
    this.doc
      .font("Helvetica-Bold")
      .fontSize(21)
      .fillColor(C.texte)
      .text(titre, M, this.doc.y, { width: LARGEUR });
    this.doc.y += 6;
    this.doc
      .save()
      .lineWidth(2)
      .strokeColor(C.bleu)
      .moveTo(M, this.doc.y)
      .lineTo(M + 60, this.doc.y)
      .stroke()
      .restore();
    this.doc.y += 16;
  }

  h2(titre) {
    this.place(60);
    this.espace(8);
    this.sommaire.push({ niveau: 2, titre, page: this.numeroPage() });
    this.doc
      .font("Helvetica-Bold")
      .fontSize(13.5)
      .fillColor(C.texte)
      .text(titre, M, this.doc.y, { width: LARGEUR });
    this.doc.y += 6;
  }

  h3(titre) {
    this.place(46);
    this.espace(6);
    this.doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(C.bleu)
      .text(titre, M, this.doc.y, { width: LARGEUR });
    this.doc.y += 3;
  }

  p(texte) {
    this.place(30);
    this.doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(C.texte)
      .text(texte, M, this.doc.y, {
        width: LARGEUR,
        align: "justify",
        lineGap: 2.2,
      });
    this.doc.y += 6;
  }

  /** Liste à puces. */
  puces(items) {
    items.forEach((t) => {
      this.place(24);
      const x = M + 12;
      const w = LARGEUR - 12;
      const yDepart = this.doc.y;
      this.doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(C.gris)
        .text("•", M + 2, yDepart, { width: 10, lineBreak: false });
      this.doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(C.texte)
        .text(t, x, yDepart, { width: w, align: "left", lineGap: 2 });
      this.doc.y += 3;
    });
    this.doc.y += 4;
  }

  /** Étapes numérotées : le coeur des modes opératoires. */
  etapes(items) {
    items.forEach((t, i) => {
      this.place(30);
      const yDepart = this.doc.y;
      const d = 15;
      this.doc
        .save()
        .circle(M + d / 2 + 1, yDepart + 6, d / 2)
        .fillColor(C.bleu)
        .fill()
        .restore();
      this.doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#ffffff")
        .text(String(i + 1), M + 1, yDepart + 3, {
          width: d,
          align: "center",
          lineBreak: false,
        });
      this.doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(C.texte)
        .text(t, M + d + 8, yDepart, {
          width: LARGEUR - d - 8,
          align: "left",
          lineGap: 2,
        });
      this.doc.y += 7;
    });
    this.doc.y += 3;
  }

  /** Encadré : type = info | attention | interdit | ok */
  encadre(titre, texte, type = "info") {
    const styles = {
      info: { bord: C.bleu, fond: C.bleuPale, couleur: C.bleu },
      attention: { bord: C.ambre, fond: C.ambrePale, couleur: C.ambre },
      interdit: { bord: C.rouge, fond: C.rougePale, couleur: C.rouge },
      ok: { bord: C.vert, fond: C.vertPale, couleur: C.vert },
    };
    const s = styles[type] || styles.info;
    const padding = 10;
    const largeurTexte = LARGEUR - 2 * padding - 4;

    this.doc.font("Helvetica-Bold").fontSize(9.5);
    // Le titre est rendu en majuscules : il faut le mesurer tel qu'il sera
    // dessine, sinon un titre long deborde du fond de l'encadre.
    const hTitre = titre
      ? this.doc.heightOfString(titre.toUpperCase(), { width: largeurTexte }) + 4
      : 0;
    this.doc.font("Helvetica").fontSize(9.5);
    const hTexte = this.doc.heightOfString(texte, {
      width: largeurTexte,
      lineGap: 2,
    });
    const hTotal = hTitre + hTexte + 2 * padding;

    this.place(hTotal + 8);
    const y0 = this.doc.y;

    this.doc.save().rect(M, y0, LARGEUR, hTotal).fillColor(s.fond).fill().restore();
    this.doc.save().rect(M, y0, 3.5, hTotal).fillColor(s.bord).fill().restore();

    let cy = y0 + padding;
    if (titre) {
      this.doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor(s.couleur)
        .text(titre.toUpperCase(), M + padding + 4, cy, { width: largeurTexte });
      cy = this.doc.y + 2;
    }
    this.doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor(C.texte)
      .text(texte, M + padding + 4, cy, { width: largeurTexte, lineGap: 2 });

    this.doc.y = y0 + hTotal + 10;
  }

  /** Bloc « code » : nom de fichier, format, chemin. */
  code(lignes) {
    const items = Array.isArray(lignes) ? lignes : [lignes];
    const padding = 8;
    this.doc.font("Courier").fontSize(9);
    const h =
      items.reduce(
        (s, l) =>
          s +
          this.doc.heightOfString(l, { width: LARGEUR - 2 * padding }) +
          1.5,
        0,
      ) +
      2 * padding;
    this.place(h + 8);
    const y0 = this.doc.y;
    this.doc.save().rect(M, y0, LARGEUR, h).fillColor(C.fondCode).fill().restore();
    let cy = y0 + padding;
    items.forEach((l) => {
      this.doc
        .font("Courier")
        .fontSize(9)
        .fillColor(C.texte)
        .text(l, M + padding, cy, { width: LARGEUR - 2 * padding });
      cy = this.doc.y + 1.5;
    });
    this.doc.y = y0 + h + 10;
  }

  /**
   * Tableau simple. colonnes = [{ t: entête, w: largeur }], lignes = [[...]]
   * Les largeurs sont des poids ramenés à la largeur utile.
   */
  tableau(colonnes, lignes) {
    const totalPoids = colonnes.reduce((s, c) => s + c.w, 0);
    const largeurs = colonnes.map((c) => (c.w / totalPoids) * LARGEUR);
    const padCell = 5;

    const hauteurLigne = (valeurs, gras) => {
      this.doc.font(gras ? "Helvetica-Bold" : "Helvetica").fontSize(8.8);
      let h = 0;
      valeurs.forEach((v, i) => {
        const hv = this.doc.heightOfString(String(v == null ? "" : v), {
          width: largeurs[i] - 2 * padCell,
          lineGap: 1.5,
        });
        if (hv > h) h = hv;
      });
      return h + 2 * padCell;
    };

    const dessinerLigne = (valeurs, options = {}) => {
      const { gras = false, fond = null } = options;
      const h = hauteurLigne(valeurs, gras);
      this.place(h + 4);
      const y0 = this.doc.y;
      if (fond) {
        this.doc.save().rect(M, y0, LARGEUR, h).fillColor(fond).fill().restore();
      }
      let x = M;
      valeurs.forEach((v, i) => {
        this.doc
          .font(gras ? "Helvetica-Bold" : "Helvetica")
          .fontSize(8.8)
          .fillColor(gras ? C.texte : C.texte)
          .text(String(v == null ? "" : v), x + padCell, y0 + padCell, {
            width: largeurs[i] - 2 * padCell,
            lineGap: 1.5,
          });
        x += largeurs[i];
      });
      this.doc
        .save()
        .lineWidth(0.5)
        .strokeColor(C.trait)
        .moveTo(M, y0 + h)
        .lineTo(M + LARGEUR, y0 + h)
        .stroke()
        .restore();
      this.doc.y = y0 + h;
    };

    this.place(60);
    dessinerLigne(
      colonnes.map((c) => c.t),
      { gras: true, fond: "#f0f2f5" },
    );
    lignes.forEach((l) => dessinerLigne(l));
    this.doc.y += 10;
  }

  /** Petite légende sous un tableau ou une figure. */
  legende(texte) {
    this.place(20);
    this.doc
      .font("Helvetica-Oblique")
      .fontSize(8.5)
      .fillColor(C.grisClair)
      .text(texte, M, this.doc.y, { width: LARGEUR, lineGap: 1.5 });
    this.doc.y += 10;
  }
}

// ── Figure : schéma de la fiche rayon ────────────────────────────────────────

const dessinerFicheRayon = (r) => {
  const doc = r.doc;
  const h = 250;
  r.place(h + 20);
  const y0 = doc.y;
  const w = 250;
  const x0 = M + (LARGEUR - w) / 2;

  doc.save().lineWidth(1).strokeColor(C.texte).rect(x0, y0, w, h).stroke().restore();

  // Bloc identité
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C.texte);
  doc.text("QUINCAILLERIE / PLOMBERIE", x0 + 10, y0 + 12, { width: w - 20, lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(9).fillColor(C.texte);
  doc.text("Code : A_1", x0 + 10, y0 + 28, { width: w - 20, lineBreak: false });
  doc.font("Helvetica").fontSize(7.5).fillColor(C.gris);
  doc.text("Emplacement : MAGASIN      Metrage : 8 m", x0 + 10, y0 + 40, {
    width: w - 20,
    lineBreak: false,
  });

  // QR factice
  const qs = 62;
  const qx = x0 + (w - qs) / 2;
  const qy = y0 + 56;
  doc.save().lineWidth(0.8).strokeColor(C.texte).rect(qx, qy, qs, qs).stroke().restore();
  for (let i = 0; i < 7; i += 1) {
    for (let j = 0; j < 7; j += 1) {
      if ((i * 3 + j * 5 + (i % 2)) % 3 === 0) {
        doc
          .save()
          .rect(qx + 5 + j * 7.5, qy + 5 + i * 7.5, 6.5, 6.5)
          .fillColor(C.texte)
          .fill()
          .restore();
      }
    }
  }
  doc.font("Helvetica-Bold").fontSize(7).fillColor(C.texte);
  doc.text("PRINCIPAL", qx, qy + qs + 3, { width: qs, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(6).fillColor(C.gris);
  doc.text("A_1 . MAGASIN", qx, qy + qs + 12, { width: qs, align: "center", lineBreak: false });

  // Ligne de découpe
  const yCut = y0 + 152;
  doc.save().lineWidth(0.7).strokeColor(C.grisClair).dash(4, { space: 3 });
  doc.moveTo(x0 + 6, yCut).lineTo(x0 + w - 6, yCut).stroke();
  doc.undash().restore();
  doc.font("Helvetica").fontSize(5.5).fillColor(C.grisClair);
  doc.text("- - -  a detacher  - - -", x0, yCut - 4, { width: w, align: "center", lineBreak: false });

  // 3 coupons
  const phases = ["PAPILLONNAGE", "BIPAGE", "CONTROLE"];
  const cw = (w - 24) / 3;
  phases.forEach((ph, i) => {
    const cx = x0 + 8 + i * (cw + 4);
    const cy = yCut + 8;
    const ch = h - (yCut - y0) - 16;
    doc.save().lineWidth(0.7).strokeColor(C.texte).rect(cx, cy, cw, ch).stroke().restore();
    doc.font("Helvetica-Bold").fontSize(5.6).fillColor(C.texte);
    doc.text(ph, cx, cy + 5, { width: cw, align: "center", lineBreak: false });
    // Code-barres factice
    for (let b = 0; b < 26; b += 1) {
      if (b % 3 !== 1) {
        doc
          .save()
          .rect(cx + 8 + b * 2.1, cy + 15, b % 2 ? 1.4 : 0.8, 20)
          .fillColor(C.texte)
          .fill()
          .restore();
      }
    }
    doc.font("Helvetica").fontSize(4.6).fillColor(C.gris);
    doc.text("2004512300017", cx, cy + 37, { width: cw, align: "center", lineBreak: false });
    doc.save().lineWidth(0.5).strokeColor(C.gris).rect(cx + 6, cy + 45, cw - 12, 12).stroke().restore();
    doc.fontSize(4.4).fillColor(C.grisClair);
    doc.text("AGENT", cx + 8, cy + 47, { lineBreak: false });
    doc.save().lineWidth(0.5).strokeColor(C.gris).rect(cx + 6, cy + 60, cw - 12, 16).stroke().restore();
    doc.fontSize(4.4).fillColor(C.grisClair);
    doc.text("SIGNATURE", cx + 8, cy + 62, { lineBreak: false });
  });

  doc.y = y0 + h + 8;
  r.legende(
    "La fiche rayon imprimee : une page A4 par rayon. En haut le QR d'identite, en bas les trois coupons detachables que l'agent rapporte au bureau.",
  );
};

// ── Figure : le cycle d'une zone ─────────────────────────────────────────────

const dessinerCycle = (r) => {
  const doc = r.doc;
  const h = 118;
  r.place(h + 16);
  const y0 = doc.y;
  const etapes = [
    ["1. PAPILLONNAGE", "Agent terrain", "Pose des papillons\nsur le rayon", C.ambre],
    ["2. BIPAGE", "Collecteur", "Comptage article\npar article", "#7c3aed"],
    ["3. CONTROLE", "Controleur", "Verification sur la\nfiche imprimee", C.vert],
  ];
  const bw = (LARGEUR - 2 * 26) / 3;
  etapes.forEach((e, i) => {
    const x = M + i * (bw + 26);
    doc.save().lineWidth(1.2).strokeColor(e[3]).rect(x, y0, bw, h).stroke().restore();
    doc.save().rect(x, y0, bw, 20).fillColor(e[3]).fill().restore();
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff");
    doc.text(e[0], x, y0 + 6, { width: bw, align: "center", lineBreak: false });
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C.gris);
    doc.text(e[1], x, y0 + 30, { width: bw, align: "center", lineBreak: false });
    doc.font("Helvetica").fontSize(8.5).fillColor(C.texte);
    doc.text(e[2], x + 6, y0 + 48, { width: bw - 12, align: "center" });
    doc.font("Helvetica").fontSize(7).fillColor(C.grisClair);
    doc.text("coupon a scanner au bureau", x + 6, y0 + h - 20, {
      width: bw - 12,
      align: "center",
      lineBreak: false,
    });
    if (i < 2) {
      const ax = x + bw + 6;
      const ay = y0 + h / 2;
      doc.save().lineWidth(1.4).strokeColor(C.grisClair);
      doc.moveTo(ax, ay).lineTo(ax + 12, ay).stroke();
      doc.moveTo(ax + 12, ay).lineTo(ax + 8, ay - 3.5).stroke();
      doc.moveTo(ax + 12, ay).lineTo(ax + 8, ay + 3.5).stroke();
      doc.restore();
    }
  });
  doc.y = y0 + h + 8;
  r.legende(
    "Les trois phases sont independantes : elles peuvent etre faites dans l'ordre que l'equipe veut. Seul le bipage produit un fichier de comptage.",
  );
};

// ── Couverture ───────────────────────────────────────────────────────────────

const couverture = (doc) => {
  doc.save().rect(0, 0, A4.w, 200).fillColor(C.bleu).fill().restore();
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#c7d2fe");
  doc.text("OUTIL EN LIGNE - QUINCAILLERIE CALEDONIENNE", M, 62, { width: LARGEUR });
  doc.font("Helvetica-Bold").fontSize(31).fillColor("#ffffff");
  doc.text("Guide de l'inventaire", M, 88, { width: LARGEUR });
  doc.font("Helvetica-Bold").fontSize(31).fillColor("#ffffff");
  doc.text("par zones", M, 122, { width: LARGEUR });
  doc.font("Helvetica").fontSize(11).fillColor("#dbeafe");
  doc.text("Fiches inventaires, comptage au collecteur et recapitulatif par zone", M, 162, {
    width: LARGEUR,
  });

  let y = 250;
  doc.font("Helvetica-Bold").fontSize(12).fillColor(C.texte);
  doc.text("A qui s'adresse ce guide", M, y, { width: LARGEUR });
  y = doc.y + 8;

  const publics = [
    [
      "Responsable d'inventaire",
      "Prepare les fiches, lance l'inventaire, suit l'avancement et exploite les ecarts. Travaille sur l'application web.",
    ],
    [
      "Agent de terrain",
      "Pose les papillons, compte les articles au collecteur, depose ses zones. Travaille sur l'application mobile.",
    ],
    [
      "Controleur",
      "Verifie les comptages sur la fiche de controle imprimee et rapporte les coupons au bureau.",
    ],
  ];
  publics.forEach(([titre, texte]) => {
    doc.save().rect(M, y, 3, 34).fillColor(C.bleu).fill().restore();
    doc.font("Helvetica-Bold").fontSize(10).fillColor(C.texte);
    doc.text(titre, M + 12, y, { width: LARGEUR - 12 });
    doc.font("Helvetica").fontSize(9).fillColor(C.gris);
    doc.text(texte, M + 12, doc.y + 1, { width: LARGEUR - 12, lineGap: 1.5 });
    y = Math.max(doc.y + 14, y + 46);
  });

  y += 6;
  doc.save().lineWidth(0.7).strokeColor(C.trait).moveTo(M, y).lineTo(M + LARGEUR, y).stroke().restore();
  y += 14;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(C.texte);
  doc.text("En un coup d'oeil", M, y, { width: LARGEUR });
  y = doc.y + 6;
  doc.font("Helvetica").fontSize(9.5).fillColor(C.texte);
  doc.text(
    "Une zone = un rayon = une fiche papier. Chaque rayon passe par trois phases : papillonnage, " +
      "bipage (le comptage) et controle. Chaque phase se declare en scannant, au bureau, le coupon " +
      "detachable que l'agent rapporte. Le comptage, lui, se fait au collecteur : l'agent scanne le QR " +
      "du rayon, compte les articles, puis depose sa zone. Le fichier de comptage part sur le reseau, " +
      "la fiche de controle s'imprime automatiquement, et l'ecran Recap par zone montre les ecarts " +
      "entre le comptage et le stock theorique.",
    M,
    y,
    { width: LARGEUR, align: "justify", lineGap: 2.5 },
  );

  const d = new Date();
  const stamp = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  doc.font("Helvetica").fontSize(8.5).fillColor(C.grisClair);
  doc.text(`Document genere le ${stamp} - Version 1`, M, A4.h - 76, {
    width: LARGEUR,
    align: "center",
    lineBreak: false,
  });
};

// ── Contenu ──────────────────────────────────────────────────────────────────

const contenu = (r) => {
  // ═══ 1. COMPRENDRE ═══
  r.h1("Comprendre l'inventaire par zones", 1);

  r.p(
    "L'inventaire par zones decoupe le magasin en rayons. Chaque rayon recoit une fiche papier " +
      "imprimee depuis l'application. Cette fiche sert a la fois de reperage sur le terrain et de " +
      "justificatif de suivi : elle porte un QR d'identite et trois coupons detachables, un par phase.",
  );

  r.h2("Les trois phases d'une zone");
  r.p(
    "Une zone n'est terminee que lorsque ses trois phases sont declarees. Elles sont independantes : " +
      "l'equipe peut les faire dans l'ordre qu'elle veut, et deux agents differents peuvent s'en charger.",
  );
  dessinerCycle(r);

  r.tableau(
    [
      { t: "Phase", w: 18 },
      { t: "Ce qui est fait", w: 44 },
      { t: "Comment elle est declaree", w: 38 },
    ],
    [
      [
        "Papillonnage",
        "L'agent parcourt le rayon et pose les papillons (etiquettes de comptage) sur les articles.",
        "En scannant le coupon PAPILLONNAGE au bureau, ecran Progression inventaire.",
      ],
      [
        "Bipage",
        "Le comptage proprement dit, au collecteur : chaque article est scanne et sa quantite saisie.",
        "En scannant le coupon BIPAGE. C'est aussi la seule phase qui produit un fichier de comptage.",
      ],
      [
        "Controle",
        "Verification du comptage sur la fiche de controle imprimee, article par article (colonne CTL).",
        "En scannant le coupon CONTROLE.",
      ],
    ],
  );

  r.encadre(
    "A retenir",
    "Scanner un coupon ne fait que declarer une phase comme realisee : cela ne transmet aucune " +
      "quantite. Les quantites comptees arrivent uniquement par le collecteur, au moment ou l'agent " +
      "depose sa zone.",
    "info",
  );

  r.h2("Le vocabulaire du module");
  r.tableau(
    [
      { t: "Terme", w: 26 },
      { t: "Ce que c'est", w: 74 },
    ],
    [
      ["Zone (ou fiche rayon)", "Un rayon du magasin. C'est l'unite de travail : on prepare, on compte et on controle rayon par rayon."],
      ["Emplacement", "MAGASIN ou DOCK. Un meme code de rayon peut exister aux deux endroits : ce sont alors DEUX zones distinctes, avec deux fiches."],
      ["Coupon", "Le talon detachable en bas de la fiche rayon. Un par phase, avec son propre code-barres."],
      ["QR principal", "Le grand QR au centre de la fiche. Il identifie la zone pour le collecteur. Il ne declare aucune phase."],
      ["Session d'inventaire", "L'inventaire en cours. Une seule session active par societe a la fois."],
      ["Collecte", "Le comptage d'UNE zone par UN agent sur le collecteur, tant qu'il n'est pas depose."],
      ["Fichier de comptage (.DAT)", "Le fichier que le collecteur depose sur le reseau quand l'agent valide sa zone."],
      ["Fiche de controle", "Le PDF imprime automatiquement a l'arrivee d'un fichier de comptage. C'est le document de verification."],
      ["Bipage (ecran Detail des bipages)", "Les lignes comptees, article par article, corrigeables au bureau."],
      ["Ecart", "Quantite comptee moins stock theorique de l'ERP. Positif = surplus, negatif = manquant."],
    ],
  );

  r.h2("Ou se trouve le module");
  r.p(
    "Dans la barre laterale de l'application web, chapitre Inventaire Zones. Il regroupe sept ecrans, " +
      "presentes ici dans l'ordre du deroulement d'un inventaire.",
  );
  r.tableau(
    [
      { t: "Ecran", w: 30 },
      { t: "A quel moment", w: 30 },
      { t: "A quoi il sert", w: 40 },
    ],
    [
      ["Fiches inventaires", "Avant", "Creer les zones et imprimer les fiches rayons."],
      ["Progression inventaire", "Avant / pendant", "Lancer l'inventaire, scanner les coupons, suivre l'avancement, importer un comptage fait sans collecteur."],
      ["Detail des bipages", "Pendant / apres", "Consulter et corriger les lignes deja comptees, recommencer une zone."],
      ["Fiches de controle", "Pendant", "Retrouver, ouvrir et telecharger les fiches PDF pour les imprimer."],
      ["Recap par zone", "Pendant / apres", "Voir l'avancement en couleurs et les ecarts chiffres."],
      ["Suivi bipage", "Pendant / apres", "Savoir qui a bipe quelle zone, quand et en combien de temps."],
      ["Agents de l'inventaire", "Pendant / apres", "La liste des personnes qui ont travaille sur l'inventaire, avec leurs zones et leurs coupons."],
    ],
  );
  r.legende(
    "Ces ecrans demandent le droit Inventaire sur la societe concernee. L'ecran Detail des bipages accepte aussi le droit Bipage.",
  );

  // ═══ 2. PREPARER ═══
  r.h1("Preparer l'inventaire (web)", 2);
  r.p(
    "Cette etape se fait une fois, avant le jour J. Elle consiste a decrire les rayons, a generer les " +
      "fiches et a les imprimer.",
  );

  r.h2("Etape 1 - Le dictionnaire des rayons");
  r.p(
    "Les zones sont construites a partir du dictionnaire des rayons de la societe : un fichier Excel " +
      "range dans le dossier collecteur du serveur, nomme d'apres le trigramme de la societe.",
  );
  r.code("<TRIGRAMME>_dictionnaire_rayons.xlsx      exemple : QC_dictionnaire_rayons.xlsx");
  r.p("Il s'edite directement dans l'application, ecran Donnees > Dictionnaire des rayons. Ses colonnes :");
  r.tableau(
    [
      { t: "Colonne", w: 18 },
      { t: "Contenu", w: 52 },
      { t: "Obligatoire", w: 30 },
    ],
    [
      ["GISM1", "Le code du rayon, celui encode dans le QR de la fiche (A_1, B_5d...).", "Oui"],
      ["libelle", "Le nom affiche en gros sur la fiche (PLOMBERIE, VISSERIE...).", "Recommande"],
      ["metrage", "Le metre lineaire du rayon. Sert au decoupage en sous-zones ailleurs dans l'application ; sur la fiche il est simplement affiche.", "Non"],
      ["priorite", "Ordre de parcours, utilise par la preparation de commandes.", "Non"],
      ["emplacement", "MAGASIN ou DOCK. Vide = MAGASIN.", "Recommande"],
    ],
  );
  r.encadre(
    "Un rayon = une fiche",
    "Une fiche est generee par LIGNE du dictionnaire, jamais par sous-zone. Un rayon de 8 metres " +
      "donne une seule fiche, pas huit.",
    "info",
  );
  r.encadre(
    "Le meme code au magasin et au dock",
    "Si un code de rayon existe en MAGASIN et en DOCK, mettez-le sur deux lignes avec deux " +
      "emplacements differents : l'application creera deux zones distinctes, avec deux fiches et deux " +
      "jeux de coupons. C'est indispensable, sinon les deux comptages se melangent.",
    "attention",
  );

  r.h2("Etape 2 - Generer les fiches inventaires");
  r.p("Ecran Inventaire Zones > Fiches inventaires. Choisissez la societe en haut de l'application, puis :");
  r.etapes([
    "Cliquez sur Generer depuis le dictionnaire. L'application lit le fichier Excel et cree une zone par rayon.",
    "Verifiez le nombre de zones creees dans le message de confirmation, puis dans la liste affichee en dessous.",
    "Utilisez la barre de recherche (code, libelle, EAN) pour verifier quelques rayons au hasard.",
  ]);
  r.encadre(
    "La generation remplace tout",
    "Generer depuis le dictionnaire SUPPRIME toutes les zones existantes de la societe avant de " +
      "recreer les nouvelles. A ne pas faire pendant un inventaire en cours : les fiches deja " +
      "imprimees ne correspondraient plus.",
    "interdit",
  );
  r.p(
    "Une seconde methode existe pour les societes qui recoivent un fichier prepare par un programme " +
      "externe : le bouton d'import CSV, sur le meme ecran. Il remplace lui aussi toutes les zones.",
  );

  r.h2("Etape 3 - Imprimer les fiches rayons");
  r.p(
    "Toujours sur l'ecran Fiches inventaires, le bouton Telecharger les fiches (PDF) produit un " +
      "document d'une page A4 par rayon. Imprimez-le, puis posez chaque fiche sur son rayon.",
  );
  dessinerFicheRayon(r);
  r.p("Chaque page comporte :");
  r.puces([
    "Le libelle du rayon en gros, son code, son emplacement et son metrage.",
    "Le QR PRINCIPAL au centre : c'est lui que l'agent scanne au collecteur pour ouvrir la zone. Il encode le code du rayon ET son emplacement.",
    "Trois coupons detachables en bas de page : PAPILLONNAGE, BIPAGE, CONTROLE. Chacun porte son code-barres, un cadre Agent et un cadre Signature.",
  ]);
  r.encadre(
    "Les coupons sont la piece justificative",
    "L'agent qui termine une phase detache le coupon correspondant, ecrit son nom, signe, et le " +
      "rapporte au bureau. C'est ce coupon qui sera scanne pour declarer la phase. Gardez-les : ils " +
      "tracent qui a fait quoi.",
    "info",
  );
  r.p(
    "Les codes-barres des coupons sont stables : reimprimer les fiches d'une meme societe redonne " +
      "exactement les memes codes, tant que le dictionnaire n'a pas change. Une fiche abimee peut donc " +
      "etre reimprimee sans rien perturber.",
  );

  r.h2("Etape 4 - Lancer l'inventaire");
  r.p(
    "Ecran Progression inventaire, bouton Initialiser. Donnez un nom parlant a l'inventaire " +
      "(par exemple Inventaire annuel 2026) : ce nom sert aussi de dossier de depot sur le reseau.",
  );
  r.encadre(
    "L'initialisation efface le travail en cours",
    "Initialiser un inventaire archive l'inventaire precedent, puis SUPPRIME toutes les zones en " +
      "cours de comptage sur les collecteurs et toutes les lignes deja bipees de la societe. " +
      "On repart d'un inventaire totalement vierge. Ne le faites qu'une fois, au demarrage.",
    "interdit",
  );
  r.p(
    "Un dossier horodate est cree sur le reseau pour recevoir les fichiers de comptage. Deux " +
      "inventaires portant le meme nom auront malgre tout deux dossiers distincts : aucun risque de " +
      "melanger les fichiers d'une annee sur l'autre.",
  );
  r.p(
    "La fenetre d'initialisation demande aussi la PLAGE DE DATES et les CLIENTS des proformas qui " +
      "serviront a compter les rayons sans collecteur (chapitre 5). Ces criteres valent pour tout " +
      "l'inventaire : ils ne seront plus jamais redemandes. Laissez-les vides si vous n'importez " +
      "que des fichiers Excel ; ils restent modifiables ensuite depuis le bloc Comptage sans " +
      "collecteur.",
  );
  r.p(
    "A partir de cet instant, les agents peuvent entrer dans l'inventaire depuis leur collecteur. " +
      "Tant qu'aucun inventaire n'est initialise, l'application mobile affiche Aucun inventaire en cours.",
  );

  // ═══ 3. TERRAIN ═══
  r.h1("Compter sur le terrain (collecteur)", 3);
  r.p(
    "Tout le comptage se fait sur l'application mobile, onglet Inventaire. L'agent travaille zone " +
      "par zone : il ouvre un rayon, compte, puis depose sa zone.",
  );

  r.h2("Entrer dans l'inventaire");
  r.etapes([
    "Ouvrez l'onglet Inventaire. L'ecran affiche INVENTAIRE EN COURS avec le nom de l'inventaire.",
    "Appuyez sur Entrer dans l'inventaire.",
    "Si l'ecran affiche Aucun inventaire en cours, c'est que le responsable n'a pas encore lance l'inventaire : rien a faire de plus.",
  ]);

  r.h2("Ouvrir une zone");
  r.etapes([
    "Scannez le QR code de la fiche rayon posee sur le rayon (Bipez le QR code de la fiche rayon).",
    "L'application affiche le rayon reconnu et demande SOUHAITEZ-VOUS BIPER CETTE ZONE ? Verifiez le libelle et le code avant de repondre Oui, biper.",
    "Si le code existe au magasin ET au dock, l'application demande SUR QUEL EMPLACEMENT ? Choisissez celui ou vous vous trouvez : c'est ce choix qui determine dans quelle zone les quantites seront comptees.",
  ]);
  r.encadre(
    "Verifiez toujours le libelle affiche",
    "Ouvrir la mauvaise zone est l'erreur la plus couteuse : les quantites d'un rayon se retrouvent " +
      "attribuees a un autre. Le libelle affiche a l'ecran doit correspondre au rayon devant vous.",
    "attention",
  );

  r.h2("Compter les articles");
  r.p(
    "Une fois la zone ouverte, l'ecran affiche Scannez un article. Pour chaque article du rayon :",
  );
  r.etapes([
    "Scannez son code-barres. L'application affiche l'article et demande Compter cet article ?",
    "Confirmez, puis saisissez la quantite comptee et validez.",
    "Passez a l'article suivant. Le compteur en haut de l'ecran indique le nombre de lignes deja comptees.",
  ]);
  r.p(
    "Si un article n'a pas de code-barres lisible, basculez en saisie manuelle et tapez son code " +
      "article (NART) ou son code-barres au clavier : le champ accepte les deux.",
  );
  r.puces([
    "Un article scanne deux fois n'est pas duplique : sa quantite se cumule et la ligne est mise a jour.",
    "Un article remplace par un autre dans l'ERP (renvoi) est automatiquement rattache a sa reference definitive.",
    "Un article inconnu du catalogue est accepte quand meme : comptez-le normalement, il sera signale au bureau comme Article non trouve.",
  ]);
  r.encadre(
    "Codes-barres commencant par un ou deux zeros",
    "Certains codes-barres commencent par 0 ou 00 (articles importes, references americaines). " +
      "Selon son reglage, la douchette transmet ces codes sur 12 ou 13 chiffres. L'application " +
      "reconnait desormais les deux ecritures : un article dont le code commence par des zeros ne doit " +
      "plus ressortir en Article inconnu. Si cela arrivait encore, signalez-le : le code exact et le " +
      "rayon suffisent a le diagnostiquer.",
    "info",
  );

  r.h2("Verifier et corriger avant de deposer");
  r.p(
    "Le bouton de recapitulatif ouvre la liste des articles comptes dans la zone. Chaque ligne peut " +
      "y etre modifiee ou supprimee tant que la zone n'est pas deposee.",
  );
  r.puces([
    "Modifier une quantite : appuyez sur la ligne, corrigez, validez.",
    "Supprimer une ligne comptee par erreur : le bouton de suppression sur la ligne.",
    "Fermer (reprendre plus tard) : la zone reste ouverte et vous la retrouverez dans Zones en cours. Rien n'est perdu.",
    "Annuler la zone : supprime entierement le comptage de cette zone. A n'utiliser que pour repartir de zero.",
  ]);

  r.h2("Deposer la zone");
  r.p(
    "Quand le rayon est entierement compte, utilisez Valider et deposer la zone. C'est l'action qui " +
      "transmet le comptage : le fichier part dans le dossier de l'inventaire en cours et la fiche de " +
      "controle s'imprime au bureau.",
  );
  r.etapes([
    "Verifiez une derniere fois le recapitulatif : apres le depot, la zone n'est plus modifiable sur le collecteur.",
    "Saisissez si besoin une Observation (facultatif) : rayon incomplet, article abime, doute sur une quantite. Elle remontera dans l'ecran Suivi bipage.",
    "Confirmez le depot. La zone disparait de vos zones en cours.",
  ]);
  r.encadre(
    "Une zone vide ne peut pas etre deposee",
    "Si aucun article n'a ete compte, le depot est refuse. Un rayon reellement vide se signale au " +
      "responsable, qui cochera la phase manuellement.",
    "attention",
  );
  r.encadre(
    "Apres le depot, on ne recommence pas tout seul",
    "Si vous devez recompter une zone deja deposee, demandez au responsable de la remettre a zero " +
      "depuis l'ecran Detail des bipages (bouton Recommencer). Rescanner le coupon de bipage ne suffit " +
      "pas : l'application le refuse pour eviter les doubles comptages.",
    "interdit",
  );

  r.h2("Terminer une phase et rapporter le coupon");
  r.p(
    "A la fin de chaque phase, l'agent detache le coupon correspondant de la fiche rayon, y inscrit " +
      "son nom, signe, et le rapporte au bureau. C'est la seule facon de declarer une phase realisee.",
  );

  // ═══ 4. PILOTER ═══
  r.h1("Piloter l'inventaire (web)", 4);

  r.h2("Declarer les phases : ecran Progression inventaire");
  r.p(
    "C'est le poste de commande pendant l'inventaire. Le champ de scan est actif en permanence : " +
      "il suffit de passer les coupons rapportes par les agents devant la douchette.",
  );
  r.etapes([
    "Placez le curseur dans le champ Scannez ou saisissez un code-barres puis Entree.",
    "Scannez le coupon rapporte. L'application reconnait le rayon et la phase, mais ne valide encore rien.",
    "Une fenetre demande QUI a realise ce travail : cherchez la personne par son nom, puis validez. C'est cette validation qui marque la phase.",
    "Enchainez les coupons : le champ de scan reprend la main, et la derniere personne choisie est reproposee.",
  ]);
  r.encadre(
    "Pourquoi on demande le nom a chaque coupon",
    "Le coupon detachable ne porte aucune identite : sans cette question, la phase serait creditee " +
      "a la personne assise au poste, jamais a l'agent qui a fait le rayon. La liste propose TOUS " +
      "les comptes de l'application, pas seulement ceux de la societe : un renfort venu d'une autre " +
      "societe du groupe doit pouvoir etre credite. Si vous validez sans choisir personne, la phase " +
      "est mise a votre nom. Annuler la fenetre ne valide rien.",
    "info",
  );
  r.p("Les messages possibles :");
  r.tableau(
    [
      { t: "Message", w: 34 },
      { t: "Signification", w: 66 },
    ],
    [
      ["Zone X - Papillonnage valide (Nom)", "La phase vient d'etre marquee au nom de la personne indiquee. Rien d'autre a faire."],
      ["Zone X - Bipage deja fait", "Le coupon avait deja ete scanne. Sans consequence."],
      ["Zone X identifiee", "Vous avez scanne le QR principal et non un coupon : aucune phase n'a ete marquee. Scannez le bon coupon."],
      ["Code-barres inconnu dans cet inventaire", "Le coupon n'appartient pas a cet inventaire : fiche d'une ancienne session, ou d'une autre societe."],
      ["Zone X deja bipee et imprimee", "Verrou de securite : voir l'encadre ci-dessous."],
    ],
  );
  r.encadre(
    "Le verrou anti double-comptage",
    "Une fois qu'une zone a ete bipee et que sa fiche de controle a ete imprimee, son coupon de " +
      "bipage ne peut plus etre rescanne. Pour recompter la zone, passez par Detail des bipages > " +
      "Recommencer : cela efface le comptage, supprime la fiche imprimee et rouvre la zone.",
    "attention",
  );
  r.p(
    "Le tableau des zones, en dessous, permet aussi de cocher ou decocher une phase a la main. " +
      "Cocher ouvre la meme fenetre de designation que le scan ; decocher est immediat. " +
      "Reservez-le aux cas ou le coupon a ete perdu ou le rayon reellement vide : le scan reste la " +
      "regle, car il conserve l'heure et l'identite de qui a declare. En survolant une pastille " +
      "verte, vous lisez qui a valide la phase et quand.",
  );

  r.h2("Integrer un comptage fait sans collecteur");
  r.p(
    "Le meme ecran porte le bloc Comptage sans collecteur, REPLIE par defaut : cliquez sur son " +
      "titre pour le derouler. On y choisit une zone, puis on lui importe un fichier Excel ou une " +
      "proforma de l'ERP. Le detail est au chapitre 5.",
  );
  r.encadre(
    "Pourquoi ici et pas dans Detail des bipages",
    "Importer un comptage, c'est faire avancer l'inventaire : la zone change d'etat et ses phases " +
      "peuvent etre cochees. Cela se pilote donc depuis l'ecran de pilotage. L'ecran Detail des " +
      "bipages, lui, ne sert plus qu'a consulter et corriger les lignes une fois qu'elles existent.",
    "info",
  );

  r.h2("Filtrer par emplacement");
  r.p(
    "Au-dessus du tableau des zones, une liste deroulante limite l'affichage a un emplacement " +
      "(MAGASIN, DOCK, ou Sans emplacement). Elle ne filtre pas que le tableau : les compteurs " +
      "d'avancement au-dessus se recalculent sur le perimetre affiche. On lit donc directement " +
      "ou en est le dock, sans le diluer dans le magasin.",
  );
  r.p(
    "Quand un emplacement est isole, le pourcentage global de l'inventaire reste rappele en petit " +
      "sous le grand chiffre : on ne perd jamais de vue l'avancement reel. Le champ de recherche " +
      "s'applique en plus du filtre, et le compteur a droite indique combien de zones sont " +
      "affichees sur le total.",
  );

  r.h2("Voir ou en est l'inventaire : ecran Recap par zone");
  r.p(
    "Une carte par rayon, coloree selon son avancement. C'est la vue a projeter pendant l'inventaire " +
      "pour voir instantanement ce qui reste a faire.",
  );
  r.tableau(
    [
      { t: "Couleur", w: 20 },
      { t: "Etat de la zone", w: 80 },
    ],
    [
      ["Rouge", "Pas commencee : aucune phase declaree."],
      ["Orange", "Papillonnage fait."],
      ["Violet", "Comptage (bipage) fait."],
      ["Vert", "Complete : papillonnage, bipage et controle declares."],
    ],
  );
  r.p(
    "Le meme ecran affiche les ecarts chiffres : pour chaque article compte, la quantite bipee, le " +
      "stock theorique de l'ERP, l'ecart et sa valorisation en francs au prix d'achat. Les totaux sont " +
      "donnes par zone, et un second regroupement permet de lire les memes ecarts par fournisseur.",
  );
  r.encadre(
    "Ce que veut dire un ecart",
    "Ecart = quantite comptee moins stock theorique. Un ecart positif signifie qu'il y a plus " +
      "d'articles en rayon que dans l'ERP ; un ecart negatif, qu'il en manque. Un rayon non encore " +
      "compte affiche donc un ecart negatif egal a tout son stock : ce n'est pas une anomalie tant que " +
      "l'inventaire n'est pas termine.",
    "info",
  );

  r.h2("Les fiches de controle");
  r.p(
    "Des qu'un agent depose une zone, le fichier de comptage arrive sur le reseau, l'application le " +
      "recupere et imprime automatiquement la fiche de controle du rayon. L'ecran Fiches de controle " +
      "recense toutes ces fiches, avec leur etat d'impression.",
  );
  r.p("La fiche imprimee liste les articles comptes avec, pour chacun :");
  r.tableau(
    [
      { t: "Colonne", w: 18 },
      { t: "Contenu", w: 82 },
    ],
    [
      ["N", "Numero de ligne."],
      ["CODE", "Le code tel qu'il a ete scanne par l'agent."],
      ["NART", "Le code article de l'ERP correspondant."],
      ["ATT", "Signal d'attention (voir ci-dessous)."],
      ["DESIGNATION / REFERENCE", "Libelle et reference de l'article."],
      ["QTE", "Quantite comptee par l'agent."],
      ["STOCK", "Stock theorique de l'ERP au moment de l'impression."],
      ["CTL", "Case vide : c'est la que le controleur ecrit ce qu'il a verifie."],
    ],
  );
  r.p("Les signaux de la colonne ATT :");
  r.tableau(
    [
      { t: "Signal", w: 12 },
      { t: "Ce qu'il faut verifier", w: 88 },
    ],
    [
      ["D", "Doublon : l'article apparait plusieurs fois dans le meme comptage. Verifiez qu'il n'a pas ete compte deux fois."],
      ["XX", "La quantite comptee depasse le stock theorique. Surplus a confirmer."],
      ["A", "Attention : le stock theorique depasse la quantite comptee, ou l'article est inconnu du catalogue."],
    ],
  );
  r.encadre(
    "Si une fiche ne sort pas de l'imprimante",
    "L'impression automatique est assuree par un poste du reseau, pas par le serveur. Si rien ne " +
      "sort, verifiez que ce poste est allume et que l'agent d'impression y tourne. La fiche reste " +
      "de toute facon disponible depuis l'ecran Fiches de controle : l'icone en forme d'oeil " +
      "l'ouvre en apercu, l'icone de telechargement l'enregistre sur votre poste, et vous " +
      "l'imprimez depuis votre lecteur PDF.",
    "attention",
  );
  r.p(
    "Le PDF reste consultable meme si le fichier a disparu du dossier reseau : l'application le " +
      "reconstruit a l'identique a partir du comptage. L'apercu et le telechargement ne dependent " +
      "donc pas du poste d'impression.",
  );

  r.h2("Corriger un comptage : ecran Detail des bipages");
  r.p(
    "Toutes les lignes comptees de l'inventaire en cours y sont listees, filtrables par zone, par " +
      "emplacement et par recherche libre. Ce sont les memes lignes que celles de la fiche imprimee, " +
      "mais modifiables.",
  );
  r.puces([
    "Corriger une quantite mal saisie par l'agent.",
    "Corriger le code article quand le scan a rattache la mauvaise reference : la designation et le stock se recalculent.",
    "Ajouter une observation sur une ligne, pour le suivi.",
    "Exporter la selection en CSV pour la transmettre a la comptabilite.",
  ]);
  r.h3("Recommencer une zone");
  r.p(
    "Le bouton Recommencer remet une zone entierement a zero : les lignes comptees sont supprimees, " +
      "la fiche de controle et ses fichiers sont effaces, la phase de bipage repasse a non faite et " +
      "l'agent peut recompter le rayon.",
  );
  r.encadre(
    "Recommencer est irreversible",
    "Le comptage precedent de la zone est definitivement perdu. Si vous voulez en garder une trace, " +
      "exportez d'abord la zone en CSV depuis le meme ecran.",
    "interdit",
  );

  r.h2("Savoir qui a fait quoi : ecran Suivi bipage");
  r.p(
    "Une ligne par zone bipee : l'agent, l'heure d'entree dans la zone, le premier et le dernier " +
      "scan, le nombre d'articles, et deux durees.",
  );
  r.tableau(
    [
      { t: "Duree", w: 22 },
      { t: "Comment elle est calculee", w: 78 },
    ],
    [
      ["Temps effectif", "Le temps reellement passe a compter : la somme des intervalles entre scans, en excluant les silences de plus de 5 minutes (pause, appel, autre tache)."],
      ["Temps brut", "De l'entree dans la zone jusqu'au depot, pauses comprises. Une zone ouverte le matin et deposee le soir affiche une journee entiere."],
    ],
  );
  r.p(
    "L'ecran affiche aussi l'observation laissee par l'agent au moment du depot, et permet d'ajouter " +
      "une observation de suivi cote bureau.",
  );

  r.h2("La synthese par personne : ecran Agents de l'inventaire");
  r.p(
    "Une ligne par personne ayant travaille sur l'inventaire, quelle que soit sa facon d'y avoir " +
      "participe. L'ecran reunit les deux sources : ce qui a ete fait au collecteur et les coupons " +
      "detachables rapportes au poste. Quelqu'un qui n'a fait que du papillonnage y figure donc au " +
      "meme titre que celui qui a bipe toute la journee.",
  );
  r.tableau(
    [
      { t: "Colonne", w: 26 },
      { t: "Ce qu'elle donne", w: 74 },
    ],
    [
      ["Zones bipees", "Le nombre de rayons comptes au collecteur, dont ceux encore ouverts."],
      ["Coupons", "Les coupons valides a son nom, detailles P (papillonnage), B (bipage), C (controle)."],
      ["Articles / Unites", "Ce qui a ete compte au collecteur."],
      ["Temps effectif / brut", "Memes definitions que dans Suivi bipage."],
      ["Moy. / zone", "Temps effectif moyen par rayon compte : le repere pour dimensionner le prochain inventaire."],
      ["Activite", "Premiere et derniere trace de travail sur l'inventaire."],
    ],
  );
  r.p(
    "Cliquez sur une ligne pour deplier le detail : d'un cote les rayons bipes avec leur temps, de " +
      "l'autre les rayons papillonnes, comptes ou controles au coupon avec la date. Le bouton Excel " +
      "exporte la synthese et ces deux details.",
  );
  r.encadre(
    "Un agent n'apparait que si on l'a designe",
    "Les coupons ne sont credites qu'a la personne choisie dans la fenetre qui suit le scan " +
      "(chapitre 4). Si l'on valide sans choisir, c'est la personne au poste qui apparait dans cet " +
      "ecran : prenez l'habitude de designer l'agent, c'est ce qui rend la synthese exploitable.",
    "attention",
  );

  // ═══ 5. CAS PARTICULIERS ═══
  r.h1("Cas particuliers et sources annexes", 5);

  r.h2("Les trois facons d'alimenter un comptage");
  r.p(
    "Le collecteur est la voie normale, mais deux autres existent pour les situations ou il n'est pas " +
      "utilisable. Quelle que soit la source, les lignes produites sont identiques : elles s'affichent, " +
      "se corrigent et s'exportent de la meme facon, et alimentent les memes ecarts.",
  );
  r.tableau(
    [
      { t: "Source", w: 20 },
      { t: "Quand l'utiliser", w: 42 },
      { t: "Ce qu'elle produit", w: 38 },
    ],
    [
      [
        "Collecteur",
        "La voie normale. L'agent scanne dans le rayon.",
        "Un fichier de comptage, une fiche de controle imprimee automatiquement.",
      ],
      [
        "Fichier Excel",
        "Rayon compte sur papier, ou magasin sans collecteur.",
        "Les memes lignes, sans impression automatique de fiche.",
      ],
      [
        "Proforma de l'ERP",
        "Equipe qui saisit son comptage sous forme de proforma.",
        "Les memes lignes, avec le vendeur du document comme agent.",
      ],
    ],
  );
  r.encadre(
    "Aucune source n'ecrit dans l'ERP",
    "L'inventaire lit le catalogue et les stocks, il ne les modifie jamais. La mise a jour des stocks " +
      "dans l'ERP reste une operation separee, faite a partir des fichiers de comptage.",
    "info",
  );

  r.h2("Le mode operatoire commun");
  r.p(
    "Les deux imports se font au meme endroit et de la meme facon : ecran Progression inventaire, " +
      "bloc Comptage sans collecteur. Ce bloc est replie par defaut : cliquez sur son titre pour " +
      "le derouler.",
  );
  r.etapes([
    "Deroulez le bloc Comptage sans collecteur.",
    "Choisissez la ZONE dans la liste deroulante. Elle porte le code du rayon, son libelle et son emplacement : un meme code au magasin et au dock apparait deux fois, ce sont deux zones distinctes.",
    "Choisissez le MODE : Comptage (+) pour ajouter, Deduction (-) pour retrancher.",
    "Cliquez sur Importer un Excel, ou sur Depuis une proforma pour aller chercher le document dans l'ERP.",
    "Pour une proforma : cochez les documents, cliquez sur Verifier, lisez l'ecran de verification (etat de la zone et effet article par article), puis confirmez.",
    "Verifiez le message de confirmation : il rappelle la zone, le nombre de lignes et d'unites integrees.",
  ]);
  r.encadre(
    "La zone est choisie, jamais devinee",
    "Le nom du fichier Excel et l'observation de la proforma n'ont aucune importance : c'est la zone " +
      "selectionnee a l'ecran qui recoit le comptage. Le bandeau sous les boutons rappelle en " +
      "permanence la zone visee — verifiez-le avant d'importer, c'est le seul garde-fou.",
    "attention",
  );

  r.h3("L'import s'ajoute au comptage existant");
  r.p(
    "Un import ne remplace pas ce qui a deja ete compte sur la zone : il s'y ajoute, ou s'en " +
      "retranche selon le mode. On peut donc completer un comptage de collecteur par un Excel, ou " +
      "cumuler plusieurs proformas sur le meme rayon.",
  );
  r.h3("Verifier avant d'integrer");
  r.p(
    "Pour une proforma, le bouton n'integre plus directement : il ouvre d'abord un ecran de " +
      "verification. Rien n'est ecrit tant que vous n'avez pas confirme.",
  );
  r.p("Cet ecran repond a trois questions :");
  r.tableau(
    [
      { t: "Ce qu'il montre", w: 32 },
      { t: "Pourquoi c'est la", w: 68 },
    ],
    [
      [
        "L'etat de la zone",
        "Papillonnage, bipage et controle deja declares. Si la zone a deja ete CONTROLEE, un bandeau rouge vous en avertit et il faut cocher une case pour continuer : le controle avait porte sur le comptage actuel, l'integration le rend caduc.",
      ],
      [
        "Article par article",
        "Ce qui etait deja compte sur la zone, le mouvement de la proforma, et le resultat. En deduction, on voit donc ce qui restera reellement, pas seulement ce que la proforma retire.",
      ],
      [
        "Les cas a decider",
        "Nouvelle reference : l'article n'avait jamais ete compte sur cette zone, il s'ajoute. Negatif : la deduction depasse ce qui avait ete compte.",
      ],
    ],
  );
  r.encadre(
    "Une deduction plus grande que le comptage n'est pas corrigee toute seule",
    "Si vous deduisez 5 pieces d'un article compte 3 fois, le resultat affiche -2, en rouge. " +
      "L'application ne ramene pas le chiffre a zero : un resultat negatif veut dire que le " +
      "comptage ou la proforma est faux, et c'est une information a traiter, pas a masquer. " +
      "Verifiez avant de confirmer.",
    "attention",
  );
  r.legende(
    "L'import Excel, lui, s'applique directement : il vient en general d'un rayon compte sur papier, sans comptage prealable a rapprocher.",
  );

  r.encadre(
    "Le meme fichier importe deux fois ne compte qu'une fois",
    "Reimporter le MEME fichier sur la MEME zone dans le MEME mode remplace l'import precedent au " +
      "lieu de l'empiler : un double clic ne double pas le comptage, et corriger un fichier puis le " +
      "reimporter met simplement les lignes a jour. Deux fichiers de noms differents, eux, " +
      "s'additionnent.",
    "info",
  );

  r.h3("Les phases cochees automatiquement");
  r.p(
    "Quand la zone importee n'avait JAMAIS ete comptee, l'application coche pour vous ses phases " +
      "papillonnage et bipage. C'est logique : personne n'est passe avec la fiche papier, il n'y aura " +
      "donc jamais de coupon a rapporter pour ce rayon.",
  );
  r.puces([
    "La phase controle n'est PAS cochee : un import ne verifie rien, la verification reste a faire.",
    "Un import qui vient completer un comptage existant ne touche a aucune phase : elles ont deja ete declarees par ceux qui ont travaille le rayon.",
    "Les phases restent modifiables a la main dans le tableau des zones, comme n'importe quelle autre.",
  ]);

  r.h2("Compter depuis un fichier Excel");
  r.p(
    "Quand un rayon a ete compte sur papier, ou par un magasin sans collecteur. Le modele se " +
      "telecharge depuis le meme bloc, bouton Modele Excel ; son onglet Aide reprend le mode " +
      "d'emploi.",
  );
  r.p("Le fichier tient en deux colonnes, dans l'onglet Bipage :");
  r.tableau(
    [
      { t: "Colonne", w: 22 },
      { t: "Contenu", w: 78 },
    ],
    [
      ["CODE", "Code-barres (gencode) ou code article (NART). Les lignes sans code sont ignorees."],
      ["QUANTITE", "Quantite comptee, en nombre entier. Toujours en POSITIF, meme en mode deduction."],
    ],
  );
  r.encadre(
    "Saisissez toujours en positif",
    "Dans les deux modes les quantites se saisissent normalement : c'est le mode choisi a l'import " +
      "qui decide du signe. Un meme fichier peut etre importe dans les deux modes sans que l'un " +
      "efface l'autre.",
    "info",
  );
  r.p(
    "Le nom du fichier est libre. Il reste toutefois affiche comme provenance de la ligne : un nom " +
      "parlant (le rayon, la date, l'agent) rend le detail des bipages plus lisible.",
  );

  r.h2("Compter depuis une proforma");
  r.p(
    "Certaines equipes saisissent leur comptage sous forme de proforma dans l'ERP. Le bouton Depuis " +
      "une proforma ouvre directement la LISTE des documents concernes : il n'y a rien a saisir, " +
      "il suffit de cocher ceux a integrer dans la zone choisie.",
  );
  r.p(
    "La plage de dates et les clients ont ete renseignes UNE SEULE FOIS, a l'initialisation de " +
      "l'inventaire (chapitre 2). Ils sont rappeles en haut de la fenetre et dans le bloc de " +
      "comptage ; le bouton Modifier permet de les corriger, ce qui vaut aussitot pour tous les " +
      "imports suivants.",
  );
  r.puces([
    "Toute proforma portant au moins une ligne article est integrable. Seule une proforma sans aucune ligne est refusee : il n'y a rien a compter.",
    "L'observation du document est affichee a titre indicatif, elle ne decide plus de rien.",
    "Le vendeur de la proforma est repris comme agent du comptage.",
    "Plusieurs proformas peuvent etre integrees d'un coup sur la meme zone : leurs quantites s'additionnent.",
  ]);
  r.encadre(
    "Pourquoi une selection est obligatoire",
    "Il faut au moins une plage de dates ou un numero de client : sans filtre, toute la table des " +
      "proformas serait balayee, ce qui prend plusieurs dizaines de secondes sur les grosses " +
      "societes. Si rien n'a ete renseigne au lancement de l'inventaire, la fenetre vous le dit et " +
      "propose de le faire — une seule fois, la aussi.",
    "info",
  );

  r.h3("Le mode Deduction");
  r.p(
    "Deduction enregistre les quantites en negatif, pour retrancher du comptage ce qui a ete vendu " +
      "dans une partie du magasin restee ouverte pendant l'inventaire. Les lignes concernees " +
      "apparaissent en orange dans le detail des bipages.",
  );

  r.h2("Un article inconnu du catalogue");
  r.p(
    "Un code qui ne correspond a aucun article est malgre tout enregistre, avec la mention Article " +
      "non trouve sur la fiche et dans le detail des bipages. Ne le sautez pas au comptage : c'est " +
      "souvent un article reel dont la reference doit etre creee ou corrigee dans l'ERP.",
  );
  r.p(
    "Au bureau, l'ecran Detail des bipages permet de renseigner le bon code article sur la ligne : " +
      "la designation et le stock se recalculent aussitot.",
  );

  // ═══ 6. TERMINER ═══
  r.h1("Terminer et exploiter l'inventaire", 6);

  r.h2("Verifier que tout est complet");
  r.etapes([
    "Ecran Recap par zone : toutes les cartes doivent etre vertes. Une carte rouge ou orange signale un rayon dont il manque une phase.",
    "Ecran Progression inventaire : le compteur de phases doit afficher le total attendu (nombre de rayons multiplie par trois).",
    "Ecran Fiches de controle : verifiez qu'aucune fiche n'est en attente d'impression.",
    "Ecran Detail des bipages : traitez les lignes Article non trouve et les signaux D et XX.",
  ]);

  r.h2("Sortir les resultats");
  r.puces([
    "Recap par zone : les ecarts chiffres, par zone ou par fournisseur, avec leur valorisation en francs. Chaque zone peut etre editee en PDF au meme format que la fiche de controle.",
    "Detail des bipages : export CSV de toutes les lignes comptees, filtrable par zone.",
    "Suivi bipage : temps passe par zone. Agents de l'inventaire : la meme lecture par personne, coupons compris. Utiles pour dimensionner le prochain inventaire.",
  ]);

  r.h2("Cloturer");
  r.p(
    "Il n'y a pas de bouton de cloture : un inventaire reste consultable tant qu'un nouveau n'est pas " +
      "initialise. Le jour ou vous initialisez l'inventaire suivant, le precedent est archive et reste " +
      "accessible dans l'historique.",
  );
  r.h3("Annuler un inventaire");
  r.p(
    "Le bouton Annuler l'inventaire, sur l'ecran Progression inventaire, fait table rase : il " +
      "supprime le dossier de depot du reseau avec tous ses fichiers, efface les comptages et les " +
      "fiches, et supprime l'inventaire lui-meme. Rien n'est archive.",
  );
  r.encadre(
    "A reserver aux faux departs",
    "Utilisez Annuler uniquement pour un inventaire lance par erreur. Pour passer a l'inventaire " +
      "suivant en gardant l'historique, il suffit d'en initialiser un nouveau.",
    "interdit",
  );

  // ═══ 7. DEPANNAGE ═══
  r.h1("Depannage", 7);
  r.p("Les situations les plus frequentes, dans l'ordre ou elles se presentent sur le terrain.");

  const pannes = [
    [
      "Le collecteur affiche Aucun inventaire en cours",
      "Aucun inventaire n'a ete initialise pour cette societe, ou l'agent n'est pas sur la bonne societe. Le responsable doit lancer l'inventaire depuis l'ecran Progression inventaire.",
    ],
    [
      "Le QR de la fiche ne donne aucune zone",
      "La fiche vient d'un ancien inventaire ou d'une autre societe, ou les zones ont ete regenerees depuis l'impression. Reimprimez les fiches depuis l'ecran Fiches inventaires.",
    ],
    [
      "L'application demande sur quel emplacement",
      "Le code du rayon existe au magasin ET au dock. Choisissez celui ou vous etes physiquement : ce choix determine la zone comptee.",
    ],
    [
      "Un article ressort Article inconnu",
      "Comptez-le quand meme : il sera signale au bureau, ou son code pourra etre corrige. Notez la reference si elle est lisible sur l'emballage.",
    ],
    [
      "Le depot est refuse : la zone est vide",
      "Aucun article n'a ete compte. Un rayon reellement vide se signale au responsable, qui cochera la phase a la main.",
    ],
    [
      "La fiche de controle ne s'imprime pas",
      "L'impression automatique est assuree par un poste du reseau, pas par le serveur. Verifiez que ce poste est allume et que l'agent d'impression y tourne. La fiche reste ouvrable en apercu et telechargeable depuis l'ecran Fiches de controle : vous l'imprimez alors depuis votre poste.",
    ],
    [
      "L'import refuse : aucune zone choisie",
      "Le bloc Comptage sans collecteur exige une zone : choisissez-la dans la liste avant de cliquer sur Importer. Si le code existe au magasin ET au dock, prenez la bonne des deux lignes.",
    ],
    [
      "Un import a atterri sur la mauvaise zone",
      "Rien n'est perdu : allez dans Detail des bipages, filtrez sur la zone, et utilisez Recommencer pour effacer son comptage, puis reimportez sur la bonne zone. Le bandeau de rappel sous les boutons evite l'erreur la fois suivante.",
    ],
    [
      "Un fichier de comptage part en zone non trouvee",
      "Le code de zone du fichier ne correspond a aucune fiche de la societe : zone supprimee depuis, ou fiches regenerees en cours d'inventaire. Verifiez la zone dans Fiches inventaires, puis faites recommencer le comptage.",
    ],
    [
      "Le coupon de bipage est refuse : zone deja bipee et imprimee",
      "Verrou anti double-comptage. Pour recompter la zone, passez par Detail des bipages > Recommencer.",
    ],
    [
      "Un rayon apparait deux fois dans le recap",
      "Le meme code existe au magasin et au dock : ce sont deux zones distinctes, c'est normal. Verifiez simplement que chacune a bien ete comptee a son emplacement.",
    ],
    [
      "Les ecarts sont enormes et tous negatifs",
      "Les rayons concernes n'ont pas encore ete comptes : l'ecart vaut alors tout le stock theorique. Attendez la fin de l'inventaire avant de conclure.",
    ],
  ];
  pannes.forEach(([q, a]) => {
    r.h3(q);
    r.p(a);
  });

  // ═══ 8. ANNEXES ═══
  r.h1("Annexes", 8);

  r.h2("Recapitulatif du deroulement");
  r.tableau(
    [
      { t: "Quand", w: 16 },
      { t: "Qui", w: 20 },
      { t: "Quoi", w: 34 },
      { t: "Ou", w: 30 },
    ],
    [
      ["Avant", "Responsable", "Renseigner le dictionnaire des rayons", "Web - Dictionnaire des rayons"],
      ["Avant", "Responsable", "Generer les zones et imprimer les fiches", "Web - Fiches inventaires"],
      ["Avant", "Equipe", "Poser une fiche par rayon", "Terrain"],
      ["Jour J", "Responsable", "Initialiser l'inventaire", "Web - Progression inventaire"],
      ["Jour J", "Agent", "Papillonner le rayon, rapporter le coupon", "Terrain"],
      ["Jour J", "Agent", "Compter le rayon et deposer la zone", "Mobile - Inventaire"],
      ["Jour J", "Bureau", "Scanner les coupons rapportes", "Web - Progression inventaire"],
      ["Jour J", "Controleur", "Verifier sur la fiche imprimee", "Fiche de controle papier"],
      ["Jour J", "Responsable", "Suivre l'avancement", "Web - Recap par zone"],
      ["Jour J", "Responsable", "Importer un comptage sans collecteur", "Web - Progression inventaire"],
      ["Apres", "Responsable", "Corriger les lignes signalees", "Web - Detail des bipages"],
      ["Apres", "Responsable", "Sortir les ecarts et les exports", "Web - Recap par zone"],
    ],
  );

  r.h2("Ce qui est efface, et quand");
  r.tableau(
    [
      { t: "Action", w: 30 },
      { t: "Consequence", w: 70 },
    ],
    [
      ["Generer les zones depuis le dictionnaire", "Remplace TOUTES les zones de la societe. Les fiches deja imprimees deviennent obsoletes."],
      ["Initialiser un inventaire", "Archive l'inventaire precedent, supprime les zones en cours de comptage et toutes les lignes bipees."],
      ["Recommencer une zone", "Efface le comptage de cette zone, sa fiche de controle et ses fichiers. Irreversible."],
      ["Annuler la zone (collecteur)", "Efface le comptage en cours de cette zone sur le collecteur. Rien n'est depose."],
      ["Annuler l'inventaire", "Supprime le dossier reseau, tous les comptages, toutes les fiches et l'inventaire. Rien n'est archive."],
    ],
  );

  r.h2("Convention de nommage du fichier de comptage");
  r.p(
    "Elle ne concerne QUE le fichier depose par le collecteur, que l'application ecrit elle-meme : " +
      "le code de zone est tout ce qui precede le DERNIER souligne, et ce qui suit designe " +
      "l'emplacement. C'est ce qui permet au poste d'impression de ranger le fichier au bon endroit.",
  );
  r.code([
    "stock.dat A_1_MAGASIN",
    "",
    "code de zone = A_1        emplacement = MAGASIN",
  ]);
  r.encadre(
    "Les imports n'ont plus de convention",
    "Le nom d'un fichier Excel et l'observation d'une proforma sont libres : la zone est choisie " +
      "dans l'ecran Progression inventaire au moment de l'import.",
    "info",
  );

  r.h2("Droits necessaires");
  r.tableau(
    [
      { t: "Pour", w: 42 },
      { t: "Droit requis", w: 58 },
    ],
    [
      ["Consulter les ecrans du module", "Inventaire - lecture, sur la societe concernee"],
      ["Generer les zones, initialiser, scanner les coupons", "Inventaire - ecriture"],
      ["Supprimer des zones ou un inventaire archive", "Inventaire - suppression"],
      ["Corriger les lignes du Detail des bipages", "Inventaire ou Bipage - ecriture"],
      ["Compter sur le collecteur", "Inventaire - ecriture, sur la societe de l'inventaire"],
    ],
  );
  r.legende(
    "Les droits se reglent par utilisateur et par societe dans Administration > Utilisateurs. Un utilisateur sans droit sur la societe ne voit pas l'inventaire, meme s'il a le module.",
  );

  r.h2("Bonnes pratiques");
  r.puces([
    "Imprimez les fiches la veille et posez-les avant l'ouverture : c'est la seule etape qui bloque tout le monde si elle traine.",
    "Ne regenerez jamais les zones pendant un inventaire : les fiches posees ne correspondraient plus.",
    "Faites scanner les coupons au fil de l'eau plutot qu'en fin de journee : le Recap par zone reste utile en temps reel.",
    "Traitez les articles inconnus le jour meme, tant que l'agent se souvient du rayon et de l'article.",
    "Exportez le detail des bipages en CSV avant toute correction de masse : c'est votre filet de securite.",
    "Un agent, une zone a la fois : deux agents sur le meme rayon produisent deux comptages, et le dernier depose ecrase le precedent.",
    "Avant d'importer un comptage sans collecteur, relisez le bandeau qui rappelle la zone visee : c'est la seule verification avant que les quantites ne partent.",
  ]);
};

// ── Sommaire (ecrit apres coup sur la page reservee) ─────────────────────────

const ecrireSommaire = (doc, sommaire, pages) => {
  // `pages` = les index (0-based) des pages RÉSERVÉES au sommaire. Il en faut
  // plusieurs dès que le guide dépasse la quarantaine d'entrées : on bascule
  // sur la suivante quand la première est pleine, plutôt que de tronquer.
  let indexPage = 0;
  doc.switchToPage(pages[indexPage]);
  doc.font("Helvetica-Bold").fontSize(21).fillColor(C.texte);
  doc.text("Sommaire", M, M, { width: LARGEUR });
  let y = doc.y + 4;
  doc.save().lineWidth(2).strokeColor(C.bleu).moveTo(M, y).lineTo(M + 60, y).stroke().restore();
  y += 20;

  let omises = 0;
  sommaire.forEach((e) => {
    // Garde-fou : si même les pages réservées ne suffisent pas, on ne tronque
    // pas en silence — le script le signale pour qu'on en réserve une de plus.
    if (y > BAS - 16) {
      indexPage += 1;
      if (indexPage >= pages.length) {
        omises += 1;
        return;
      }
      doc.switchToPage(pages[indexPage]);
      y = M;
    }
    const estChapitre = e.niveau === 1;
    const x = estChapitre ? M : M + 18;
    const label = estChapitre ? `${e.numero}.  ${e.titre}` : e.titre;

    doc
      .font(estChapitre ? "Helvetica-Bold" : "Helvetica")
      .fontSize(estChapitre ? 11 : 9.5)
      .fillColor(estChapitre ? C.texte : C.gris);

    if (estChapitre) y += 6;
    const largeurLabel = doc.widthOfString(label);
    doc.text(label, x, y, { lineBreak: false });

    const numero = String(e.page);
    doc.font("Helvetica").fontSize(estChapitre ? 10 : 9).fillColor(C.gris);
    const largeurNum = doc.widthOfString(numero);
    doc.text(numero, M + LARGEUR - largeurNum, y, { lineBreak: false });

    // Points de conduite
    const xDebut = x + largeurLabel + 6;
    const xFin = M + LARGEUR - largeurNum - 6;
    if (xFin > xDebut) {
      doc
        .save()
        .lineWidth(0.5)
        .strokeColor("#d0d0d0")
        .dash(1.2, { space: 3 })
        .moveTo(xDebut, y + (estChapitre ? 8 : 7))
        .lineTo(xFin, y + (estChapitre ? 8 : 7))
        .stroke()
        .undash()
        .restore();
    }
    y += estChapitre ? 19 : 15;
  });
  return omises;
};

// ── Pieds de page ────────────────────────────────────────────────────────────

const piedsDePage = (doc, total) => {
  for (let i = 1; i < total; i += 1) {
    doc.switchToPage(i);
    const y = A4.h - 40;
    doc
      .save()
      .lineWidth(0.5)
      .strokeColor(C.trait)
      .moveTo(M, y - 8)
      .lineTo(M + LARGEUR, y - 8)
      .stroke()
      .restore();
    doc.font("Helvetica").fontSize(8).fillColor(C.grisClair);
    doc.text("Guide de l'inventaire par zones", M, y, {
      width: LARGEUR / 2,
      lineBreak: false,
    });
    doc.text(String(i + 1), M + LARGEUR / 2, y, {
      width: LARGEUR / 2,
      align: "right",
      lineBreak: false,
    });
  }
};

// ── Programme ────────────────────────────────────────────────────────────────

const doc = new PDFDocument({
  size: "A4",
  margin: M,
  bufferPages: true,
  info: {
    Title: "Guide de l'inventaire par zones",
    Author: "Quincaillerie Caledonienne",
    Subject:
      "Documentation utilisateur du module Inventaire Zones (application web et collecteur)",
  },
});

const flux = fs.createWriteStream(SORTIE);
doc.pipe(flux);

couverture(doc);

// Pages 2 et 3 : reservees au sommaire, remplies a la fin.
doc.addPage();
doc.addPage();
const PAGES_SOMMAIRE = [1, 2]; // index 0-based dans le buffer

const rendu = new Rendu(doc);
contenu(rendu);

const total = doc.bufferedPageRange().count;
const omises = ecrireSommaire(doc, rendu.sommaire, PAGES_SOMMAIRE);
piedsDePage(doc, total);

doc.flushPages();
doc.end();

flux.on("finish", () => {
  const taille = (fs.statSync(SORTIE).size / 1024).toFixed(0);
  console.log(`PDF genere : ${SORTIE}`);
  console.log(`${total} pages, ${taille} Ko, ${rendu.sommaire.length} entrees de sommaire.`);
  if (omises) {
    console.warn(
      `ATTENTION : ${omises} entree(s) de sommaire n'ont pas tenu sur les ${PAGES_SOMMAIRE.length} pages reservees.`,
    );
  }
});
