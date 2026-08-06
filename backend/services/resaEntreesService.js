// backend/services/resaEntreesService.js
//
// Module « Entrées sur réservation » — portage Access QC_master_report
// (RESA_ARTICLE_EN_ENTREE / rqETAReservation / procResaSurEntrees).
//
// But : quand un article en RÉSERVATION (facture TYPFACT="R") ENTRE en stock
// (entrees.dbf), on l'affiche avec le vendeur (code REPRES + nom via la config
// entreprise.vendeurs), le client (nom + identifiant TIERS) et l'état résa
// (1=Réservation Stock, 2=Commande Spéciale via entreprise.mappingEtatsReservation).
//
// ⚠️ PERF : facture.dbf 391 Mo + detail.dbf 1,17 Go + entrees.dbf 67 Mo.
// Lecture EN STREAMING par lots (dbf.readRecords(2000)), on ne conserve que
// l'index des réservations (petit) et les entrées de la période. Caches TTL.
import path from "path";
import fs from "fs";
import { DBFFile } from "dbffile";
import articleCacheService from "./articleService.js";
import clientCacheService from "./clientCacheService.js";

const BATCH = 2000;

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const digitsOnly = (v) => (v == null ? "" : String(v)).replace(/\D/g, "");
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const toYmd = (v) => {
  if (v == null) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    return `${v.getFullYear()}${String(v.getMonth() + 1).padStart(2, "0")}${String(v.getDate()).padStart(2, "0")}`;
  }
  return digitsOnly(v).slice(0, 8);
};
const ymdToFr = (ymd) =>
  ymd && ymd.length === 8
    ? `${ymd.slice(6, 8)}/${ymd.slice(4, 6)}/${ymd.slice(0, 4)}`
    : "";

const entryYmd = (rec) => toYmd(rec.ARRIVEE) || toYmd(rec.DATFACT);

const statSafe = (p) => {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
};

const dbfPathFor = (entreprise, file) =>
  path.join(entreprise.cheminBase, entreprise.nomDossierDBF, file);

// Libellé de l'état de réservation (Map Mongoose OU objet).
const etatLabel = (entreprise, etat) => {
  const key = String(etat);
  const m = entreprise?.mappingEtatsReservation;
  if (!m) return "Inconnu";
  if (typeof m.get === "function") return safeTrim(m.get(key)) || "Inconnu";
  return safeTrim(m[key]) || "Inconnu";
};

// Nom du vendeur si le code REPRES matche un vendeur de la config entreprise.
const vendeurNom = (entreprise, repres) => {
  const list = Array.isArray(entreprise?.vendeurs) ? entreprise.vendeurs : [];
  const code = safeTrim(repres);
  const n = Number(repres);
  const v = list.find((x) => {
    const c = safeTrim(x.code);
    return c === code || (Number.isFinite(n) && parseInt(c, 10) === n);
  });
  return v ? safeTrim(v.nom) : "";
};

// ─────────────── Index des réservations (facture + detail, streaming) ────────
// Map<NART_upper, [{ numfact, qteResa, tiers, repres, etat, nom, texte, datfact }]>
const RESA_TTL_MS = 10 * 60 * 1000;
const resaCache = new Map(); // dossier -> { index, loadedAt, mFact, sFact, mDet, sDet }

const getReservationsIndex = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const factPath = dbfPathFor(entreprise, "facture.dbf");
  const detPath = dbfPathFor(entreprise, "detail.dbf");
  const stF = statSafe(factPath);
  const stD = statSafe(detPath);
  if (!stF) throw new Error(`facture.dbf introuvable: ${factPath}`);
  if (!stD) throw new Error(`detail.dbf introuvable: ${detPath}`);

  const cached = resaCache.get(dossier);
  if (
    cached &&
    Date.now() - cached.loadedAt < RESA_TTL_MS &&
    cached.mFact === stF.mtime.getTime() &&
    cached.sFact === stF.size &&
    cached.mDet === stD.mtime.getTime() &&
    cached.sDet === stD.size
  ) {
    return cached.index;
  }

  const t0 = Date.now();

  // Phase 1 : entêtes réservation (facture TYPFACT="R").
  const factDbf = await DBFFile.open(factPath, { readMode: "loose" });
  const resaFactures = new Map(); // NUMFACT -> header
  let batch;
  let scannedF = 0;
  while ((batch = await factDbf.readRecords(BATCH)).length > 0) {
    scannedF += batch.length;
    for (const r of batch) {
      if (safeTrim(r.TYPFACT).toUpperCase() !== "R") continue;
      const numfact = safeTrim(r.NUMFACT);
      if (!numfact) continue;
      resaFactures.set(numfact, {
        numfact,
        tiers: num(r.TIERS),
        repres: num(r.REPRES),
        etat: num(r.ETAT),
        nom: safeTrim(r.NOM),
        texte: safeTrim(r.TEXTE),
        datfact: toYmd(r.DATFACT),
      });
    }
  }

  // Phase 2 : lignes réservées (detail dont NUMFACT ∈ résa, QTE≠0) -> par NART.
  const detDbf = await DBFFile.open(detPath, { readMode: "loose" });
  const index = new Map(); // NART_upper -> [{ numfact, qteResa, ...header }]
  let scannedD = 0;
  while ((batch = await detDbf.readRecords(BATCH)).length > 0) {
    scannedD += batch.length;
    for (const r of batch) {
      const numfact = safeTrim(r.NUMFACT);
      if (!numfact) continue;
      const header = resaFactures.get(numfact);
      if (!header) continue;
      if (Number(r.QTE) === 0) continue;
      const nart = safeTrim(r.NART).toUpperCase();
      if (!nart) continue;
      if (!index.has(nart)) index.set(nart, []);
      index.get(nart).push({ ...header, qteResa: num(r.QTE) });
    }
  }

  resaCache.set(dossier, {
    index,
    loadedAt: Date.now(),
    mFact: stF.mtime.getTime(),
    sFact: stF.size,
    mDet: stD.mtime.getTime(),
    sDet: stD.size,
  });
  console.log(
    `[ResaEntrees] Réservations ${dossier}: ${resaFactures.size} factures R, ${index.size} NART (scan facture ${scannedF} + detail ${scannedD} en ${Date.now() - t0}ms)`,
  );
  return index;
};

