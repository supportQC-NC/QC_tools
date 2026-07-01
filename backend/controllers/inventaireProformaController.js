// backend/controllers/inventaireProformaController.js
import asyncHandler from "../middleware/asyncHandler.js";
import proformaCacheService from "../services/proformaCacheService.js";
import articleCacheService from "../services/articleService.js";
import fournissCacheService from "../services/fournissCacheService.js";
import { ecrirePDF } from "../services/ficheControleService.js";
import path from "path";
import os from "os";
import fs from "fs";
import zlib from "zlib";
import ProformaZone from "../models/ProformaZoneModel.js";

/**
 * Mode « Inventaire Proforma » (admin, lecture seule).
 *
 * Client = TIERS (proforma.dbf, entête, N:4.0). On récupère les entêtes de ce
 * TIERS (filtre date DATFACT optionnel) → NUMFACT + NOM + TEXTE (observation),
 * puis les lignes prodet.dbf de chaque NUMFACT (lien = NUMFACT), triées par NL,
 * enrichies du stock théorique de l'article (article.dbf, S1..S5).
 *
 * proforma.dbf : NUMFACT(C:7), DATFACT(D:8), TIERS(N:4.0), NOM(C:30),
 *   TEXTE(C:60 = observation), ..., ETAT.
 * prodet.dbf   : NUMFACT(C:7), NART(C:6), DESIGN(C:50), ..., NL(N:8.3), ...
 *   (NART vide ou "!" => ligne commentaire)
 */

const safeTrim = (v) => (v === null || v === undefined ? "" : String(v).trim());
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const isComment = (nart) => nart === "" || nart.includes("!");

// ---------------------------------------------------------------------------
// Export .DAT (mode Inventaire Proforma) — même format que les réappros :
//   CODE(13, NART complété d'espaces) | QTE(8, zéros) | 000
// NB : pour la proforma inventaire, on n'utilise JAMAIS le GENCOD — toujours le NART.
// La ZONE est portée par le NOM du fichier : "stock.dat inventaire_<zone>".
// ---------------------------------------------------------------------------
const ZONES = ["S1", "S2", "S3", "S4", "S5"];
const ZONE_DEFAUT = "S1";

// Nom de fichier déposé / téléchargé. <zone> = code entrepôt (S1..S5).
const nomFichierDat = (zone) =>
  `stock.dat inventaire_${String(zone || ZONE_DEFAUT)
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")}`;

// Contenu .DAT à partir de lignes { nart, quantite }.
// Proforma inventaire : identifiant = NART uniquement (jamais GENCOD),
// complété par des espaces jusqu'à 13 caractères.
const genererContenuDat = (lignes) => {
  let contenu = "";
  for (const ligne of lignes) {
    const code = (ligne.nart || "").trim().padEnd(13, " ");
    const q = Math.max(0, Math.trunc(Number(ligne.quantite) || 0)); // négatif -> 0
    const quantiteFormatee = q.toString().padStart(8, "0");
    contenu += `${code}|${quantiteFormatee}|000\r\n`;
  }
  return contenu;
};

// --- ZIP minimal (méthode deflate), sans dépendance externe ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const makeZip = (files) => {
  // files : [{ name, data: Buffer }]
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const data = f.data;
    const crc = crc32(data);
    const comp = zlib.deflateRawSync(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6); // UTF-8
    lfh.writeUInt16LE(8, 8); // deflate
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(comp.length, 18);
    lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    chunks.push(lfh, nameBuf, comp);
    const cdr = Buffer.alloc(46);
    cdr.writeUInt32LE(0x02014b50, 0);
    cdr.writeUInt16LE(20, 4);
    cdr.writeUInt16LE(20, 6);
    cdr.writeUInt16LE(0x0800, 8);
    cdr.writeUInt16LE(8, 10);
    cdr.writeUInt16LE(0, 12);
    cdr.writeUInt16LE(0, 14);
    cdr.writeUInt32LE(crc, 16);
    cdr.writeUInt32LE(comp.length, 20);
    cdr.writeUInt32LE(data.length, 24);
    cdr.writeUInt16LE(nameBuf.length, 28);
    cdr.writeUInt16LE(0, 30);
    cdr.writeUInt16LE(0, 32);
    cdr.writeUInt16LE(0, 34);
    cdr.writeUInt16LE(0, 36);
    cdr.writeUInt32LE(0, 38);
    cdr.writeUInt32LE(offset, 42);
    central.push({ cdr, nameBuf });
    offset += lfh.length + nameBuf.length + comp.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) {
    chunks.push(c.cdr, c.nameBuf);
    centralSize += c.cdr.length + c.nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);
  return Buffer.concat(chunks);
};

