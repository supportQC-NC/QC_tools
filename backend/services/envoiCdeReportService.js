// backend/services/envoiCdeReportService.js
//
// Génération des pièces jointes d'une commande fournisseur : un classeur Excel
// et un PDF du détail des lignes. Les deux sont produits EN MÉMOIRE (Buffer)
// afin d'être attachés directement à l'email — aucune écriture disque, donc
// aucune dépendance à un partage réseau (contrairement à l'Access qui déposait
// les fichiers dans un dossier avant de les joindre).
import ExcelJS from "exceljs";

// Colonnes du détail (équivalent de la requête Access rqDetailSelection).
const COLS = [
  { key: "NL", label: "N°", w: 26, align: "center" },
  { key: "NART", label: "CODE", w: 50, align: "left" },
  { key: "DESIGN", label: "DÉSIGNATION", w: 150, align: "left" },
  { key: "DESIFRN", label: "DÉSIGN. FRN", w: 120, align: "left" },
  { key: "REFER", label: "RÉFÉRENCE", w: 78, align: "left" },
  { key: "GENCOD", label: "GENCODE", w: 82, align: "left" },
  { key: "QTE", label: "QTÉ", w: 40, align: "center" },
];

// Formate une date (Date | string DBF AAAAMMJJ) en JJ/MM/AAAA.
export const formatDate = (value) => {
  if (!value) return "";
  let d = null;
  if (value instanceof Date) d = value;
  else if (typeof value === "string" && value.length === 8) {
    d = new Date(
      parseInt(value.slice(0, 4)),
      parseInt(value.slice(4, 6)) - 1,
      parseInt(value.slice(6, 8)),
    );
  } else {
    const p = new Date(value);
    if (!isNaN(p.getTime())) d = p;
  }
  if (!d || isNaN(d.getTime())) return "";
  const jj = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${jj}/${mm}/${d.getFullYear()}`;
};

// Nom de base des fichiers : {TRIG}_order_number_{NUMCDE}_{JJMMAAAA} (comme Access).
export const buildBaseName = (trigramme, numcde, date = new Date()) => {
  const jj = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const stamp = `${jj}${mm}${date.getFullYear()}`;
  const trig = (trigramme || "SOC").toUpperCase();
  return `${trig}_order_number_${String(numcde).trim()}_${stamp}`;
};

const val = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Décode le logo société (base64 data URL) en Buffer pour pdfkit / pièce jointe.
// Renvoie { buffer, ext, contentType } ou null.
export const logoFromEntreprise = (entreprise) => {
  const raw = val(entreprise?.logo);
  const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(raw);
  if (!m) return null;
  try {
    const ext = m[1].toLowerCase().startsWith("jp") ? "jpg" : "png";
    return {
      buffer: Buffer.from(m[2], "base64"),
      ext,
      contentType: ext === "jpg" ? "image/jpeg" : "image/png",
    };
  } catch {
    return null;
  }
};

// Colonnes Excel — reproduit EXACTEMENT la requête Access rqDetailSelection.
const XL_COLS = [
  { key: "NUMCDE", label: "NUMCDE", width: 10 },
  { key: "FOURN", label: "FOURN", width: 8 },
  { key: "NOM", label: "NOM", width: 26 },
  { key: "NART", label: "NART", width: 12 },
  { key: "DESIGN", label: "DESIGN", width: 40 },
  { key: "DESIFRN", label: "DESIFRN", width: 34 },
  { key: "REFER", label: "REFER", width: 16 },
  { key: "GENCOD", label: "GENCOD", width: 16 },
  { key: "QTE", label: "QTE", width: 8 },
  { key: "NL", label: "NL", width: 6 },
  { key: "DATCDE", label: "DATCDE", width: 12 },
  // PACHAT (prix d'achat article) — TOUJOURS en dernière colonne.
  { key: "PACHAT", label: "PACHAT", width: 12 },
];

// ────────────────────────────────────────────────────────────────────────────
// EXCEL — dump du détail de commande (colonnes = rqDetailSelection Access)
// ────────────────────────────────────────────────────────────────────────────
export const genererExcelCommande = async (header, lignes) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Krysto - Envoi Cde Fournisseur";
  workbook.created = new Date();

  const ws = workbook.addWorksheet(`Commande ${val(header.numcde)}`.slice(0, 31), {
    properties: { tabColor: { argb: "FF0066CC" } },
  });
  ws.columns = XL_COLS.map((c) => ({ key: c.key, width: c.width }));

  // En-têtes (ligne 1) — comme un export de requête.
  const headerRow = ws.getRow(1);
  XL_COLS.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF34495E" } };
  });
  headerRow.commit();

  const numcde = val(header.numcde);
  const fourn = header.fournId ?? header.fourn ?? "";
  const nom = val(header.fournNom || header.nom);
  const dat = formatDate(header.datcde);

  // Une ligne par article, colonnes NUMCDE/FOURN/NOM/DATCDE répétées (comme Access).
  let r = 2;
  lignes.forEach((l) => {
    const row = ws.getRow(r);
    row.getCell(1).value = numcde;
    row.getCell(2).value = fourn;
    row.getCell(3).value = nom;
    row.getCell(4).value = val(l.NART);
    row.getCell(5).value = val(l.DESIGN);
    row.getCell(6).value = val(l.DESIFRN);
    row.getCell(7).value = val(l.REFER);
    row.getCell(8).value = val(l.GENCOD);
    row.getCell(9).value = Number(l.QTE) || 0;
    row.getCell(10).value = l.NL ?? "";
    row.getCell(11).value = dat;
    row.getCell(12).value = Number(l.PACHAT) || 0;
    row.commit();
    r += 1;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

// ────────────────────────────────────────────────────────────────────────────
// PDF (buffer en mémoire)
// ────────────────────────────────────────────────────────────────────────────
const fitText = (doc, text, maxWidth) => {
  const str = text == null ? "" : String(text);
  if (!str) return "";
  if (doc.widthOfString(str) <= maxWidth) return str;
  let t = str;
  while (t.length > 1 && doc.widthOfString(t + "…") > maxWidth) t = t.slice(0, -1);
  return t + "…";
};

export const genererPdfCommande = async (header, lignes) => {
  const mod = await import("pdfkit").catch(() => {
    throw new Error("Module 'pdfkit' introuvable. Lancez : npm i pdfkit (backend).");
  });
  const PDFDocument = mod.default;

  const margin = 30;
  const doc = new PDFDocument({ size: "A4", margin });

  // Collecte du PDF en mémoire.
  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = margin;
  const right = doc.page.width - margin;
  const tableWidth = COLS.reduce((s, c) => s + c.w, 0);

  // Logo société en en-tête (comme le report Access : LOGOS\{SOC}.jpg).
  if (header.logo) {
    try {
      doc.image(header.logo, left, margin, { fit: [120, 44] });
    } catch {
      /* logo illisible : ignoré */
    }
  }

  // Titre
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("BON DE COMMANDE FOURNISSEUR", left, margin + 4, {
      width: right - left,
      align: "center",
    });

  let y = margin + 48;

  // Bloc infos (2 colonnes, 3 lignes)
  const infoH = 18;
  const colB = left + (right - left) / 2;
  const halfW = (right - left) / 2;
  const drawInfo = (x, w, label, value) => {
    doc.font("Helvetica-Bold").fontSize(9).text(`${label} :`, x + 4, y + 5, { width: 82 });
    doc
      .font("Helvetica")
      .fontSize(9)
      .text(value || "", x + 88, y + 5, { width: w - 92, lineBreak: false });
  };
  const blocH = infoH * 3;
  doc.rect(left, y, right - left, blocH).stroke();
  doc.moveTo(colB, y).lineTo(colB, y + blocH).stroke();
  doc.moveTo(left, y + infoH).lineTo(right, y + infoH).stroke();
  doc.moveTo(left, y + infoH * 2).lineTo(right, y + infoH * 2).stroke();

  drawInfo(left, halfW, "Société", header.nomSociete);
  drawInfo(colB, halfW, "N° Commande", header.numcde);
  y += infoH;
  drawInfo(left, halfW, "Fournisseur", `${val(header.fournId)} - ${val(header.fournNom)}`);
  drawInfo(colB, halfW, "Date commande", formatDate(header.datcde));
  y += infoH;
  drawInfo(left, halfW, "Bateau", header.bateau);
  drawInfo(colB, halfW, "Nb lignes", String(lignes.length));
  y += infoH + 12;

  const rowH = 16;
  const drawHeader = () => {
    let x = left;
    doc.rect(left, y, tableWidth, rowH).fillAndStroke("#e8e8e8", "#000");
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(7.5);
    COLS.forEach((c) => {
      doc.text(c.label, x + 2, y + 5, { width: c.w - 4, align: c.align, lineBreak: false });
      x += c.w;
    });
    y += rowH;
  };
  const ensureSpace = () => {
    if (y + rowH > doc.page.height - margin - 20) {
      doc.addPage();
      y = margin;
      drawHeader();
      doc.font("Helvetica").fontSize(7.5);
    }
  };

  drawHeader();
  doc.font("Helvetica").fontSize(7.5);

  lignes.forEach((l, idx) => {
    ensureSpace();
    let x = left;
    if (idx % 2 === 1) {
      doc.save();
      doc.rect(left, y, tableWidth, rowH).fill("#f5f8fb");
      doc.restore();
    }
    doc.strokeColor("#999").fillColor("#000");
    COLS.forEach((c) => {
      doc.rect(x, y, c.w, rowH).stroke();
      const raw = l[c.key] === null || l[c.key] === undefined ? "" : String(l[c.key]);
      doc.text(fitText(doc, raw, c.w - 4), x + 2, y + 5, {
        width: c.w - 4,
        align: c.align,
        lineBreak: false,
      });
      x += c.w;
    });
    y += rowH;
  });

  // Pied de page
  ensureSpace();
  y += 6;
  doc
    .font("Helvetica-Oblique")
    .fontSize(8)
    .fillColor("#555")
    .text(
      "Document généré automatiquement — QC Tools · Envoi Commande Fournisseur",
      left,
      y,
      { width: right - left, align: "center" },
    );

  doc.end();
  return done;
};

export default {
  genererExcelCommande,
  genererPdfCommande,
  buildBaseName,
  formatDate,
};
