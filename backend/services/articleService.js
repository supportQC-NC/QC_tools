// backend/services/articleCacheService.js
import { DBFFile } from "dbffile";
import path from "path";
import fs from "fs";

/**
 * Service de cache pour les articles DBF
 * Optimisé pour 90 000+ références avec recherche < 2 secondes
 * Supporte les filtres avancés côté serveur
 */
class ArticleCacheService {
  constructor() {
    // Cache principal : Map<nomDossierDBF, CacheEntry>
    this.cache = new Map();
    // Durée de validité du cache (5 minutes par défaut)
    this.cacheTTL = 5 * 60 * 1000;
    // Filet de sécurité : au-delà de ce délai, on revalide en arrière-plan
    // (non bloquant) même si mtime/taille n'ont pas changé.
    this.revalidateAfter = 30 * 60 * 1000;
    // Locks pour éviter les chargements multiples simultanés
    this.loadingLocks = new Map();
  }

  /**
   * Structure d'une entrée de cache
   */
  createCacheEntry(records, dbfInfo) {
    // Index par NART (code article) - accès O(1)
    const indexByNart = new Map();
    // Index par GENCOD (code barre) - accès O(1)
    const indexByGencod = new Map();
    // Index par GROUPE pour filtrage rapide
    const indexByGroupe = new Map();
    // Index par FOURN pour filtrage rapide
    const indexByFourn = new Map();
    // Liste des articles avec stock > 0 (stock total S1+S2+S3+S4+S5)
    const articlesEnStock = [];

    // Construction des index en une seule passe O(n)
    records.forEach((record, idx) => {
      // Index NART
      if (record.NART) {
        const nart = record.NART.trim().toUpperCase();
        indexByNart.set(nart, idx);
      }

      // Index GENCOD
      if (record.GENCOD) {
        const gencod = record.GENCOD.trim();
        if (gencod) {
          indexByGencod.set(gencod, idx);
        }
      }

      // Index GROUPE
      if (record.GROUPE) {
        const groupe = record.GROUPE.trim();
        if (groupe) {
          if (!indexByGroupe.has(groupe)) {
            indexByGroupe.set(groupe, []);
          }
          indexByGroupe.get(groupe).push(idx);
        }
      }

      // Index FOURN
      if (record.FOURN !== undefined && record.FOURN !== null) {
        const fourn = record.FOURN;
        if (!indexByFourn.has(fourn)) {
          indexByFourn.set(fourn, []);
        }
        indexByFourn.get(fourn).push(idx);
      }

      // Articles en stock (stock total S1+S2+S3+S4+S5 > 0)
      const stockTotal = this.calculateStockTotal(record);
      if (stockTotal > 0) {
        articlesEnStock.push(idx);
      }
    });

    // Index de recherche textuelle : mots-clés -> indices
    // Pré-calculé pour recherche rapide
    const searchIndex = this.buildSearchIndex(records);

    return {
      records,
      dbfInfo,
      indexByNart,
      indexByGencod,
      indexByGroupe,
      indexByFourn,
      articlesEnStock,
      searchIndex,
      loadedAt: Date.now(),
      lastModified: dbfInfo.lastModified,
    };
  }

  /**
   * Calcul du stock total (S1+S2+S3+S4+S5)
   */
  calculateStockTotal(record) {
    const s1 = parseFloat(record.S1) || 0;
    const s2 = parseFloat(record.S2) || 0;
    const s3 = parseFloat(record.S3) || 0;
    const s4 = parseFloat(record.S4) || 0;
    const s5 = parseFloat(record.S5) || 0;
    return s1 + s2 + s3 + s4 + s5;
  }

