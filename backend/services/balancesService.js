// backend/services/balancesService.js
//
// Module « Balances / clients à bloquer » — portage des requêtes Access
// rqBalances / rqBalancesABloquer (QC_master_report).
//
// balances.dbf (petit, ~55 Ko) : TIERS (N) + LIBELLE (C100). LIBELLE encode
// l'ancienneté de l'encours sous forme de tags, ex :
//   "[M-2 : 2 522] [M-3 : 2 617]"
//   "[M-2 : -2 018 632] [M-3 : 4 883] [3M+ : 10 170 981]"
// Les fonctions VBA EncoursQC / GetMxEncoursQC parsent cette chaîne ; on les
// reproduit ici. On joint le client (clients.dbf via clientCacheService) pour
// NOM/REPRES/CATEGORIE/OBSERV et on résout le vendeur via entreprise.vendeurs.
import path from "path";
import fs from "fs";
import { DBFFile } from "dbffile";
import clientCacheService from "./clientCacheService.js";

const TTL_MS = 5 * 60 * 1000;

class BalancesCacheService {
  constructor() {
    this.cache = new Map(); // nomDossierDBF -> { records, loadedAt, mtime, size }
    this.loadingLocks = new Map();
  }

  _dbfPath(entreprise) {
    return path.join(entreprise.cheminBase, entreprise.nomDossierDBF, "balances.dbf");
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

  async getBalancesRecords(entreprise) {
    const key = entreprise.nomDossierDBF;
    const dbfPath = this._dbfPath(entreprise);

    const cached = this.cache.get(key);
    if (this._isValid(cached, dbfPath)) return cached.records;

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
        throw new Error(`Fichier balances.dbf non trouvé: ${dbfPath}`);
      }
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
}

const balancesCacheService = new BalancesCacheService();

// ─────────────────────────── Parsing LIBELLE ────────────────────────────────
const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Extrait le montant d'un tag donné ("M-1", "M-2", "M-3", "3M+"). Montant avec
// séparateurs espace, négatif possible. Tag absent -> 0.
const tagAmount = (libelle, tag) => {
  // tag peut contenir "+" (3M+) -> on échappe pour la regex.
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`\\[\\s*${esc}\\s*:\\s*([-\\d ]+)\\]`).exec(
    String(libelle || ""),
  );
  if (!m) return 0;
  const n = parseInt(m[1].replace(/\s/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

// Parse une LIBELLE -> { m1, m2, m3, m3plus } (buckets d'ancienneté).
export const parseLibelleEncours = (libelle) => ({
  m1: tagAmount(libelle, "M-1"),
  m2: tagAmount(libelle, "M-2"),
  m3: tagAmount(libelle, "M-3"),
  m3plus: tagAmount(libelle, "3M+"),
});

// Contient (insensible casse) — utilitaire pour les filtres catégorie/observ.
const contient = (v, sub) =>
  safeTrim(v).toLowerCase().includes(sub.toLowerCase());

/**
 * Encours clients d'une société + drapeau « à bloquer ».
 * @param {Object} entreprise - document entreprise (getters cheminBase actifs)
 * @returns {Promise<{ rows: Array, totalSolde: number, nbABloquer: number }>}
 */
export const getBalances = async (entreprise) => {
  const records = await balancesCacheService.getBalancesRecords(entreprise);

  // Résolution vendeur : REPRES -> nom via entreprise.vendeurs (code -> nom).
  const vendeurMap = new Map();
  for (const v of entreprise.vendeurs || []) {
    const code = safeTrim(v.code);
    if (!code) continue;
    vendeurMap.set(code, safeTrim(v.nom) || safeTrim(v.prenom));
    const n = parseInt(code, 10);
    if (Number.isFinite(n)) vendeurMap.set(String(n), safeTrim(v.nom) || safeTrim(v.prenom));
  }
  const vendeurName = (repres) => {
    const key = safeTrim(repres);
    if (!key) return "MAGASIN";
    return (
      vendeurMap.get(key) ||
      vendeurMap.get(String(parseInt(key, 10))) ||
      "MAGASIN"
    );
  };

  const rows = [];
  for (const rec of records) {
    const tiers = rec.TIERS;
    if (tiers == null || safeTrim(tiers) === "") continue;

    const { m1, m2, m3, m3plus } = parseLibelleEncours(rec.LIBELLE);
    const solde = m1 + m2 + m3 + m3plus;

    let client = null;
    try {
      client = await clientCacheService.findByTiers(entreprise, tiers);
    } catch {
      client = null;
    }
    const nom = safeTrim(client?.NOM);
    const repres = client?.REPRES;
    const categorie = safeTrim(client?.CATEGORIE);
    const observ = safeTrim(client?.OBSERV);

    // Critère « à bloquer » (rqBalancesABloquer) : encours>0, dette ≥ 2 mois
    // (m2+m3+m3plus>0), hors comptes « groupe » et déjà « bloque(é) ».
    const aBloquer =
      solde > 0 &&
      m2 + m3 + m3plus > 0 &&
      !contient(categorie, "groupe") &&
      !contient(observ, "oque");

    rows.push({
      tiers: Number(tiers),
      nom,
      vendeur: vendeurName(repres),
      categorie,
      observ,
      solde,
      m1,
      m2,
      m3,
      m3plus,
      aBloquer,
    });
  }

  rows.sort((a, b) => b.solde - a.solde);

  const totalSolde = rows.reduce((s, r) => s + r.solde, 0);
  const nbABloquer = rows.filter((r) => r.aBloquer).length;

  return { rows, totalSolde, nbABloquer };
};

export default balancesCacheService;
