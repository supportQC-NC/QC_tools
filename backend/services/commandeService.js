import { DBFFile } from "dbffile";
import path from "path";
import fs from "fs";

/**
 * Service de cache pour les commandes DBF (cmdref.dbf + cmdetail.dbf)
 * Gère deux fichiers DBF liés par NUMCDE
 * Optimisé avec index pour recherches O(1)
 */
class CommandeCacheService {
  constructor() {
    // Cache entêtes : Map<nomDossierDBF, CacheEntry>
    this.cacheRef = new Map();
    // Cache détails : Map<nomDossierDBF, CacheEntry>
    this.cacheDetail = new Map();
    // Durée de validité du cache (5 minutes par défaut)
    this.cacheTTL = 5 * 60 * 1000;
    // Filet de sécurité : au-delà de ce délai, revalidation en arrière-plan
    // (non bloquante) même si mtime/taille n'ont pas changé.
    this.revalidateAfter = 30 * 60 * 1000;
    // Locks pour éviter les chargements multiples simultanés
    this.loadingLocksRef = new Map();
    this.loadingLocksDetail = new Map();
  }

  // =============================================
  // UTILITAIRES
  // =============================================

  /**
   * Safe trim pour les valeurs
   */
  safeTrim(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value).trim();
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
   * Parse une date DBF (type D:8) en objet Date
   */
  parseDbfDate(dateValue) {
    if (!dateValue) return null;
    if (dateValue instanceof Date) return dateValue;
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
      return "fresh"; // chemin momentanément inaccessible : servir le cache
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

  // =============================================
  // CONSTRUCTION DES INDEX - CMDREF (ENTÊTES)
  // =============================================

  /**
   * Crée une entrée de cache pour les entêtes de commande (cmdref.dbf)
   */
  createRefCacheEntry(records, dbfInfo) {
    // Index par NUMCDE - accès O(1)
    const indexByNumcde = new Map();
    // Index par FOURN pour filtrage rapide
    const indexByFourn = new Map();
    // Index par ETAT
    const indexByEtat = new Map();
    // Index par BATEAU
    const indexByBateau = new Map();

    // Construction des index en une seule passe O(n)
    records.forEach((record, idx) => {
      // Index NUMCDE
      if (record.NUMCDE) {
        const numcde = record.NUMCDE.trim().toUpperCase();
        indexByNumcde.set(numcde, idx);
      }

      // Index FOURN
      if (record.FOURN !== undefined && record.FOURN !== null) {
        const fourn = record.FOURN;
        if (!indexByFourn.has(fourn)) {
          indexByFourn.set(fourn, []);
        }
        indexByFourn.get(fourn).push(idx);
      }

      // Index ETAT
      if (record.ETAT !== undefined && record.ETAT !== null) {
        const etat = record.ETAT;
        if (!indexByEtat.has(etat)) {
          indexByEtat.set(etat, []);
        }
        indexByEtat.get(etat).push(idx);
      }

      // Index BATEAU
      if (record.BATEAU) {
        const bateau = record.BATEAU.trim();
        if (bateau) {
          if (!indexByBateau.has(bateau)) {
            indexByBateau.set(bateau, []);
          }
          indexByBateau.get(bateau).push(idx);
        }
      }
    });

    // Index de recherche textuelle
    const searchIndex = this.buildRefSearchIndex(records);

    return {
      records,
      dbfInfo,
      indexByNumcde,
      indexByFourn,
      indexByEtat,
      indexByBateau,
      searchIndex,
      loadedAt: Date.now(),
      lastModified: dbfInfo.lastModified,
    };
  }

  /**
   * Construit un index de recherche textuelle inversé pour cmdref
   */
  buildRefSearchIndex(records) {
    const index = new Map(); // mot -> Set<indices>

    records.forEach((record, idx) => {
      const fieldsToIndex = [
        record.NUMCDE,
        record.OBSERV,
        record.BATEAU,
        record.NUMFACT,
      ];

      fieldsToIndex.forEach((field) => {
        if (field) {
          const tokens = this.tokenize(field.toString());
          tokens.forEach((token) => {
            if (token.length >= 2) {
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

  // =============================================
  // CONSTRUCTION DES INDEX - CMDETAIL (DÉTAILS)
  // =============================================

  /**
   * Crée une entrée de cache pour les détails de commande (cmdetail.dbf)
   * Inclut un index pré-calculé des totaux par NUMCDE (SUM de QTE * PACHAT)
   */
  createDetailCacheEntry(records, dbfInfo) {
    // Index par NUMCDE -> liste d'indices (une commande a plusieurs lignes)
    const indexByNumcde = new Map();
    // Index par NART -> liste d'indices (un article peut être dans plusieurs commandes)
    const indexByNart = new Map();
    // Index pré-calculé des totaux par NUMCDE : Map<NUMCDE, { totalQtePachat, totalMontant, nbLignes }>
    const totalsByNumcde = new Map();

    // Construction des index en une seule passe O(n)
    records.forEach((record, idx) => {
      const numcde = record.NUMCDE ? record.NUMCDE.trim().toUpperCase() : null;

      // Index NUMCDE (1 commande -> N lignes)
      if (numcde) {
        if (!indexByNumcde.has(numcde)) {
          indexByNumcde.set(numcde, []);
        }
        indexByNumcde.get(numcde).push(idx);

        // Calcul des totaux par commande
        const qte = parseFloat(record.QTE) || 0;
        const pachat = parseFloat(record.PACHAT) || 0;
        const montant = parseFloat(record.MONTANT) || 0;

        if (!totalsByNumcde.has(numcde)) {
          totalsByNumcde.set(numcde, {
            totalQtePachat: 0,
            totalMontant: 0,
            nbLignes: 0,
          });
        }

        const totaux = totalsByNumcde.get(numcde);
        totaux.totalQtePachat += qte * pachat;
        totaux.totalMontant += montant;
        totaux.nbLignes += 1;
      }

      // Index NART (1 article -> N lignes dans différentes commandes)
      if (record.NART) {
        const nart = record.NART.trim().toUpperCase();
        if (!indexByNart.has(nart)) {
          indexByNart.set(nart, []);
        }
        indexByNart.get(nart).push(idx);
      }
    });

    // Arrondir les totaux
    for (const [numcde, totaux] of totalsByNumcde) {
      totaux.totalQtePachat = Math.round(totaux.totalQtePachat * 100) / 100;
      totaux.totalMontant = Math.round(totaux.totalMontant * 100) / 100;
    }

    return {
      records,
      dbfInfo,
      indexByNumcde,
      indexByNart,
      totalsByNumcde,
      loadedAt: Date.now(),
      lastModified: dbfInfo.lastModified,
    };
  }

  // =============================================
  // CHARGEMENT DES FICHIERS DBF
  // =============================================

  /**
   * Charge ou récupère du cache les entêtes de commande (cmdref.dbf)
   */
  async getCmdRef(entreprise) {
    const cacheKey = entreprise.nomDossierDBF;
    const dbfPath = path.join(
      entreprise.cheminBase,
      entreprise.nomDossierDBF,
      "cmdref.dbf",
    );

    const cached = this.cacheRef.get(cacheKey);
    const freshness = this.cacheFreshness(cached, dbfPath);
    if (freshness === "fresh") return cached;
    if (freshness === "stale") {
      // stale-while-revalidate : on sert le cache et on recharge en fond.
      if (!this.loadingLocksRef.has(cacheKey)) {
        this._loadRef(entreprise, cacheKey, dbfPath).catch((e) =>
          console.error(
            `[CommandeCache] Revalidation cmdref échouée ${cacheKey}: ${e.message}`,
          ),
        );
      }
      return cached;
    }
    return this._loadRef(entreprise, cacheKey, dbfPath);
  }

  /**
   * Chargement effectif cmdref.dbf (protégé par lock anti-concurrence).
   */
  async _loadRef(entreprise, cacheKey, dbfPath) {
    // Éviter les chargements multiples simultanés
    if (this.loadingLocksRef.has(cacheKey)) {
      await this.loadingLocksRef.get(cacheKey);
      return this.cacheRef.get(cacheKey);
    }

    let resolveLock;
    const lockPromise = new Promise((resolve) => {
      resolveLock = resolve;
    });
    this.loadingLocksRef.set(cacheKey, lockPromise);

    try {
      console.log(
        `[CommandeCache] Chargement cmdref.dbf pour ${cacheKey}...`,
      );
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

      const cacheEntry = this.createRefCacheEntry(records, dbfInfo);
      this.cacheRef.set(cacheKey, cacheEntry);

      const loadTime = Date.now() - startTime;
      console.log(
        `[CommandeCache] cmdref chargé pour ${cacheKey}: ${records.length} commandes en ${loadTime}ms`,
      );

      return cacheEntry;
    } finally {
      this.loadingLocksRef.delete(cacheKey);
      resolveLock();
    }
  }

  /**
   * Charge ou récupère du cache les détails de commande (cmdetail.dbf)
   */
  async getCmdDetail(entreprise) {
    const cacheKey = entreprise.nomDossierDBF;
    const dbfPath = path.join(
      entreprise.cheminBase,
      entreprise.nomDossierDBF,
      "cmdetail.dbf",
    );

    const cached = this.cacheDetail.get(cacheKey);
    const freshness = this.cacheFreshness(cached, dbfPath);
    if (freshness === "fresh") return cached;
    if (freshness === "stale") {
      if (!this.loadingLocksDetail.has(cacheKey)) {
        this._loadDetail(entreprise, cacheKey, dbfPath).catch((e) =>
          console.error(
            `[CommandeCache] Revalidation cmdetail échouée ${cacheKey}: ${e.message}`,
          ),
        );
      }
      return cached;
    }
    return this._loadDetail(entreprise, cacheKey, dbfPath);
  }

  /**
   * Chargement effectif cmdetail.dbf (protégé par lock anti-concurrence).
   */
  async _loadDetail(entreprise, cacheKey, dbfPath) {
    // Éviter les chargements multiples simultanés
    if (this.loadingLocksDetail.has(cacheKey)) {
      await this.loadingLocksDetail.get(cacheKey);
      return this.cacheDetail.get(cacheKey);
    }

    let resolveLock;
    const lockPromise = new Promise((resolve) => {
      resolveLock = resolve;
    });
    this.loadingLocksDetail.set(cacheKey, lockPromise);

    try {
      console.log(
        `[CommandeCache] Chargement cmdetail.dbf pour ${cacheKey}...`,
      );
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

      const cacheEntry = this.createDetailCacheEntry(records, dbfInfo);
      this.cacheDetail.set(cacheKey, cacheEntry);

      const loadTime = Date.now() - startTime;
      console.log(
        `[CommandeCache] cmdetail chargé pour ${cacheKey}: ${records.length} lignes en ${loadTime}ms`,
      );

      return cacheEntry;
    } finally {
      this.loadingLocksDetail.delete(cacheKey);
      resolveLock();
    }
  }

  // =============================================
  // MÉTHODES DE RECHERCHE - ENTÊTES (CMDREF)
  // =============================================

  /**
   * Recherche par NUMCDE - O(1)
   */
  async findByNumcde(entreprise, numcde) {
    const cache = await this.getCmdRef(entreprise);
    const numcdeNormalized = numcde.trim().toUpperCase();
    const idx = cache.indexByNumcde.get(numcdeNormalized);
    return idx !== undefined ? cache.records[idx] : null;
  }

  /**
   * Recherche par fournisseur avec pagination
   */
  async findByFournisseur(entreprise, fourn, options = {}) {
    const { page = 1, limit = 50 } = options;
    const cache = await this.getCmdRef(entreprise);

    const indices = cache.indexByFourn.get(fourn) || [];
    const commandes = indices.map((i) => cache.records[i]);

    // Tri par date de commande décroissante
    commandes.sort((a, b) => {
      const dateA = this.parseDbfDate(a.DATCDE);
      const dateB = this.parseDbfDate(b.DATCDE);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB.getTime() - dateA.getTime();
    });

    const totalRecords = commandes.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const startIndex = (page - 1) * limit;
    const paginatedCommandes = commandes.slice(startIndex, startIndex + limit);

    return {
      totalRecords,
      totalPages,
      page,
      limit,
      hasNextPage: startIndex + limit < totalRecords,
      hasPrevPage: page > 1,
      commandes: paginatedCommandes,
    };
  }

  /**
   * Recherche textuelle optimisée dans les entêtes
   */
  async search(entreprise, searchTerm, options = {}) {
    const { limit = 50 } = options;
    const cache = await this.getCmdRef(entreprise);

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
      candidateIndices = new Set(cache.records.map((_, i) => i));
    }

    const results = [...candidateIndices];
    const limitedResults = results.slice(0, limit);

    return {
      totalFound: results.length,
      commandes: limitedResults.map((i) => cache.records[i]),
    };
  }

  /**
   * Recherche paginée avec tous les filtres avancés sur les entêtes
   * Enrichit chaque commande avec TOTAL_DETAIL (SUM QTE*PACHAT) depuis le cache détails
   */
  async getPaginated(entreprise, options = {}) {
    const {
      page = 1,
      limit = 50,
      // Filtres textuels
      search,
      numcde,
      fourn,
      bateau,
      cdvise,
      // Filtres booléens
      verrou,
      hasFacture,
      groupage,
      // Filtres numériques
      etat,
      // Filtres de dates
      dateDebut,
      dateFin,
      // Option pour enrichir avec les totaux détails
      withDetailTotals = true,
    } = options;

    const cache = await this.getCmdRef(entreprise);

    // Charger le cache détails pour les totaux (en parallèle, pas de surcoût si déjà en cache)
    let detailCache = null;
    if (withDetailTotals) {
      try {
        detailCache = await this.getCmdDetail(entreprise);
      } catch (err) {
        // Si cmdetail.dbf n'existe pas, on continue sans les totaux
        console.warn(
          `[CommandeCache] cmdetail non disponible pour les totaux: ${err.message}`,
        );
      }
    }

    let filteredRecords = [...cache.records];

    // ============ FILTRES TEXTUELS ============

    // Recherche textuelle (NUMCDE, OBSERV, BATEAU, NUMFACT)
    if (search) {
      const searchLower = search.toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const numcdeVal = this.safeTrim(record.NUMCDE).toLowerCase();
        const observ = this.safeTrim(record.OBSERV).toLowerCase();
        const bateauVal = this.safeTrim(record.BATEAU).toLowerCase();
        const numfact = this.safeTrim(record.NUMFACT).toLowerCase();
        return (
          numcdeVal.includes(searchLower) ||
          observ.includes(searchLower) ||
          bateauVal.includes(searchLower) ||
          numfact.includes(searchLower)
        );
      });
    }

    // Filtre: NUMCDE (recherche partielle)
    if (numcde) {
      const numcdeLower = numcde.toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const numcdeVal = this.safeTrim(record.NUMCDE).toLowerCase();
        return numcdeVal.includes(numcdeLower);
      });
    }

    // Filtre: Fournisseur
    if (fourn) {
      const fournVal = parseInt(fourn);
      if (!isNaN(fournVal)) {
        filteredRecords = filteredRecords.filter((record) => {
          return record.FOURN === fournVal;
        });
      }
    }

    // Filtre: Bateau (recherche partielle)
    if (bateau) {
      const bateauLower = bateau.toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const bateauVal = this.safeTrim(record.BATEAU).toLowerCase();
        return bateauVal.includes(bateauLower);
      });
    }

    // Filtre: Code devise
    if (cdvise) {
      const cdviseLower = cdvise.toLowerCase();
      filteredRecords = filteredRecords.filter((record) => {
        const cdviseVal = this.safeTrim(record.CDVISE).toLowerCase();
        return cdviseVal === cdviseLower;
      });
    }

    // ============ FILTRES BOOLÉENS ============

    // Filtre: Verrouillé
    if (verrou) {
      filteredRecords = filteredRecords.filter((record) => {
        const verrouVal = this.safeTrim(record.VERROU).toUpperCase();
        return verrouVal === "O";
      });
    }

    // Filtre: A une facture (NUMFACT non vide)
    if (hasFacture) {
      filteredRecords = filteredRecords.filter((record) => {
        const numfact = this.safeTrim(record.NUMFACT);
        return numfact.length > 0;
      });
    }

    // Filtre: Groupage
    if (groupage) {
      filteredRecords = filteredRecords.filter((record) => {
        const groupageVal = this.safeTrim(record.GROUPAGE).toUpperCase();
        return groupageVal === "O";
      });
    }

    // ============ FILTRES NUMÉRIQUES ============

    // Filtre: État
    if (etat !== undefined && etat !== null && !isNaN(etat)) {
      filteredRecords = filteredRecords.filter((record) => {
        return record.ETAT === etat;
      });
    }

    // ============ FILTRES DE DATES ============

    // Filtre: Date de commande minimum
    if (dateDebut) {
      const dateDebutObj = new Date(dateDebut);
      dateDebutObj.setHours(0, 0, 0, 0);
      if (!isNaN(dateDebutObj.getTime())) {
        filteredRecords = filteredRecords.filter((record) => {
          const datcde = this.parseDbfDate(record.DATCDE);
          if (!datcde) return false;
          return datcde >= dateDebutObj;
        });
      }
    }

    // Filtre: Date de commande maximum
    if (dateFin) {
      const dateFinObj = new Date(dateFin);
      dateFinObj.setHours(23, 59, 59, 999);
      if (!isNaN(dateFinObj.getTime())) {
        filteredRecords = filteredRecords.filter((record) => {
          const datcde = this.parseDbfDate(record.DATCDE);
          if (!datcde) return false;
          return datcde <= dateFinObj;
        });
      }
    }

    // ============ TRI PAR DATE DÉCROISSANTE ============
    filteredRecords.sort((a, b) => {
      const dateA = this.parseDbfDate(a.DATCDE);
      const dateB = this.parseDbfDate(b.DATCDE);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateB.getTime() - dateA.getTime();
    });

    // ============ PAGINATION ============
    const totalRecords = filteredRecords.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const startIndex = (page - 1) * limit;
    const paginatedRecords = filteredRecords.slice(
      startIndex,
      startIndex + limit,
    );

    // ============ ENRICHISSEMENT AVEC TOTAUX DÉTAILS ============
    // On n'enrichit que les commandes de la page courante (performance)
    let enrichedCommandes;
    if (detailCache && detailCache.totalsByNumcde) {
      enrichedCommandes = paginatedRecords.map((record) => {
        const numcdeKey = record.NUMCDE
          ? record.NUMCDE.trim().toUpperCase()
          : null;
        const totaux = numcdeKey
          ? detailCache.totalsByNumcde.get(numcdeKey)
          : null;

        return {
          ...record,
          TOTAL_DETAIL: totaux ? totaux.totalQtePachat : 0,
          TOTAL_MONTANT_DETAIL: totaux ? totaux.totalMontant : 0,
          NB_LIGNES_DETAIL: totaux ? totaux.nbLignes : 0,
        };
      });
    } else {
      enrichedCommandes = paginatedRecords;
    }

    return {
      totalRecords,
      totalPages,
      page,
      limit,
      hasNextPage: startIndex + limit < totalRecords,
      hasPrevPage: page > 1,
      commandes: enrichedCommandes,
    };
  }

  // =============================================
  // MÉTHODES DE RECHERCHE - DÉTAILS (CMDETAIL)
  // =============================================

  /**
   * Obtenir les lignes de détail d'une commande par NUMCDE - O(1)
   */
  async getDetailsByNumcde(entreprise, numcde) {
    const cache = await this.getCmdDetail(entreprise);
    const numcdeNormalized = numcde.trim().toUpperCase();
    const indices = cache.indexByNumcde.get(numcdeNormalized) || [];

    const details = indices.map((i) => cache.records[i]);

    // Tri par numéro de ligne (NL)
    details.sort((a, b) => {
      const nlA = parseFloat(a.NL) || 0;
      const nlB = parseFloat(b.NL) || 0;
      return nlA - nlB;
    });

    return details;
  }

  /**
   * Obtenir les totaux pré-calculés d'une commande par NUMCDE - O(1)
   */
  async getTotalsByNumcde(entreprise, numcde) {
    const cache = await this.getCmdDetail(entreprise);
    const numcdeNormalized = numcde.trim().toUpperCase();
    return (
      cache.totalsByNumcde.get(numcdeNormalized) || {
        totalQtePachat: 0,
        totalMontant: 0,
        nbLignes: 0,
      }
    );
  }

  /**
   * Trouver toutes les lignes de détail pour un article (NART) avec pagination
   * Permet de savoir dans quelles commandes un article apparaît
   */
  async findDetailsByNart(entreprise, nart, options = {}) {
    const { page = 1, limit = 50 } = options;
    const cache = await this.getCmdDetail(entreprise);
    const nartNormalized = nart.trim().toUpperCase();

    const indices = cache.indexByNart.get(nartNormalized) || [];
    const details = indices.map((i) => cache.records[i]);

    const totalRecords = details.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const startIndex = (page - 1) * limit;
    const paginatedDetails = details.slice(startIndex, startIndex + limit);

    return {
      totalRecords,
      totalPages,
      page,
      limit,
      hasNextPage: startIndex + limit < totalRecords,
      hasPrevPage: page > 1,
      details: paginatedDetails,
    };
  }

  // =============================================
  // MÉTHODES UTILITAIRES / LISTES
  // =============================================

  /**
   * Obtenir la liste des fournisseurs avec comptage de commandes
   */
  async getFournisseurs(entreprise) {
    const cache = await this.getCmdRef(entreprise);
    const fournisseurs = [];

    for (const [code, indices] of cache.indexByFourn) {
      fournisseurs.push({ code, count: indices.length });
    }

    return fournisseurs.sort((a, b) => a.code - b.code);
  }

  /**
   * Obtenir la liste des bateaux distincts avec comptage
   */
  async getBateaux(entreprise) {
    const cache = await this.getCmdRef(entreprise);
    const bateaux = [];

    for (const [nom, indices] of cache.indexByBateau) {
      bateaux.push({ nom, count: indices.length });
    }

    return bateaux.sort((a, b) => a.nom.localeCompare(b.nom));
  }

  /**
   * Obtenir les états distincts avec comptage
   */
  async getEtats(entreprise) {
    const cache = await this.getCmdRef(entreprise);
    const etats = [];

    for (const [code, indices] of cache.indexByEtat) {
      etats.push({ code, count: indices.length });
    }

    return etats.sort((a, b) => a.code - b.code);
  }

  /**
   * Obtenir la structure d'un fichier DBF (cmdref ou cmdetail)
   */
  async getStructure(entreprise, fichier = "cmdref") {
    const cache =
      fichier === "cmdetail"
        ? await this.getCmdDetail(entreprise)
        : await this.getCmdRef(entreprise);

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

  // =============================================
  // GESTION DU CACHE
  // =============================================

  /**
   * Invalider le cache d'une entreprise (les deux fichiers)
   */
  invalidate(nomDossierDBF) {
    this.cacheRef.delete(nomDossierDBF);
    this.cacheDetail.delete(nomDossierDBF);
    console.log(
      `[CommandeCache] Cache invalidé pour ${nomDossierDBF} (cmdref + cmdetail)`,
    );
  }

  /**
   * Invalider tout le cache
   */
  invalidateAll() {
    this.cacheRef.clear();
    this.cacheDetail.clear();
    console.log("[CommandeCache] Tout le cache a été invalidé");
  }

  /**
   * Pré-charger le cache pour une entreprise (à appeler au démarrage)
   */
  async preload(entreprise) {
    try {
      await Promise.all([
        this.getCmdRef(entreprise),
        this.getCmdDetail(entreprise),
      ]);
    } catch (error) {
      console.error(
        `[CommandeCache] Erreur préchargement ${entreprise.nomDossierDBF}:`,
        error.message,
      );
    }
  }

  /**
   * Statistiques du cache
   */
  getStats() {
    const stats = {};

    for (const [key, entry] of this.cacheRef) {
      if (!stats[key]) stats[key] = {};
      stats[key].cmdref = {
        recordCount: entry.records.length,
        loadedAt: new Date(entry.loadedAt).toISOString(),
        indexedTokens: entry.searchIndex.size,
        fournisseurs: entry.indexByFourn.size,
        bateaux: entry.indexByBateau.size,
        etats: entry.indexByEtat.size,
      };
    }

    for (const [key, entry] of this.cacheDetail) {
      if (!stats[key]) stats[key] = {};
      stats[key].cmdetail = {
        recordCount: entry.records.length,
        loadedAt: new Date(entry.loadedAt).toISOString(),
        commandesIndexees: entry.indexByNumcde.size,
        articlesIndexes: entry.indexByNart.size,
        commandesAvecTotaux: entry.totalsByNumcde.size,
      };
    }

    return stats;
  }
}

// Export singleton
const commandeCacheService = new CommandeCacheService();
export default commandeCacheService;