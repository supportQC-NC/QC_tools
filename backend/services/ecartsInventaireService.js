// backend/services/ecartsInventaireService.js
//
// FEUILLE D'ÉCARTS — générateur commun à deux écrans.
//
// L'« inventaire proforma » et le « détail des bipages » posent la même
// question : pour chaque article, quel écart entre la quantité comptée et le
// stock théorique, et combien ça pèse en francs. Seule la SOURCE du comptage
// diffère (lignes de proformas d'un côté, LigneBipage de la session de
// l'autre) ; le regroupement (famille / fournisseur), le seuil, la mise en page
// PDF et le classeur Excel sont identiques.
//
// Ce module porte donc la partie commune, extraite du contrôleur inventaire
// proforma le 09/09/2026. ⚠️ Toute évolution de mise en page vaut pour les DEUX
// écrans : c'est voulu, le client veut « exactement les mêmes fichiers ».
//
// L'appelant fournit des `rows` déjà calculées :
//   { nart, design, refer, gencod, fourn, fournNom, stock, qte, diff, diffval,
//     att, detail? }
import fs from "fs";

/** Formatage entier avec séparateur de milliers = espace simple (rendu PDF OK). */
export const fmtNum = (n) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const r = Math.round(n);
  const sign = r < 0 ? "-" : "";
  return sign + Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};

/**
 * QUANTITÉS (stock, qté, diff) : les décimales sont CONSERVÉES (3 max, virgule
 * française) — articles vendus au mètre, « 1,5 » ne doit pas sortir « 2 »
 * (constaté le 29/10/2026 sur la fiche de contrôle). Un entier s'affiche
 * exactement comme avec fmtNum ; les montants XPF restent sur fmtNum.
 */
export const fmtQteDoc = (n) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const r = Math.round(n * 1000) / 1000;
  const abs = Math.abs(r);
  const ent = Math.trunc(abs);
  const entStr = ent.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const frac = Math.round((abs - ent) * 1000) / 1000;
  const fracStr = frac ? String(frac).slice(1).replace(".", ",") : "";
  return (r < 0 ? "-" : "") + entStr + fracStr;
};

