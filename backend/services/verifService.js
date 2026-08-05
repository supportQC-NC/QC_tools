// backend/services/verifService.js
//
// Lecture de verif.dbf (historique des changements de PRIX DE VENTE de l'ERP)
// + jointure avec article.dbf. Portage fidèle du script Python `main.py` :
//   verif ⋈ article sur NART, filtre DATE == jour choisi et EXPVTE/NEWPVTE non
//   nuls, puis récupère depuis l'article DESIGN/FOURN/GENCOD/PVTETTC/KL/VOL.
//
// verif.dbf contient : NART, DATE (caractère "YYYYMMDD"), EXPVTE (ancien prix),
// NEWPVTE (nouveau prix), MOTPASSE. On met les enregistrements bruts en cache
// (Map par nomDossierDBF, TTL 5 min + invalidation sur mtime/size), à l'image de
// articleService / factureCacheService. La jointure article passe par le cache
// article existant (articleCacheService.findByNart, index O(1)).
import path from "path";
import fs from "fs";
import { DBFFile } from "dbffile";
import articleCacheService from "./articleService.js";

const TTL_MS = 5 * 60 * 1000;

class VerifCacheService {
  constructor() {
    // nomDossierDBF -> { records, loadedAt, mtime, size }
    this.cache = new Map();
    this.loadingLocks = new Map();
  }

  _dbfPath(entreprise) {
    // cheminBase : getter du modèle (DBF_BASE_PATH en prod, UNC en dev).
    return path.join(
      entreprise.cheminBase,
      entreprise.nomDossierDBF,
      "verif.dbf",
    );
  }

  _isValid(entry, dbfPath) {
    if (!entry) return false;
    if (Date.now() - entry.loadedAt > TTL_MS) return false;
    try {
      const st = fs.statSync(dbfPath);
      if (st.mtime.getTime() !== entry.mtime.getTime()) return false;
      if (st.size !== entry.size) return false;
    } catch {
      return false;
    }
    return true;
  }

  async getVerifRecords(entreprise) {
    const key = entreprise.nomDossierDBF;
    const dbfPath = this._dbfPath(entreprise);

    const cached = this.cache.get(key);
    if (this._isValid(cached, dbfPath)) return cached.records;

    // Un seul chargement concurrent par société.
    if (this.loadingLocks.has(key)) {
      await this.loadingLocks.get(key);
      const now = this.cache.get(key);
      if (now) return now.records;
    }

    let resolveLock;
    const lock = new Promise((r) => {
      resolveLock = r;
    });
    this.loadingLocks.set(key, lock);

    try {
      if (!fs.existsSync(dbfPath)) {
        throw new Error(`Fichier verif.dbf non trouvé: ${dbfPath}`);
      }
      // readMode:"loose" : tolère les entêtes DBF non conformes (noms de champs
      // dupliqués sur les .dbf legacy), sinon dbffile lève une exception.
      const dbf = await DBFFile.open(dbfPath, { readMode: "loose" });
      const records = await dbf.readRecords();
      const st = fs.statSync(dbfPath);
      this.cache.set(key, {
        records,
        loadedAt: Date.now(),
        mtime: st.mtime,
        size: st.size,
      });
      return records;
    } finally {
      resolveLock();
      this.loadingLocks.delete(key);
    }
  }

  invalidate(nomDossierDBF) {
    this.cache.delete(nomDossierDBF);
  }

  invalidateAll() {
    this.cache.clear();
  }
}

const verifCacheService = new VerifCacheService();

// ─────────────────────────── Helpers (portage Python) ───────────────────────

const digitsOnly = (v) => (v == null ? "" : String(v)).replace(/\D/g, "");

// Valeur "présente" (≈ pandas notna) : ni null/undefined, ni NaN, ni chaîne vide.
const present = (v) =>
  v !== null &&
  v !== undefined &&
  !(typeof v === "number" && Number.isNaN(v)) &&
  String(v).trim() !== "";

