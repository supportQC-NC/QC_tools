// backend/services/ficheControleService.js
import fs from "fs";
import path from "path";
import articleCacheService from "./articleService.js";

// ===========================================
// CONFIG (.env, avec valeurs par défaut)
// ===========================================
export const config = {
  // Partage réseau où le collecteur dépose les .DAT
  sharePath: process.env.STOCK_SHARE_PATH || "\\\\192.168.0.250\\Rcommun\\STOCK",
  // Préfixe des fichiers : "stock.dat_<codeZone>"
  datPrefix: process.env.DAT_FILENAME_PREFIX || "stock.dat_",
  // Détection tolérante : "stock.dat" ou "stock_dat", séparateur . _ ou espace,
  // extension .dat optionnelle. Le groupe 1 = code zone.
  filenameRegex: process.env.DAT_FILENAME_REGEX
    ? new RegExp(process.env.DAT_FILENAME_REGEX, "i")
    : /^stock[._]dat[._\s]*(.+?)(?:\.dat)?$/i,
  // Imprimante (vide = imprimante par défaut)
  printerName: process.env.PRINTER_NAME || "",
  // Intervalle de surveillance (ms)
  watchIntervalMs: parseInt(process.env.FICHE_WATCH_INTERVAL_MS || "5000", 10),
  // Impression automatique
  autoprint:
    (process.env.FICHE_AUTOPRINT || "true").toLowerCase() !== "false",
  // Dossiers dédiés (créés automatiquement à l'init)
  archiveDatDirName: "archive_dat", // .DAT traités/imprimés
  archivePdfDirName: "archive_pdf", // fiches PDF imprimées
  zoneInconnueDirName: "zone_non_trouvee", // .DAT dont la zone est inconnue
};

// ===========================================
// DOSSIERS
// ===========================================