/** Dessine le document d'inventaire (PDF paysage, table groupée). */
export const dessinerDocInventaire = async ({
  titre,
  groupes,
  grandTotal,
  groupLabel,
  outPath,
}) => {
  const mod = await import("pdfkit").catch(() => {
    throw new Error("Module 'pdfkit' introuvable. Lancez : npm i pdfkit");
  });
  const PDFDocument = mod.default;

  const margin = 24;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const left = margin;
  const pageRight = doc.page.width - margin;
  const pageBottom = doc.page.height - margin;

  // STOCK FIGÉ + STOCK LIVE (16/11/2026) : quand les lignes portent
  // `stockLive` (écarts bipage avec stock figé actif), la colonne STOCK
  // devient « STOCK FIGÉ » (la référence du calcul d'écart) et une colonne
  // indicative « STOCK LIVE » (le stock réel, qui continue de bouger avec les
  // ventes) s'intercale. DÉSIGNATION et FOURNISSEUR cèdent la largeur
  // nécessaire ; sans `stockLive` (écran proforma, bipage non figé), la mise
  // en page historique est inchangée.
  const avecLive = groupes.some((g) =>
    (g.rows || []).some((r) => r.stockLive !== undefined),
  );
  const COLS = [
    { key: "nart", label: "NART", w: 40, align: "left" },
    { key: "att", label: "ATT", w: 26, align: "center" },
    { key: "design", label: "DÉSIGNATION", w: avecLive ? 180 : 196, align: "left" },
    { key: "refer", label: "RÉFÉRENCE", w: 70, align: "left" },
    { key: "gencod", label: "GENCODE", w: 66, align: "left" },
    { key: "fourn", label: "FOURN.", w: 30, align: "left" },
    { key: "fournNom", label: "FOURNISSEUR", w: avecLive ? 68 : 78, align: "left" },
    { key: "stock", label: avecLive ? "STOCK FIGÉ" : "STOCK", w: 44, align: "right" },
    ...(avecLive
      ? [{ key: "stockLive", label: "STOCK LIVE", w: 44, align: "right" }]
      : []),
    { key: "qte", label: "QTÉ", w: 44, align: "right" },
    { key: "diff", label: "DIFF", w: 46, align: "right" },
    { key: "diffval", label: "DIFF (XPF)", w: 74, align: "right" },
    { key: "ctl", label: "QTÉ CONTRÔLÉE", w: 62, align: "center" },
  ];
  const tableW = COLS.reduce((a, c) => a + c.w, 0);
  const tableRight = left + tableW;
  const ctlW = COLS[COLS.length - 1].w;
  const diffvalW = COLS.find((c) => c.key === "diffval").w;
  const diffvalX = tableRight - ctlW - diffvalW;

  const fit = (text, w) => {
    const s = text == null ? "" : String(text);
    if (doc.widthOfString(s) <= w - 4) return s;
    let t = s;
    while (t.length > 1 && doc.widthOfString(t + "…") > w - 4) t = t.slice(0, -1);
    return t + "…";
  };

  let y = margin;

  const drawHeaderRow = () => {
    const h = 16;
    let x = left;
    doc.rect(left, y, tableW, h).fillAndStroke("#333", "#333");
    doc.fillColor("#fff").font("Helvetica-Bold").fontSize(8);
    COLS.forEach((c) => {
      doc.text(c.label, x + 2, y + 4, { width: c.w - 4, align: c.align });
      x += c.w;
    });
    doc.fillColor("#000");
    y += h;
  };

  const ensureSpace = (need) => {
    if (y + need > pageBottom) {
      doc.addPage();
      y = margin;
      drawHeaderRow();
    }
  };

  // Titre
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text(titre, left, y);
  y += 18;
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#444")
    .text(`Généré le ${new Date().toLocaleString("fr-FR")}`, left, y);
  y += 14;
  doc.fillColor("#000");

  drawHeaderRow();

  for (const g of groupes) {
    // En-tête de groupe
    ensureSpace(16 + 13);
    doc.rect(left, y, tableW, 16).fillAndStroke("#d9d9d9", "#999");
    doc
      .fillColor("#000")
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(
        `${groupLabel} ${g.key}${g.nom ? " — " + g.nom : ""} (${g.rows.length})`,
        left + 4,
        y + 4,
        {
          width: tableW - 8,
        },
      );
    y += 16;

    // Lignes
    for (const r of g.rows) {
      const h = 13;
      ensureSpace(h);
      let x = left;
      doc.strokeColor("#ccc");
      COLS.forEach((c) => {
        doc.rect(x, y, c.w, h).stroke();
        let val = r[c.key];
        if (["stock", "stockLive", "qte", "diff", "diffval"].includes(c.key)) {
          const num = r[c.key];
          // diffval = XPF (entier) ; les quantités gardent leurs décimales.
          val = c.key === "diffval" ? fmtNum(num) : fmtQteDoc(num);
          doc.font("Helvetica").fontSize(7.5);
          if ((c.key === "diff" || c.key === "diffval") && Number.isFinite(num)) {
            doc.fillColor(num > 0 ? "#067d06" : num < 0 ? "#c00" : "#000");
          } else doc.fillColor("#000");
        } else if (c.key === "att" && val) {
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#c00");
        } else {
          doc.font("Helvetica").fontSize(7.5).fillColor("#000");
        }
        doc.text(fit(val == null ? "" : String(val), c.w), x + 2, y + 3, {
          width: c.w - 4,
          align: c.align,
        });
        x += c.w;
      });
      y += h;

      // Sous-lignes "bipé où / combien" (articles sur ≥ 2 proformas)
      if (Array.isArray(r.detail) && r.detail.length) {
        for (const d of r.detail) {
          const sh = 12;
          ensureSpace(sh);
          // Les sous-lignes proforma portent un numéro de document ; celles
          // des gisements bipés n'en ont pas — pas de parenthèses vides.
          const sub = {
            nart: "",
            att: "",
            design: `   ↳ ${d.texte ? d.texte + " " : ""}${d.numfact ? `(${d.numfact})` : ""}`.trimEnd(),
            refer: "",
            gencod: "",
            fourn: "",
            fournNom: "",
            stock: "",
            stockLive: "",
            qte: d.qte,
            diff: "",
            diffval: "",
            ctl: "",
          };
          doc.save();
          doc.rect(left, y, tableW, sh).fill("#f4f1fb");
          doc.restore();
          let xs = left;
          doc.font("Helvetica-Oblique").fontSize(7).fillColor("#555");
          doc.strokeColor("#ddd");
          COLS.forEach((c) => {
            doc.rect(xs, y, c.w, sh).stroke();
            let val = sub[c.key];
            if (["stock", "qte"].includes(c.key)) {
              val = val === "" ? "" : fmtQteDoc(val);
            }
            doc.text(fit(val == null ? "" : String(val), c.w), xs + 2, y + 3, {
              width: c.w - 4,
              align: c.align,
            });
            xs += c.w;
          });
          y += sh;
        }
        doc.fillColor("#000");
      }
    }

    // Sous-total groupe
    ensureSpace(14);
    doc.rect(left, y, tableW, 14).fillAndStroke("#eee", "#999");
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("#000")
      .text(`Sous-total ${groupLabel} ${g.key}`, left + 4, y + 4, {
        width: tableW - 100,
      });
    doc
      .fillColor(g.subtotal > 0 ? "#067d06" : g.subtotal < 0 ? "#c00" : "#000")
      .text(
        `${g.subtotal > 0 ? "+" : ""}${fmtNum(g.subtotal)} XPF`,
        diffvalX,
        y + 4,
        { width: diffvalW, align: "right" },
      );
    y += 14;
  }

  // Total général
  ensureSpace(18);
  doc.rect(left, y, tableW, 18).fillAndStroke("#333", "#333");
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .fillColor("#fff")
    .text("TOTAL GÉNÉRAL", left + 4, y + 5, { width: tableW - 110 });
  doc.text(
    `${grandTotal > 0 ? "+" : ""}${fmtNum(grandTotal)} XPF`,
    diffvalX,
    y + 5,
    { width: diffvalW, align: "right" },
  );
  y += 22;

  ensureSpace(14);
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#555")
    .text(
      "ATT : D = doublon (NART présent ≥ 2 fois sur la même proforma) | XX = quantité excédentaire (qté > stock) | C = quantité corrigée après bipage",
      left,
      y,
      { width: tableW },
    );
  doc.fillColor("#000");

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
};


