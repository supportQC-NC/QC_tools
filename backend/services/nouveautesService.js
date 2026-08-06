// backend/services/nouveautesService.js
//
// Module « Communication client — catalogue nouveautés ».
//
// DÉFINITION d'une NOUVEAUTÉ (règle métier QC) :
//   Le champ article.CREATION n'est PAS fiable (l'article est souvent créé des
//   mois avant sa 1ère réception). Un NART est une nouveauté si :
//     1) il a une entrée (entrees.dbf) dont la date tombe dans la plage choisie,
//     2) il n'a JAMAIS eu d'entrée AVANT celle-ci (= sa 1ère entrée est dans la plage),
//     3) il n'a JAMAIS eu de ventes (proxy fiable : ventes 12 mois V1..V12 == 0 ;
//        valable car la 1ère entrée est récente → toutes ses ventes seraient dans
//        la fenêtre 12 mois),
//   et (pour un catalogue client) il est en stock (S1..S5 > 0).
//
// entrees.dbf (~67 Mo) est lu EN STREAMING (min entrée par NART), mis en cache.
import path from "path";
import fs from "fs";
import { DBFFile } from "dbffile";
import articleCacheService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";

const BATCH = 2000;
const TTL_MS = 10 * 60 * 1000;

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const digitsOnly = (v) => (v == null ? "" : String(v)).replace(/\D/g, "");
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
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
const dayToYmd = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) ? s.replace(/-/g, "") : "";

// Date d'entrée d'une ligne entrees.dbf : ARRIVEE en priorité, repli DATFACT.
const entryYmd = (rec) => toYmd(rec.ARRIVEE) || toYmd(rec.DATFACT);

const stockTotal = (r) =>
  num(r.S1) + num(r.S2) + num(r.S3) + num(r.S4) + num(r.S5);
const ventes12 = (r) => {
  let s = 0;
  for (let i = 1; i <= 12; i++) s += num(r[`V${i}`]);
  return s;
};

// ── Cache : Map<NART, 1ère date d'entrée "YYYYMMDD"> par société ─────────────
const firstEntryCache = new Map(); // dossier -> { map, loadedAt, mtime, size }

const getFirstEntryMap = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const dbfPath = path.join(entreprise.cheminBase, dossier, "entrees.dbf");
  const cached = firstEntryCache.get(dossier);
  const st = (() => {
    try {
      return fs.statSync(dbfPath);
    } catch {
      return null;
    }
  })();
  if (!st) throw new Error(`entrees.dbf introuvable: ${dbfPath}`);
  if (
    cached &&
    Date.now() - cached.loadedAt < TTL_MS &&
    cached.mtime === st.mtime.getTime() &&
    cached.size === st.size
  ) {
    return cached.map;
  }

  const t0 = Date.now();
  const dbf = await DBFFile.open(dbfPath, { readMode: "loose" });
  const map = new Map(); // NART(upper) -> min ymd
  let batch;
  let scanned = 0;
  while ((batch = await dbf.readRecords(BATCH)).length > 0) {
    scanned += batch.length;
    for (const r of batch) {
      const nart = safeTrim(r.NART).toUpperCase();
      if (!nart) continue;
      const ymd = entryYmd(r);
      if (!ymd || ymd.length !== 8) continue;
      const prev = map.get(nart);
      if (!prev || ymd < prev) map.set(nart, ymd);
    }
  }
  firstEntryCache.set(dossier, {
    map,
    loadedAt: Date.now(),
    mtime: st.mtime.getTime(),
    size: st.size,
  });
  console.log(
    `[Nouveautes] entrees ${dossier}: ${map.size} NART (1ère entrée) — scan ${scanned} en ${Date.now() - t0}ms`,
  );
  return map;
};

/**
 * Catalogue des nouveautés d'une société pour une période.
 * @param {Object} entreprise
 * @param {{start:string,end:string}} periode - dates "YYYY-MM-DD"
 */
export const getNouveautes = async (entreprise, { start, end }) => {
  const startYmd = dayToYmd(start);
  const endYmd = dayToYmd(end);
  if (!startYmd || !endYmd) {
    return { periode: { start, end }, total: 0, groupes: [] };
  }

  const firstEntry = await getFirstEntryMap(entreprise);

  // Candidats : NART dont la 1ère entrée EVER tombe dans la plage.
  const retenus = [];
  for (const [nart, ymd] of firstEntry) {
    if (ymd < startYmd || ymd > endYmd) continue;
    let article = null;
    try {
      article = await articleCacheService.findByNart(entreprise, nart);
    } catch {
      article = null;
    }
    if (!article) continue;
    if (stockTotal(article) <= 0) continue; // catalogue = produits dispo
    if (ventes12(article) > 0) continue; // jamais vendu (12 mois glissants)
    retenus.push({ article, firstEntry: ymd });
  }

  // Groupement par fournisseur.
  const nomFournCache = new Map();
  const resolveNomFourn = async (code) => {
    const key = String(code);
    if (nomFournCache.has(key)) return nomFournCache.get(key);
    let nom = "";
    try {
      const f = await fournissCacheService.findByFourn(entreprise, code);
      nom = safeTrim(f?.NOM);
    } catch {
      nom = "";
    }
    nomFournCache.set(key, nom);
    return nom;
  };

  const groupesMap = new Map();
  for (const { article: r, firstEntry: fe } of retenus) {
    const fourn = num(r.FOURN);
    const nom = await resolveNomFourn(fourn);
    if (!groupesMap.has(fourn)) {
      groupesMap.set(fourn, {
        fourn,
        nom: nom || `Fournisseur ${fourn}`,
        articles: [],
      });
    }
    groupesMap.get(fourn).articles.push({
      nart: safeTrim(r.NART),
      design: safeTrim(r.DESIGN),
      refer: safeTrim(r.REFER),
      gencod: digitsOnly(r.GENCOD),
      fourn,
      pvte: num(r.PVTE),
      pvtettc: num(r.PVTETTC),
      stock: stockTotal(r),
      dateEntree: ymdToFr(fe),
    });
  }

  const groupes = [...groupesMap.values()].sort((a, b) =>
    a.nom.localeCompare(b.nom, "fr"),
  );
  for (const g of groupes) {
    g.articles.sort((a, b) => a.design.localeCompare(b.design, "fr"));
  }

  return { periode: { start, end }, total: retenus.length, groupes };
};

export default { getNouveautes };
