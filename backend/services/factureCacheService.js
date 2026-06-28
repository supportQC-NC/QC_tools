// backend/services/factureCacheService.js
import { DBFFile } from "dbffile";
import path from "path";
import fs from "fs";
import articleCacheService from "./articleService.js";

/**
 * Service de cache pour les factures DBF (entêtes + détails)
 * 
 * ⚠️ IMPORTANT : Les fichiers facture.dbf (~1.5M records) et detail.dbf (~5.8M records)
 * sont trop volumineux pour être chargés entièrement en mémoire.
 * 
 * STRATÉGIE : On ne charge que les factures dont DATFACT est dans 
 * l'ANNÉE EN COURS ou l'ANNÉE PRÉCÉDENTE. Les lignes detail sont filtrées
 * pour ne garder que celles liées à ces factures.
 *
 * Deux fichiers : facture.dbf (entêtes) et detail.dbf (lignes détail)
 * Liaison detail <-> article via NART
 * Liaison detail <-> facture via NUMFACT
 *
 * TYPFACT : F=Facture, A=Avoir, R=RESA, T=Transfert
 * Si NART est vide ou contient "!" => ligne de commentaire
 */
class FactureCacheService {
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

  parseDate(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date) {
      if (isNaN(dateValue.getTime())) return null;
      return dateValue;
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
    if (typeof dateValue === "number") {
      if (dateValue > 19000000 && dateValue < 30000000) {
        const str = dateValue.toString();
        const year = parseInt(str.substring(0, 4));
        const month = parseInt(str.substring(4, 6)) - 1;
        const day = parseInt(str.substring(6, 8));
        const d = new Date(year, month, day);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(dateValue);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /**
   * Retourne l'année d'une date DBF (rapide, sans créer d'objet Date)
   */
  getYearFromDate(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date) {
      if (isNaN(dateValue.getTime())) return null;
      return dateValue.getFullYear();
    }
    if (typeof dateValue === "string" && dateValue.length === 8) {
      return parseInt(dateValue.substring(0, 4));
    }
    if (typeof dateValue === "string" && dateValue.includes("-")) {
      return parseInt(dateValue.substring(0, 4));
    }
    return null;
  }

  isCommentLine(record) {
    const nart = this.safeTrim(record.NART);
    return nart === "" || nart.includes("!");
  }

  tokenize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0);
  }

  createCacheEntry(factureRecords, detailRecords, factureDbfInfo, detailDbfInfo, totalFacturesInFile, totalDetailsInFile) {
    const indexByNumfact = new Map();
    const indexByTiers = new Map();
    const indexByRepres = new Map();
    const indexByEtat = new Map();
    const indexByTypfact = new Map();
    const detailByNumfact = new Map();
    const searchIndex = new Map();

    // Set des NUMFACT valides (ceux qu'on a gardé)
    const validNumfacts = new Set();

    factureRecords.forEach((record, idx) => {
      const numfact = this.safeTrim(record.NUMFACT);

      if (numfact) {
        indexByNumfact.set(numfact, idx);
        validNumfacts.add(numfact);
      }

      const tiers = record.TIERS;
      if (tiers !== undefined && tiers !== null) {
        const tiersKey = tiers.toString();
        if (!indexByTiers.has(tiersKey)) indexByTiers.set(tiersKey, []);
        indexByTiers.get(tiersKey).push(idx);
      }

      const repres = record.REPRES;
      if (repres !== undefined && repres !== null) {
        const represKey = repres.toString();
        if (!indexByRepres.has(represKey)) indexByRepres.set(represKey, []);
        indexByRepres.get(represKey).push(idx);
      }

      const etat = record.ETAT;
      if (etat !== undefined && etat !== null) {
        const etatKey = etat.toString();
        if (!indexByEtat.has(etatKey)) indexByEtat.set(etatKey, []);
        indexByEtat.get(etatKey).push(idx);
      }

      const typfact = this.safeTrim(record.TYPFACT).toUpperCase();
      if (typfact) {
        if (!indexByTypfact.has(typfact)) indexByTypfact.set(typfact, []);
        indexByTypfact.get(typfact).push(idx);
      }

      const fieldsToIndex = [record.NUMFACT, record.NOM, record.TEXTE, record.BONCDE];
      fieldsToIndex.forEach((field) => {
        if (field) {
          const tokens = this.tokenize(field.toString());
          tokens.forEach((token) => {
            if (token.length >= 2) {
              if (!searchIndex.has(token)) searchIndex.set(token, new Set());
              searchIndex.get(token).add(idx);
            }
          });
        }
      });
    });

    // Index detail par NUMFACT — ne garder QUE les details liés aux factures filtrées
    detailRecords.forEach((record) => {
      const numfact = this.safeTrim(record.NUMFACT);
      if (numfact && validNumfacts.has(numfact)) {
        if (!detailByNumfact.has(numfact)) detailByNumfact.set(numfact, []);
        detailByNumfact.get(numfact).push(record);
      }
    });

    return {
      factureRecords,
      factureDbfInfo,
      detailDbfInfo,
      indexByNumfact,
      indexByTiers,
      indexByRepres,
      indexByEtat,
      indexByTypfact,
      detailByNumfact,
      searchIndex,
      loadedAt: Date.now(),
      lastModifiedFacture: factureDbfInfo.lastModified,
      lastModifiedDetail: detailDbfInfo.lastModified,
      totalFacturesInFile,
      totalDetailsInFile,
      filteredFactureCount: factureRecords.length,
    };
  }

