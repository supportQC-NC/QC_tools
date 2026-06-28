// backend/services/proformaCacheService.js
import { DBFFile } from "dbffile";
import path from "path";
import fs from "fs";
import articleCacheService from "./articleService.js";

/**
 * Service de cache pour les proformas DBF (entêtes + détails)
 * Deux fichiers : proforma.dbf (entêtes) et prodet.dbf (lignes détail)
 * Liaison prodet <-> article via NART
 * Liaison prodet <-> proforma via NUMFACT
 *
 * Structure proforma.dbf :
 * NUMFACT(C:7), DATFACT(D:8), TIERS(N:4.0), NOM(C:30), TEXTE(C:60),
 * REPRES(N:2.0), MONTANT(N:8.0), DATCHANT(D:8),
 * MAILING1-5(C:70), ETAT(N:1.0)
 *
 * Structure prodet.dbf :
 * NUMFACT(C:7), NART(C:6), DESIGN(C:50), QTE(N:9.3), PVTE(N:11.2),
 * PREV(N:11.2), POURC(N:3.0), DTVA(N:5.2), CLIENT(C:4), NL(N:8.3),
 * COMPOSE(C:2), NONIMP(C:1), PVTTC(N:8.0), NUMSERIE(C:40), GARANTIE(C:10)
 *
 * Si NART est vide ou contient "!" => ligne de commentaire (pas un article)
 */
class ProformaCacheService {
  constructor() {
    // Cache principal : Map<nomDossierDBF, CacheEntry>
    this.cache = new Map();
    // Durée de validité du cache (5 minutes)
    this.cacheTTL = 5 * 60 * 1000;
    // Locks pour éviter les chargements multiples simultanés
    this.loadingLocks = new Map();
  }

