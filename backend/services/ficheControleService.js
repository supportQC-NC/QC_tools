// backend/services/ficheControleService.js
import fs from "fs";
import os from "os";
import path from "path";
import articleCacheService from "./articleService.js";
import LigneBipage from "../models/LigneBipageModel.js";

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
  // Dossiers dédiés, créés PAR EMPLACEMENT (à l'intérieur de chaque sous-dossier)
  archiveDatDirName: "archive_dat", // .DAT traités/imprimés
  archivePdfDirName: "archive_pdf", // fiches PDF imprimées
  zoneInconnueDirName: "zone_non_trouvee", // .DAT dont la zone est inconnue
  // Sous-dossier des zones SANS emplacement (type vide) : rien n'est jamais
  // déposé à la racine de l'inventaire.
  sansEmplacementDirName: "SANS_EMPLACEMENT",
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

/**
 * Nom du SOUS-DOSSIER d'un emplacement (zone.type). SOURCE UNIQUE de vérité,
 * utilisée par le dépôt, le watcher, la réimpression et le « recommencer » :
 * tous doivent pointer le MÊME dossier. Un type vide → dossier par défaut
 * (jamais de fichier à la racine de l'inventaire).
 */
export const emplacementDir = (type) => {
  const t = String(type || "").trim();
  return t ? sanitizeName(t) : config.sansEmplacementDirName;
};

/**
 * Construit le SLUG de dossier UNIQUE d'un inventaire : nom nettoyé + horodatage.
 * Deux réinitialisations (même nom) donnent ainsi deux dossiers distincts →
 * aucun mélange avec d'anciens .DAT. Le slug est stocké sur la session
 * (dossierSlug) et sur chaque fiche (inventaireSlug), puis passé à
 * getInventaireDirs pour retrouver le dossier dans l'environnement courant.
 * On borne la partie "nom" pour que le slug complet reste < 120 car.
 * (sanitizeName tronque à 120 : le suffixe horodaté ne doit pas être coupé).
 */