  isCacheValid(cacheEntry, factureDbfPath, detailDbfPath) {
    if (!cacheEntry) return false;
    if (Date.now() - cacheEntry.loadedAt > this.cacheTTL) return false;

    try {
      const statsFacture = fs.statSync(factureDbfPath);
      if (statsFacture.mtime.getTime() !== cacheEntry.lastModifiedFacture.getTime()) return false;
    } catch { return false; }

    try {
      const statsDetail = fs.statSync(detailDbfPath);
      if (statsDetail.mtime.getTime() !== cacheEntry.lastModifiedDetail.getTime()) return false;
    } catch { return false; }

    return true;
  }

  async getFactures(entreprise) {
    const cacheKey = `facture_${entreprise.nomDossierDBF}`;
    const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
    const factureDbfPath = path.join(basePath, "facture.dbf");
    const detailDbfPath = path.join(basePath, "detail.dbf");

    const cached = this.cache.get(cacheKey);
    if (this.isCacheValid(cached, factureDbfPath, detailDbfPath)) {
      return cached;
    }

    if (this.loadingLocks.has(cacheKey)) {
      await this.loadingLocks.get(cacheKey);
      return this.cache.get(cacheKey);
    }

    let resolveLock;
    const lockPromise = new Promise((resolve) => { resolveLock = resolve; });
    this.loadingLocks.set(cacheKey, lockPromise);

    try {
      console.log(`[FactureCache] Chargement du cache pour ${entreprise.nomDossierDBF}...`);
      const startTime = Date.now();

      if (!fs.existsSync(factureDbfPath)) {
        throw new Error(`Fichier facture.dbf non trouvé: ${factureDbfPath}`);
      }
      if (!fs.existsSync(detailDbfPath)) {
        throw new Error(`Fichier detail.dbf non trouvé: ${detailDbfPath}`);
      }

      // Années à conserver : année en cours + année précédente
      const currentYear = new Date().getFullYear();
      const minYear = currentYear - 1;

      console.log(`[FactureCache] Filtrage : années ${minYear} à ${currentYear}`);

      // ========== PHASE 1 : Charger et filtrer les entêtes facture.dbf ==========
      const factureDbf = await DBFFile.open(factureDbfPath);
      const totalFacturesInFile = factureDbf.recordCount;
      console.log(`[FactureCache] facture.dbf : ${totalFacturesInFile} records total, lecture...`);

      const allFactureRecords = await factureDbf.readRecords();
      
      // Filtrer : ne garder que les factures de l'année en cours et précédente
      const filteredFactures = [];
      const validNumfacts = new Set();

      for (const record of allFactureRecords) {
        const year = this.getYearFromDate(record.DATFACT);
        if (year !== null && year >= minYear) {
          filteredFactures.push(record);
          const numfact = this.safeTrim(record.NUMFACT);
          if (numfact) validNumfacts.add(numfact);
        }
      }

      console.log(`[FactureCache] Factures filtrées : ${filteredFactures.length} / ${totalFacturesInFile} (années ${minYear}-${currentYear})`);

      // Libérer la mémoire des records bruts
      allFactureRecords.length = 0;

      // ========== PHASE 2 : Charger et filtrer les détails detail.dbf ==========
      const detailDbf = await DBFFile.open(detailDbfPath);
      const totalDetailsInFile = detailDbf.recordCount;
      console.log(`[FactureCache] detail.dbf : ${totalDetailsInFile} records total, lecture...`);

      const allDetailRecords = await detailDbf.readRecords();

      // Filtrer : ne garder que les détails dont le NUMFACT est dans nos factures filtrées
      const filteredDetails = [];
      for (const record of allDetailRecords) {
        const numfact = this.safeTrim(record.NUMFACT);
        if (numfact && validNumfacts.has(numfact)) {
          filteredDetails.push(record);
        }
      }

      console.log(`[FactureCache] Détails filtrés : ${filteredDetails.length} / ${totalDetailsInFile}`);

      // Libérer la mémoire des records bruts
      allDetailRecords.length = 0;

      // ========== PHASE 3 : Stats et indexation ==========
      const [statsFacture, statsDetail] = await Promise.all([
        fs.promises.stat(factureDbfPath),
        fs.promises.stat(detailDbfPath),
      ]);

      const factureDbfInfo = {
        path: factureDbfPath,
        recordCount: factureDbf.recordCount,
        fileSize: statsFacture.size,
        lastModified: statsFacture.mtime,
        fields: factureDbf.fields,
      };

      const detailDbfInfo = {
        path: detailDbfPath,
        recordCount: detailDbf.recordCount,
        fileSize: statsDetail.size,
        lastModified: statsDetail.mtime,
        fields: detailDbf.fields,
      };

      const cacheEntry = this.createCacheEntry(
        filteredFactures,
        filteredDetails,
        factureDbfInfo,
        detailDbfInfo,
        totalFacturesInFile,
        totalDetailsInFile,
      );
      this.cache.set(cacheKey, cacheEntry);

      const loadTime = Date.now() - startTime;
      console.log(
        `[FactureCache] Cache chargé pour ${entreprise.nomDossierDBF}: ${filteredFactures.length} factures (sur ${totalFacturesInFile}), ${filteredDetails.length} lignes détail (sur ${totalDetailsInFile}) en ${loadTime}ms`,
      );

      return cacheEntry;
    } finally {
      this.loadingLocks.delete(cacheKey);
      resolveLock();
    }
  }

