// backend/services/entreesService.js
//
// Module « Suivi des entrées » — portage de l'outil Access QC_SUIVI_ENTREES.
// Lit entrees.dbf (marchandises reçues / entrées en stock) et reconstruit la
// grille du jour enrichie de l'Access (requêtes GET_ENTREES_MAIN_DATA /
// ENTREE_ALL_DATA / CTRL_TGC).
//
// Différence assumée avec l'Access : la « date d'entrée » n'est PAS mémorisée
// dans une table d'historique locale (HISTORIQUE_DATE_ENTREE) mais CALCULÉE À LA
// VOLÉE depuis entrees.dbf (champ ARRIVEE, repli DATFACT). Aucun état à
// maintenir, aucun job. Multi-sociétés (l'Access ne gérait que QC).
//
// ⚠️ PERFORMANCE / MÉMOIRE : les .dbf de l'ERP sont ÉNORMES (facture/detail QC ≈
// 1,7 M lignes). On NE charge JAMAIS un fichier entier en mémoire ici : lecture
// EN STREAMING par lots, on ne conserve que le peu qui sert (lignes de la date,
// Set de NART réservés). Charger tout provoquait un « heap out of memory ».
//
// Enrichissements 100 % ERP DBF (portables à toutes les sociétés) :
//   - article.dbf : DESIGN, REFER, GENCOD, PVTETTC, S1 (stock magasin),
//     S2 (stock dock), GISM1 (rayon), PLACE, PVTE, ATVA, CREATION ;
//   - fourniss.dbf : nom du fournisseur ;
//   - flag RÉSA : NART présent dans une réservation (detail.dbf TYPFACT="R") ;
//   - flag CHGT PRIX : NART dont le prix a changé ce jour (verif.dbf) ;
//   - flag NOUVEAUTÉ (approx.) : article créé il y a moins de 30 jours ;
//   - contrôle TGC : écart entre PVTE et PVTETTC/(1+ATVA/100) (>= 1.5 => anomalie).
// Les enrichissements QC-only de l'Access (nouveautés catalogue, commentaires
// manuels, libellés rayons, référentiel marges REF3009) ne sont pas portés.
import path from "path";
import fs from "fs";
import { DBFFile } from "dbffile";
import articleCacheService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";
import { getChangementsPrix } from "./verifService.js";

const BATCH = 2000; // lignes lues par lot en streaming

// ─────────────────────────── Helpers ────────────────────────────────────────
const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const digitsOnly = (v) => (v == null ? "" : String(v)).replace(/\D/g, "");
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Normalise une valeur date (objet Date des .dbf, ou chaîne "YYYYMMDD") en
// "YYYYMMDD". Chaîne vide si absente/invalide.
const toYmd = (v) => {
  if (v == null) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }
  return digitsOnly(v).slice(0, 8);
};

const ymdToFr = (ymd) =>
  ymd && ymd.length === 8
    ? `${ymd.slice(6, 8)}/${ymd.slice(4, 6)}/${ymd.slice(0, 4)}`
    : "";

// Date d'entrée d'une ligne entrees.dbf : ARRIVEE en priorité, repli DATFACT.
const entryYmd = (rec) => toYmd(rec.ARRIVEE) || toYmd(rec.DATFACT);

// "YYYYMMDD" - N jours -> "YYYYMMDD".
const ymdMinusDays = (ymd, days) => {
  if (!ymd || ymd.length !== 8) return "";
  const d = new Date(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(4, 6)) - 1,
    Number(ymd.slice(6, 8)),
  );
  d.setDate(d.getDate() - days);
  return toYmd(d);
};

const statSafe = (p) => {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
};

// ─────────────────── Lecture entrees.dbf (streaming, filtré date) ────────────
// Cache par (société + date) : on ne garde que les lignes de la date demandée.
const ENTREES_TTL_MS = 5 * 60 * 1000;
const entreesByDate = new Map(); // `${dossier}::${ymd}` -> { records, loadedAt, mtime, size }