/**
 * Regroupe les lignes d'écart par famille (2 premiers caractères du NART) ou
 * par fournisseur, avec sous-totaux et total général.
 * `ordre` : tri DANS chaque groupe — "nart" (historique, défaut) ou "design"
 * (désignation alphabétique, demande client du 16/11/2026 ; le NART départage
 * les désignations identiques pour un ordre stable).
 * @returns { groupes, grandTotal, groupLabel }
 */
// Regroupements ARTPLUS (17/11/2026, écarts bipage seulement) : l'appelant a
// pré-rempli `r.artplusKey` (valeur de l'attribut groupe/famille/ss-famille de
// l'article) — ce service n'ouvre jamais artplus lui-même.
const LABELS_ARTPLUS = {
  ap_groupe: "Groupe",
  ap_famille: "Famille",
  ap_sousfamille: "Sous-famille",
};

export const grouperEcarts = (rows, groupBy, ordre = "nart") => {
  const parFournisseur = groupBy === "fournisseur";
  const parArtplus = Object.prototype.hasOwnProperty.call(
    LABELS_ARTPLUS,
    groupBy,
  );
  const keyOf = (r) =>
    parArtplus
      ? r.artplusKey || "(non classé)"
      : parFournisseur
        ? r.fourn || "—"
        : (r.nart || "").slice(0, 2) || "—";

  const groupsMap = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groupsMap.has(k))
      groupsMap.set(k, {
        key: k,
        nom: parFournisseur ? r.fournNom || "" : "",
        rows: [],
        subtotal: 0,
      });
    const g = groupsMap.get(k);
    g.rows.push(r);
    g.subtotal += r.diffval;
  }

  const groupes = [...groupsMap.values()].sort((a, b) =>
    String(a.key).localeCompare(String(b.key), "fr", { numeric: true }),
  );
  const parNart = (a, b) => (a.nart || "").localeCompare(b.nart || "", "fr");
  const parDesign = (a, b) =>
    (a.design || "").localeCompare(b.design || "", "fr") || parNart(a, b);
  groupes.forEach((g) =>
    g.rows.sort(ordre === "design" ? parDesign : parNart),
  );

  return {
    groupes,
    grandTotal: rows.reduce((a, r) => a + r.diffval, 0),
    groupLabel: parArtplus
      ? LABELS_ARTPLUS[groupBy]
      : parFournisseur
        ? "Fournisseur"
        : "Famille",
  };
};

