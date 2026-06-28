// backend/services/fournissCacheService.js
import { DBFFile } from "dbffile";
import path from "path";
import fs from "fs";

/**
 * Service de cache pour les fournisseurs (fourniss.dbf)
 * Structure FOURN(N:3.0) est la clé primaire liée aux articles.
 */
class FournissCacheService {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 10 * 60 * 1000; // Cache plus long (10 min) car change moins souvent
    this.loadingLocks = new Map();
  }

  createCacheEntry(records, dbfInfo) {
    // Index par FOURN (Code fournisseur) - accès O(1)
    const indexByFourn = new Map();
    // Index par NOM pour recherche textuelle
    const searchIndex = new Map();

    records.forEach((record, idx) => {
      // Index FOURN (Numérique)
      if (record.FOURN !== undefined && record.FOURN !== null) {
        indexByFourn.set(record.FOURN, idx);
      }

      // Indexation pour recherche textuelle (NOM, Villes, etc.)
      const fieldsToIndex = [
        record.NOM,
        record.AD1,
        record.AD2,
        record.AD3,
        record.AD4,
        record.TEL,
      ];

      fieldsToIndex.forEach((field) => {
        if (field) {
          const tokens = this.tokenize(field.toString());
          tokens.forEach((token) => {
            if (token.length >= 2) {
              if (!searchIndex.has(token)) {
                searchIndex.set(token, new Set());
              }
              searchIndex.get(token).add(idx);
            }
          });
        }
      });
    });

    return {
      records,
      dbfInfo,
      indexByFourn,
      searchIndex,
      loadedAt: Date.now(),
      lastModified: dbfInfo.lastModified,
    };
  }

  tokenize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0);
  }

  safeTrim(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value).trim();
  }

  isCacheValid(cacheEntry, dbfPath) {
    if (!cacheEntry) return false;
    if (Date.now() - cacheEntry.loadedAt > this.cacheTTL) return false;
    try {
      const stats = fs.statSync(dbfPath);
      return stats.mtime.getTime() === cacheEntry.lastModified.getTime();
    } catch {
      return false;
    }
  }

  async getFournisseurs(entreprise) {
    const cacheKey = entreprise.nomDossierDBF;
    const dbfPath = path.join(
      entreprise.cheminBase,
      entreprise.nomDossierDBF,
      "fourniss.dbf"
    );

    const cached = this.cache.get(cacheKey);
    if (this.isCacheValid(cached, dbfPath)) {
      return cached;
    }

    if (this.loadingLocks.has(cacheKey)) {
      await this.loadingLocks.get(cacheKey);
      return this.cache.get(cacheKey);
    }

    let resolveLock;
    const lockPromise = new Promise((resolve) => {
      resolveLock = resolve;
    });
    this.loadingLocks.set(cacheKey, lockPromise);

    try {
      console.log(`[FournissCache] Chargement pour ${cacheKey}...`);
      const startTime = Date.now();

      if (!fs.existsSync(dbfPath)) {
        throw new Error(`Fichier DBF non trouvé: ${dbfPath}`);
      }

      const dbf = await DBFFile.open(dbfPath);
      const records = await dbf.readRecords();
      const stats = fs.statSync(dbfPath);

      const dbfInfo = {
        path: dbfPath,
        recordCount: dbf.recordCount,
        fileSize: stats.size,
        lastModified: stats.mtime,
        fields: dbf.fields,
      };

      const cacheEntry = this.createCacheEntry(records, dbfInfo);
      this.cache.set(cacheKey, cacheEntry);

      console.log(
        `[FournissCache] Cache chargé: ${records.length} fournisseurs en ${Date.now() - startTime}ms`
      );

      return cacheEntry;
    } finally {
      this.loadingLocks.delete(cacheKey);
      resolveLock();
    }
  }

  /**
   * Recherche par Code FOURN (Numérique) - O(1)
   */
  async findByFourn(entreprise, fournCode) {
    const cache = await this.getFournisseurs(entreprise);
    const code = parseInt(fournCode);
    if (isNaN(code)) return null;

    const idx = cache.indexByFourn.get(code);
    return idx !== undefined ? cache.records[idx] : null;
  }

  /**
   * Recherche textuelle (Nom, Ville, etc.)
   */
  async search(entreprise, searchTerm, options = {}) {
    const { limit = 50 } = options;
    const cache = await this.getFournisseurs(entreprise);

    if (!searchTerm) {
      return {
        totalFound: cache.records.length,
        fournisseurs: cache.records.slice(0, limit),
      };
    }

    const tokens = this.tokenize(searchTerm);
    let candidateIndices = null;

    tokens.forEach((token) => {
      const matchingIndices = new Set();
      for (const [indexedToken, indices] of cache.searchIndex) {
        if (indexedToken.includes(token)) {
          indices.forEach((i) => matchingIndices.add(i));
        }
      }

      if (candidateIndices === null) {
        candidateIndices = matchingIndices;
      } else {
        // Intersection
        candidateIndices = new Set(
          [...candidateIndices].filter((i) => matchingIndices.has(i))
        );
      }
    });

    const results = candidateIndices
      ? [...candidateIndices].map((i) => cache.records[i])
      : [];

    return {
      totalFound: results.length,
      fournisseurs: results.slice(0, limit),
    };
  }

  /**
   * Liste paginée
   */
  async getPaginated(entreprise, options = {}) {
    const { page = 1, limit = 50, search } = options;
    const cache = await this.getFournisseurs(entreprise);

    let filtered = [...cache.records];

    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter((rec) => {
        return (
          this.safeTrim(rec.NOM).toLowerCase().includes(searchLower) ||
          this.safeTrim(rec.AD1).toLowerCase().includes(searchLower) ||
          this.safeTrim(rec.TEL).includes(search) ||
          String(rec.FOURN).includes(search)
        );
      });
    }

    const totalRecords = filtered.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const start = (page - 1) * limit;

    return {
      totalRecords,
      totalPages,
      page,
      limit,
      hasNextPage: start + limit < totalRecords,
      hasPrevPage: page > 1,
      fournisseurs: filtered.slice(start, start + limit),
    };
  }

  async getStructure(entreprise) {
    const cache = await this.getFournisseurs(entreprise);
    return {
      ...cache.dbfInfo,
      fields: cache.dbfInfo.fields.map((f) => ({
        name: f.name,
        type: f.type,
        size: f.size,
        decimalPlaces: f.decimalPlaces,
      })),
    };
  }

  invalidate(nomDossierDBF) {
    this.cache.delete(nomDossierDBF);
    console.log(`[FournissCache] Cache invalidé pour ${nomDossierDBF}`);
  }

  getStats() {
    const stats = {};
    for (const [key, entry] of this.cache) {
      stats[key] = {
        recordCount: entry.records.length,
        loadedAt: new Date(entry.loadedAt).toISOString(),
      };
    }
    return stats;
  }
}

const fournissCacheService = new FournissCacheService();
export default fournissCacheService;