// backend/controllers/inventaireProformaController.js
import asyncHandler from "../middleware/asyncHandler.js";
import {
  fmtNum,
  grouperEcarts,
  dessinerDocInventaire,
  construireClasseurEcarts,
} from "../services/ecartsInventaireService.js";
import proformaCacheService from "../services/proformaCacheService.js";
import articleCacheService from "../services/articleService.js";
import fournissCacheService from "../services/fournissCacheService.js";
import { ecrirePDF } from "../services/ficheControleService.js";
import { envoyerClasseur } from "../utils/envoyerClasseur.js";
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
      const idx = articleCacheService.lookupNart(acache, key);
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

  // 5) Groupement (service commun avec « Détail des bipages »)
  const { groupes, grandTotal, groupLabel } = grouperEcarts(rows, groupBy);

  // 6) Sortie : PDF (défaut) ou Excel
  const titre = `Inventaire proforma — Tiers ${tiers} — par ${
    groupBy === "fournisseur" ? "fournisseur" : "famille"
  }${seuil ? ` (|écart| > ${fmtNum(seuil)} XPF)` : ""}`;

  if (req.query.format === "xlsx") {
    const wb = await construireClasseurEcarts({
      titre,
      groupes,
      grandTotal,
      groupLabel,
    });
    // Droits « champ par champ » appliqués avant l'envoi.
    await envoyerClasseur(
      req,
      res,
      wb,
      `inventaire_proforma_${tiers}.xlsx`,
    );
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

/**
 * @desc    Export « gisement » (Excel) : UNE LIGNE PAR ARTICLE des proformas du
 *          tiers. Colonnes : NUMFACT (prodet), date proforma (DATFACT), NART,
 *          DÉSIGNATION (prodet), FOURN (article), nom FOURNISSEUR (fourniss.dbf),
 *          OBSERVATION (proforma.TEXTE), LOCALISATION (zone S1..S5 de la proforma).
 *          Respecte le filtre date (dateDebut/dateFin) et la sélection (numfacts).
 * @route   GET /api/inventaire-proforma/:nomDossierDBF/tiers/:tiers/export-gisement
 * @access  Private/Admin
 */
const exportGisement = asyncHandler(async (req, res) => {
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

  const cache = await proformaCacheService.getProformas(entreprise);
  const matchTiers = makeTiersMatcher(tiers);
  const dDeb = inputDate(req.query.dateDebut);
  const dFin = inputDate(req.query.dateFin);
  if (dFin) dFin.setHours(23, 59, 59, 999);

  // Sélection de proformas (cases cochées). Absent => toutes.
  const selParam = safeTrim(req.query.numfacts);
  const selected = selParam
    ? new Set(selParam.split(",").map((x) => safeTrim(x)).filter(Boolean))
    : null;

  // 1) Entêtes du tiers → NUMFACT + date (DATFACT) + observation (TEXTE)
  const headerByNumfact = new Map();
  for (const h of cache.proformaRecords) {
    if (!matchTiers(h.TIERS)) continue;
    if (dDeb || dFin) {
      const df = recDate(h.DATFACT);
      if (dDeb && (!df || df < dDeb)) continue;
      if (dFin && (!df || df > dFin)) continue;
    }
    const nf = safeTrim(h.NUMFACT);
    if (!nf || (selected && !selected.has(nf))) continue;
    if (!headerByNumfact.has(nf)) {
      headerByNumfact.set(nf, {
        date: recDate(h.DATFACT),
        texte: safeTrim(h.TEXTE),
      });
    }
  }
  const numfacts = [...headerByNumfact.keys()].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
  if (numfacts.length === 0) {
    res.status(404);
    throw new Error("Aucune proforma pour ce tiers / cette période");
  }

  // 2) Zone (localisation) par proforma — défaut S1.
  const zonesAff = await ProformaZone.find({
    entreprise: entreprise._id,
    numfact: { $in: numfacts },
  }).lean();
  const zoneByNumfact = new Map(zonesAff.map((z) => [z.numfact, z.zone]));

  await articleCacheService.preload(entreprise).catch(() => {});

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

  // 3) Une ligne par article (lignes commentaire exclues). FOURN vient de
  //    l'article (article.dbf), résolu par NART.
  const rows = [];
  for (const nf of numfacts) {
    const hdr = headerByNumfact.get(nf);
    const localisation = zoneByNumfact.get(nf) || ZONE_DEFAUT;
    const raw = [...(cache.prodetByNumfact.get(nf) || [])].sort(
      (a, b) => toNum(a.NL) - toNum(b.NL),
    );
    for (const r of raw) {
      const nart = safeTrim(r.NART);
      if (isComment(nart) || !nart) continue;

      let fourn = "";
      try {
        const art = await articleCacheService.findByNart(entreprise, nart);
        if (art) {
          fourn =
            art.FOURNISS !== undefined && art.FOURNISS !== null
              ? safeTrim(art.FOURNISS)
              : safeTrim(art.FOURN);
        }
      } catch {
        fourn = "";
      }
      const fournNom = await resolveNomFourn(fourn);

      rows.push({
        numfact: nf,
        date: hdr.date,
        nart,
        design: safeTrim(r.DESIGN),
        fourn,
        fournNom,
        observation: hdr.texte,
        localisation,
      });
    }
  }

  if (rows.length === 0) {
    res.status(404);
    throw new Error("Aucun article à exporter pour ce tiers / cette période");
  }

  // 4) Génération Excel
  const ExcelMod = await import("exceljs").catch(() => {
    throw new Error("Module 'exceljs' introuvable. Lancez : npm i exceljs");
  });
  const ExcelJS = ExcelMod.default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Gisement");

  ws.columns = [
    { header: "NUMFACT", key: "numfact", width: 12 },
    { header: "Date proforma", key: "date", width: 14 },
    { header: "NART", key: "nart", width: 12 },
    { header: "Désignation", key: "design", width: 42 },
    { header: "Fourn.", key: "fourn", width: 10 },
    { header: "Fournisseur", key: "fournNom", width: 30 },
    { header: "Observation", key: "observation", width: 32 },
    { header: "Localisation", key: "localisation", width: 14 },
  ];

  const hr = ws.getRow(1);
  hr.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF333333" } };
    c.alignment = { horizontal: "left" };
  });

  for (const r of rows) {
    const row = ws.addRow(r);
    const dcell = row.getCell("date");
    if (r.date instanceof Date) {
      dcell.value = r.date;
      dcell.numFmt = "dd/mm/yyyy";
    } else {
      dcell.value = "";
    }
  }

  // Droits « champ par champ » appliqués avant l'envoi.
  await envoyerClasseur(req, res, wb, `export_gisement_${tiers}.xlsx`);
});

export {
  getTiers,
  getByTiers,
  genererFicheControle,
  genererInventaireDoc,
  setProformaZone,
  exportProformaDat,
  exportGisement,
};