/**
 * Classeur Excel de la feuille d'écarts. L'appelant l'envoie lui-même (via
 * `envoyerClasseur`, qui applique les droits « champ par champ »).
 */
export const construireClasseurEcarts = async ({
  titre,
  groupes,
  grandTotal,
  groupLabel,
}) => {
  const ExcelMod = await import("exceljs").catch(() => {
    throw new Error("Module 'exceljs' introuvable. Lancez : npm i exceljs");
  });
  const ExcelJS = ExcelMod.default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Inventaire");

  // Même règle que le PDF : la colonne « STOCK LIVE » n'existe que si les
  // lignes portent `stockLive` (écarts bipage avec stock figé actif) ; la
  // colonne STOCK s'intitule alors « STOCK FIGÉ ». Les indices de cellule
  // suivent la liste (plus aucun numéro en dur : insérer une colonne ne doit
  // jamais décaler silencieusement les autres).
  const avecLive = groupes.some((g) =>
    (g.rows || []).some((r) => r.stockLive !== undefined),
  );
  const COLONNES = [
    { key: "nart", header: "NART", width: 12 },
    { key: "att", header: "ATT", width: 7 },
    { key: "design", header: "DÉSIGNATION", width: 40 },
    { key: "refer", header: "RÉFÉRENCE", width: 16 },
    { key: "gencod", header: "GENCODE", width: 16 },
    { key: "fourn", header: "FOURN.", width: 8 },
    { key: "fournNom", header: "FOURNISSEUR", width: 28 },
    { key: "stock", header: avecLive ? "STOCK FIGÉ" : "STOCK", width: 10 },
    ...(avecLive
      ? [{ key: "stockLive", header: "STOCK LIVE", width: 10 }]
      : []),
    { key: "qte", header: "QTÉ", width: 10 },
    { key: "diff", header: "DIFF", width: 10 },
    { key: "diffval", header: "DIFF (XPF)", width: 16 },
    { key: "ctl", header: "QTÉ CONTRÔLÉE", width: 16 },
  ];
  const nbCols = COLONNES.length;
  // Indice de cellule (1-based) d'une colonne par sa clé.
  const col = (key) => COLONNES.findIndex((c) => c.key === key) + 1;

  ws.columns = COLONNES.map(({ key, width }) => ({ key, width }));

  ws.mergeCells(1, 1, 1, nbCols);
  const tcell = ws.getCell(1, 1);
  tcell.value = titre;
  tcell.font = { bold: true, size: 13 };
  const dcell = ws.getCell(2, 1);
  dcell.value = `Généré le ${new Date().toLocaleString("fr-FR")}`;
  dcell.font = { size: 9, color: { argb: "FF666666" } };

  const numFmt = "#,##0"; // montants XPF (diffval)
  // Quantités : décimales affichées quand il y en a (articles au mètre),
  // entiers inchangés.
  const numFmtQte = "#,##0.###";
  const fontColor = (v) =>
    v > 0
      ? { argb: "FF067D06" }
      : v < 0
        ? { argb: "FFCC0000" }
        : { argb: "FF000000" };

  let rownum = 4;
  const hr = ws.getRow(rownum);
  COLONNES.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF333333" },
    };
    cell.alignment = { horizontal: i + 1 >= col("stock") ? "right" : "left" };
  });
  rownum++;

  for (const g of groupes) {
    ws.mergeCells(rownum, 1, rownum, nbCols);
    const gc = ws.getCell(rownum, 1);
    gc.value = `${groupLabel} ${g.key}${g.nom ? " — " + g.nom : ""} (${g.rows.length})`;
    gc.font = { bold: true };
    gc.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD9D9D9" },
    };
    rownum++;

    for (const r of g.rows) {
      const row = ws.getRow(rownum);
      row.getCell(col("nart")).value = r.nart;
      const ac = row.getCell(col("att"));
      ac.value = r.att;
      if (r.att)
        ac.font = { bold: true, color: { argb: "FFCC0000" } };
      ac.alignment = { horizontal: "center" };
      row.getCell(col("design")).value = r.design;
      row.getCell(col("refer")).value = r.refer;
      row.getCell(col("gencod")).value = r.gencod;
      row.getCell(col("fourn")).value = r.fourn;
      row.getCell(col("fournNom")).value = r.fournNom;
      const sc = row.getCell(col("stock"));
      sc.value = r.stock;
      sc.numFmt = numFmtQte;
      if (avecLive) {
        const lc = row.getCell(col("stockLive"));
        lc.value = r.stockLive;
        lc.numFmt = numFmtQte;
      }
      const qc = row.getCell(col("qte"));
      qc.value = r.qte;
      qc.numFmt = numFmtQte;
      const dc = row.getCell(col("diff"));
      dc.value = r.diff;
      dc.numFmt = numFmtQte;
      dc.font = { color: fontColor(r.diff) };
      const vc = row.getCell(col("diffval"));
      vc.value = r.diffval;
      vc.numFmt = numFmt;
      vc.font = { color: fontColor(r.diffval) };
      rownum++;

      if (Array.isArray(r.detail) && r.detail.length) {
        for (const d of r.detail) {
          const dr = ws.getRow(rownum);
          dr.getCell(col("design")).value =
            `   ↳ ${d.texte ? d.texte + " " : ""}${d.numfact ? `(${d.numfact})` : ""}`.trimEnd();
          const dq = dr.getCell(col("qte"));
          dq.value = d.qte;
          dq.numFmt = numFmtQte;
          for (let i = 1; i <= nbCols; i++) {
            dr.getCell(i).font = {
              italic: true,
              size: 9,
              color: { argb: "FF666666" },
            };
            dr.getCell(i).fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: "FFF4F1FB" },
            };
          }
          rownum++;
        }
      }
    }

    const sr = ws.getRow(rownum);
    sr.getCell(1).value = `Sous-total ${groupLabel} ${g.key}`;
    for (let i = 1; i <= nbCols; i++) {
      sr.getCell(i).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFEFEF" },
      };
      sr.getCell(i).font = { bold: true };
    }
    const stc = sr.getCell(col("diffval"));
    stc.value = g.subtotal;
    stc.numFmt = numFmt;
    stc.font = { bold: true, color: fontColor(g.subtotal) };
    rownum++;
  }

  const tr = ws.getRow(rownum);
  tr.getCell(1).value = "TOTAL GÉNÉRAL";
  for (let i = 1; i <= nbCols; i++) {
    tr.getCell(i).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF333333" },
    };
    tr.getCell(i).font = { bold: true, color: { argb: "FFFFFFFF" } };
  }
  const gtc = tr.getCell(col("diffval"));
  gtc.value = grandTotal;
  gtc.numFmt = numFmt;


  return wb;
};