  /**
   * Vérifie si une promo est active pour un article
   */
  isPromoActive(record) {
    if (!record.DPROMOD || !record.DPROMOF || !record.PVPROMO) {
      return false;
    }

    const parseDate = (dateValue) => {
      if (!dateValue) return null;
      if (dateValue instanceof Date) return dateValue;
      if (typeof dateValue === "string" && dateValue.length === 8) {
        const year = parseInt(dateValue.substring(0, 4));
        const month = parseInt(dateValue.substring(4, 6)) - 1;
        const day = parseInt(dateValue.substring(6, 8));
        return new Date(year, month, day);
      }
      if (typeof dateValue === "string") {
        const parsed = new Date(dateValue);
        if (!isNaN(parsed.getTime())) return parsed;
      }
      if (typeof dateValue === "number") {
        if (dateValue > 19000000 && dateValue < 30000000) {
          const str = dateValue.toString();
          const year = parseInt(str.substring(0, 4));
          const month = parseInt(str.substring(4, 6)) - 1;
          const day = parseInt(str.substring(6, 8));
          return new Date(year, month, day);
        }
        return new Date(dateValue);
      }
      return null;
    };

    const dateDebut = parseDate(record.DPROMOD);
    const dateFin = parseDate(record.DPROMOF);

    if (!dateDebut || !dateFin) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dateDebut.setHours(0, 0, 0, 0);
    dateFin.setHours(23, 59, 59, 999);

    return today >= dateDebut && today <= dateFin;
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
   * Construit un index de recherche textuelle inversé
   * Permet des recherches full-text rapides
   */
  buildSearchIndex(records) {
    const index = new Map(); // mot -> Set<indices>

    records.forEach((record, idx) => {
      // Champs à indexer pour la recherche
      const fieldsToIndex = [
        record.NART,
        record.DESIGN,
        record.DESIGN2,
        record.GENCOD,
        record.REFER,
      ];

      fieldsToIndex.forEach((field) => {
        if (field) {
          // Normaliser et tokenizer
          const tokens = this.tokenize(field.toString());
          tokens.forEach((token) => {
            if (token.length >= 2) {
              // Ignorer les tokens trop courts
              if (!index.has(token)) {
                index.set(token, new Set());
              }
              index.get(token).add(idx);
            }
          });
        }
      });
    });

    return index;
  }

  /**
   * Tokenize une chaîne pour l'indexation/recherche
   */
  tokenize(str) {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Enlever les accents
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0);
  }

  /**
   * Vérifie si le cache est valide
   */
  isCacheValid(cacheEntry, dbfPath) {
    if (!cacheEntry) return false;

    // Vérifier le TTL
    if (Date.now() - cacheEntry.loadedAt > this.cacheTTL) {
      return false;
    }

    // Vérifier si le fichier a été modifié
    try {
      const stats = fs.statSync(dbfPath);
      if (stats.mtime.getTime() !== cacheEntry.lastModified.getTime()) {
        return false;
      }
    } catch {
      return false;
    }

    return true;
  }

  /**
   * État de fraîcheur du cache : "fresh" | "stale" | "missing".
   * - missing : aucun cache -> chargement synchrone obligatoire
   * - fresh   : fichier inchangé (mtime + taille) -> on sert le cache
   * - stale   : fichier modifié (ou filet de sécurité) -> on sert le cache
   *             et on recharge en arrière-plan (stale-while-revalidate)
   */
  cacheFreshness(cacheEntry, dbfPath) {
    if (!cacheEntry) return "missing";
    let stats;
    try {
      stats = fs.statSync(dbfPath);
    } catch {
      // Chemin momentanément inaccessible : servir le cache existant.
      return "fresh";
    }
    const mtimeChanged =
      stats.mtime.getTime() !== cacheEntry.lastModified.getTime();
    const sizeChanged =
      cacheEntry.dbfInfo && typeof cacheEntry.dbfInfo.fileSize === "number"
        ? stats.size !== cacheEntry.dbfInfo.fileSize
        : false;
    if (mtimeChanged || sizeChanged) return "stale";
    if (Date.now() - cacheEntry.loadedAt > this.revalidateAfter) return "stale";
    return "fresh";
  }

  /**
   * Charge ou récupère du cache les articles d'une entreprise
   */
  async getArticles(entreprise) {
    const cacheKey = entreprise.nomDossierDBF;
    const dbfPath = path.join(
      entreprise.cheminBase,
      entreprise.nomDossierDBF,
      "article.dbf",
    );

    const cached = this.cache.get(cacheKey);
    const freshness = this.cacheFreshness(cached, dbfPath);
    if (freshness === "fresh") return cached;
    if (freshness === "stale") {
      // stale-while-revalidate : on sert le cache immédiatement et on
      // recharge en arrière-plan (l'utilisateur n'attend jamais la relecture).
      if (!this.loadingLocks.has(cacheKey)) {
        this._loadArticles(entreprise, cacheKey, dbfPath).catch((e) =>
          console.error(
            `[ArticleCache] Revalidation échouée ${cacheKey}: ${e.message}`,
          ),
        );
      }
      return cached;
    }
    // missing : premier chargement -> synchrone (inévitable)
    return this._loadArticles(entreprise, cacheKey, dbfPath);
  }

