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

  const COLS = [
    { key: "nart", label: "NART", w: 40, align: "left" },
    { key: "att", label: "ATT", w: 26, align: "center" },
    { key: "design", label: "DÉSIGNATION", w: 196, align: "left" },
    { key: "refer", label: "RÉFÉRENCE", w: 70, align: "left" },
    { key: "gencod", label: "GENCODE", w: 66, align: "left" },
    { key: "fourn", label: "FOURN.", w: 30, align: "left" },
    { key: "fournNom", label: "FOURNISSEUR", w: 78, align: "left" },
    { key: "stock", label: "STOCK", w: 44, align: "right" },
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
        if (["stock", "qte", "diff", "diffval"].includes(c.key)) {
          const num = r[c.key];
          val = fmtNum(num);
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
          const sub = {
            nart: "",
            att: "",
            design: `   ↳ ${d.texte ? d.texte + " " : ""}(${d.numfact})`,
            refer: "",
            gencod: "",
            fourn: "",
            fournNom: "",
            stock: "",
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
              val = val === "" ? "" : fmtNum(val);
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
      "ATT : D = doublon (NART présent ≥ 2 fois sur la même proforma) | XX = quantité excédentaire (qté > stock)",
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
 * @returns { groupes, grandTotal, groupLabel }
 */
export const grouperEcarts = (rows, groupBy) => {
  const parFournisseur = groupBy === "fournisseur";
  const keyOf = (r) =>
    parFournisseur ? r.fourn || "—" : (r.nart || "").slice(0, 2) || "—";

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
  groupes.forEach((g) =>
    g.rows.sort((a, b) => (a.nart || "").localeCompare(b.nart || "", "fr")),
  );

  return {
    groupes,
    grandTotal: rows.reduce((a, r) => a + r.diffval, 0),
    groupLabel: parFournisseur ? "Fournisseur" : "Famille",
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

  ws.columns = [
    { key: "nart", width: 12 },
    { key: "att", width: 7 },
    { key: "design", width: 40 },
    { key: "refer", width: 16 },
    { key: "gencod", width: 16 },
    { key: "fourn", width: 8 },
    { key: "fournNom", width: 28 },
    { key: "stock", width: 10 },
    { key: "qte", width: 10 },
    { key: "diff", width: 10 },
    { key: "diffval", width: 16 },
    { key: "ctl", width: 16 },
  ];

  ws.mergeCells(1, 1, 1, 12);
  const tcell = ws.getCell(1, 1);
  tcell.value = titre;
  tcell.font = { bold: true, size: 13 };
  const dcell = ws.getCell(2, 1);
  dcell.value = `Généré le ${new Date().toLocaleString("fr-FR")}`;
  dcell.font = { size: 9, color: { argb: "FF666666" } };

  const numFmt = "#,##0";
  const fontColor = (v) =>
    v > 0
      ? { argb: "FF067D06" }
      : v < 0
        ? { argb: "FFCC0000" }
        : { argb: "FF000000" };

  let rownum = 4;
  const headers = [
    "NART",
    "ATT",
    "DÉSIGNATION",
    "RÉFÉRENCE",
    "GENCODE",
    "FOURN.",
    "FOURNISSEUR",
    "STOCK",
    "QTÉ",
    "DIFF",
    "DIFF (XPF)",
    "QTÉ CONTRÔLÉE",
  ];
  const hr = ws.getRow(rownum);
  headers.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF333333" },
    };
    c.alignment = { horizontal: i >= 7 ? "right" : "left" };
  });
  rownum++;

  for (const g of groupes) {
    ws.mergeCells(rownum, 1, rownum, 12);
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
      row.getCell(1).value = r.nart;
      const ac = row.getCell(2);
      ac.value = r.att;
      if (r.att)
        ac.font = { bold: true, color: { argb: "FFCC0000" } };
      ac.alignment = { horizontal: "center" };
      row.getCell(3).value = r.design;
      row.getCell(4).value = r.refer;
      row.getCell(5).value = r.gencod;
      row.getCell(6).value = r.fourn;
      row.getCell(7).value = r.fournNom;
      const sc = row.getCell(8);
      sc.value = r.stock;
      sc.numFmt = numFmt;
      const qc = row.getCell(9);
      qc.value = r.qte;
      qc.numFmt = numFmt;
      const dc = row.getCell(10);
      dc.value = r.diff;
      dc.numFmt = numFmt;
      dc.font = { color: fontColor(r.diff) };
      const vc = row.getCell(11);
      vc.value = r.diffval;
      vc.numFmt = numFmt;
      vc.font = { color: fontColor(r.diffval) };
      rownum++;

      if (Array.isArray(r.detail) && r.detail.length) {
        for (const d of r.detail) {
          const dr = ws.getRow(rownum);
          dr.getCell(3).value = `   ↳ ${d.texte ? d.texte + " " : ""}(${d.numfact})`;
          const dq = dr.getCell(9);
          dq.value = d.qte;
          dq.numFmt = numFmt;
          for (let i = 1; i <= 12; i++) {
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
    for (let i = 1; i <= 12; i++) {
      sr.getCell(i).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFEFEF" },
      };
      sr.getCell(i).font = { bold: true };
    }
    const stc = sr.getCell(11);
    stc.value = g.subtotal;
    stc.numFmt = numFmt;
    stc.font = { bold: true, color: fontColor(g.subtotal) };
    rownum++;
  }

  const tr = ws.getRow(rownum);
  tr.getCell(1).value = "TOTAL GÉNÉRAL";
  for (let i = 1; i <= 12; i++) {
    tr.getCell(i).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF333333" },
    };
    tr.getCell(i).font = { bold: true, color: { argb: "FFFFFFFF" } };
  }
  const gtc = tr.getCell(11);
  gtc.value = grandTotal;
  gtc.numFmt = numFmt;


  return wb;
};