  async findByNumfact(entreprise, numfact) {
    const cache = await this.getFactures(entreprise);
    const idx = cache.indexByNumfact.get(numfact.trim());
    return idx !== undefined ? cache.factureRecords[idx] : null;
  }

  async getDetailByNumfact(entreprise, numfact) {
    const cache = await this.getFactures(entreprise);
    const lignes = cache.detailByNumfact.get(numfact.trim()) || [];

    const lignesEnrichies = await Promise.all(
      lignes.map(async (ligne) => {
        const isComment = this.isCommentLine(ligne);
        const nart = this.safeTrim(ligne.NART);

        let articleInfo = null;
        if (!isComment && nart) {
          try {
            articleInfo = await articleCacheService.findByNart(entreprise, nart);
          } catch (error) {
            console.warn(`[FactureCache] Impossible de charger l'article ${nart}: ${error.message}`);
          }
        }

        return {
          ...ligne,
          _isComment: isComment,
          _articleInfo: articleInfo,
        };
      }),
    );

    return lignesEnrichies;
  }

  async getPaginated(entreprise, options = {}) {
    const {
      page = 1,
      limit = 50,
      search,
      tiers,
      repres,
      etat,
      typfact,
      dateDebut,
      dateFin,
    } = options;

    const cache = await this.getFactures(entreprise);
    let filteredRecords = [...cache.factureRecords];

    if (search) {
      const searchLower = search.toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const numfact = this.safeTrim(record.NUMFACT).toLowerCase();
        const nom = this.safeTrim(record.NOM).toLowerCase();
        const texte = this.safeTrim(record.TEXTE).toLowerCase();
        const boncde = this.safeTrim(record.BONCDE).toLowerCase();
        return (
          numfact.includes(searchLower) ||
          nom.includes(searchLower) ||
          texte.includes(searchLower) ||
          boncde.includes(searchLower)
        );
      });
    }

    if (tiers !== undefined && tiers !== null && tiers !== "") {
      const tiersStr = tiers.toString();
      filteredRecords = filteredRecords.filter((r) =>
        r.TIERS !== undefined && r.TIERS !== null ? r.TIERS.toString() === tiersStr : false,
      );
    }

    if (repres !== undefined && repres !== null && repres !== "") {
      const represStr = repres.toString();
      filteredRecords = filteredRecords.filter((r) =>
        r.REPRES !== undefined && r.REPRES !== null ? r.REPRES.toString() === represStr : false,
      );
    }

    if (etat !== undefined && etat !== null && etat !== "") {
      const etatNum = parseInt(etat);
      if (!isNaN(etatNum)) {
        filteredRecords = filteredRecords.filter((r) => r.ETAT === etatNum);
      }
    }

    if (typfact !== undefined && typfact !== null && typfact !== "" && typfact !== "TOUT") {
      const typUpper = typfact.toString().toUpperCase();
      filteredRecords = filteredRecords.filter((r) =>
        this.safeTrim(r.TYPFACT).toUpperCase() === typUpper,
      );
    }

    if (dateDebut) {
      const dateDebutParsed = new Date(dateDebut);
      dateDebutParsed.setHours(0, 0, 0, 0);
      if (!isNaN(dateDebutParsed.getTime())) {
        filteredRecords = filteredRecords.filter((r) => {
          const d = this.parseDate(r.DATFACT);
          if (!d) return false;
          d.setHours(0, 0, 0, 0);
          return d >= dateDebutParsed;
        });
      }
    }

    if (dateFin) {
      const dateFinParsed = new Date(dateFin);
      dateFinParsed.setHours(23, 59, 59, 999);
      if (!isNaN(dateFinParsed.getTime())) {
        filteredRecords = filteredRecords.filter((r) => {
          const d = this.parseDate(r.DATFACT);
          if (!d) return false;
          return d <= dateFinParsed;
        });
      }
    }

    filteredRecords.sort((a, b) => {
      const dateA = this.parseDate(a.DATFACT);
      const dateB = this.parseDate(b.DATFACT);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB.getTime() - dateA.getTime();
    });

    const totalRecords = filteredRecords.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const startIndex = (page - 1) * limit;
    const paginatedRecords = filteredRecords.slice(startIndex, startIndex + limit);

    return {
      totalRecords,
      totalPages,
      page,
      limit,
      hasNextPage: startIndex + limit < totalRecords,
      hasPrevPage: page > 1,
      factures: paginatedRecords,
    };
  }

  async search(entreprise, searchTerm, options = {}) {
    const { limit = 50 } = options;
    const cache = await this.getFactures(entreprise);

    let candidateIndices = null;

    if (searchTerm) {
      const tokens = this.tokenize(searchTerm);
      if (tokens.length > 0) {
        tokens.forEach((token) => {
          const matchingIndices = new Set();
          for (const [indexedToken, indices] of cache.searchIndex) {
            if (indexedToken.startsWith(token) || token.startsWith(indexedToken)) {
              indices.forEach((i) => matchingIndices.add(i));
            }
          }
          if (candidateIndices === null) {
            candidateIndices = matchingIndices;
          } else {
            candidateIndices = new Set([...candidateIndices].filter((i) => matchingIndices.has(i)));
          }
        });
      }
    }

    if (candidateIndices === null) {
      candidateIndices = new Set(cache.factureRecords.map((_, i) => i));
    }

    const results = [...candidateIndices].slice(0, limit);

    return {
      totalFound: candidateIndices.size,
      factures: results.map((i) => cache.factureRecords[i]),
    };
  }

  async getRepresentants(entreprise) {
    const cache = await this.getFactures(entreprise);
    const representants = [];
    for (const [code, indices] of cache.indexByRepres) {
      representants.push({ code: parseInt(code) || 0, count: indices.length });
    }
    return representants.sort((a, b) => a.code - b.code);
  }

  async getTypfactStats(entreprise) {
    const cache = await this.getFactures(entreprise);
    const stats = {};
    for (const [typ, indices] of cache.indexByTypfact) {
      stats[typ] = indices.length;
    }
    return stats;
  }

  async getStructure(entreprise) {
    const cache = await this.getFactures(entreprise);
    const formatFields = (fields) =>
      fields.map((f) => ({ name: f.name, type: f.type, size: f.size, decimalPlaces: f.decimalPlaces }));

    return {
      facture: { ...cache.factureDbfInfo, fields: formatFields(cache.factureDbfInfo.fields) },
      detail: { ...cache.detailDbfInfo, fields: formatFields(cache.detailDbfInfo.fields) },
    };
  }

  invalidate(nomDossierDBF) {
    this.cache.delete(`facture_${nomDossierDBF}`);
    console.log(`[FactureCache] Cache invalidé pour ${nomDossierDBF}`);
  }

  invalidateAll() {
    this.cache.clear();
    console.log("[FactureCache] Tout le cache a été invalidé");
  }

  async preload(entreprise) {
    try {
      await this.getFactures(entreprise);
    } catch (error) {
      console.error(`[FactureCache] Erreur préchargement ${entreprise.nomDossierDBF}:`, error.message);
    }
  }

  getStats() {
    const stats = {};
    for (const [key, entry] of this.cache) {
      stats[key] = {
        factureCount: entry.factureRecords.length,
        totalFacturesInFile: entry.totalFacturesInFile,
        totalDetailsInFile: entry.totalDetailsInFile,
        detailCount: [...entry.detailByNumfact.values()].reduce((sum, arr) => sum + arr.length, 0),
        loadedAt: new Date(entry.loadedAt).toISOString(),
        indexedTokens: entry.searchIndex.size,
        representants: entry.indexByRepres.size,
        typfacts: Object.fromEntries([...entry.indexByTypfact].map(([k, v]) => [k, v.length])),
        etats: Object.fromEntries([...entry.indexByEtat].map(([k, v]) => [k, v.length])),
        periodFilter: `Année ${new Date().getFullYear() - 1} et ${new Date().getFullYear()}`,
      };
    }
    return stats;
  }
}

const factureCacheService = new FactureCacheService();
export default factureCacheService;