const getEntreesRecordsForDate = async (entreprise, dateYmd) => {
  const dossier = entreprise.nomDossierDBF;
  const dbfPath = path.join(entreprise.cheminBase, dossier, "entrees.dbf");
  const cacheKey = `${dossier}::${dateYmd}`;
  const st = statSafe(dbfPath);
  if (!st) throw new Error(`Fichier entrees.dbf non trouvé: ${dbfPath}`);

  const cached = entreesByDate.get(cacheKey);
  if (
    cached &&
    Date.now() - cached.loadedAt < ENTREES_TTL_MS &&
    cached.mtime === st.mtime.getTime() &&
    cached.size === st.size
  ) {
    return cached.records;
  }

  const t0 = Date.now();
  const dbf = await DBFFile.open(dbfPath, { readMode: "loose" });
  const records = [];
  let batch;
  let scanned = 0;
  while ((batch = await dbf.readRecords(BATCH)).length > 0) {
    scanned += batch.length;
    for (const r of batch) {
      if (entryYmd(r) === dateYmd) records.push(r);
    }
  }
  entreesByDate.set(cacheKey, {
    records,
    loadedAt: Date.now(),
    mtime: st.mtime.getTime(),
    size: st.size,
  });
  console.log(
    `[SuiviEntrees] entrees ${dossier} ${dateYmd}: ${records.length} ligne(s) (scan ${scanned} en ${Date.now() - t0}ms)`,
  );
  return records;
};

// ─────────────────── NART réservés (streaming detail.dbf) ────────────────────
// detail.dbf est énorme -> lecture par lots, on ne garde qu'un Set de NART.
// Résultat mis en cache (TTL 10 min) car le balayage complet est coûteux.
const RESERVED_TTL_MS = 10 * 60 * 1000;
const reservedCache = new Map(); // dossier -> { set, loadedAt, mtime, size }

const getReservedNarts = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const dbfPath = path.join(entreprise.cheminBase, dossier, "detail.dbf");
  const cached = reservedCache.get(dossier);
  try {
    const st = statSafe(dbfPath);
    if (!st) throw new Error("detail.dbf introuvable");
    if (
      cached &&
      Date.now() - cached.loadedAt < RESERVED_TTL_MS &&
      cached.mtime === st.mtime.getTime() &&
      cached.size === st.size
    ) {
      return cached.set;
    }

    const t0 = Date.now();
    const dbf = await DBFFile.open(dbfPath, { readMode: "loose" });
    const set = new Set();
    let batch;
    let scanned = 0;
    while ((batch = await dbf.readRecords(BATCH)).length > 0) {
      scanned += batch.length;
      for (const r of batch) {
        if (safeTrim(r.TYPFACT).toUpperCase() === "R" && Number(r.QTE) !== 0) {
          const nart = safeTrim(r.NART).toUpperCase();
          if (nart) set.add(nart);
        }
      }
    }
    reservedCache.set(dossier, {
      set,
      loadedAt: Date.now(),
      mtime: st.mtime.getTime(),
      size: st.size,
    });
    console.log(
      `[SuiviEntrees] Réservations ${dossier}: ${set.size} NART (scan ${scanned} lignes detail.dbf en ${Date.now() - t0}ms)`,
    );
    return set;
  } catch (e) {
    console.warn(`[SuiviEntrees] Scan réservations impossible (${dossier}): ${e.message}`);
    return cached?.set || new Set();
  }
};

// Contrôle TGC (PB_TX_TGC de l'Access) : anomalie si l'écart entre PVTE et le
// prix HT recalculé depuis PVTETTC dépasse ~1,5 XPF.
const controleTgcAnomalie = (article) => {
  const pvte = num(article?.PVTE);
  const pvtettc = num(article?.PVTETTC);
  const atva = num(article?.ATVA);
  if (pvte == null || pvtettc == null || atva == null) return false;
  const htRecalcule = pvtettc / (1 + atva / 100);
  return Math.abs(Math.round(pvte) - Math.round(htRecalcule)) >= 1.5;
};