  /**
   * Chargement effectif (lecture DBF). Protégé par lock anti-concurrence.
   */
  async _loadArticles(entreprise, cacheKey, dbfPath) {
    if (this.loadingLocks.has(cacheKey)) {
      // Attendre que le chargement en cours se termine
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
      console.log(`[ArticleCache] Chargement du cache pour ${cacheKey}...`);
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

      const loadTime = Date.now() - startTime;
      console.log(
        `[ArticleCache] Cache chargé pour ${cacheKey}: ${records.length} articles en ${loadTime}ms`,
      );

      return cacheEntry;
    } finally {
      this.loadingLocks.delete(cacheKey);
      resolveLock();
    }
  }

  /**
   * Recherche par NART - O(1)
   */
  async findByNart(entreprise, nart) {
    const cache = await this.getArticles(entreprise);
    const nartNormalized = nart.trim().toUpperCase();
    const idx = cache.indexByNart.get(nartNormalized);
    return idx !== undefined ? cache.records[idx] : null;
  }

  /**
   * Recherche par GENCOD - O(1)
   */
  async findByGencod(entreprise, gencod) {
    const cache = await this.getArticles(entreprise);
    const gencodNormalized = gencod.trim();
    const idx = cache.indexByGencod.get(gencodNormalized);
    return idx !== undefined ? cache.records[idx] : null;
  }

  /**
   * Recherche par code (NART ou GENCOD) - pour le scan
   */
  async findByCode(entreprise, code) {
    const cache = await this.getArticles(entreprise);
    const codeNormalized = code.trim();

    // Essayer d'abord par GENCOD (code barre)
    let idx = cache.indexByGencod.get(codeNormalized);
    if (idx !== undefined) {
      return cache.records[idx];
    }

    // Sinon par NART
    idx = cache.indexByNart.get(codeNormalized.toUpperCase());
    if (idx !== undefined) {
      return cache.records[idx];
    }

    return null;
  }

  /**
   * Recherche textuelle optimisée
   */
  async search(entreprise, searchTerm, options = {}) {
    const { limit = 50, groupe, fourn, enStock } = options;
    const cache = await this.getArticles(entreprise);

    let candidateIndices = null;

    // Si on a un terme de recherche, utiliser l'index inversé
    if (searchTerm) {
      const tokens = this.tokenize(searchTerm);
      if (tokens.length > 0) {
        // Intersection des résultats de chaque token
        tokens.forEach((token) => {
          // Recherche par préfixe pour plus de flexibilité
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
            // Intersection
            candidateIndices = new Set(
              [...candidateIndices].filter((i) => matchingIndices.has(i)),
            );
          }
        });
      }
    }

    // Si pas de recherche textuelle, commencer avec tous les indices
    if (candidateIndices === null) {
      candidateIndices = new Set(cache.records.map((_, i) => i));
    }

    // Appliquer les filtres
    let results = [...candidateIndices];

    // Filtre par groupe
    if (groupe) {
      const groupeIndices = cache.indexByGroupe.get(groupe.trim());
      if (groupeIndices) {
        const groupeSet = new Set(groupeIndices);
        results = results.filter((i) => groupeSet.has(i));
      } else {
        results = [];
      }
    }

    // Filtre par fournisseur
    if (fourn !== undefined) {
      const fournCode = parseInt(fourn);
      const fournIndices = cache.indexByFourn.get(fournCode);
      if (fournIndices) {
        const fournSet = new Set(fournIndices);
        results = results.filter((i) => fournSet.has(i));
      } else {
        results = [];
      }
    }

    // Filtre en stock
    if (enStock) {
      const stockSet = new Set(cache.articlesEnStock);
      results = results.filter((i) => stockSet.has(i));
    }