// ─────────────── Entrées d'une période (streaming entrees.dbf) ───────────────
const ENTREES_TTL_MS = 5 * 60 * 1000;
const entreesRangeCache = new Map(); // `${dossier}::${start}::${end}` -> {...}

const getEntreesRange = async (entreprise, startYmd, endYmd) => {
  const dossier = entreprise.nomDossierDBF;
  const p = dbfPathFor(entreprise, "entrees.dbf");
  const st = statSafe(p);
  if (!st) throw new Error(`entrees.dbf introuvable: ${p}`);
  const cacheKey = `${dossier}::${startYmd}::${endYmd}`;
  const cached = entreesRangeCache.get(cacheKey);
  if (
    cached &&
    Date.now() - cached.loadedAt < ENTREES_TTL_MS &&
    cached.mtime === st.mtime.getTime() &&
    cached.size === st.size
  ) {
    return cached.map;
  }

  const dbf = await DBFFile.open(p, { readMode: "loose" });
  const map = new Map(); // NART_upper -> { dateEntree(ymd), numcde, qteEntree }
  let batch;
  while ((batch = await dbf.readRecords(BATCH)).length > 0) {
    for (const r of batch) {
      const ymd = entryYmd(r);
      if (!ymd || ymd < startYmd || ymd > endYmd) continue;
      const nart = safeTrim(r.NART).toUpperCase();
      if (!nart) continue;
      const prev = map.get(nart);
      // garde l'entrée la plus RÉCENTE de la période
      if (!prev || ymd > prev.dateEntree) {
        map.set(nart, {
          dateEntree: ymd,
          numcde: safeTrim(r.NUMCDE),
          qteEntree: num(r.QTE),
        });
      }
    }
  }
  entreesRangeCache.set(cacheKey, {
    map,
    loadedAt: Date.now(),
    mtime: st.mtime.getTime(),
    size: st.size,
  });
  return map;
};

/**
 * Articles en réservation qui sont entrés en stock sur une période.
 * @param {Object} entreprise - document entreprise (mappingEtatsReservation, vendeurs)
 * @param {{start:string,end:string}} periode - dates "YYYY-MM-DD"
 * @returns {Promise<{periode, total, rows}>}
 */
export const getResaEntrees = async (entreprise, { start, end }) => {
  const startYmd = /^\d{4}-\d{2}-\d{2}$/.test(String(start || ""))
    ? start.replace(/-/g, "")
    : "";
  const endYmd = /^\d{4}-\d{2}-\d{2}$/.test(String(end || ""))
    ? end.replace(/-/g, "")
    : "";
  if (!startYmd || !endYmd) {
    return { periode: { start, end }, total: 0, rows: [] };
  }

  const [resaIndex, entreesMap] = await Promise.all([
    getReservationsIndex(entreprise),
    getEntreesRange(entreprise, startYmd, endYmd),
  ]);

  const rows = [];
  for (const [nartKey, entree] of entreesMap) {
    const resas = resaIndex.get(nartKey);
    if (!resas || resas.length === 0) continue;

    // Article (désignation, gencod) résolu une fois.
    let article = null;
    try {
      article = await articleCacheService.findByNart(entreprise, nartKey);
    } catch {
      article = null;
    }
    const design = safeTrim(article?.DESIGN);
    const gencod = digitsOnly(article?.GENCOD);
    const nart = safeTrim(article?.NART) || nartKey;
    const stockTotal =
      num(article?.S1) +
      num(article?.S2) +
      num(article?.S3) +
      num(article?.S4) +
      num(article?.S5);

    // Une ligne PAR réservation de ce NART.
    for (const rz of resas) {
      let client = rz.nom;
      if (!client && rz.tiers != null) {
        try {
          const c = await clientCacheService.findByTiers(entreprise, rz.tiers);
          client = safeTrim(c?.NOM);
        } catch {
          /* garde vide */
        }
      }
      rows.push({
        nart,
        design,
        gencod,
        etatCode: rz.etat,
        etatResa: etatLabel(entreprise, rz.etat),
        qteResa: rz.qteResa,
        qteEntree: entree.qteEntree,
        stockTotal,
        dateEntree: ymdToFr(entree.dateEntree),
        dateEntreeYmd: entree.dateEntree,
        client: client || "",
        tiers: rz.tiers,
        vendeurCode: rz.repres,
        vendeurNom: vendeurNom(entreprise, rz.repres),
        refResa: rz.numfact,
        texteResa: rz.texte,
        dateResa: ymdToFr(rz.datfact),
      });
    }
  }

  // Tri : date d'entrée décroissante puis client.
  rows.sort((a, b) => {
    if (a.dateEntreeYmd !== b.dateEntreeYmd)
      return b.dateEntreeYmd.localeCompare(a.dateEntreeYmd);
    return String(a.client).localeCompare(String(b.client), "fr");
  });

  return { periode: { start, end }, total: rows.length, rows };
};

export default { getResaEntrees };