  /**
   * Safe trim pour les valeurs
   */
  safeTrim(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value).trim();
  }

  /**
   * Parse une date DBF en objet Date
   */
  parseDate(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date) {
      // Vérifier que la date est valide
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
   * Détermine si une ligne prodet est un commentaire
   * Règle : NART vide ou contenant "!" => commentaire
   */
  isCommentLine(record) {
    const nart = this.safeTrim(record.NART);
    return nart === "" || nart.includes("!");
  }

  /**
   * Tokenize une chaîne pour l'indexation/recherche
   */
  tokenize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0);
  }

  /**
   * Structure d'une entrée de cache
   */
  createCacheEntry(proformaRecords, prodetRecords, proformaDbfInfo, prodetDbfInfo) {
    // Index proformas par NUMFACT - accès O(1)
    const indexByNumfact = new Map();
    // Index par TIERS
    const indexByTiers = new Map();
    // Index par REPRES
    const indexByRepres = new Map();
    // Index par ETAT
    const indexByEtat = new Map();

    // Index des lignes prodet par NUMFACT - accès O(1)
    const prodetByNumfact = new Map();

    // Index de recherche textuelle pour proformas
    const searchIndex = new Map();

    // Construction des index proformas en une seule passe O(n)
    proformaRecords.forEach((record, idx) => {
      const numfact = this.safeTrim(record.NUMFACT);

      // Index NUMFACT
      if (numfact) {
        indexByNumfact.set(numfact, idx);
      }

      // Index TIERS
      const tiers = record.TIERS;
      if (tiers !== undefined && tiers !== null) {
        const tiersKey = tiers.toString();
        if (!indexByTiers.has(tiersKey)) {
          indexByTiers.set(tiersKey, []);
        }
        indexByTiers.get(tiersKey).push(idx);
      }

      // Index REPRES
      const repres = record.REPRES;
      if (repres !== undefined && repres !== null) {
        const represKey = repres.toString();
        if (!indexByRepres.has(represKey)) {
          indexByRepres.set(represKey, []);
        }
        indexByRepres.get(represKey).push(idx);
      }

      // Index ETAT
      const etat = record.ETAT;
      if (etat !== undefined && etat !== null) {
        const etatKey = etat.toString();
        if (!indexByEtat.has(etatKey)) {
          indexByEtat.set(etatKey, []);
        }
        indexByEtat.get(etatKey).push(idx);
      }

      // Index de recherche textuelle
      const fieldsToIndex = [
        record.NUMFACT,
        record.NOM,
        record.TEXTE,
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

    // Construction de l'index prodet par NUMFACT en une seule passe O(n)
    prodetRecords.forEach((record) => {
      const numfact = this.safeTrim(record.NUMFACT);
      if (numfact) {
        if (!prodetByNumfact.has(numfact)) {
          prodetByNumfact.set(numfact, []);
        }
        prodetByNumfact.get(numfact).push(record);
      }
    });

    return {
      proformaRecords,
      prodetRecords,
      proformaDbfInfo,
      prodetDbfInfo,
      indexByNumfact,
      indexByTiers,
      indexByRepres,
      indexByEtat,
      prodetByNumfact,
      searchIndex,
      loadedAt: Date.now(),
      lastModifiedProforma: proformaDbfInfo.lastModified,
      lastModifiedProdet: prodetDbfInfo.lastModified,
    };
  }

  /**
   * Vérifie si le cache est valide (vérifie les deux fichiers DBF)
   */
  isCacheValid(cacheEntry, proformaDbfPath, prodetDbfPath) {
    if (!cacheEntry) return false;

    // Vérifier le TTL
    if (Date.now() - cacheEntry.loadedAt > this.cacheTTL) {
      return false;
    }

    // Vérifier si proforma.dbf a été modifié
    try {
      const statsProforma = fs.statSync(proformaDbfPath);
      if (statsProforma.mtime.getTime() !== cacheEntry.lastModifiedProforma.getTime()) {
        return false;
      }
    } catch {
      return false;
    }

    // Vérifier si prodet.dbf a été modifié
    try {
      const statsProdet = fs.statSync(prodetDbfPath);
      if (statsProdet.mtime.getTime() !== cacheEntry.lastModifiedProdet.getTime()) {
        return false;
      }
    } catch {
      return false;
    }

    return true;
  }

  /**
   * Charge ou récupère du cache les proformas d'une entreprise
   */
  async getProformas(entreprise) {
    const cacheKey = entreprise.nomDossierDBF;
    const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
    const proformaDbfPath = path.join(basePath, "proforma.dbf");
    const prodetDbfPath = path.join(basePath, "prodet.dbf");

    // Vérifier le cache
    const cached = this.cache.get(cacheKey);
    if (this.isCacheValid(cached, proformaDbfPath, prodetDbfPath)) {
      return cached;
    }

    // Éviter les chargements multiples simultanés
    if (this.loadingLocks.has(cacheKey)) {
      await this.loadingLocks.get(cacheKey);
      return this.cache.get(cacheKey);
    }

    // Créer un lock pour ce chargement
    let resolveLock;
    const lockPromise = new Promise((resolve) => {
      resolveLock = resolve;
    });
    this.loadingLocks.set(cacheKey, lockPromise);

    try {
      console.log(`[ProformaCache] Chargement du cache pour ${cacheKey}...`);
      const startTime = Date.now();

      if (!fs.existsSync(proformaDbfPath)) {
        throw new Error(`Fichier proforma.dbf non trouvé: ${proformaDbfPath}`);
      }
      if (!fs.existsSync(prodetDbfPath)) {
        throw new Error(`Fichier prodet.dbf non trouvé: ${prodetDbfPath}`);
      }

      // Charger les deux fichiers DBF en parallèle
      const [proformaDbf, prodetDbf] = await Promise.all([
        DBFFile.open(proformaDbfPath),
        DBFFile.open(prodetDbfPath),
      ]);

      const [proformaRecords, prodetRecords] = await Promise.all([
        proformaDbf.readRecords(),
        prodetDbf.readRecords(),
      ]);

      const [statsProforma, statsProdet] = await Promise.all([
        fs.promises.stat(proformaDbfPath),
        fs.promises.stat(prodetDbfPath),
      ]);

      const proformaDbfInfo = {
        path: proformaDbfPath,
        recordCount: proformaDbf.recordCount,
        fileSize: statsProforma.size,
        lastModified: statsProforma.mtime,
        fields: proformaDbf.fields,
      };

      const prodetDbfInfo = {
        path: prodetDbfPath,
        recordCount: prodetDbf.recordCount,
        fileSize: statsProdet.size,
        lastModified: statsProdet.mtime,
        fields: prodetDbf.fields,
      };

      const cacheEntry = this.createCacheEntry(
        proformaRecords,
        prodetRecords,
        proformaDbfInfo,
        prodetDbfInfo,
      );
      this.cache.set(cacheKey, cacheEntry);

      const loadTime = Date.now() - startTime;
      console.log(
        `[ProformaCache] Cache chargé pour ${cacheKey}: ${proformaRecords.length} proformas, ${prodetRecords.length} lignes détail en ${loadTime}ms`,
      );

      return cacheEntry;
    } finally {
      this.loadingLocks.delete(cacheKey);
      resolveLock();
    }
  }

  /**
   * Recherche d'une proforma par NUMFACT - O(1)
   */
  async findByNumfact(entreprise, numfact) {
    const cache = await this.getProformas(entreprise);
    const numfactNormalized = numfact.trim();
    const idx = cache.indexByNumfact.get(numfactNormalized);
    return idx !== undefined ? cache.proformaRecords[idx] : null;
  }

  /**
   * Récupérer les lignes détail d'une proforma par NUMFACT - O(1)
   * Enrichit chaque ligne avec les infos article complètes
   */
  async getProdetByNumfact(entreprise, numfact) {
    const cache = await this.getProformas(entreprise);
    const numfactNormalized = numfact.trim();
    const lignes = cache.prodetByNumfact.get(numfactNormalized) || [];

    // Enrichir chaque ligne avec les infos article
    const lignesEnrichies = await Promise.all(
      lignes.map(async (ligne) => {
        const isComment = this.isCommentLine(ligne);
        const nart = this.safeTrim(ligne.NART);

        let articleInfo = null;
        if (!isComment && nart) {
          try {
            articleInfo = await articleCacheService.findByNart(entreprise, nart);
          } catch (error) {
            console.warn(
              `[ProformaCache] Impossible de charger l'article ${nart}: ${error.message}`,
            );
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

  /**
   * Recherche paginée de proformas avec filtres
   * Filtres : search, tiers, repres, etat, dateDebut, dateFin
   */
  async getPaginated(entreprise, options = {}) {
    const {
      page = 1,
      limit = 50,
      search,
      tiers,
      repres,
      etat,
      dateDebut,
      dateFin,
    } = options;

    const cache = await this.getProformas(entreprise);

    let filteredRecords = [...cache.proformaRecords];

    // ============ FILTRE TEXTUEL ============

    // Recherche textuelle (NUMFACT, NOM, TEXTE)
    if (search) {
      const searchLower = search.toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const numfact = this.safeTrim(record.NUMFACT).toLowerCase();
        const nom = this.safeTrim(record.NOM).toLowerCase();
        const texte = this.safeTrim(record.TEXTE).toLowerCase();
        return (
          numfact.includes(searchLower) ||
          nom.includes(searchLower) ||
          texte.includes(searchLower)
        );
      });
    }

    // ============ FILTRES SPÉCIFIQUES ============

    // Filtre par TIERS (code client)
    if (tiers !== undefined && tiers !== null && tiers !== "") {
      const tiersStr = tiers.toString();
      filteredRecords = filteredRecords.filter((record) => {
        const tiersVal = record.TIERS !== undefined && record.TIERS !== null
          ? record.TIERS.toString()
          : "";
        return tiersVal === tiersStr;
      });
    }

    // Filtre par REPRES (représentant)
    if (repres !== undefined && repres !== null && repres !== "") {
      const represStr = repres.toString();
      filteredRecords = filteredRecords.filter((record) => {
        const represVal = record.REPRES !== undefined && record.REPRES !== null
          ? record.REPRES.toString()
          : "";
        return represVal === represStr;
      });
    }

    // Filtre par ETAT (0=brouillon, 1=validée, 2=facturée)
    if (etat !== undefined && etat !== null && etat !== "") {
      const etatNum = parseInt(etat);
      if (!isNaN(etatNum)) {
        filteredRecords = filteredRecords.filter((record) => {
          return record.ETAT === etatNum;
        });
      }
    }

    // Filtre par plage de dates (DATFACT)
    if (dateDebut) {
      const dateDebutParsed = new Date(dateDebut);
      dateDebutParsed.setHours(0, 0, 0, 0);
      if (!isNaN(dateDebutParsed.getTime())) {
        filteredRecords = filteredRecords.filter((record) => {
          const datfact = this.parseDate(record.DATFACT);
          if (!datfact) return false;
          datfact.setHours(0, 0, 0, 0);
          return datfact >= dateDebutParsed;
        });
      }
    }

    if (dateFin) {
      const dateFinParsed = new Date(dateFin);
      dateFinParsed.setHours(23, 59, 59, 999);
      if (!isNaN(dateFinParsed.getTime())) {
        filteredRecords = filteredRecords.filter((record) => {
          const datfact = this.parseDate(record.DATFACT);
          if (!datfact) return false;
          return datfact <= dateFinParsed;
        });
      }
    }

    // ============ TRI PAR DATE DÉCROISSANTE ============
    filteredRecords.sort((a, b) => {
      const dateA = this.parseDate(a.DATFACT);
      const dateB = this.parseDate(b.DATFACT);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB.getTime() - dateA.getTime();
    });

    // ============ PAGINATION ============
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
      proformas: paginatedRecords,
    };
  }

  /**
   * Recherche textuelle optimisée via index inversé
   */
  async search(entreprise, searchTerm, options = {}) {
    const { limit = 50 } = options;
    const cache = await this.getProformas(entreprise);

    let candidateIndices = null;

    if (searchTerm) {
      const tokens = this.tokenize(searchTerm);
      if (tokens.length > 0) {
        tokens.forEach((token) => {
          const matchingIndices = new Set();
          for (const [indexedToken, indices] of cache.searchIndex) {
            if (
              indexedToken.startsWith(token) ||
              token.startsWith(indexedToken)
            ) {
              indices.forEach((i) => matchingIndices.add(i));
            }
          }

          if (candidateIndices === null) {
            candidateIndices = matchingIndices;
          } else {
            candidateIndices = new Set(
              [...candidateIndices].filter((i) => matchingIndices.has(i)),
            );
          }
        });
      }
    }

    if (candidateIndices === null) {
      candidateIndices = new Set(cache.proformaRecords.map((_, i) => i));
    }

    const results = [...candidateIndices].slice(0, limit);

    return {
      totalFound: candidateIndices.size,
      proformas: results.map((i) => cache.proformaRecords[i]),
    };
  }

  /**
   * Obtenir les représentants distincts avec comptage
   */
  async getRepresentants(entreprise) {
    const cache = await this.getProformas(entreprise);
    const representants = [];

    for (const [code, indices] of cache.indexByRepres) {
      representants.push({ code: parseInt(code) || 0, count: indices.length });
    }

    return representants.sort((a, b) => a.code - b.code);
  }

  /**
   * Obtenir la structure des fichiers DBF (proforma + prodet)
   */
  async getStructure(entreprise) {
    const cache = await this.getProformas(entreprise);

    const formatFields = (fields) =>
      fields.map((f) => ({
        name: f.name,
        type: f.type,
        size: f.size,
        decimalPlaces: f.decimalPlaces,
      }));

    return {
      proforma: {
        ...cache.proformaDbfInfo,
        fields: formatFields(cache.proformaDbfInfo.fields),
      },
      prodet: {
        ...cache.prodetDbfInfo,
        fields: formatFields(cache.prodetDbfInfo.fields),
      },
    };
  }

  /**
   * Invalider le cache d'une entreprise
   */
  invalidate(nomDossierDBF) {
    this.cache.delete(nomDossierDBF);
    console.log(`[ProformaCache] Cache invalidé pour ${nomDossierDBF}`);
  }

  /**
   * Invalider tout le cache
   */
  invalidateAll() {
    this.cache.clear();
    console.log("[ProformaCache] Tout le cache a été invalidé");
  }

  /**
   * Pré-charger le cache
   */
  async preload(entreprise) {
    try {
      await this.getProformas(entreprise);
    } catch (error) {
      console.error(
        `[ProformaCache] Erreur préchargement ${entreprise.nomDossierDBF}:`,
        error.message,
      );
    }
  }

  /**
   * Statistiques du cache
   */
  getStats() {
    const stats = {};
    for (const [key, entry] of this.cache) {
      stats[key] = {
        proformaCount: entry.proformaRecords.length,
        prodetCount: entry.prodetRecords.length,
        loadedAt: new Date(entry.loadedAt).toISOString(),
        indexedTokens: entry.searchIndex.size,
        representants: entry.indexByRepres.size,
        etats: Object.fromEntries(
          [...entry.indexByEtat].map(([k, v]) => [k, v.length]),
        ),
      };
    }
    return stats;
  }
}

// Export singleton
const proformaCacheService = new ProformaCacheService();
export default proformaCacheService;