// verif.DATE : champ caractère "YYYYMMDD" (le Python parse en %Y%m%d). On gère
// aussi le cas où dbffile renverrait un objet Date (champ de type D).
const toYmd = (v) => {
  if (v == null) return "";
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
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

// Désignation nettoyée comme dans le Python : retrait des '*', trim, espaces
// multiples réduits à un seul.
const cleanDesign = (v) =>
  (v == null ? "" : String(v))
    .replace(/\*/g, "")
    .trim()
    .replace(/\s{2,}/g, " ");

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// L'article est-il en promo À la date consultée ? Un article a une promo active
// si DPROMOD <= dateYmd <= DPROMOF (bornes incluses) et PVPROMO > 0. Le prix de
// vente effectif devient alors le PVPROMO TTC = trunc(PVPROMO * (1 + ATVA/100)),
// calcul identique au générateur d'étiquettes (etiquetteService.js).
const promoInfo = (article, dateYmd) => {
  const none = { enPromo: false, pvpromo: null };
  if (!article) return none;
  const pvpromo = Number(article.PVPROMO);
  if (!Number.isFinite(pvpromo) || pvpromo <= 0) return none;
  const debut = toYmd(article.DPROMOD);
  const fin = toYmd(article.DPROMOF);
  if (debut.length !== 8 || fin.length !== 8) return none;
  // Comparaison lexicographique valable sur des "YYYYMMDD" zéro-remplis.
  if (dateYmd < debut || dateYmd > fin) return none;
  const atva = Number(article.ATVA) || 0;
  return { enPromo: true, pvpromo: Math.trunc(pvpromo * (1 + atva / 100)) };
};

/**
 * Retourne les changements de prix de vente d'une société pour une date donnée.
 * @param {Object} entreprise - document entreprise (getters cheminBase actifs)
 * @param {string} dateYmd    - date au format "YYYYMMDD"
 * @returns {Promise<{ date: string, rows: Array, articles: Array }>}
 *   rows     = lignes enrichies (tableau écran + Excel) ;
 *   articles = enregistrements article.dbf BRUTS (dans l'ordre) — passés tels
 *              quels au générateur d'étiquettes standard (rendu identique).
 */
export const getChangementsPrix = async (entreprise, dateYmd) => {
  const verifRecords = await verifCacheService.getVerifRecords(entreprise);
  const rows = [];
  const articles = [];

  for (const v of verifRecords) {
    if (toYmd(v.DATE) !== dateYmd) continue;
    // dropna(subset=['EXPVTE','NEWPVTE'], how='all') : on garde la ligne si au
    // moins l'un des deux prix est présent.
    if (!present(v.EXPVTE) && !present(v.NEWPVTE)) continue;

    const nart = (v.NART == null ? "" : String(v.NART)).trim();
    if (!nart) continue;

    let article = null;
    try {
      article = await articleCacheService.findByNart(entreprise, nart);
    } catch {
      article = null;
    }

    const rawDesign = article?.DESIGN ?? "";
    const { enPromo, pvpromo } = promoInfo(article, dateYmd);
    const pvtettc = num(article?.PVTETTC);
    rows.push({
      nart,
      date: ymdToFr(dateYmd),
      prixInitial: num(v.EXPVTE),
      prixActuel: num(v.NEWPVTE),
      designation: cleanDesign(rawDesign),
      fournisseur: article?.FOURN ?? "",
      gencod: digitsOnly(article?.GENCOD),
      pvtettc,
      // Promo active à la date consultée : le prix de vente effectif est le
      // PVPROMO TTC, pas le PVTETTC.
      enPromo,
      pvpromo,
      prixVente: enPromo ? pvpromo : pvtettc,
      kl: article?.KL ?? "",
      vol: num(article?.VOL),
      // Déprécié : reproduction À L'IDENTIQUE du script Python — celui-ci teste
      // la présence de '*' sur la désignation DÉJÀ nettoyée (les '*' viennent
      // d'être retirés), donc le résultat est toujours faux. Comportement voulu.
      deprecie: cleanDesign(rawDesign).includes("*"),
      introuvable: !article,
    });

    // Étiquettes : uniquement les articles réellement trouvés dans article.dbf.
    if (article) articles.push(article);
  }

  return { date: dateYmd, rows, articles };
};

export default verifCacheService;
