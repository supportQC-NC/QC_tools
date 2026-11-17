// backend/services/listePrixService.js
//
// LISTE DE PRIX par groupe / famille / sous-famille (module étiquettes,
// demande client du 17/11/2026).
//
// La sélection vient d'ARTPLUS.DBF (compléments article, voir artplusService) :
// l'utilisateur choisit un groupe, puis éventuellement une famille et une
// sous-famille, et obtient un PDF A4 portrait :
//   - en-tête : logo de la société (même résolution que les étiquettes :
//     logo uploadé prioritaire, repli cheminLogoEtiquettes) + le NOM du niveau
//     choisi CENTRÉ (chemin parent en sous-titre) ;
//   - tableau : NART | RÉFÉRENCE | DÉSIGNATION | GENCOD | PRIX TTC
//     (article.dbf : REFER, DESIGN, GENCOD, PVTETTC), trié par désignation ;
//   - pied de page : date de génération EN BAS À DROITE (chaque page).
//
// ⚠️ Une société SANS artplus.dbf (ou sans attributs groupe/famille/ss-famille)
// n'a pas cette fonctionnalité : l'écran la grise via le même
// `getClassement().disponible` que l'API partenaire. Les articles RENVOYÉS
// (GENDOUBL rempli) sont écartés : leur fiche active porte le prix.
import fs from "fs";
import artplusService from "./artplusService.js";
import articleCacheService from "./articleService.js";
import { resolveLogoBuffer } from "./etiquetteService.js";

const safeTrim = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Article vendu AU MÈTRE : par convention ERP, sa DÉSIGNATION se termine par
// « AU M » — ou ses variantes « AU ML » / « LE M » — ou COMMENCE par « M »
// suivi d'un espace (« M CHAINE GALVA… », « M CABLE ELECT… »), toutes incluses
// à la demande du client (18/11/2026 — pouvoir n'imprimer que ceux-là).
// « AU »/« LE » doivent être des mots entiers : « …NIVEAU M » ou
// « …SIGMA LEM » ne comptent pas. « /M » reste EXCLU : presque que des faux
// amis (« 100% COTON 190Gr/m »).
const estVenduAuMetre = (design) => {
  const d = safeTrim(design);
  return /^M\s/i.test(d) || /(^|\s)(AU\s+ML?|LE\s+M)\.?$/i.test(d);
};

// Montants XPF : entiers, séparateur de milliers = espace (rendu PDF sûr).
const fmtXpf = (n) => {
  const r = Math.round(Number(n) || 0);
  return `${r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} XPF`;
};

/**
 * Articles d'un groupe / famille / sous-famille, prêts pour la liste de prix.
 * Les trois filtres se CUMULENT (famille dans le groupe, sous-famille dans la
 * famille) : deux familles homonymes de groupes différents ne se mélangent pas.
 * `auMetre` restreint en plus aux articles vendus au mètre (DESIGN terminé par
 * « AU M »).
 * @returns {Promise<Array<{nart, refer, design, gencod, prix}>>}
 */
export const construireLignesListePrix = async (
  entreprise,
  { groupe = "", famille = "", sousFamille = "", auMetre = false },
) => {
  const index = await artplusService.getIndex(entreprise);
  if (!index.present) {
    const err = new Error(
      "artplus.dbf indisponible pour cette société : la liste de prix ne peut pas être générée.",
    );
    err.status = 400;
    throw err;
  }
  const { roles, parNart } = index;
  const g = safeTrim(groupe);
  const f = safeTrim(famille);
  const sf = safeTrim(sousFamille);
  if (!g && !f && !sf) {
    const err = new Error("Choisissez au moins un groupe, une famille ou une sous-famille.");
    err.status = 400;
    throw err;
  }

  const narts = [];
  for (const [nart, attrs] of parNart) {
    if (g && safeTrim(roles.groupe ? attrs[roles.groupe] : "") !== g) continue;
    if (f && safeTrim(roles.famille ? attrs[roles.famille] : "") !== f) continue;
    if (sf && safeTrim(roles.sousFamille ? attrs[roles.sousFamille] : "") !== sf)
      continue;
    narts.push(nart);
  }

  const cache = await articleCacheService.getArticles(entreprise);
  const rows = [];
  for (const nart of narts) {
    const idx = articleCacheService.lookupNart(cache, nart);
    if (idx === undefined) continue;
    const rec = cache.records[idx];
    if (!rec) continue;
    // Fiche renvoyée : la fiche ACTIVE porte le prix, pas celle-ci.
    if (safeTrim(rec.GENDOUBL)) continue;
    if (auMetre && !estVenduAuMetre(rec.DESIGN)) continue;
    rows.push({
      nart: safeTrim(rec.NART),
      refer: safeTrim(rec.REFER),
      design: safeTrim(rec.DESIGN),
      gencod: safeTrim(rec.GENCOD),
      prix: Number(rec.PVTETTC) || 0,
    });
  }

  rows.sort(
    (a, b) =>
      a.design.localeCompare(b.design, "fr") || a.nart.localeCompare(b.nart, "fr"),
  );
  return rows;
};

/**
 * Écrit le PDF de la liste de prix.
 * `titre` = le nom du niveau choisi (centré) ; `sousTitre` = le chemin parent
 * (« GROUPE › FAMILLE »), vide pour un groupe ; `mention` = ligne centrée
 * supplémentaire (« Articles vendus au mètre »), vide sans filtre.
 */