const formatEntreprise = (e) => ({
  _id: e._id,
  nomDossierDBF: e.nomDossierDBF,
  trigramme: e.trigramme,
  nomComplet: e.nomComplet,
});

const checkFiles = (entreprise) => {
  const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
  const proformaPath = path.join(basePath, "proforma.dbf");
  const prodetPath = path.join(basePath, "prodet.dbf");
  if (!fs.existsSync(proformaPath))
    return { ok: false, error: `proforma.dbf non trouvé (${entreprise.nomComplet})` };
  if (!fs.existsSync(prodetPath))
    return { ok: false, error: `prodet.dbf non trouvé (${entreprise.nomComplet})` };
  return { ok: true };
};

const makeTiersMatcher = (input) => {
  const inTrim = safeTrim(input);
  const inNum = Number(inTrim);
  const inIsNum = inTrim !== "" && Number.isFinite(inNum);
  return (val) => {
    const s = safeTrim(val);
    if (s === inTrim) return true;
    if (inIsNum && s !== "" && Number(s) === inNum) return true;
    return false;
  };
};

const recDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const s = safeTrim(val);
  if (s.length === 8 && /^\d{8}$/.test(s)) {
    const d = new Date(
      parseInt(s.slice(0, 4), 10),
      parseInt(s.slice(4, 6), 10) - 1,
      parseInt(s.slice(6, 8), 10),
    );
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// Formatage JJ/MM/AAAA pour l'affichage de la date de création (proforma.DATFACT).
const fmtDateFr = (d) => {
  if (!d) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};

const inputDate = (s) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * @desc    Liste des tiers présents dans proforma.dbf (code + nom + nb proformas)
 * @route   GET /api/inventaire-proforma/:nomDossierDBF/tiers
 * @access  Private/Admin
 */
const getTiers = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const chk = checkFiles(entreprise);
  if (!chk.ok) {
    res.status(404);
    throw new Error(chk.error);
  }

  const cache = await proformaCacheService.getProformas(entreprise);

  const map = new Map();
  for (const h of cache.proformaRecords) {
    const t = safeTrim(h.TIERS);
    if (!t) continue;
    if (!map.has(t)) map.set(t, { nom: safeTrim(h.NOM), proformas: 0 });
    map.get(t).proformas += 1;
  }

  const tiers = [...map.entries()]
    .map(([code, e]) => ({ code, nom: e.nom, proformas: e.proformas }))
    .sort((a, b) => a.code.localeCompare(b.code, "fr", { numeric: true }));

  res.json({
    entreprise: formatEntreprise(entreprise),
    total: tiers.length,
    _queryTime: `${Date.now() - startTime}ms`,
    tiers,
  });
});

/**
 * @desc    Proformas d'un tiers (filtre date), groupées par NUMFACT (+ observation),
 *          lignes triées par NL et enrichies du stock théorique (article.dbf).
 * @route   GET /api/inventaire-proforma/:nomDossierDBF/tiers/:tiers?dateDebut=&dateFin=
 * @access  Private/Admin
 */
