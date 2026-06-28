// backend/services/clientCacheService.js
import { DBFFile } from "dbffile";
import path from "path";
import fs from "fs";

/**
 * Service de cache pour les clients DBF + tiers DBF
 *
 * Fichier clients.dbf :
 *   Clé primaire : TIERS (N:4.0)
 *   AD5 = RIDET → nettoyé en _ridet
 *   Filtres indexés : CATCLI, TYPE, CATEGORIE, GROUPE, BANQUE,
 *                     CODTARIF, CLTVA, ECOTAXE, SAV, FDM, REPRES
 *   # records: ~6374
 *
 * Fichier tiers.dbf :
 *   COMPTE(C:6), TIERS(N:5.0), NOM(C:30), DEBIT(N:10.0), CREDIT(N:10.0)
 *   Lié à clients.dbf par TIERS — filtre par COMPTE
 *   # records: ~371
 */
class ClientCacheService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000;
    this.loadingLocks = new Map();
  }

  safeTrim(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value).trim();
  }

  cleanRidet(ad5Value) {
    const raw = this.safeTrim(ad5Value);
    if (!raw) return "";
    const digits = raw.replace(/[^0-9]/g, "");
    if (!digits) return "";
    return digits.substring(0, 7);
  }

  parseDate(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date) {
      return isNaN(dateValue.getTime()) ? null : dateValue;
    }
    if (typeof dateValue === "string" && dateValue.length === 8) {
      const year = parseInt(dateValue.substring(0, 4));
      const month = parseInt(dateValue.substring(4, 6)) - 1;
      const day = parseInt(dateValue.substring(6, 8));
      const d = new Date(year, month, day);
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof dateValue === "string") {
      const parsed = new Date(dateValue);
      return isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  tokenize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0);
  }

  normalizeNom(nom) {
    const raw = this.safeTrim(nom);
    if (!raw) return "";
    return raw.toUpperCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Z0-9 ]/g, "")
      .replace(/\s+/g, " ").trim();
  }

  _addToIndex(indexMap, key, idx) {
    if (!key) return;
    if (!indexMap.has(key)) indexMap.set(key, []);
    indexMap.get(key).push(idx);
  }

  _getDistinctFromIndex(indexMap) {
    const items = [];
    for (const [code, indices] of indexMap) {
      items.push({ code, count: indices.length });
    }
    return items.sort((a, b) => a.code.localeCompare(b.code, "fr"));
  }

  async loadTiersDbf(entreprise) {
    const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
    const tiersPath = path.join(basePath, "tiers.dbf");

    if (!fs.existsSync(tiersPath)) {
      console.warn(`[ClientCache] tiers.dbf non trouvé: ${tiersPath}`);
      return { records: [], indexByTiers: new Map(), indexByCompte: new Map() };
    }

    try {
      const dbf = await DBFFile.open(tiersPath);
      const records = await dbf.readRecords();
      const indexByTiers = new Map();
      const indexByCompte = new Map();

      records.forEach((record, idx) => {
        const tiers = record.TIERS;
        if (tiers !== undefined && tiers !== null) {
          const k = tiers.toString().trim();
          if (!indexByTiers.has(k)) indexByTiers.set(k, []);
          indexByTiers.get(k).push(idx);
        }
        const compte = this.safeTrim(record.COMPTE);
        if (compte) {
          if (!indexByCompte.has(compte)) indexByCompte.set(compte, []);
          indexByCompte.get(compte).push(idx);
        }
      });

      console.log(`[ClientCache] tiers.dbf chargé: ${records.length} enregistrements, ${indexByCompte.size} comptes`);
      return { records, indexByTiers, indexByCompte };
    } catch (error) {
      console.error(`[ClientCache] Erreur chargement tiers.dbf: ${error.message}`);
      return { records: [], indexByTiers: new Map(), indexByCompte: new Map() };
    }
  }

  createCacheEntry(records, dbfInfo, tiersData) {
    const indexByTiers = new Map();
    const indexByRidet = new Map();
    const indexByNom = new Map();
    const indexByRepres = new Map();
    const indexByCatcli = new Map();
    const indexByType = new Map();
    const indexByCategorie = new Map();
    const indexByGroupe = new Map();
    const indexByBanque = new Map();
    const indexByCodtarif = new Map();
    const indexByCltva = new Map();
    const indexByEcotaxe = new Map();
    const indexBySav = new Map();
    const indexByFdm = new Map();
    const indexByCompte = new Map();
    const searchIndex = new Map();

    // Mapping TIERS → COMPTE(s)
    const clientTiersToComptes = new Map();
    if (tiersData && tiersData.records.length > 0) {
      for (const [tiersKey, indices] of tiersData.indexByTiers) {
        const comptes = indices.map((i) => this.safeTrim(tiersData.records[i].COMPTE)).filter(Boolean);
        if (comptes.length > 0) clientTiersToComptes.set(tiersKey, [...new Set(comptes)]);
      }
    }

    const enrichedRecords = records.map((record, idx) => {
      const ridet = this.cleanRidet(record.AD5);
      const nomNormalized = this.normalizeNom(record.NOM);

      const tiers = record.TIERS;
      const tiersKey = tiers !== undefined && tiers !== null ? tiers.toString().trim() : "";
      let tiersInfo = null;
      let comptes = [];

      if (tiersKey && tiersData && tiersData.indexByTiers.has(tiersKey)) {
        const tiersIndices = tiersData.indexByTiers.get(tiersKey);
        tiersInfo = tiersIndices.map((tidx) => {
          const tr = tiersData.records[tidx];
          return { COMPTE: this.safeTrim(tr.COMPTE), NOM: this.safeTrim(tr.NOM), DEBIT: tr.DEBIT || 0, CREDIT: tr.CREDIT || 0 };
        });
        comptes = clientTiersToComptes.get(tiersKey) || [];
      }

      const enriched = { ...record, _ridet: ridet, _nomNormalized: nomNormalized, _tiersInfo: tiersInfo, _comptes: comptes };

      // Indexes
      if (tiersKey) indexByTiers.set(tiersKey, idx);
      this._addToIndex(indexByRidet, ridet, idx);
      this._addToIndex(indexByNom, nomNormalized, idx);
      if (record.REPRES !== undefined && record.REPRES !== null) {
        this._addToIndex(indexByRepres, record.REPRES.toString(), idx);
      }
      this._addToIndex(indexByCatcli, this.safeTrim(record.CATCLI), idx);
      this._addToIndex(indexByType, this.safeTrim(record.TYPE), idx);
      this._addToIndex(indexByCategorie, this.safeTrim(record.CATEGORIE), idx);
      this._addToIndex(indexByGroupe, this.safeTrim(record.GROUPE), idx);
      this._addToIndex(indexByBanque, this.safeTrim(record.BANQUE), idx);
      this._addToIndex(indexByCodtarif, this.safeTrim(record.CODTARIF), idx);
      this._addToIndex(indexByCltva, this.safeTrim(record.CLTVA), idx);
      this._addToIndex(indexByEcotaxe, this.safeTrim(record.ECOTAXE), idx);
      this._addToIndex(indexBySav, this.safeTrim(record.SAV), idx);
      this._addToIndex(indexByFdm, this.safeTrim(record.FDM), idx);
      comptes.forEach((c) => this._addToIndex(indexByCompte, c, idx));

      // Search tokens
      const fieldsToIndex = [
        record.NOM, record.AD1, record.AD2, record.TEL,
        record.OBSERV, record.ADMAIL, record.INTERLOC,
        tiers !== undefined ? tiers.toString() : "",
        ridet, this.safeTrim(record.TYPE), this.safeTrim(record.CATEGORIE),
        this.safeTrim(record.GROUPE), this.safeTrim(record.BANQUE),
        ...comptes,
      ];
      fieldsToIndex.forEach((field) => {
        if (field) {
          this.tokenize(field.toString()).forEach((token) => {
            if (token.length >= 2) {
              if (!searchIndex.has(token)) searchIndex.set(token, new Set());
              searchIndex.get(token).add(idx);
            }
          });
        }
      });

      return enriched;
    });

    return {
      records: enrichedRecords, dbfInfo, tiersData,
      indexByTiers, indexByRidet, indexByNom, indexByRepres,
      indexByCatcli, indexByType, indexByCategorie, indexByGroupe,
      indexByBanque, indexByCodtarif, indexByCltva, indexByEcotaxe,
      indexBySav, indexByFdm, indexByCompte, searchIndex,
      loadedAt: Date.now(), lastModified: dbfInfo.lastModified,
    };
  }

  isCacheValid(cacheEntry, dbfPath) {
    if (!cacheEntry) return false;
    if (Date.now() - cacheEntry.loadedAt > this.cacheTTL) return false;
    try {
      const stats = fs.statSync(dbfPath);
      if (stats.mtime.getTime() !== cacheEntry.lastModified.getTime()) return false;
    } catch { return false; }
    return true;
  }

  async getClients(entreprise) {
    const cacheKey = `client_${entreprise.nomDossierDBF}`;
    const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
    const dbfPath = path.join(basePath, "clients.dbf");

    const cached = this.cache.get(cacheKey);
    if (this.isCacheValid(cached, dbfPath)) return cached;

    if (this.loadingLocks.has(cacheKey)) {
      await this.loadingLocks.get(cacheKey);
      return this.cache.get(cacheKey);
    }

    let resolveLock;
    const lockPromise = new Promise((resolve) => { resolveLock = resolve; });
    this.loadingLocks.set(cacheKey, lockPromise);

    try {
      console.log(`[ClientCache] Chargement du cache pour ${entreprise.nomDossierDBF}...`);
      const startTime = Date.now();
      if (!fs.existsSync(dbfPath)) throw new Error(`Fichier clients.dbf non trouvé: ${dbfPath}`);

      const dbf = await DBFFile.open(dbfPath);
      const records = await dbf.readRecords();
      const stats = await fs.promises.stat(dbfPath);
      const dbfInfo = { path: dbfPath, recordCount: dbf.recordCount, fileSize: stats.size, lastModified: stats.mtime, fields: dbf.fields };
      const tiersData = await this.loadTiersDbf(entreprise);
      const cacheEntry = this.createCacheEntry(records, dbfInfo, tiersData);
      this.cache.set(cacheKey, cacheEntry);

      console.log(`[ClientCache] Cache chargé pour ${entreprise.nomDossierDBF}: ${records.length} clients, ${tiersData.records.length} tiers en ${Date.now() - startTime}ms`);
      return cacheEntry;
    } finally {
      this.loadingLocks.delete(cacheKey);
      resolveLock();
    }
  }

  async findByTiers(entreprise, tiers) {
    const cache = await this.getClients(entreprise);
    const idx = cache.indexByTiers.get(tiers.toString().trim());
    return idx !== undefined ? cache.records[idx] : null;
  }

  async findByRidet(entreprise, ridet) {
    const cache = await this.getClients(entreprise);
    const cleaned = ridet.replace(/[^0-9]/g, "").substring(0, 7);
    if (!cleaned) return [];
    return (cache.indexByRidet.get(cleaned) || []).map((i) => cache.records[i]);
  }

  async findCrossEntrepriseByRidet(ridet, excludeNomDossier = null) {
    const cleaned = ridet.replace(/[^0-9]/g, "").substring(0, 7);
    if (!cleaned || cleaned.length < 4) return [];
    const results = [];
    for (const [cacheKey, cacheEntry] of this.cache) {
      const nomDossier = cacheKey.replace("client_", "");
      if (excludeNomDossier && nomDossier === excludeNomDossier) continue;
      const indices = cacheEntry.indexByRidet.get(cleaned) || [];
      if (indices.length > 0) results.push({ nomDossierDBF: nomDossier, matchType: "ridet", clients: indices.map((i) => cacheEntry.records[i]) });
    }
    return results;
  }

  async findCrossEntrepriseByNom(nom, excludeNomDossier = null) {
    const normalized = this.normalizeNom(nom);
    if (!normalized || normalized.length < 3) return [];
    const results = [];
    for (const [cacheKey, cacheEntry] of this.cache) {
      const nomDossier = cacheKey.replace("client_", "");
      if (excludeNomDossier && nomDossier === excludeNomDossier) continue;
      const indices = cacheEntry.indexByNom.get(normalized) || [];
      if (indices.length > 0) results.push({ nomDossierDBF: nomDossier, matchType: "nom", clients: indices.map((i) => cacheEntry.records[i]) });
    }
    return results;
  }

  async findCrossEntreprise(client, excludeNomDossier = null) {
    const ridet = client._ridet || this.cleanRidet(client.AD5);
    const nom = this.safeTrim(client.NOM);
    if (ridet && ridet.length >= 4) {
      const r = await this.findCrossEntrepriseByRidet(ridet, excludeNomDossier);
      if (r.length > 0) return { matchType: "ridet", matchValue: ridet, results: r };
    }
    if (nom) {
      const r = await this.findCrossEntrepriseByNom(nom, excludeNomDossier);
      if (r.length > 0) return { matchType: "nom", matchValue: this.normalizeNom(nom), results: r };
    }
    return { matchType: ridet ? "ridet" : "nom", matchValue: ridet || this.normalizeNom(nom), results: [] };
  }

  async preloadAll(entreprises) {
    await Promise.all(entreprises.map(async (e) => {
      try { await this.getClients(e); } catch (err) { console.warn(`[ClientCache] Skip ${e.nomDossierDBF}: ${err.message}`); }
    }));
  }

  _isFilterActive(val) {
    return val !== undefined && val !== null && val !== "" && val !== "TOUT";
  }

  async getPaginated(entreprise, options = {}) {
    const { page = 1, limit = 50, search, repres, catcli, type, categorie, groupe, banque, codtarif, cltva, ecotaxe, sav, fdm, compte } = options;

    const cache = await this.getClients(entreprise);
    let filtered = [...cache.records];

    if (search) {
      const sl = search.toLowerCase();
      filtered = filtered.filter((r) => {
        return (
          this.safeTrim(r.NOM).toLowerCase().includes(sl) ||
          this.safeTrim(r.AD1).toLowerCase().includes(sl) ||
          this.safeTrim(r.TEL).toLowerCase().includes(sl) ||
          this.safeTrim(r.ADMAIL).toLowerCase().includes(sl) ||
          this.safeTrim(r.OBSERV).toLowerCase().includes(sl) ||
          (r.TIERS !== undefined ? r.TIERS.toString() : "").includes(sl) ||
          (r._ridet || "").toLowerCase().includes(sl) ||
          this.safeTrim(r.TYPE).toLowerCase().includes(sl) ||
          this.safeTrim(r.CATEGORIE).toLowerCase().includes(sl) ||
          this.safeTrim(r.GROUPE).toLowerCase().includes(sl) ||
          (r._comptes || []).join(" ").toLowerCase().includes(sl)
        );
      });
    }

    if (this._isFilterActive(repres)) {
      const rs = repres.toString();
      filtered = filtered.filter((r) => r.REPRES !== undefined && r.REPRES !== null ? r.REPRES.toString() === rs : false);
    }

    const simpleFilters = [
      ["CATCLI", catcli], ["TYPE", type], ["CATEGORIE", categorie],
      ["GROUPE", groupe], ["BANQUE", banque], ["CODTARIF", codtarif],
      ["CLTVA", cltva], ["ECOTAXE", ecotaxe], ["SAV", sav], ["FDM", fdm],
    ];
    for (const [field, val] of simpleFilters) {
      if (this._isFilterActive(val)) {
        filtered = filtered.filter((r) => this.safeTrim(r[field]) === val);
      }
    }

    if (this._isFilterActive(compte)) {
      filtered = filtered.filter((r) => (r._comptes || []).includes(compte));
    }

    filtered.sort((a, b) => this.safeTrim(a.NOM).toLowerCase().localeCompare(this.safeTrim(b.NOM).toLowerCase(), "fr"));

    const totalRecords = filtered.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const startIndex = (page - 1) * limit;

    return {
      totalRecords, totalPages, page, limit,
      hasNextPage: startIndex + limit < totalRecords,
      hasPrevPage: page > 1,
      clients: filtered.slice(startIndex, startIndex + limit),
    };
  }

  async search(entreprise, searchTerm, options = {}) {
    const { limit = 50 } = options;
    const cache = await this.getClients(entreprise);
    let candidateIndices = null;
    if (searchTerm) {
      const tokens = this.tokenize(searchTerm);
      if (tokens.length > 0) {
        tokens.forEach((token) => {
          const matching = new Set();
          for (const [indexed, indices] of cache.searchIndex) {
            if (indexed.startsWith(token) || token.startsWith(indexed)) indices.forEach((i) => matching.add(i));
          }
          candidateIndices = candidateIndices === null ? matching : new Set([...candidateIndices].filter((i) => matching.has(i)));
        });
      }
    }
    if (candidateIndices === null) candidateIndices = new Set(cache.records.map((_, i) => i));
    const results = [...candidateIndices].slice(0, limit);
    return { totalFound: candidateIndices.size, clients: results.map((i) => cache.records[i]) };
  }

  async getRepresentants(entreprise) {
    const cache = await this.getClients(entreprise);
    const reps = [];
    for (const [code, indices] of cache.indexByRepres) reps.push({ code: parseInt(code) || 0, count: indices.length });
    return reps.sort((a, b) => a.code - b.code);
  }

  async getCategories(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexByCatcli); }
  async getTypes(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexByType); }
  async getCategoriesDetaillees(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexByCategorie); }
  async getGroupes(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexByGroupe); }
  async getBanques(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexByBanque); }
  async getCodtarifs(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexByCodtarif); }
  async getCltvas(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexByCltva); }
  async getEcotaxes(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexByEcotaxe); }
  async getSavs(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexBySav); }
  async getFdms(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexByFdm); }
  async getComptes(entreprise) { return this._getDistinctFromIndex((await this.getClients(entreprise)).indexByCompte); }

  /**
   * Retourne TOUTES les valeurs distinctes en un seul appel
   */
  async getAllFilterValues(entreprise) {
    const cache = await this.getClients(entreprise);
    const reps = [];
    for (const [code, indices] of cache.indexByRepres) reps.push({ code: parseInt(code) || 0, count: indices.length });
    reps.sort((a, b) => a.code - b.code);

    return {
      representants: reps,
      catclis: this._getDistinctFromIndex(cache.indexByCatcli),
      types: this._getDistinctFromIndex(cache.indexByType),
      categories: this._getDistinctFromIndex(cache.indexByCategorie),
      groupes: this._getDistinctFromIndex(cache.indexByGroupe),
      banques: this._getDistinctFromIndex(cache.indexByBanque),
      codtarifs: this._getDistinctFromIndex(cache.indexByCodtarif),
      cltvas: this._getDistinctFromIndex(cache.indexByCltva),
      ecotaxes: this._getDistinctFromIndex(cache.indexByEcotaxe),
      savs: this._getDistinctFromIndex(cache.indexBySav),
      fdms: this._getDistinctFromIndex(cache.indexByFdm),
      comptes: this._getDistinctFromIndex(cache.indexByCompte),
    };
  }

  async getStructure(entreprise) {
    const cache = await this.getClients(entreprise);
    return { clients: { ...cache.dbfInfo, fields: cache.dbfInfo.fields.map((f) => ({ name: f.name, type: f.type, size: f.size, decimalPlaces: f.decimalPlaces })) } };
  }

  invalidate(nomDossierDBF) { this.cache.delete(`client_${nomDossierDBF}`); console.log(`[ClientCache] Cache invalidé pour ${nomDossierDBF}`); }
  invalidateAll() { this.cache.clear(); console.log("[ClientCache] Tout le cache a été invalidé"); }

  getStats() {
    const stats = {};
    for (const [key, entry] of this.cache) {
      stats[key] = {
        clientCount: entry.records.length,
        tiersCount: entry.tiersData ? entry.tiersData.records.length : 0,
        loadedAt: new Date(entry.loadedAt).toISOString(),
        indexedTokens: entry.searchIndex.size,
        representants: entry.indexByRepres.size,
        catclis: entry.indexByCatcli.size,
        types: entry.indexByType.size,
        categories: entry.indexByCategorie.size,
        groupes: entry.indexByGroupe.size,
        comptes: entry.indexByCompte.size,
        ridetsUniques: entry.indexByRidet.size,
      };
    }
    return stats;
  }
}

const clientCacheService = new ClientCacheService();
export default clientCacheService;