    // Limiter et récupérer les records
    const limitedResults = results.slice(0, limit);
    return {
      totalFound: results.length,
      articles: limitedResults.map((i) => cache.records[i]),
    };
  }

  /**
   * Recherche paginée avec TOUS les filtres avancés
   * Les filtres s'appliquent sur TOUS les articles AVANT pagination
   */
  async getPaginated(entreprise, options = {}) {
    const {
      page = 1,
      limit = 100,
      // Filtres textuels
      search,
      nart,
      groupe,
      fourn,
      gisement,
      // Filtres booléens
      enStock,
      hasGencod,
      hasPromo,
      hasDeprec,
      isWeb,
      hasPhoto,
      reapproMag,
      // Filtres numériques
      tgc,
    } = options;

    const cache = await this.getArticles(entreprise);

    // Commencer avec tous les records
    let filteredRecords = [...cache.records];

    // ============ FILTRES TEXTUELS ============

    // Filtre: Recherche textuelle (DESIGN, DESIGN2, NART, GENCOD, REFER)
    if (search) {
      const searchLower = search.toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const design = this.safeTrim(record.DESIGN).toLowerCase();
        const design2 = this.safeTrim(record.DESIGN2).toLowerCase();
        const nartVal = this.safeTrim(record.NART).toLowerCase();
        const gencod = this.safeTrim(record.GENCOD).toLowerCase();
        const refer = this.safeTrim(record.REFER).toLowerCase();
        return (
          design.includes(searchLower) ||
          design2.includes(searchLower) ||
          nartVal.includes(searchLower) ||
          gencod.includes(searchLower) ||
          refer.includes(searchLower)
        );
      });
    }

    // Filtre: Code NART (recherche partielle)
    if (nart) {
      const nartLower = nart.toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const nartVal = this.safeTrim(record.NART).toLowerCase();
        return nartVal.includes(nartLower);
      });
    }

    // Filtre: Groupe/Famille
    if (groupe) {
      const groupeLower = groupe.toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const groupeVal = this.safeTrim(record.GROUPE).toLowerCase();
        return groupeVal === groupeLower;
      });
    }

    // Filtre: Fournisseur
    if (fourn) {
      const fournLower = fourn.toString().toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const fournVal = this.safeTrim(record.FOURN).toLowerCase();
        return fournVal.includes(fournLower);
      });
    }

    // Filtre: Gisement (recherche dans GISM1-5 et PLACE)
    if (gisement) {
      const gisementLower = gisement.toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const gism1 = this.safeTrim(record.GISM1).toLowerCase();
        const gism2 = this.safeTrim(record.GISM2).toLowerCase();
        const gism3 = this.safeTrim(record.GISM3).toLowerCase();
        const gism4 = this.safeTrim(record.GISM4).toLowerCase();
        const gism5 = this.safeTrim(record.GISM5).toLowerCase();
        const place = this.safeTrim(record.PLACE).toLowerCase();
        return (
          gism1.includes(gisementLower) ||
          gism2.includes(gisementLower) ||
          gism3.includes(gisementLower) ||
          gism4.includes(gisementLower) ||
          gism5.includes(gisementLower) ||
          place.includes(gisementLower)
        );
      });
    }

    // ============ FILTRES BOOLÉENS ============

    // Filtre: En stock (stock total S1+S2+S3+S4+S5 > 0)
    if (enStock) {
      filteredRecords = filteredRecords.filter((record) => {
        return this.calculateStockTotal(record) > 0;
      });
    }

    // Filtre: A un code GENCOD
    if (hasGencod) {
      filteredRecords = filteredRecords.filter((record) => {
        const gencod = this.safeTrim(record.GENCOD);
        return gencod.length > 0;
      });
    }

    // Filtre: En promotion active
    if (hasPromo) {
      filteredRecords = filteredRecords.filter((record) => {
        return this.isPromoActive(record);
      });
    }

    // Filtre: Article déprécié (DEPREC > 0)
    if (hasDeprec) {
      filteredRecords = filteredRecords.filter((record) => {
        const deprec = parseFloat(record.DEPREC) || 0;
        return deprec > 0;
      });
    }

    // Filtre: Visible sur le web (WEB === "O")
    if (isWeb) {
      filteredRecords = filteredRecords.filter((record) => {
        const web = this.safeTrim(record.WEB).toUpperCase();
        return web === "O";
      });
    }

    // Filtre: A une photo (FOTO === "F")
    if (hasPhoto) {
      filteredRecords = filteredRecords.filter((record) => {
        const foto = this.safeTrim(record.FOTO).toUpperCase();
        return foto === "F";
      });
    }

    // Filtre: Réappro Magasin (stock total > 0 ET S1 = 0)
    if (reapproMag) {
      filteredRecords = filteredRecords.filter((record) => {
        const stockTotal = this.calculateStockTotal(record);
        const s1 = parseFloat(record.S1) || 0;
        return stockTotal > 0 && s1 === 0;
      });
    }

    // ============ FILTRES NUMÉRIQUES ============

    // Filtre: TGC (taux de taxe)
    if (tgc !== undefined && tgc !== "" && tgc !== null) {
      const tgcValue = parseFloat(tgc);
      if (!isNaN(tgcValue)) {
        filteredRecords = filteredRecords.filter((record) => {
          const taxes = parseFloat(record.TAXES) || 0;
          return Math.abs(taxes - tgcValue) < 0.01; // Tolérance pour les flottants
        });
      }
    }

    // ============ PAGINATION ============
    const totalRecords = filteredRecords.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const startIndex = (page - 1) * limit;
    const paginatedRecords = filteredRecords.slice(
      startIndex,
      startIndex + limit,
    );

    return {
      totalRecords,
      totalPages,
      page,
      limit,
      hasNextPage: startIndex + limit < totalRecords,
      hasPrevPage: page > 1,
      articles: paginatedRecords,
    };
  }

  /**
   * Obtenir les groupes avec comptage
   */
  async getGroupes(entreprise) {
    const cache = await this.getArticles(entreprise);
    const groupes = [];

    for (const [code, indices] of cache.indexByGroupe) {
      groupes.push({ code, count: indices.length });
    }

    return groupes.sort((a, b) => a.code.localeCompare(b.code));
  }

  /**
   * Obtenir les taux TGC distincts
   */
  async getTgcRates(entreprise) {
    const cache = await this.getArticles(entreprise);
    const tgcSet = new Set();

    cache.records.forEach((record) => {
      const taxes = parseFloat(record.TAXES);
      if (!isNaN(taxes)) {
        tgcSet.add(taxes);
      }
    });

    return Array.from(tgcSet).sort((a, b) => a - b);
  }

  /**
   * Obtenir la structure du fichier DBF
   */
  async getStructure(entreprise) {
    const cache = await this.getArticles(entreprise);
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

  /**
   * Invalider le cache d'une entreprise
   */
  invalidate(nomDossierDBF) {
    this.cache.delete(nomDossierDBF);
    console.log(`[ArticleCache] Cache invalidé pour ${nomDossierDBF}`);
  }

  /**
   * Invalider tout le cache
   */
  invalidateAll() {
    this.cache.clear();
    console.log("[ArticleCache] Tout le cache a été invalidé");
  }

  /**
   * Pré-charger le cache pour une entreprise (à appeler au démarrage)
   */
  async preload(entreprise) {
    try {
      await this.getArticles(entreprise);
    } catch (error) {
      console.error(
        `[ArticleCache] Erreur préchargement ${entreprise.nomDossierDBF}:`,
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
        recordCount: entry.records.length,
        loadedAt: new Date(entry.loadedAt).toISOString(),
        indexedTokens: entry.searchIndex.size,
        groupes: entry.indexByGroupe.size,
        articlesEnStock: entry.articlesEnStock.length,
      };
    }
    return stats;
  }

    /**
   * Calculer les statistiques d'articles pour un fournisseur spécifique
   * (Total articles, Total dépréciés)
   */
  /**
   * Calculer les statistiques d'articles pour un fournisseur spécifique
   * Utilise un filtrage String pour être cohérent avec getPaginated
   */
  async getSupplierStats(entreprise, fournCode) {
    const cache = await this.getArticles(entreprise);
    
    // On transforme le code cherché en string nettoyée
    const targetCode = String(fournCode).trim().toLowerCase();
    const stockKeys = ['S1', 'S2', 'S3', 'S4', 'S5'];

    let total = 0;
    let deprecatedCount = 0;

    // On scanne TOUS les records pour trouver ceux de ce fournisseur
    // C'est plus lent que l'index (O(n)) mais garanti 100% de cohérence avec l'affichage
    cache.records.forEach(record => {
      // 1. Filtre Fournisseur (même logique que getPaginated)
      const recordCode = this.safeTrim(record.FOURN).toLowerCase();
      
      if (recordCode.includes(targetCode)) {
        total++;

        // 2. Calcul Dépréciation
        const design = (record.DESIGN || "").trim();
        const hasDeprecatedMark = design.includes("**");
        
        let stockTotal = 0;
        stockKeys.forEach(k => {
          stockTotal += (parseFloat(record[k]) || 0);
        });

        if (hasDeprecatedMark && stockTotal === 0) {
          deprecatedCount++;
        }
      }
    });

    const rate = total > 0 ? ((deprecatedCount / total) * 100) : 0;

    return {
      total,
      deprecated: deprecatedCount,
      rate: rate.toFixed(1)
    };
  }
}


// Export singleton
const articleCacheService = new ArticleCacheService();
export default articleCacheService;