export const makeInventaireSlug = (nom, date = new Date()) => {
  const d = new Date(date);
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}h${p(d.getMinutes())}m${p(d.getSeconds())}`;
  const base = sanitizeName(nom).slice(0, 90);
  return `${base} ${stamp}`.trim();
};

/**
 * DESTINATIONS possibles du dossier d'un inventaire (choisies à l'initialisation
 * et stockées sur la session, cf. InventaireZoneSessionModel.destination).
 *
 * ⚠️ On stocke le MODE, jamais un chemin absolu : le même Mongo sert au poste
 * de dev (Windows, UNC) et au VPS (Linux, montages). La racine est donc
 * RECALCULÉE à chaque usage pour l'environnement courant — c'est déjà la raison
 * pour laquelle le dépôt, le watcher et la réimpression ignorent
 * `session.dossierDat`.
 *
 * `ftp` est RÉSERVÉ et volontairement non proposé : le watcher lit un système
 * de fichiers (`fs.readdirSync`), un inventaire qui ne vivrait que sur le FTPS
 * ne produirait ni FicheControle, ni LigneBipage, ni impression. Le FTP reste
 * le MIROIR de référence (inventaireFtpService).
 */
export const DESTINATIONS = ["rcommun", "collect_sec"];

/** Normalise une destination reçue de l'extérieur (repli = défaut historique). */
export const normaliserDestination = (v) =>
  DESTINATIONS.includes(String(v || "").trim()) ? String(v).trim() : "rcommun";

/**
 * Racine du dossier d'inventaire pour une destination, dans l'environnement
 * COURANT :
 *  - `rcommun`     → partage STOCK (`config.sharePath` / STOCK_SHARE_PATH) ;
 *  - `collect_sec` → `entreprise.cheminExportInventaire`, déjà traduit par le
 *    getter du modèle (RCOMMON_STOCK_ROOT garde le dernier segment, propre à
 *    chaque société : collect_sec, collect_sec_aw…).
 * Repli sur le partage STOCK si la société n'a pas de chemin d'export : mieux
 * vaut le dossier historique qu'un chemin vide.
 */
export const racineInventaire = (destination, entreprise = null) => {
  if (normaliserDestination(destination) === "collect_sec") {
    const collect = String(entreprise?.cheminExportInventaire || "").trim();
    if (collect) return collect;
  }
  return config.sharePath;
};

/**
 * TOUTES les racines où un fichier d'inventaire de cette société peut vivre,
 * dans l'ordre de préférence. Sert aux fonctions de RECHERCHE (retrouver un PDF
 * ou un .DAT existant) : elles n'ont pas à savoir quelle destination avait été
 * choisie, et les inventaires créés avant ce choix restent trouvables.
 */
export const racinesInventaire = (entreprise = null) => {
  const racines = [config.sharePath];
  const collect = String(entreprise?.cheminExportInventaire || "").trim();
  if (collect && !racines.includes(collect)) racines.push(collect);
  return racines;
};

/**
 * Renvoie les chemins des dossiers d'un inventaire (nom OU slug de dossier).
 * `racine` = résultat de `racineInventaire(session.destination, entreprise)` ;
 * omise, on garde le partage STOCK (comportement historique).
 */
export const getInventaireDirs = (nom, racine = config.sharePath) => {
  const base = path.join(racine || config.sharePath, sanitizeName(nom));
  return {
    base,
    archiveDat: path.join(base, config.archiveDatDirName),
    archivePdf: path.join(base, config.archivePdfDirName),
    zoneInconnue: path.join(base, config.zoneInconnueDirName),
  };
};

/** Crée (récursivement) tous les dossiers de l'inventaire. */
export const ensureInventaireDirs = (nom, racine = config.sharePath) => {
  const dirs = getInventaireDirs(nom, racine);
  fs.mkdirSync(dirs.base, { recursive: true });
  fs.mkdirSync(dirs.archiveDat, { recursive: true });
  fs.mkdirSync(dirs.archivePdf, { recursive: true });
  fs.mkdirSync(dirs.zoneInconnue, { recursive: true });
  return dirs;
};

/**
 * Reconstruit le chemin du PDF d'une fiche POUR L'ENVIRONNEMENT COURANT.
 *
 * Le PDF est généré par l'agent local (Windows → chemin UNC) mais peut devoir
 * être servi/relu par le VPS (Linux → /mnt/rcommun) : on ne se fie donc PAS au
 * chemin absolu stocké (`fiche.pdfPath`, propre à la machine qui l'a créé). On
 * le recalcule depuis la/les RACINES de la société (`racinesInventaire` :
 * partage STOCK puis son collect_xxx) + <slug d'inventaire> (getInventaireDirs)
 * puis on cherche le fichier dans le SOUS-DOSSIER d'emplacement (zone.type) —
 * archive_pdf puis racine du sous-dossier — avec repli sur la racine de
 * l'inventaire (fiches sans emplacement / legacy). Renvoie le 1er chemin EXISTANT.
 */
export const resoudreCheminPdf = (fiche, entreprise = null) => {
  if (!fiche) return "";
  // Slug de dossier en priorité (dossier unique horodaté) ; repli sur le nom
  // pour les anciennes fiches créées avant l'introduction du slug.
  const nom = fiche.inventaireSlug || fiche.inventaireNom || "";
  // pdfFileName est un nom "pur" ; on garantit le basename par sécurité.
  const fileName = fiche.pdfFileName ? path.basename(fiche.pdfFileName) : "";
  const candidats = [];
  // On balaie TOUTES les racines possibles de la société (partage STOCK puis
  // son collect_xxx) plutôt que de stocker la destination sur chaque fiche :
  // cette fonction cherche un fichier EXISTANT, et les fiches antérieures au
  // choix de destination restent ainsi trouvables.
  if (nom && fileName) {
    for (const racine of racinesInventaire(entreprise)) {
      const dirs = getInventaireDirs(nom, racine);
      // Sous-dossier d'emplacement (MAGASIN/DOCK/… ou défaut) où vit le PDF.
      const scanDir = path.join(dirs.base, emplacementDir(fiche.zoneType));
      candidats.push(path.join(scanDir, config.archivePdfDirName, fileName));
      candidats.push(path.join(scanDir, fileName));
      // Replis racine : anciennes fiches à plat (avant les sous-dossiers).
      candidats.push(path.join(dirs.archivePdf, fileName)); // archivé
      candidats.push(path.join(dirs.base, fileName)); // pas encore archivé
    }
  }
  if (fiche.pdfPath) candidats.push(fiche.pdfPath); // dernier recours
  for (const p of candidats) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return "";
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
    // parseFloat, pas parseInt : le format officiel est entier (Stock XL) mais
    // un .dat retouché à la main peut porter des décimales — on les respecte.
    const quantite = Math.round((parseFloat(parts[1]) || 0) * 1000) / 1000;
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
 * ATT : A = article inconnu du catalogue, XX = surplus de stock (qté bipée >
 * stock), D = doublon dans le fichier. « stock > qté bipée » n'est plus une
 * anomalie (12/11/2026) : trop fréquent, il noyait les trois autres.
 *
 * ⚠️ La colonne CODE de la fiche porte le **GENCOD du catalogue** (demande
 * client du 10/11/2026), PAS le code brut bipé ni le NART — ce dernier a sa
 * propre colonne, l'afficher deux fois ne servait à rien. Le code bipé reste la
 * clé de RECHERCHE (`l.code`, résolu par findByCode, tolérant aux zéros de
 * tête) ; il ne sert plus qu'à l'affichage de SECOURS, quand l'article n'a pas
 * de gencod ou n'a pas été retrouvé — une colonne vide ne donnerait rien à
 * contrôler. Le `.dat`, lui, reste sur le NART (format Stock XL figé).
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

    // SUIVI DES RENVOIS GENDOUBL (corrigé le 16/11/2026) : `findByCode` rend
    // la fiche TELLE QUELLE, renvoyée ou non — sans ce suivi, biper l'ancienne
    // étiquette d'un article renvoyé faisait sortir la fiche de contrôle (et
    // les LigneBipage, donc les écarts) sur l'ANCIENNE fiche, alors que l'app
    // collecteur et le .dat comptent déjà sur la fiche ACTIVE. Même logique
    // plafonnée que `suivreChaineRenvois` (scan collecteur) : 10 sauts max, et
    // un renvoi vers une fiche disparue s'arrête sur la dernière trouvée.
    // La colonne CODE BIPÉ, elle, garde le code brut (`l.code`), comme avant.
    // `renvoye` : au moins un saut GENDOUBL a été suivi — la fiche imprimée
    // porte alors un « R » à côté du code bipé (demande client du 18/11/2026),
    // pour que le contrôleur sache que l'étiquette lue n'est pas celle de la
    // fiche active.
    let renvoye = false;
    if (record) {
      let sauts = 0;
      while (sauts < 10) {
        const gendoubl = String(record.GENDOUBL || "").trim();
        if (!gendoubl) break;
        let suivant = null;
        try {
          suivant = await articleCacheService.findByNart(entreprise, gendoubl);
        } catch {
          suivant = null;
        }
        if (!suivant) break;
        record = suivant;
        renvoye = true;
        sauts += 1;
      }
    }

    if (!record) {
      entries.push({
        code: l.code,
        nart: "-",
        gencod: "",
        designation: "Article non trouvé",
        reference: "",
        qte: l.quantite,
        stock: null,
        nonTrouve: true,
        renvoye: false,
        dupKey: `CODE:${l.code}`,
      });
    } else {
      const nart = (record.NART || "").trim();
      const stock = articleCacheService.calculateStockTotal(record);
      const gencod = (record.GENCOD || "").trim();
      entries.push({
        code: l.code,
        nart: nart || "-",
        // Code-barres du CATALOGUE, distinct du code scanné (`code`).
        gencod,
        designation: (record.DESIGN || "").trim(),
        reference: (record.REFER || "").trim(),
        qte: l.quantite,
        stock,
        nonTrouve: false,
        renvoye,
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

    // TROIS anomalies, et trois seulement :
    //   A  = article INCONNU du catalogue ;
    //   XX = surplus de stock (quantité bipée > stock théorique) ;
    //   D  = doublon (même article compté ≥ 2 fois dans la zone).
    //
    // ⚠️ « stock > qté bipée » N'EST PLUS une anomalie (demande client du
    // 12/11/2026). C'était le cas le plus FRÉQUENT — tout article dont il
    // reste du stock et qu'on n'a pas fini de compter le déclenchait — et il
    // noyait les trois autres : des fiches entières sortaient en rouge, donc
    // plus rien ne ressortait. L'écart stock/comptage reste traité là où c'est
    // sa place : la feuille d'écarts.
    if (e.nonTrouve) {
      flags.push("A");
    } else if (e.qte > e.stock) {
      flags.push("XX");
    }

    if (estDoublon) doublons += 1;
    if (flags.includes("XX")) excedent += 1;
    // `attention` compte les lignes marquées A, donc désormais exactement les
    // articles inconnus : les deux compteurs sont égaux, et `attention` est
    // conservé parce que FicheControle.stats et les écrans le lisent déjà.
    if (flags.includes("A")) attention += 1;
    if (e.nonTrouve) nonTrouves += 1;

    return {
      n: i + 1,
      // CODE = le code-barres du CATALOGUE ; repli sur le code bipé quand
      // l'article n'a pas de gencod (ou est inconnu). Voir l'en-tête.
      code: e.gencod || e.code,
      // « R » = le code bipé a été RENVOYÉ (chaîne GENDOUBL suivie jusqu'à la
      // fiche active) : petite colonne à côté du code bipé sur la fiche.
      renvoi: e.renvoye ? "R" : "",
      renvoye: !!e.renvoye,
      nart: e.nart,
      gencod: e.gencod || "",
      // Code réellement bipé, SANS résolution : il a sa propre colonne dans la
      // fiche (« CODE BIPÉ ») et à l'écran, à côté du GENCODE du catalogue.
      codeScanne: e.code,
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
// ⚠️ La somme des largeurs DOIT valoir 535 pt : A4 portrait (595,28) moins les
// deux marges de 30. Toute colonne ajoutée se prend sur les autres.
// Total actuel : 26+62+14+62+46+28+130+60+34+40+33 = 535.
// Les deux colonnes de code sont calées au plus juste : un GENCOD est un C(13),
// soit 54,2 pt en Helvetica 7,5 — 58 pt utiles suffisent. La DÉSIGNATION n'est
// PLUS tronquée (18/11/2026) : quand elle ne tient pas sur une ligne, elle
// passe à la ligne et la LIGNE S'AGRANDIT — réduire sa colonne de 14 pt pour
// la colonne « R » ne fait donc plus perdre d'information.
const COLS = [
  { key: "n", label: "N°", w: 26, align: "center" },
  // CODE BIPÉ = ce que l'agent a réellement douché ou saisi, SANS résolution :
  // le code-barres s'il a bipé une étiquette, le NART s'il l'a tapé. Demandé
  // pour pouvoir confronter le terrain au catalogue : quand la ligne est
  // fausse, c'est presque toujours ici que ça se voit (code d'un autre
  // article, zéro de tête absent, renvoi GENDOUBL suivi vers une autre fiche).
  { key: "codeScanne", label: "CODE BIPÉ", w: 62, align: "left" },
  // « R » = le code bipé est un RENVOI (GENDOUBL suivi jusqu'à la fiche
  // active) : l'étiquette lue en rayon n'est pas celle de la fiche dont la
  // ligne porte le NART/GENCODE (demande client du 18/11/2026).
  { key: "renvoi", label: "R", w: 14, align: "center" },
  // Intitulé « GENCODE » et pas « CODE » (demande client du 10/11/2026) : la
  // colonne porte le code-barres du catalogue — celui de l'étiquette en rayon —
  // obtenu par RÉSOLUTION du code bipé, et pas une référence interne (NART,
  // colonne suivante).
  { key: "code", label: "GENCODE", w: 62, align: "left" },
  { key: "nart", label: "NART", w: 46, align: "left" },
  { key: "att", label: "ATT", w: 28, align: "center" },
  { key: "designation", label: "DÉSIGNATION", w: 130, align: "left" },
  { key: "reference", label: "RÉFÉRENCE", w: 60, align: "left" },
  { key: "qte", label: "QTÉ", w: 34, align: "center" },
  { key: "stock", label: "STOCK", w: 40, align: "center" },
  { key: "ctl", label: "CTL", w: 33, align: "center" },
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
export const ecrirePDF = async ({ header, rows, outPath, legende }) => {
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
    .text("FICHE DE CONTRÔLE BIPAGE", left, margin, {
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

  // ---- BIPÉ PAR (remplace le « VISA CONTRÔLE » d'en-tête, 17/11/2026) ----
  // Collecteur : prénom + nom du ou des agents qui ont bipé (cumul de la
  // zone) ; import proforma : le VENDEUR (REPRES) qui a créé le document.
  // Le visa du contrôleur, lui, est parti EN FIN DE FICHE (bloc signature).
  doc.rect(left, y, right - left, 20).stroke();
  doc
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("BIPÉ PAR :", left + 4, y + 6, { continued: false });
  doc
    .font("Helvetica")
    .fontSize(9)
    .text(
      fitText(doc, header.bipePar || "", right - left - 70),
      left + 62,
      y + 6,
      { width: right - left - 70, lineBreak: false },
    );
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

  const ensureSpace = (besoin = rowH) => {
    if (y + besoin > doc.page.height - margin - 24) {
      doc.addPage();
      y = margin;
      drawHeader();
    }
  };

  drawHeader();

  const designCol = COLS.find((c) => c.key === "designation");

  rows.forEach((r) => {
    // Police posée AVANT la mesure : heightOfString mesure avec la police
    // courante (drawHeader la laisse en gras après un saut de page).
    doc.font("Helvetica").fontSize(7.5);

    // HAUTEUR DE LIGNE VARIABLE (demande client du 18/11/2026) : la
    // DÉSIGNATION n'est plus tronquée — quand elle ne tient pas, elle passe à
    // la ligne et la ligne s'agrandit. DESIGN est un C(50) : deux lignes
    // suffisent presque toujours, mais la hauteur suit le texte réel.
    const design = r.designation == null ? "" : String(r.designation);
    // Une désignation qui TIENT sur une ligne garde la hauteur historique
    // (16 pt) : heightOfString d'une ligne unique dépasserait déjà le seuil
    // et toutes les lignes sortaient à 18 pt.
    const designDeborde =
      design && doc.widthOfString(design) > designCol.w - 4;
    const h = designDeborde
      ? Math.max(
          rowH,
          Math.ceil(doc.heightOfString(design, { width: designCol.w - 4 })) + 9,
        )
      : rowH;

    // Une ligne INCONNUE (A) est suivie d'une ligne VIERGE de correction : on
    // réserve la place des deux d'un coup pour qu'elles ne soient jamais
    // séparées par un saut de page.
    ensureSpace(r.nonTrouve ? h + rowH : h);
    // Après un saut de page, drawHeader laisse la police en GRAS : on la
    // repose à chaque ligne (et avant fitText, qui mesure avec la police
    // courante) — les pages 2+ sortaient entièrement en gras.
    doc.font("Helvetica").fontSize(7.5);
    let x = left;

    // Ligne en défaut : fond gris (texte noir, compatible impression N&B)
    if (r.rouge) {
      doc.save();
      doc.rect(left, y, tableWidth, h).fill("#d9d9d9");
      doc.restore();
    }

    doc.strokeColor("#999");
    COLS.forEach((c) => {
      doc.rect(x, y, c.w, h).stroke();
      if (c.key === "designation") {
        // Pas de fitText ici : le texte COMPLET, avec retour à la ligne —
        // la hauteur `h` a été calculée pour lui.
        doc.fillColor("#000").text(design, x + 2, y + 5, {
          width: c.w - 4,
          align: c.align,
          height: h - 5,
        });
      } else {
        const raw =
          c.key === "ctl"
            ? ""
            : r[c.key] === null || r[c.key] === undefined
              ? ""
              : // Quantités/stocks décimaux (articles au mètre) : virgule
                // française, "1.5" imprimé « 1,5 ».
                (c.key === "qte" || c.key === "stock") &&
                  typeof r[c.key] === "number"
                ? String(Math.round(r[c.key] * 1000) / 1000).replace(".", ",")
                : String(r[c.key]);
        const val = fitText(doc, raw, c.w - 4);
        doc
          .fillColor("#000")
          .text(val, x + 2, y + 5, {
            width: c.w - 4,
            align: c.align,
            lineBreak: false,
          });
      }
      x += c.w;
    });
    y += h;

    // Article inconnu (A) : ligne VIERGE juste en dessous, pour que l'agent
    // écrive la correction à la main (demande client du 17/11/2026). Mêmes
    // cellules, aucun contenu — la place est déjà réservée par ensureSpace.
    if (r.nonTrouve) {
      let xv = left;
      COLS.forEach((c) => {
        doc.rect(xv, y, c.w, rowH).stroke();
        xv += c.w;
      });
      y += rowH;
    }
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
      legende ||
        "   A = Article inconnu | XX = Surplus de stock | D = Doublon | R = Renvoi (code bipé → fiche active) | Grisé = Contrôle prioritaire",
    );
  y += 20;

  // ---- Tableau AJOUT (demande client du 18/11/2026) ----
  // 15 lignes VIERGES entre la légende et le visa : le contrôleur y note les
  // articles OUBLIÉS découverts pendant son contrôle (NL, NART ou gencode,
  // désignation, quantité) — ils seront ressaisis dans l'écran « Ajout
  // contrôle inventaire ». Bloc insécable : saut de page s'il ne tient pas.
  const AJOUT_COLS = [
    { label: "NL", w: 30 },
    { label: "NART / GENCODE", w: 120 },
    { label: "DÉSIGNATION", w: 305 },
    { label: "QTÉ", w: 80 },
  ];
  // Lignes hautes (18 pt) : ce tableau se remplit AU STYLO.
  const ajoutRowH = 18;
  const ajoutNbLignes = 15;
  const ajoutTitreH = 16;
  const ajoutH = ajoutTitreH + rowH + ajoutNbLignes * ajoutRowH;
  y += 10;
  if (y + ajoutH > doc.page.height - margin) {
    doc.addPage();
    y = margin;
  }
  doc.strokeColor("#000").rect(left, y, tableWidth, ajoutTitreH).fillAndStroke("#e8e8e8", "#000");
  doc
    .fillColor("#000")
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(
      "AJOUT — bipages oubliés constatés au contrôle (à saisir ensuite dans l'écran « Ajout contrôle inventaire »)",
      left + 4,
      y + 4,
      { width: tableWidth - 8, lineBreak: false },
    );
  y += ajoutTitreH;
  let xa = left;
  doc.rect(left, y, tableWidth, rowH).fillAndStroke("#e8e8e8", "#000");
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(7.5);
  AJOUT_COLS.forEach((c) => {
    doc.text(c.label, xa + 2, y + 5, { width: c.w - 4, align: "left" });
    xa += c.w;
  });
  y += rowH;
  doc.strokeColor("#999");
  for (let i = 0; i < ajoutNbLignes; i += 1) {
    let xv = left;
    AJOUT_COLS.forEach((c) => {
      doc.rect(xv, y, c.w, ajoutRowH).stroke();
      xv += c.w;
    });
    y += ajoutRowH;
  }
  doc.strokeColor("#000");

  // ---- VISA CONTRÔLE (fin de fiche, 17/11/2026) ----
  // L'agent qui a CONTRÔLÉ la zone écrit son nom et signe ici — l'ancien
  // encadré d'en-tête est devenu « BIPÉ PAR » (l'agent du comptage, lui, est
  // connu du système). Bloc insécable : saut de page s'il ne tient pas.
  const visaH = 64;
  y += 10;
  if (y + visaH > doc.page.height - margin) {
    doc.addPage();
    y = margin;
  }
  const milieu = left + (right - left) / 2;
  doc.strokeColor("#000").rect(left, y, right - left, visaH).stroke();
  doc.moveTo(milieu, y + 18).lineTo(milieu, y + visaH).stroke();
  doc.moveTo(left, y + 18).lineTo(right, y + 18).stroke();
  doc
    .fillColor("#000")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("VISA CONTRÔLE", left + 4, y + 5);
  doc.font("Helvetica-Bold").fontSize(8).text("Nom :", left + 4, y + 24);
  doc
    .moveTo(left + 34, y + visaH - 14)
    .lineTo(milieu - 10, y + visaH - 14)
    .stroke();
  doc.font("Helvetica-Bold").fontSize(8).text("Signature :", milieu + 4, y + 24);

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
};
// ===========================================
// FICHE D'IMPORTS GROUPÉE PAR ZONE
// ===========================================
//
// Demande client du 16/11/2026 : intégrer PLUSIEURS proformas (ou fichiers
// Excel) sur une zone ne doit plus produire une fiche de contrôle PAR
// document — il n'y a qu'UNE fiche PAR ZONE, le CUMUL de tous les imports
// (ajouts ET déductions), régénérée complète à chaque nouvel import. Même
// logique que le .dat d'une zone re-bipée au collecteur (inventaireCumulService).
//
// Chaque import garde SA référence sur ses LigneBipage (datFileName
// « proforma N … » / « excel F … » / « deduction … ») : c'est la clé de son
// idempotence et du détail par document. Seule la FICHE est groupée, sous la
// référence « imports <zone>[_<emplacement>] » — un nom qui ne peut collider ni
// avec un .DAT (« <EMPL>/stock.dat <code> ») ni avec une référence d'import.

export const PREFIXE_FICHE_IMPORTS = "imports ";

export const referenceImportsZone = (zoneCode, zoneType) => {
  const code = String(zoneCode || "").trim();
  const type = String(zoneType || "").trim();
  return `${PREFIXE_FICHE_IMPORTS}${code}${type ? `_${type}` : ""}`;
};

/**
 * Toutes les lignes d'IMPORT d'une zone (proformas + Excel, ajouts et
 * déductions), tolérant aux lignes historiques sans champ `source` (repérées
 * par leur référence — un .DAT ne commence jamais par ces mots).
 */
export const lignesImportsZone = async (sessionId, zoneCode, zoneType) => {
  const type = String(zoneType || "").trim();
  return LigneBipage.find({
    session: sessionId,
    zoneCode: String(zoneCode || "").trim(),
    zoneType: type || { $in: [null, ""] },
    $or: [
      { source: { $in: ["proforma", "excel"] } },
      {
        source: { $in: [null, ""] },
        datFileName: { $regex: /^(?:deduction |excel |proforma )/ },
      },
    ],
  })
    .sort({ datFileName: 1, ordre: 1 })
    .lean();
};

/**
 * Cumul PAR ARTICLE des lignes d'import d'une zone → le format attendu par
 * `construireLignes` ({ code, quantite }). Un article présent sur plusieurs
 * documents sort en UNE ligne, quantités additionnées (déductions en négatif,
 * elles se retranchent naturellement) — exactement comme le .dat cumulé d'une
 * zone re-bipée. Clé = NART résolu, repli code scanné ; l'ordre est celui de
 * la première apparition.
 */
export const cumulerLignesImports = (lignes) => {
  const map = new Map();
  for (const l of lignes || []) {
    const cle = String(l.nart || l.codeScanne || l.eanArticle || "")
      .trim()
      .toUpperCase();
    if (!cle) continue;
    const cur = map.get(cle) || {
      code: String(l.codeScanne || l.eanArticle || l.nart || "").trim(),
      quantite: 0,
    };
    cur.quantite += Number(l.qteScan) || 0;
    map.set(cle, cur);
  }
  // Un cumul retombé à zéro (import puis déduction identique) reste affiché :
  // c'est une information de contrôle, pas une ligne fantôme.
  return [...map.values()];
};

// ===========================================
// RÉCUPÉRATION / RECONSTRUCTION DU PDF
// ===========================================

/**
 * Reconstruit le chemin du .DAT source d'une fiche pour l'environnement
 * courant. `fiche.datFileName` est une clé LOGIQUE « <EMPLACEMENT>/stock.dat
 * <code> » : le dossier d'emplacement y est déjà, on l'accroche simplement au
 * dossier de l'inventaire recalculé ici (cf. resoudreCheminPdf).
 */
export const resoudreCheminDat = (fiche, entreprise = null) => {
  if (!fiche) return "";
  const nom = fiche.inventaireSlug || fiche.inventaireNom || "";
  const logique = String(fiche.datFileName || "");
  if (!nom || !logique) return "";
  const parts = logique.split("/").filter(Boolean);
  const fileName = parts.pop();
  const sousDossier = parts.length
    ? parts.join(path.sep)
    : emplacementDir(fiche.zoneType);
  // Toutes les racines possibles de la société (cf. resoudreCheminPdf).
  const candidats = [];
  for (const racine of racinesInventaire(entreprise)) {
    const dirs = getInventaireDirs(nom, racine);
    candidats.push(
      path.join(dirs.base, sousDossier, fileName),
      path.join(dirs.base, sousDossier, config.archiveDatDirName, fileName),
      path.join(dirs.base, fileName), // anciennes fiches à plat
      path.join(dirs.archiveDat, fileName),
    );
  }
  for (const p of candidats) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return "";
};

/**
 * Retrouve les lignes brutes (code + quantité) d'une fiche, d'abord depuis le
 * .DAT s'il est encore là, sinon depuis les lignes persistées en base
 * (LigneBipage, écrites au traitement du .DAT). Le second chemin est celui qui
 * sauve la mise quand un programme externe a déplacé/supprimé les fichiers du
 * partage, ou quand le backend web n'a pas accès au partage du tout.
 */
// Noms d'agents DISTINCTS d'un lot de LigneBipage, dans l'ordre d'apparition
// (collecteur : prénom + nom de l'agent ; import proforma : le vendeur REPRES).
const agentsDepuisLignes = (lignes) => {
  const noms = [];
  for (const l of lignes || []) {
    const n = String(l.agentNom || "").trim();
    if (n && !noms.includes(n)) noms.push(n);
  }
  return noms;
};

const retrouverLignesDat = async (fiche, entreprise = null) => {
  // Fiche d'imports GROUPÉE PAR ZONE : aucun fichier sur le partage et les
  // lignes ne portent pas sa référence (chacune garde celle de SON import).
  // On reconstruit le CUMUL de la zone, toutes sources d'import confondues.
  if (String(fiche?.datFileName || "").startsWith(PREFIXE_FICHE_IMPORTS)) {
    const enBase = await lignesImportsZone(
      fiche.session,
      fiche.zoneCode,
      fiche.zoneType,
    );
    const lignes = cumulerLignesImports(enBase);
    return {
      lignes,
      origine: lignes.length ? "base" : "",
      agents: agentsDepuisLignes(enBase),
    };
  }

  const enBase = await LigneBipage.find({
    session: fiche.session,
    datFileName: fiche.datFileName,
  })
    .sort({ ordre: 1 })
    .lean();
  // Le « bipé par » ne vit QUE sur les LigneBipage (le .DAT ne porte aucun
  // agent) : on les lit donc toujours, même quand les lignes viendront du .DAT.
  const agents = agentsDepuisLignes(enBase);

  const datPath = resoudreCheminDat(fiche, entreprise);
  if (datPath) {
    try {
      const lignes = parseDat(fs.readFileSync(datPath, "utf8"));
      if (lignes.length) return { lignes, origine: "dat", agents };
    } catch {
      /* on bascule sur la base */
    }
  }

  if (enBase.length) {
    return {
      lignes: enBase.map((l) => ({
        // On repart du code RÉELLEMENT BIPÉ : c'est lui que la fiche doit
        // afficher en colonne CODE BIPÉ, et le repasser dans construireLignes
        // redonne exactement la même résolution qu'au dépôt. Repli sur
        // `eanArticle` pour les lignes antérieures à ce champ.
        code: String(l.codeScanne || l.eanArticle || l.nart || "").trim(),
        quantite: Number(l.qteScan) || 0,
      })),
      origine: "base",
      agents,
    };
  }
  return { lignes: [], origine: "", agents: [] };
};

/**
 * Renvoie un chemin de PDF LISIBLE pour cette fiche, quoi qu'il arrive :
 *  1. le PDF d'origine s'il est toujours sur le partage ;
 *  2. sinon un PDF REGÉNÉRÉ à l'identique dans un fichier temporaire, à partir
 *     du .DAT ou des lignes stockées en base.
 * L'appelant doit supprimer le fichier quand `temporaire` est vrai.
 * @returns {Promise<{chemin: string, temporaire: boolean, origine: string}>}
 */
export const assurerPdfFiche = async (fiche, entreprise, surchargeEntete = null) => {
  // ⚠️ Avec une surcharge d'en-tête (fiches d'IMPORT : observation/client de
  // la proforma), on régénère TOUJOURS — le PDF du disque, s'il existait,
  // porterait l'ancien en-tête.
  if (!surchargeEntete) {
    const existant = resoudreCheminPdf(fiche, entreprise);
    if (existant) return { chemin: existant, temporaire: false, origine: "disque" };
  }

  const { lignes, origine, agents } = await retrouverLignesDat(
    fiche,
    entreprise,
  );
  if (!lignes.length) return { chemin: "", temporaire: false, origine: "" };

  const { rows } = await construireLignes(entreprise, lignes);
  const outPath = path.join(
    os.tmpdir(),
    `fiche_${fiche._id}_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`,
  );
  await ecrirePDF({
    header: {
      zoneCode: surchargeEntete?.zoneCode ?? (fiche.zoneCode || ""),
      zoneLibelle: surchargeEntete?.zoneLibelle ?? (fiche.zoneLibelle || ""),
      zoneType: surchargeEntete?.zoneType ?? (fiche.zoneType || ""),
      date:
        surchargeEntete?.date ?? (fiche.date || fiche.createdAt || new Date()),
      // Surcharge (import proforma : le VENDEUR) > valeur figée sur la fiche
      // (watcher) > agents des LigneBipage (fiches antérieures au champ).
      bipePar:
        surchargeEntete?.bipePar ??
        (String(fiche.bipePar || "").trim() || (agents || []).join(" / ")),
    },
    rows,
    outPath,
  });
  return { chemin: outPath, temporaire: true, origine };
};