export const ecrirePdfListePrix = async ({
  entreprise,
  titre,
  sousTitre,
  mention = "",
  rows,
  outPath,
}) => {
  const mod = await import("pdfkit").catch(() => {
    throw new Error("Module 'pdfkit' introuvable. Lancez : npm i pdfkit (backend).");
  });
  const PDFDocument = mod.default;

  const margin = 36;
  // `bufferPages` : la pagination « n/N » (demande client du 18/11/2026) exige
  // de connaître le nombre TOTAL de pages — les pieds de page sont donc posés
  // en une dernière passe, une fois toutes les lignes écrites.
  const doc = new PDFDocument({
    size: "A4",
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

  // ⚠️ Somme des largeurs = 523 pt (A4 595,28 − 2 × 36).
  const COLS = [
    { key: "nart", label: "NART", w: 55, align: "left" },
    { key: "refer", label: "RÉFÉRENCE", w: 95, align: "left" },
    { key: "design", label: "DÉSIGNATION", w: 225, align: "left" },
    { key: "gencod", label: "GENCOD", w: 80, align: "left" },
    { key: "prixFmt", label: "PRIX TTC", w: 68, align: "right" },
  ];
  const left = margin;
  const tableW = COLS.reduce((s, c) => s + c.w, 0);
  const rowH = 15;

  const fitText = (text, maxWidth) => {
    const str = text == null ? "" : String(text);
    if (!str) return "";
    if (doc.widthOfString(str) <= maxWidth) return str;
    let t = str;
    while (t.length > 1 && doc.widthOfString(t + "…") > maxWidth) t = t.slice(0, -1);
    return t + "…";
  };

  let y = margin;

  // En-tête de la PREMIÈRE page : logo + titre centré + sous-titre(s).
  // Le sous-titre (chemin parent) et la mention (« Articles vendus au mètre »)
  // sont DEUX lignes centrées distinctes : concaténés, la ligne débordait sur
  // le logo (demande client du 18/11/2026).
  const drawEnTete = () => {
    if (logoBuf) {
      try {
        doc.image(logoBuf, left, y, { fit: [120, 60] });
      } catch {
        /* logo illisible : on continue sans */
      }
    }
    const lignesSousTitre = [sousTitre, mention].filter(Boolean);
    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor("#000")
      .text(titre || "Liste de prix", left, y + (lignesSousTitre.length ? 6 : 20), {
        width: tableW,
        align: "center",
      });
    doc.font("Helvetica").fontSize(10).fillColor("#555");
    lignesSousTitre.forEach((ligne, i) => {
      doc.text(ligne, left, y + 34 + i * 14, { width: tableW, align: "center" });
    });
    doc.fillColor("#000");
    y += lignesSousTitre.length > 1 ? 84 : 72;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#666")
      .text(`${rows.length} article${rows.length > 1 ? "s" : ""}`, left, y, {
        width: tableW,
        align: "right",
        lineBreak: false,
      })
      .fillColor("#000");
    y += 12;
  };

  const drawHeaderRow = () => {
    let x = left;
    doc.rect(left, y, tableW, rowH).fillAndStroke("#333", "#333");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8);
    COLS.forEach((c) => {
      doc.text(c.label, x + 3, y + 4, { width: c.w - 6, align: c.align });
      x += c.w;
    });
    doc.fillColor("#000");
    y += rowH;
  };

  const nouvellePage = () => {
    doc.addPage();
    y = margin;
    // Le logo est RAPPELÉ sur chaque page (demande client du 18/11/2026),
    // en plus petit que sur la page de titre.
    if (logoBuf) {
      try {
        doc.image(logoBuf, left, y, { fit: [90, 36] });
        y += 44;
      } catch {
        /* logo illisible : on continue sans */
      }
    }
  };

  doc.addPage();
  drawEnTete();
  drawHeaderRow();

  rows.forEach((r, i) => {
    if (y + rowH > doc.page.height - margin - 14) {
      nouvellePage();
      drawHeaderRow();
    }
    // Zébrage une ligne sur deux : la liste se lit en rayon, loin de l'écran.
    if (i % 2) {
      doc.save();
      doc.rect(left, y, tableW, rowH).fill("#f2f2f2");
      doc.restore();
    }
    let x = left;
    doc.strokeColor("#ccc");
    doc.font("Helvetica").fontSize(8).fillColor("#000");
    const vals = { ...r, prixFmt: fmtXpf(r.prix) };
    COLS.forEach((c) => {
      doc.rect(x, y, c.w, rowH).stroke();
      doc.text(fitText(String(vals[c.key] ?? ""), c.w - 6), x + 3, y + 4, {
        width: c.w - 6,
        align: c.align,
        lineBreak: false,
      });
      x += c.w;
    });
    y += rowH;
  });

  // Pieds de page en DERNIÈRE passe (bufferPages) : numéro « n/N » en bas à
  // GAUCHE, date de génération en bas à droite — le total de pages n'est
  // connu qu'ici.
  // ⚠️ Écrire SOUS la marge basse fait créer une page AUTOMATIQUE à pdfkit
  // (le pied sortait en haut d'une page blanche) : on annule la marge basse le
  // temps d'écrire, puis on la restaure.
  const pages = doc.bufferedPageRange();
  for (let p = pages.start; p < pages.start + pages.count; p++) {
    doc.switchToPage(p);
    const margeBasse = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor("#666");
    doc.text(`${p + 1}/${pages.count}`, left, doc.page.height - 26, {
      lineBreak: false,
    });
    doc.text(`Généré le ${dateGen}`, left, doc.page.height - 26, {
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

export default { construireLignesListePrix, ecrirePdfListePrix };