/** Nettoie un nom pour en faire un nom de dossier Windows valide. */
export const sanitizeName = (nom) =>
  String(nom || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "inventaire";

/** Renvoie les chemins des dossiers d'un inventaire. */
export const getInventaireDirs = (nom) => {
  const base = path.join(config.sharePath, sanitizeName(nom));
  return {
    base,
    archiveDat: path.join(base, config.archiveDatDirName),
    archivePdf: path.join(base, config.archivePdfDirName),
    zoneInconnue: path.join(base, config.zoneInconnueDirName),
  };
};

/** Crée (récursivement) tous les dossiers de l'inventaire. */
export const ensureInventaireDirs = (nom) => {
  const dirs = getInventaireDirs(nom);
  fs.mkdirSync(dirs.base, { recursive: true });
  fs.mkdirSync(dirs.archiveDat, { recursive: true });
  fs.mkdirSync(dirs.archivePdf, { recursive: true });
  fs.mkdirSync(dirs.zoneInconnue, { recursive: true });
  return dirs;
};

/** Extrait le code zone d'un nom de fichier "stock.dat_<code>[.dat]". */
export const extraireCodeZone = (fileName) => {
  const m = fileName.match(config.filenameRegex);
  return m && m[1] ? m[1].trim() : null;
};

/** Vrai si le fichier correspond au motif des .DAT collecteur. */
export const estFichierDat = (fileName) => {
  if (fileName.toLowerCase().endsWith(".pdf")) return false;
  return config.filenameRegex.test(fileName);
};

// ===========================================
// PARSING .DAT
// ===========================================
// Format par ligne : CODE(13) | QTE(8, zéros à gauche) | 000
export const parseDat = (content) => {
  const lignes = [];
  const rows = content.split(/\r?\n/);
  for (const raw of rows) {
    if (!raw || !raw.trim()) continue;
    const parts = raw.split("|");
    if (parts.length < 2) continue;
    const code = parts[0].trim();
    const quantite = parseInt(parts[1], 10) || 0;
    if (!code) continue;
    lignes.push({ code, quantite });
  }
  return lignes;
};

// ===========================================
// CROISEMENT ARTICLE + CALCUL ATT
// ===========================================
/**
 * @returns { rows, stats }
 * row = { n, code, nart, att, designation, reference, qte, stock, rouge, nonTrouve }
 * ATT : D = doublon dans le fichier, XX = qté > stock, A = stock > qté OU article non trouvé
 */
export const construireLignes = async (entreprise, lignesDat) => {
  // 1) Résolution article par article
  const entries = [];
  for (const l of lignesDat) {
    let record = null;
    try {
      record = await articleCacheService.findByCode(entreprise, l.code);
    } catch {
      record = null;
    }

    if (!record) {
      entries.push({
        code: l.code,
        nart: "-",
        designation: "Article non trouvé",
        reference: "",
        qte: l.quantite,
        stock: null,
        nonTrouve: true,
        dupKey: `CODE:${l.code}`,
      });
    } else {
      const nart = (record.NART || "").trim();
      const stock = articleCacheService.calculateStockTotal(record);
      entries.push({
        code: l.code,
        nart: nart || "-",
        designation: (record.DESIGN || "").trim(),
        reference: (record.REFER || "").trim(),
        qte: l.quantite,
        stock,
        nonTrouve: false,
        dupKey: nart ? `NART:${nart}` : `GENCOD:${(record.GENCOD || "").trim()}`,
      });
    }
  }

  // 2) Détection des doublons (même article ≥ 2 fois)
  const counts = new Map();
  entries.forEach((e) => counts.set(e.dupKey, (counts.get(e.dupKey) || 0) + 1));

  // 3) Construction des lignes + flags
  let doublons = 0;
  let attention = 0;
  let excedent = 0;
  let nonTrouves = 0;

  const rows = entries.map((e, i) => {
    const flags = [];
    const estDoublon = counts.get(e.dupKey) > 1;
    if (estDoublon) flags.push("D");

    if (e.nonTrouve) {
      flags.push("A");
    } else if (e.qte > e.stock) {
      flags.push("XX");
    } else if (e.stock > e.qte) {
      flags.push("A");
    }

    if (estDoublon) doublons += 1;
    if (flags.includes("XX")) excedent += 1;
    if (flags.includes("A")) attention += 1;
    if (e.nonTrouve) nonTrouves += 1;

    return {
      n: i + 1,
      code: e.code,
      nart: e.nart,
      att: flags.join(" "),
      designation: e.designation,
      reference: e.reference,
      qte: e.qte,
      stock: e.nonTrouve ? "-" : e.stock,
      rouge: flags.length > 0,
      nonTrouve: e.nonTrouve,
    };
  });

  return {
    rows,
    stats: {
      total: rows.length,
      doublons,
      attention,
      excedent,
      nonTrouves,
    },
  };
};

// ===========================================
// GÉNÉRATION PDF (modèle "FICHE DE CONTRÔLE INVENTAIRE")
// ===========================================
const COLS = [
  { key: "n", label: "N°", w: 26, align: "center" },
  { key: "code", label: "CODE", w: 88, align: "left" },
  { key: "nart", label: "NART", w: 50, align: "left" },
  { key: "att", label: "ATT", w: 30, align: "center" },
  { key: "designation", label: "DÉSIGNATION", w: 168, align: "left" },
  { key: "reference", label: "RÉFÉRENCE", w: 70, align: "left" },
  { key: "qte", label: "QTÉ", w: 34, align: "center" },
  { key: "stock", label: "STOCK", w: 40, align: "center" },
  { key: "ctl", label: "CTL", w: 29, align: "center" },
];

const formatDateFr = (d) =>
  new Date(d).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Tronque un texte avec … pour qu'il tienne dans maxWidth (police courante). */
const fitText = (doc, text, maxWidth) => {
  const str = text == null ? "" : String(text);
  if (!str) return "";
  if (doc.widthOfString(str) <= maxWidth) return str;
  let t = str;
  while (t.length > 1 && doc.widthOfString(t + "…") > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + "…";
};

/**
 * Écrit le PDF de la fiche de contrôle.
 * @returns Promise<void>
 */
export const ecrirePDF = async ({ header, rows, outPath }) => {
  const mod = await import("pdfkit").catch(() => {
    throw new Error(
      "Module 'pdfkit' introuvable. Lancez : npm i pdfkit (backend).",
    );
  });
  const PDFDocument = mod.default;

  const margin = 30;
  const doc = new PDFDocument({ size: "A4", margin });
  const stream = fs.createWriteStream(outPath);
  doc.pipe(stream);

  const left = margin;
  const right = doc.page.width - margin;
  const tableWidth = COLS.reduce((s, c) => s + c.w, 0);

  // ---- Titre ----
  doc
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("FICHE DE CONTRÔLE INVENTAIRE", left, margin, {
      width: right - left,
      align: "center",
    });

  let y = margin + 30;

  // ---- Bloc en-tête (Zone/Type, Libellé/Date) ----
  const infoH = 18;
  const colA = left;
  const colB = left + (right - left) / 2;
  const drawInfo = (x, w, label, value) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`${label} :`, x + 4, y + 5, { width: 50 });
    doc
      .font("Helvetica")
      .fontSize(9)
      .text(value || "", x + 56, y + 5, { width: w - 60 });
  };
  doc.rect(left, y, right - left, infoH * 2).stroke();
  doc.moveTo(colB, y).lineTo(colB, y + infoH * 2).stroke();
  doc.moveTo(left, y + infoH).lineTo(right, y + infoH).stroke();
  drawInfo(colA, (right - left) / 2, "Zone", header.zoneCode);
  drawInfo(colB, (right - left) / 2, "Type", header.zoneType);
  y += infoH;
  drawInfo(colA, (right - left) / 2, "Libellé", header.zoneLibelle);
  drawInfo(colB, (right - left) / 2, "Date", formatDateFr(header.date));
  y += infoH + 8;

  // ---- VISA CONTRÔLE ----
  doc.rect(left, y, right - left, 20).stroke();
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("VISA CONTRÔLE :", left + 4, y + 6);
  y += 28;

  // ---- Table ----
  const rowH = 16;
  const drawHeader = () => {
    let x = left;
    doc.rect(left, y, tableWidth, rowH).fillAndStroke("#e8e8e8", "#000");
    doc.fillColor("#000").font("Helvetica-Bold").fontSize(7.5);
    COLS.forEach((c) => {
      doc.text(c.label, x + 2, y + 5, {
        width: c.w - 4,
        align: c.align,
      });
      x += c.w;
    });
    y += rowH;
  };

  const ensureSpace = () => {
    if (y + rowH > doc.page.height - margin - 24) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
  };

  drawHeader();

  doc.font("Helvetica").fontSize(7.5);
  rows.forEach((r) => {
    ensureSpace();
    let x = left;

    // Ligne en défaut : fond gris (texte noir, compatible impression N&B)
    if (r.rouge) {
      doc.save();
      doc.rect(left, y, tableWidth, rowH).fill("#d9d9d9");
      doc.restore();
    }

    doc.strokeColor("#999");
    COLS.forEach((c) => {
      doc.rect(x, y, c.w, rowH).stroke();
      const raw =
        c.key === "ctl"
          ? ""
          : r[c.key] === null || r[c.key] === undefined
            ? ""
            : String(r[c.key]);
      const val = fitText(doc, raw, c.w - 4);
      doc
        .fillColor("#000")
        .text(val, x + 2, y + 5, {
          width: c.w - 4,
          align: c.align,
          lineBreak: false,
        });
      x += c.w;
    });
    y += rowH;
  });

  // ---- Légende ----
  y += 10;
  if (y > doc.page.height - margin - 30) {
    doc.addPage();
    y = margin;
  }
  doc.strokeColor("#000").rect(left, y, right - left, 20).stroke();
  doc
    .fillColor("#000")
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .text("LÉGENDE :", left + 4, y + 6, { continued: true })
    .font("Helvetica")
    .text(
      "   D = Doublon | A = Attention requise (stock > qté ou article non trouvé) | XX = Quantité excédentaire | Lignes rouges = Contrôle prioritaire",
    );

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
};