// Set des NART réservés (scan detail.dbf) — exposé pour l'endpoint dédié qui
// charge le flag Résa EN ARRIÈRE-PLAN (detail.dbf QC ≈ 1,17 Go => trop lent pour
// bloquer l'affichage de la grille).
export const getReservedNartSet = (entreprise) => getReservedNarts(entreprise);

/**
 * Grille « entrées » d'une société pour une date donnée.
 * @param {Object} entreprise - document entreprise (getters cheminBase actifs)
 * @param {string} dateYmd    - date au format "YYYYMMDD"
 * @param {Object} [opts]
 * @param {boolean} [opts.includeResa=false] - inclure le flag Résa (scan lourd
 *        de detail.dbf). Laissé à false pour l'affichage (chargé à part) ;
 *        activé pour l'export Excel.
 * @returns {Promise<{ date: string, dateFr: string, rows: Array }>}
 */
export const getEntreesForDate = async (
  entreprise,
  dateYmd,
  { includeResa = false } = {},
) => {
  const duJour = await getEntreesRecordsForDate(entreprise, dateYmd);
  if (duJour.length === 0) {
    return { date: dateYmd, dateFr: ymdToFr(dateYmd), rows: [] };
  }

  // Enrichissements légers (article/verif). Le flag Résa (detail.dbf géant) est
  // optionnel et chargé séparément pour ne pas bloquer la grille.
  const [reserved, changePrix] = await Promise.all([
    includeResa ? getReservedNarts(entreprise) : Promise.resolve(new Set()),
    getChangementsPrix(entreprise, dateYmd)
      .then((r) => new Set(r.rows.map((x) => x.nart.toUpperCase())))
      .catch(() => new Set()),
  ]);

  const seuilNouveaute = ymdMinusDays(dateYmd, 30);
  const rows = [];

  for (const rec of duJour) {
    const nart = safeTrim(rec.NART);
    const nartKey = nart.toUpperCase();

    let article = null;
    try {
      article = await articleCacheService.findByNart(entreprise, nart);
    } catch {
      article = null;
    }

    let fournisseurNom = "";
    const fournCode = rec.FOURN;
    if (fournCode != null && safeTrim(fournCode) !== "") {
      try {
        const f = await fournissCacheService.findByFourn(entreprise, fournCode);
        fournisseurNom = safeTrim(f?.NOM);
      } catch {
        fournisseurNom = "";
      }
    }

    const creationYmd = toYmd(article?.CREATION);
    const nouveaute =
      !!creationYmd && !!seuilNouveaute && creationYmd > seuilNouveaute;

    rows.push({
      nart,
      design: safeTrim(article?.DESIGN),
      refer: safeTrim(article?.REFER),
      gencod: digitsOnly(article?.GENCOD),
      fournisseur: fournisseurNom,
      fournCode: num(fournCode),
      numcde: safeTrim(rec.NUMCDE),
      bateau: safeTrim(rec.BATEAU),
      qte: num(rec.QTE),
      pvtettc: num(article?.PVTETTC),
      stockMag: num(article?.S1),
      stockDock: num(article?.S2),
      gism1: safeTrim(article?.GISM1),
      place: safeTrim(article?.PLACE),
      dateEntree: ymdToFr(dateYmd),
      datcde: ymdToFr(toYmd(rec.DATCDE)),
      datfact: ymdToFr(toYmd(rec.DATFACT)),
      arrivee: ymdToFr(toYmd(rec.ARRIVEE)),
      nouveaute,
      resa: reserved.has(nartKey),
      chgPrix: changePrix.has(nartKey),
      pbTgc: controleTgcAnomalie(article),
      // détails contrôle TGC
      pvte: num(article?.PVTE),
      atva: num(article?.ATVA),
      introuvable: !article,
    });
  }

  return { date: dateYmd, dateFr: ymdToFr(dateYmd), rows };
};

export default { getEntreesForDate };