const getByTiers = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();
  const tiers = safeTrim(req.params.tiers);

  if (!tiers) {
    res.status(400);
    throw new Error("N° de tiers requis");
  }

  const chk = checkFiles(entreprise);
  if (!chk.ok) {
    res.status(404);
    throw new Error(chk.error);
  }

  const cache = await proformaCacheService.getProformas(entreprise);
  const matchTiers = makeTiersMatcher(tiers);

  const dDeb = inputDate(req.query.dateDebut);
  const dFin = inputDate(req.query.dateFin);
  if (dFin) dFin.setHours(23, 59, 59, 999);

  // 1) Entêtes du tiers → NUMFACT + NOM + TEXTE (observation)
  const numfactsSet = new Set();
  const texteByNumfact = new Map();
  const dateByNumfact = new Map();
  let nom = "";
  for (const h of cache.proformaRecords) {
    if (!matchTiers(h.TIERS)) continue;

    if (dDeb || dFin) {
      const df = recDate(h.DATFACT);
      if (dDeb && (!df || df < dDeb)) continue;
      if (dFin && (!df || df > dFin)) continue;
    }

    const nf = safeTrim(h.NUMFACT);
    if (nf) {
      numfactsSet.add(nf);
      if (!texteByNumfact.has(nf)) texteByNumfact.set(nf, safeTrim(h.TEXTE));
      if (!dateByNumfact.has(nf)) dateByNumfact.set(nf, recDate(h.DATFACT));
    }
    if (!nom) nom = safeTrim(h.NOM);
  }

  // Cache article chargé une fois (best-effort) avant l'enrichissement
  await articleCacheService.preload(entreprise).catch(() => {});

  // Détail "bipé où / combien" par NART (sur toutes les proformas du tiers)
  const bipageByNart = new Map(); // NARTupper -> Map(numfact -> qte)
  for (const nf of numfactsSet) {
    for (const r of cache.prodetByNumfact.get(nf) || []) {
      const nart = safeTrim(r.NART);
      if (isComment(nart) || !nart) continue;
      const key = nart.toUpperCase();
      if (!bipageByNart.has(key)) bipageByNart.set(key, new Map());
      const m = bipageByNart.get(key);
      m.set(nf, (m.get(nf) || 0) + toNum(r.QTE));
    }
  }
  // Détail seulement si l'article est bipé sur ≥ 2 proformas
  const detailFor = (nart) => {
    if (!nart) return null;
    const m = bipageByNart.get(nart.toUpperCase());
    if (!m || m.size < 2) return null;
    return [...m.entries()]
      .map(([nf, q]) => ({
        numfact: nf,
        texte: texteByNumfact.get(nf) || "",
        qte: q,
      }))
      .sort((a, b) => a.numfact.localeCompare(b.numfact, "fr"));
  };

  // 2) Lignes prodet par NUMFACT + stock théorique
  let totalLignes = 0;
  const groupes = [];
  for (const numfact of numfactsSet) {
    const raw = cache.prodetByNumfact.get(numfact) || [];

    // Doublon = NART présent ≥ 2 fois DANS CETTE proforma
    const nartCount = new Map();
    for (const r of raw) {
      const n = safeTrim(r.NART);
      if (isComment(n) || !n) continue;
      const k = n.toUpperCase();
      nartCount.set(k, (nartCount.get(k) || 0) + 1);
    }

    const lignes = await Promise.all(
      raw.map(async (r) => {
        const nart = safeTrim(r.NART);
        const comment = isComment(nart);
        let stock = null;
        let prev = null;
        if (!comment && nart) {
          try {
            const art = await articleCacheService.findByNart(entreprise, nart);
            if (art) {
              stock = articleCacheService.calculateStockTotal(art);
              prev =
                art.PREV !== undefined && art.PREV !== null
                  ? toNum(art.PREV)
                  : null;
            }
          } catch {
            stock = null;
            prev = null;
          }
        }
        return {
          numfact,
          nl: toNum(r.NL),
          nart,
          design: safeTrim(r.DESIGN),
          qte: toNum(r.QTE),
          stock,
          prev,
          isComment: comment,
          doublon:
            !comment && nart
              ? (nartCount.get(nart.toUpperCase()) || 0) >= 2
              : false,
          detail: comment ? null : detailFor(nart),
        };
      }),
    );

    lignes.sort((a, b) => a.nl - b.nl);
    totalLignes += lignes.length;
    groupes.push({
      numfact,
      dateFact: fmtDateFr(dateByNumfact.get(numfact)),
      texte: texteByNumfact.get(numfact) || "",
      nbLignes: lignes.length,
      lignes,
    });
  }

  groupes.sort((a, b) => a.numfact.localeCompare(b.numfact, "fr"));

  // Affectation de zone (entrepôt) par proforma — défaut S1.
  const zonesAff = await ProformaZone.find({
    entreprise: entreprise._id,
    numfact: { $in: groupes.map((g) => g.numfact) },
  }).lean();
  const zoneByNumfact = new Map(zonesAff.map((z) => [z.numfact, z.zone]));
  for (const g of groupes) {
    g.zone = zoneByNumfact.get(g.numfact) || ZONE_DEFAUT;
  }

  res.json({
    entreprise: formatEntreprise(entreprise),
    mappingEntrepots: entreprise.mappingEntrepots || {
      S1: "S1",
      S2: "S2",
      S3: "S3",
      S4: "S4",
      S5: "S5",
    },
    tiers,
    nom,
    filtreDate: {
      dateDebut: req.query.dateDebut || null,
      dateFin: req.query.dateFin || null,
    },
    totalProformas: groupes.length,
    totalLignes,
    _queryTime: `${Date.now() - startTime}ms`,
    groupes,
  });
});

/**
 * @desc    Génère la feuille de contrôle PDF d'une proforma (même format que la
 *          fiche de contrôle inventaire). « Zone » = proforma.TEXTE (observation).
 *          Lignes commentaire exclues du corps. PDF renvoyé en téléchargement.
 * @route   GET /api/inventaire-proforma/:nomDossierDBF/proforma/:numfact/fiche-controle
 * @access  Private/Admin
 */
const genererFicheControle = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const numfact = safeTrim(req.params.numfact);

  if (!numfact) {
    res.status(400);
    throw new Error("NUMFACT requis");
  }

  const chk = checkFiles(entreprise);
  if (!chk.ok) {
    res.status(404);
    throw new Error(chk.error);
  }

  const cache = await proformaCacheService.getProformas(entreprise);

  // Entête proforma → TEXTE (observation) pour le champ "Zone"
  const hIdx = cache.indexByNumfact.get(numfact);
  const headerRec = hIdx !== undefined ? cache.proformaRecords[hIdx] : null;
  const texte = headerRec ? safeTrim(headerRec.TEXTE) : "";

  // Lignes prodet de la proforma, triées par NL
  const raw = [...(cache.prodetByNumfact.get(numfact) || [])].sort(
    (a, b) => toNum(a.NL) - toNum(b.NL),
  );
  if (raw.length === 0) {
    res.status(404);
    throw new Error(`Aucune ligne pour la proforma ${numfact}`);
  }

  await articleCacheService.preload(entreprise).catch(() => {});

  // Construction des entrées (articles seulement : lignes commentaire exclues)
  const entries = [];
  for (const r of raw) {
    const nart = safeTrim(r.NART);
    if (isComment(nart)) continue;

    let art = null;
    try {
      art = await articleCacheService.findByNart(entreprise, nart);
    } catch {
      art = null;
    }
    const found = !!art;

    entries.push({
      code: found ? safeTrim(art.GENCOD) || nart : nart,
      nart: nart || "-",
      designation: found ? safeTrim(art.DESIGN) : safeTrim(r.DESIGN),
      reference: found ? safeTrim(art.REFER) : "",
      qte: toNum(r.QTE),
      stock: found ? articleCacheService.calculateStockTotal(art) : null,
      nonTrouve: !found,
      dupKey: nart ? `NART:${nart}` : `LIG:${toNum(r.NL)}`,
    });
  }

  if (entries.length === 0) {
    res.status(404);
    throw new Error(`Aucun article à contrôler pour la proforma ${numfact}`);
  }

  // Flags (mêmes règles que la fiche de contrôle normale)
  const counts = new Map();
  entries.forEach((e) => counts.set(e.dupKey, (counts.get(e.dupKey) || 0) + 1));

  const rows = entries.map((e, i) => {
    const flags = [];
    if (counts.get(e.dupKey) > 1) flags.push("D");
    if (e.nonTrouve) flags.push("A");
    else if (e.qte > e.stock) flags.push("XX");
    else if (e.stock > e.qte) flags.push("A");

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

  // « À la place de la zone » : le TEXTE (observation) de la proforma
  const header = {
    zoneCode: texte || `Proforma ${numfact}`,
    zoneType: "",
    zoneLibelle: `Proforma ${numfact}`,
    date: new Date(),
  };

  const tmp = path.join(
    os.tmpdir(),
    `fiche_proforma_${numfact.replace(/[^\w-]+/g, "_")}_${Date.now()}.pdf`,
  );

  await ecrirePDF({ header, rows, outPath: tmp });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="fiche_controle_${numfact}.pdf"`,
  );

  const stream = fs.createReadStream(tmp);
  const cleanup = () => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  };
  stream.on("close", cleanup);
  stream.on("error", cleanup);
  stream.pipe(res);
});

/** Formatage entier avec séparateur de milliers = espace simple (rendu PDF OK). */
const fmtNum = (n) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const r = Math.round(n);
  const sign = r < 0 ? "-" : "";
  return sign + Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};

/** Dessine le document d'inventaire (PDF paysage, table groupée). */
const dessinerDocInventaire = async ({
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
 * @desc    Document d'inventaire d'un tiers : tous les articles des proformas
 *          (qté cumulée) + tous les articles stock>0 non bipés, regroupés par
 *          famille (2 1ers car. NART) ou par fournisseur (article.FOURN), avec
 *          diff de stock et diff en valeur. Exclut |diff valeur| <= seuil (XPF).
 * @route   GET /api/inventaire-proforma/:nomDossierDBF/tiers/:tiers/inventaire-doc?groupBy=&seuil=&dateDebut=
 * @access  Private/Admin
 */
const genererInventaireDoc = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const tiers = safeTrim(req.params.tiers);
  if (!tiers) {
    res.status(400);
    throw new Error("N° de tiers requis");
  }

  const chk = checkFiles(entreprise);
  if (!chk.ok) {
    res.status(404);
    throw new Error(chk.error);
  }

  const groupBy =
    req.query.groupBy === "fournisseur" ? "fournisseur" : "famille";
  const seuil = Math.max(0, toNum(req.query.seuil));

  const pcache = await proformaCacheService.getProformas(entreprise);
  const matchTiers = makeTiersMatcher(tiers);
  const dDeb = inputDate(req.query.dateDebut);

  // Proformas sélectionnées (cases cochées). Si absent => toutes.
  const selParam = safeTrim(req.query.numfacts);
  const selected = selParam
    ? new Set(
        selParam
          .split(",")
          .map((x) => safeTrim(x))
          .filter(Boolean),
      )
    : null;

  // 1) NUMFACT du tiers (filtre date "à partir du" + sélection)
  const numfacts = new Set();
  const texteByNumfact = new Map();
  for (const h of pcache.proformaRecords) {
    if (!matchTiers(h.TIERS)) continue;
    if (dDeb) {
      const df = recDate(h.DATFACT);
      if (!df || df < dDeb) continue;
    }
    const nf = safeTrim(h.NUMFACT);
    if (!nf) continue;
    if (selected && !selected.has(nf)) continue;
    numfacts.add(nf);
    if (!texteByNumfact.has(nf)) texteByNumfact.set(nf, safeTrim(h.TEXTE));
  }

  // 2) Somme des QTE par NART (+ détail par proforma + nb occurrences/proforma)
  const qteByNart = new Map(); // NARTupper -> { qte, design, nart, bip, bipCount }
  for (const nf of numfacts) {
    const lignes = pcache.prodetByNumfact.get(nf) || [];
    for (const r of lignes) {
      const nart = safeTrim(r.NART);
      if (isComment(nart) || !nart) continue;
      const key = nart.toUpperCase();
      const cur = qteByNart.get(key) || {
        qte: 0,
        design: safeTrim(r.DESIGN),
        nart,
        bip: new Map(),
        bipCount: new Map(),
      };
      const q = toNum(r.QTE);
      cur.qte += q;
      cur.bip.set(nf, (cur.bip.get(nf) || 0) + q);
      cur.bipCount.set(nf, (cur.bipCount.get(nf) || 0) + 1);
      qteByNart.set(key, cur);
    }
  }

  // 3) Univers = articles stock>0 ∪ articles des proformas
  await articleCacheService.preload(entreprise).catch(() => {});
  const acache = await articleCacheService.getArticles(entreprise);

  const universe = new Map(); // NARTupper -> row
  const addFromRecord = (rec) => {
    const nart = safeTrim(rec.NART);
    if (!nart) return;
    const fourn =
      rec.FOURNISS !== undefined && rec.FOURNISS !== null
        ? safeTrim(rec.FOURNISS)
        : safeTrim(rec.FOURN);
    universe.set(nart.toUpperCase(), {
      nart,
      design: safeTrim(rec.DESIGN),
      refer: safeTrim(rec.REFER),
      gencod: safeTrim(rec.GENCOD),
      fourn,
      stock: articleCacheService.calculateStockTotal(rec),
      prev:
        rec.PREV !== undefined && rec.PREV !== null ? toNum(rec.PREV) : 0,
      qte: 0,
      nonTrouve: false,
    });
  };

  for (const idx of acache.articlesEnStock) addFromRecord(acache.records[idx]);

  for (const [key, info] of qteByNart) {
    if (!universe.has(key)) {
      const idx = acache.indexByNart.get(key);
      if (idx !== undefined) addFromRecord(acache.records[idx]);
      else
        universe.set(key, {
          nart: info.nart,
          design: info.design,
          refer: "",
          gencod: "",
          fourn: "",
          stock: 0,
          prev: 0,
          qte: 0,
          nonTrouve: true,
        });
    }
    universe.get(key).qte += info.qte;
    // Doublon = NART ≥ 2 fois dans une même proforma
    universe.get(key).doublon = info.bipCount
      ? [...info.bipCount.values()].some((c) => c >= 2)
      : false;
    // Recap par proforma (OBSERV + qté) — pour toute proforma bipée (≥ 1)
    if (info.bip && info.bip.size >= 1) {
      universe.get(key).detail = [...info.bip.entries()]
        .map(([nf, q]) => ({
          numfact: nf,
          texte: texteByNumfact.get(nf) || "",
          qte: q,
        }))
        .sort((a, b) => a.numfact.localeCompare(b.numfact, "fr"));
    }
  }

  // 4) Diff + flags ATT (D, XX uniquement) + filtre seuil (valeur absolue)
  const rows = [];
  for (const row of universe.values()) {
    const diff = row.qte - row.stock;
    const diffval = Math.round(diff * row.prev);
    if (Math.abs(diffval) <= seuil) continue;
    const flags = [];
    if (row.doublon) flags.push("D"); // NART ≥ 2 fois dans une même proforma
    if (row.qte > row.stock) flags.push("XX"); // quantité excédentaire
    rows.push({ ...row, diff, diffval, att: flags.join(" ") });
  }

  if (rows.length === 0) {
    res.status(404);
    throw new Error("Aucun article au-dessus du seuil de valeur indiqué.");
  }

  // Résolution du nom fournisseur (fourniss.dbf, lié par FOURN), mise en cache.
  const nomFournByCode = new Map();
  const resolveNomFourn = async (code) => {
    const key = safeTrim(code);
    if (key === "") return "";
    if (nomFournByCode.has(key)) return nomFournByCode.get(key);
    let nom = "";
    try {
      const f = await fournissCacheService.findByFourn(entreprise, key);
      if (f) nom = safeTrim(f.NOM);
    } catch {
      nom = "";
    }
    nomFournByCode.set(key, nom);
    return nom;
  };
  for (const r of rows) {
    r.fournNom = await resolveNomFourn(r.fourn);
  }

  // 5) Groupement
  const keyOf = (r) =>
    groupBy === "fournisseur" ? r.fourn || "—" : r.nart.slice(0, 2) || "—";
  const groupsMap = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!groupsMap.has(k))
      groupsMap.set(k, {
        key: k,
        nom: groupBy === "fournisseur" ? r.fournNom || "" : "",
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
    g.rows.sort((a, b) => a.nart.localeCompare(b.nart, "fr")),
  );
  const grandTotal = rows.reduce((a, r) => a + r.diffval, 0);

  // 6) Sortie : PDF (défaut) ou Excel
  const groupLabel = groupBy === "fournisseur" ? "Fournisseur" : "Famille";
  const titre = `Inventaire proforma — Tiers ${tiers} — par ${
    groupBy === "fournisseur" ? "fournisseur" : "famille"
  }${seuil ? ` (|écart| > ${fmtNum(seuil)} XPF)` : ""}`;

  if (req.query.format === "xlsx") {
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

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="inventaire_proforma_${tiers}.xlsx"`,
    );
    await wb.xlsx.write(res);
    res.end();
    return;
  }

  // PDF paysage
  const tmp = path.join(
    os.tmpdir(),
    `inv_proforma_${tiers.replace(/[^\w-]+/g, "_")}_${Date.now()}.pdf`,
  );

  await dessinerDocInventaire({
    titre,
    groupes,
    grandTotal,
    groupLabel,
    outPath: tmp,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="inventaire_proforma_${tiers}.pdf"`,
  );
  const stream = fs.createReadStream(tmp);
  const cleanup = () => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  };
  stream.on("close", cleanup);
  stream.on("error", cleanup);
  stream.pipe(res);
});

/**
 * @desc    Affecter une proforma à une zone/entrepôt (S1..S5)
 * @route   PUT /api/inventaire-proforma/:nomDossierDBF/proforma/:numfact/zone
 * @access  Admin
 */
const setProformaZone = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const numfact = safeTrim(req.params.numfact);
  const zone = safeTrim(req.body.zone).toUpperCase();

  if (!numfact) {
    res.status(400);
    throw new Error("NUMFACT requis");
  }
  if (!ZONES.includes(zone)) {
    res.status(400);
    throw new Error(`Zone invalide (attendu : ${ZONES.join(", ")})`);
  }

  const doc = await ProformaZone.findOneAndUpdate(
    { entreprise: entreprise._id, numfact },
    { $set: { zone, nomDossierDBF: entreprise.nomDossierDBF } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  res.json({ numfact: doc.numfact, zone: doc.zone });
});

/**
 * @desc    Exporter les proformas d'un tiers en .DAT (format réappro).
 *          portee = "zone" (un fichier par entrepôt) | "general" (un seul fichier)
 *          mode   = "serveur" (cheminExportInventaire) | "download" (poste, ZIP si multi)
 * @route   POST /api/inventaire-proforma/:nomDossierDBF/tiers/:tiers/export-dat
 * @access  Admin
 */
const exportProformaDat = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const tiers = safeTrim(req.params.tiers);
  const { dateDebut, dateFin, mode, portee, cheminDestination } = req.body;

  if (!tiers) {
    res.status(400);
    throw new Error("N° de tiers requis");
  }

  const chk = checkFiles(entreprise);
  if (!chk.ok) {
    res.status(404);
    throw new Error(chk.error);
  }

  const cache = await proformaCacheService.getProformas(entreprise);
  const matchTiers = makeTiersMatcher(tiers);
  const dDeb = inputDate(dateDebut);
  const dFin = inputDate(dateFin);
  if (dFin) dFin.setHours(23, 59, 59, 999);

  // NUMFACT du tiers (+ filtre date) — même périmètre que getByTiers
  const numfacts = [];
  const seen = new Set();
  for (const h of cache.proformaRecords) {
    if (!matchTiers(h.TIERS)) continue;
    if (dDeb || dFin) {
      const df = recDate(h.DATFACT);
      if (dDeb && (!df || df < dDeb)) continue;
      if (dFin && (!df || df > dFin)) continue;
    }
    const nf = safeTrim(h.NUMFACT);
    if (nf && !seen.has(nf)) {
      seen.add(nf);
      numfacts.push(nf);
    }
  }
  if (numfacts.length === 0) {
    res.status(400);
    throw new Error("Aucune proforma pour ce tiers / cette période");
  }

  await articleCacheService.preload(entreprise).catch(() => {});

  // Zone par proforma (défaut S1)
  const zonesAff = await ProformaZone.find({
    entreprise: entreprise._id,
    numfact: { $in: numfacts },
  }).lean();
  const zoneByNumfact = new Map(zonesAff.map((z) => [z.numfact, z.zone]));

  // Agrégation par bucket (zone, ou "__general__") -> Map(NART -> { nart, quantite })
  // Proforma inventaire : identifiant = NART uniquement (pas de GENCOD).
  const general = portee === "general";
  const buckets = new Map();
  const ensure = (k) => {
    if (!buckets.has(k)) buckets.set(k, new Map());
    return buckets.get(k);
  };

  for (const nf of numfacts) {
    const zone = zoneByNumfact.get(nf) || ZONE_DEFAUT;
    const agg = ensure(general ? "__general__" : zone);
    for (const r of cache.prodetByNumfact.get(nf) || []) {
      const nart = safeTrim(r.NART);
      if (isComment(nart) || !nart) continue;
      const q = Math.max(0, toNum(r.QTE)); // quantité négative -> 0
      const key = nart.toUpperCase();
      const cur = agg.get(key) || { nart, quantite: 0 };
      cur.quantite += q;
      agg.set(key, cur);
    }
  }

  // Construction des fichiers
  const files = [];
  for (const [bucketKey, agg] of buckets) {
    const lignes = [...agg.values()];
    lignes.sort((a, b) => a.nart.localeCompare(b.nart, "fr"));
    const zoneForName = general ? "general" : bucketKey;
    files.push({
      zone: zoneForName,
      name: nomFichierDat(zoneForName),
      data: Buffer.from(genererContenuDat(lignes), "utf8"),
      nbLignes: lignes.length,
    });
  }
  files.sort((a, b) => a.zone.localeCompare(b.zone, "fr"));

  if (files.length === 0) {
    res.status(400);
    throw new Error("Rien à exporter");
  }

  // ---- Destination : serveur ----
  if (mode === "serveur") {
    let cheminExport =
      entreprise.cheminExportInventaire ||
      (cheminDestination && cheminDestination.trim()) ||
      "/mnt/rcommun/STOCK/collect_sec";
    try {
      if (!fs.existsSync(cheminExport)) {
        fs.mkdirSync(cheminExport, { recursive: true });
      }
    } catch (e) {
      res.status(400);
      throw new Error(
        `Impossible d'accéder au chemin: ${cheminExport}. Vérifiez les droits. (${e.message})`,
      );
    }
    const ecrits = [];
    for (const f of files) {
      const p = path.join(cheminExport, f.name);
      try {
        fs.writeFileSync(p, f.data, "utf8");
      } catch (e) {
        res.status(400);
        throw new Error(`Impossible d'écrire ${f.name}: ${e.message}`);
      }
      ecrits.push({ fichier: f.name, zone: f.zone, lignes: f.nbLignes, chemin: p });
    }
    return res.json({
      message: `${ecrits.length} fichier(s) .DAT exporté(s) sur le serveur`,
      dossier: cheminExport,
      fichiers: ecrits,
    });
  }

  // ---- Destination : téléchargement (poste) ----
  if (files.length === 1) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${files[0].name}"`);
    return res.send(files[0].data);
  }
  const zip = makeZip(files.map((f) => ({ name: f.name, data: f.data })));
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="inventaire_proforma_${tiers}_dat.zip"`,
  );
  return res.send(zip);
});

export {
  getTiers,
  getByTiers,
  genererFicheControle,
  genererInventaireDoc,
  setProformaZone,
  exportProformaDat,
};