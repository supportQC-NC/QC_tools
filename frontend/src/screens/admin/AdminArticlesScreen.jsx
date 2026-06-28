// src/screens/admin/AdminArticlesScreen.jsx
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  HiSearch,
  HiRefresh,
  HiFilter,
  HiChevronLeft,
  HiChevronRight,
  HiCube,
  HiOfficeBuilding,
  HiEye,
  HiX,
  HiTag,
  HiPhotograph,
  HiGlobe,
  HiExclamation,
  HiShoppingCart,
  HiQrcode,
  HiCurrencyDollar,
  HiCollection,
  HiLocationMarker,
  HiAdjustments,
  HiChevronDown,
  HiChevronUp,
  HiTrendingDown,
  HiArchive,
  HiExternalLink,
} from "react-icons/hi";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetArticlesQuery,
  useGetGroupesQuery,
  getPhotoUrl,
} from "../../slices/articleApiSlice";
import "./AdminArticlesScreen.css";

// Clé pour le localStorage
const STORAGE_KEY_ENTREPRISE = "admin_articles_selected_entreprise";

// Debounce hook pour éviter trop de requêtes
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

const AdminArticlesScreen = () => {
  const navigate = useNavigate();
  const { nomDossierDBF: urlNomDossier } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  // Récupérer l'entreprise depuis l'URL, le localStorage ou vide
  const getInitialEntreprise = () => {
    if (urlNomDossier) return urlNomDossier;
    const saved = localStorage.getItem(STORAGE_KEY_ENTREPRISE);
    return saved || "";
  };

  // État principal
  const [selectedEntreprise, setSelectedEntreprise] =
    useState(getInitialEntreprise);
  const [selectedEntrepriseData, setSelectedEntrepriseData] = useState(null);
  const [page, setPage] = useState(parseInt(searchParams.get("page")) || 1);
  const [limit] = useState(50);

  // États des filtres - Récupérer depuis URL si disponible
  const [filters, setFilters] = useState({
    nart: searchParams.get("nart") || "",
    search: searchParams.get("search") || "",
    fourn: searchParams.get("fourn") || "",
    stock: searchParams.get("stock") || "TOUT",
    gencod: searchParams.get("gencod") || "TOUT",
    promo: searchParams.get("promo") || "TOUT",
    deprec: searchParams.get("deprec") || "TOUT",
    web: searchParams.get("web") || "TOUT",
    photo: searchParams.get("photo") || "TOUT",
    tgc: searchParams.get("tgc") || "TOUT",
    reappro: searchParams.get("reappro") || "TOUT",
    groupe: searchParams.get("groupe") || "",
    gisement: searchParams.get("gisement") || "",
  });

  // Debounce des filtres textuels pour éviter trop de requêtes
  const debouncedFilters = useDebounce(filters, 400);

  // États UI
  const [showFilters, setShowFilters] = useState(true);
  const [selectedArticle, setSelectedArticle] = useState(null);
  const [photoError, setPhotoError] = useState(false);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    identification: true,
    stock: true,
    commercial: true,
    avance: false,
  });

  // Queries
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();

  // Query pour les articles avec TOUS les filtres côté serveur
  const {
    data: articlesData,
    isLoading: loadingArticles,
    error: articlesError,
    refetch,
    isFetching,
  } = useGetArticlesQuery(
    {
      nomDossierDBF: selectedEntreprise,
      page,
      limit,
      // ====== TOUS LES FILTRES ENVOYÉS AU SERVEUR ======
      // Filtres textuels
      search: debouncedFilters.search || undefined,
      nart: debouncedFilters.nart || undefined,
      groupe: debouncedFilters.groupe || undefined,
      fourn: debouncedFilters.fourn || undefined,
      gisement: debouncedFilters.gisement || undefined,
      // Filtres énumérés
      stock: debouncedFilters.stock,
      gencod: debouncedFilters.gencod,
      promo: debouncedFilters.promo,
      deprec: debouncedFilters.deprec,
      web: debouncedFilters.web,
      photo: debouncedFilters.photo,
      reappro: debouncedFilters.reappro,
      tgc: debouncedFilters.tgc,
    },
    { skip: !selectedEntreprise },
  );

  const { data: groupesData } = useGetGroupesQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
  });

  // Effet pour mettre à jour l'entreprise sélectionnée quand les données sont chargées
  useEffect(() => {
    if (entreprises && selectedEntreprise) {
      const entreprise = entreprises.find(
        (e) => e.nomDossierDBF === selectedEntreprise,
      );
      if (entreprise) {
        setSelectedEntrepriseData(entreprise);
        localStorage.setItem(STORAGE_KEY_ENTREPRISE, selectedEntreprise);
      }
    }
  }, [entreprises, selectedEntreprise]);

  // Effet pour synchroniser l'URL avec les filtres
  useEffect(() => {
    const params = new URLSearchParams();

    if (page > 1) params.set("page", page.toString());
    if (filters.nart) params.set("nart", filters.nart);
    if (filters.search) params.set("search", filters.search);
    if (filters.fourn) params.set("fourn", filters.fourn);
    if (filters.stock !== "TOUT") params.set("stock", filters.stock);
    if (filters.gencod !== "TOUT") params.set("gencod", filters.gencod);
    if (filters.promo !== "TOUT") params.set("promo", filters.promo);
    if (filters.deprec !== "TOUT") params.set("deprec", filters.deprec);
    if (filters.web !== "TOUT") params.set("web", filters.web);
    if (filters.photo !== "TOUT") params.set("photo", filters.photo);
    if (filters.tgc !== "TOUT") params.set("tgc", filters.tgc);
    if (filters.reappro !== "TOUT") params.set("reappro", filters.reappro);
    if (filters.groupe) params.set("groupe", filters.groupe);
    if (filters.gisement) params.set("gisement", filters.gisement);

    setSearchParams(params, { replace: true });
  }, [filters, page, setSearchParams]);

  // Helper pour vérifier si une promo est active (pour l'affichage)
  const isPromoActive = useCallback((article) => {
    if (!article?.DPROMOD || !article?.DPROMOF || !article?.PVPROMO) {
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
      return null;
    };

    const dateDebut = parseDate(article.DPROMOD);
    const dateFin = parseDate(article.DPROMOF);

    if (!dateDebut || !dateFin) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dateDebut.setHours(0, 0, 0, 0);
    dateFin.setHours(23, 59, 59, 999);

    return today >= dateDebut && today <= dateFin;
  }, []);

  // Les articles viennent directement du serveur (déjà filtrés !)
  const articles = articlesData?.articles || [];

  // Handlers
  const handleEntrepriseChange = (e) => {
    const nomDossier = e.target.value;
    setSelectedEntreprise(nomDossier);

    if (nomDossier) {
      const entreprise = entreprises?.find(
        (ent) => ent.nomDossierDBF === nomDossier,
      );
      setSelectedEntrepriseData(entreprise);
      localStorage.setItem(STORAGE_KEY_ENTREPRISE, nomDossier);
    } else {
      setSelectedEntrepriseData(null);
      localStorage.removeItem(STORAGE_KEY_ENTREPRISE);
    }

    setPage(1);
    resetFilters();
  };

  const resetFilters = () => {
    setFilters({
      nart: "",
      search: "",
      fourn: "",
      stock: "TOUT",
      gencod: "TOUT",
      promo: "TOUT",
      deprec: "TOUT",
      web: "TOUT",
      photo: "TOUT",
      tgc: "TOUT",
      reappro: "TOUT",
      groupe: "",
      gisement: "",
    });
    setPage(1);
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1); // Reset page quand un filtre change
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const handleViewArticle = (article) => {
    setSelectedArticle(article);
    setPhotoError(false);
    setPhotoLoaded(false);
  };

  // Compteurs de filtres actifs
  const activeFiltersCount = useMemo(() => {
    return Object.entries(filters).filter(([key, value]) => {
      if (["nart", "search", "fourn", "groupe", "gisement"].includes(key)) {
        return value !== "";
      }
      return value !== "TOUT";
    }).length;
  }, [filters]);

  // Formatters
  const formatPrice = (price) => {
    if (!price && price !== 0) return "-";
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XPF",
      minimumFractionDigits: 0,
    }).format(price);
  };

  const formatStock = (stock) => {
    if (stock === null || stock === undefined) return "-";
    const num = parseFloat(stock);
    if (isNaN(num)) return "-";
    return num.toLocaleString("fr-FR");
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return "-";
    if (typeof dateValue === "string" && dateValue.length === 8) {
      const year = dateValue.substring(0, 4);
      const month = dateValue.substring(4, 6);
      const day = dateValue.substring(6, 8);
      return `${day}/${month}/${year}`;
    }
    if (dateValue instanceof Date) {
      return dateValue.toLocaleDateString("fr-FR");
    }
    return "-";
  };

  const safeTrim = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value);
  };

  const hasPhotosConfigured = !!selectedEntrepriseData?.cheminPhotos;

  // Calcul stock total
  const calculateStockTotal = (article) => {
    if (!article) return 0;
    return (
      (parseFloat(article.S1) || 0) +
      (parseFloat(article.S2) || 0) +
      (parseFloat(article.S3) || 0) +
      (parseFloat(article.S4) || 0) +
      (parseFloat(article.S5) || 0)
    );
  };

  // Taux TGC disponibles
  const tgcRates = [
    { value: "TOUT", label: "Tous" },
    { value: "0", label: "0% (Exonéré)" },
    { value: "3", label: "3% (Réduit)" },
    { value: "6", label: "6% (Intermédiaire)" },
    { value: "11", label: "11% (Normal)" },
    { value: "22", label: "22% (Majoré)" },
  ];

  // Mapping des entrepôts
  const mappingEntrepots = selectedEntrepriseData?.mappingEntrepots || {
    S1: "Magasin",
    S2: "S2",
    S3: "S3",
    S4: "S4",
    S5: "S5",
  };

  if (loadingEntreprises) {
    return (
      <div className="admin-articles-page">
        <div className="admin-loading-state">
          <div className="loading-spinner"></div>
          <p>Chargement des entreprises...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-articles-page">
      {/* Header */}
      <header className="admin-articles-header">
        <div className="header-left">
          <div className="header-icon">
            <HiCube />
          </div>
          <div className="header-title">
            <h1>Gestion des Articles</h1>
            <p className="header-subtitle">
              Consultation et filtrage avancé des articles DBF
            </p>
          </div>
        </div>

        <div className="header-actions">
          <div className="entreprise-selector">
            <HiOfficeBuilding className="selector-icon" />
            <select
              value={selectedEntreprise}
              onChange={handleEntrepriseChange}
            >
              <option value="">Sélectionner une entreprise</option>
              {entreprises?.map((e) => (
                <option key={e._id} value={e.nomDossierDBF}>
                  {e.trigramme} - {e.nomComplet}
                </option>
              ))}
            </select>
            <HiChevronDown className="selector-arrow" />
          </div>
        </div>
      </header>

      {!selectedEntreprise ? (
        <div className="empty-state">
          <div className="empty-icon">
            <HiOfficeBuilding />
          </div>
          <h2>Sélectionnez une entreprise</h2>
          <p>Choisissez une entreprise pour consulter ses articles</p>
        </div>
      ) : (
        <div className="admin-articles-content">
          {/* Sidebar Filtres */}
          <aside className={`filters-sidebar ${showFilters ? "open" : ""}`}>
            <div className="filters-header">
              <div className="filters-title">
                <HiFilter />
                <span>Filtres de recherche</span>
                {activeFiltersCount > 0 && (
                  <span className="filters-badge">{activeFiltersCount}</span>
                )}
              </div>
              <button
                className="btn-toggle-filters"
                onClick={() => setShowFilters(!showFilters)}
              >
                {showFilters ? <HiX /> : <HiFilter />}
              </button>
            </div>

            <div className="filters-body">
              {/* Section Identification */}
              <div className="filter-section">
                <button
                  className="section-header"
                  onClick={() => toggleSection("identification")}
                >
                  <span className="section-icon">🏷️</span>
                  <span>Identification</span>
                  {expandedSections.identification ? (
                    <HiChevronUp />
                  ) : (
                    <HiChevronDown />
                  )}
                </button>
                {expandedSections.identification && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label>
                        <HiQrcode /> Code NART
                      </label>
                      <input
                        type="text"
                        placeholder="Rechercher par code..."
                        value={filters.nart}
                        onChange={(e) =>
                          handleFilterChange("nart", e.target.value)
                        }
                      />
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiSearch /> Recherche globale
                      </label>
                      <input
                        type="text"
                        placeholder="Désignation, code barre..."
                        value={filters.search}
                        onChange={(e) =>
                          handleFilterChange("search", e.target.value)
                        }
                      />
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiShoppingCart /> Fournisseur
                      </label>
                      <input
                        type="text"
                        placeholder="Code fournisseur..."
                        value={filters.fourn}
                        onChange={(e) =>
                          handleFilterChange("fourn", e.target.value)
                        }
                      />
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiCollection /> Groupe/Famille
                      </label>
                      <select
                        value={filters.groupe}
                        onChange={(e) =>
                          handleFilterChange("groupe", e.target.value)
                        }
                      >
                        <option value="">Tous les groupes</option>
                        {groupesData?.groupes?.map((g) => (
                          <option key={g.code} value={g.code}>
                            {g.code} ({g.count})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiQrcode /> Code barre (GENCOD)
                      </label>
                      <select
                        value={filters.gencod}
                        onChange={(e) =>
                          handleFilterChange("gencod", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous</option>
                        <option value="OUI">Avec code barre</option>
                        <option value="NON">Sans code barre</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Section Stock */}
              <div className="filter-section">
                <button
                  className="section-header"
                  onClick={() => toggleSection("stock")}
                >
                  <span className="section-icon">📦</span>
                  <span>Stock & Emplacement</span>
                  {expandedSections.stock ? <HiChevronUp /> : <HiChevronDown />}
                </button>
                {expandedSections.stock && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label>
                        <HiArchive /> État du stock
                      </label>
                      <select
                        value={filters.stock}
                        onChange={(e) =>
                          handleFilterChange("stock", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous</option>
                        <option value="POSITIF">Stock positif</option>
                        <option value="NUL">Stock nul</option>
                        <option value="NEGATIF">Stock négatif</option>
                      </select>
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiTrendingDown /> Réappro Magasin
                      </label>
                      <select
                        value={filters.reappro}
                        onChange={(e) =>
                          handleFilterChange("reappro", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous</option>
                        <option value="OUI">À réapprovisionner</option>
                        <option value="NON">Stock magasin OK</option>
                      </select>
                      <span className="filter-hint">
                        Stock total &gt; 0 et Magasin = 0
                      </span>
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiLocationMarker /> Gisement / Place
                      </label>
                      <input
                        type="text"
                        placeholder="Rechercher gisement..."
                        value={filters.gisement}
                        onChange={(e) =>
                          handleFilterChange("gisement", e.target.value)
                        }
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Section Commercial */}
              <div className="filter-section">
                <button
                  className="section-header"
                  onClick={() => toggleSection("commercial")}
                >
                  <span className="section-icon">💰</span>
                  <span>Commercial</span>
                  {expandedSections.commercial ? (
                    <HiChevronUp />
                  ) : (
                    <HiChevronDown />
                  )}
                </button>
                {expandedSections.commercial && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label>
                        <HiTag /> Promotion
                      </label>
                      <select
                        value={filters.promo}
                        onChange={(e) =>
                          handleFilterChange("promo", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous</option>
                        <option value="OUI">En promotion</option>
                        <option value="NON">Prix normal</option>
                      </select>
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiExclamation /> Dépréciation
                      </label>
                      <select
                        value={filters.deprec}
                        onChange={(e) =>
                          handleFilterChange("deprec", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous</option>
                        <option value="OUI">Déprécié</option>
                        <option value="NON">Non déprécié</option>
                      </select>
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiCurrencyDollar /> Taux TGC
                      </label>
                      <select
                        value={filters.tgc}
                        onChange={(e) =>
                          handleFilterChange("tgc", e.target.value)
                        }
                      >
                        {tgcRates.map((rate) => (
                          <option key={rate.value} value={rate.value}>
                            {rate.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Section Avancé */}
              <div className="filter-section">
                <button
                  className="section-header"
                  onClick={() => toggleSection("avance")}
                >
                  <span className="section-icon">⚙️</span>
                  <span>Paramètres avancés</span>
                  {expandedSections.avance ? (
                    <HiChevronUp />
                  ) : (
                    <HiChevronDown />
                  )}
                </button>
                {expandedSections.avance && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label>
                        <HiGlobe /> Visible Web
                      </label>
                      <select
                        value={filters.web}
                        onChange={(e) =>
                          handleFilterChange("web", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous</option>
                        <option value="OUI">Visible sur le web</option>
                        <option value="NON">Non visible</option>
                      </select>
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiPhotograph /> Photo disponible
                      </label>
                      <select
                        value={filters.photo}
                        onChange={(e) =>
                          handleFilterChange("photo", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous</option>
                        <option value="OUI">Avec photo</option>
                        <option value="NON">Sans photo</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="filters-footer">
              <button className="btn-reset" onClick={resetFilters}>
                <HiRefresh />
                <span>Réinitialiser</span>
              </button>
            </div>
          </aside>

          {/* Main Content */}
          <main className="articles-main">
            {/* Stats Bar */}
            <div className="stats-bar">
              <div className="stat-item primary">
                <span className="stat-value">
                  {articlesData?.pagination?.totalRecords?.toLocaleString() ||
                    0}
                </span>
                <span className="stat-label">
                  {activeFiltersCount > 0 ? "Articles filtrés" : "Articles"}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {groupesData?.totalGroupes || 0}
                </span>
                <span className="stat-label">Groupes</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {articlesData?.pagination?.page || 1}/
                  {articlesData?.pagination?.totalPages || 1}
                </span>
                <span className="stat-label">Page</span>
              </div>
              {articlesData?._queryTime && (
                <div className="stat-item">
                  <span className="stat-value">{articlesData._queryTime}</span>
                  <span className="stat-label">Temps</span>
                </div>
              )}

              <div className="stats-actions">
                <button
                  className={`btn-icon-action ${showFilters ? "active" : ""}`}
                  onClick={() => setShowFilters(!showFilters)}
                  title="Afficher/Masquer les filtres"
                >
                  <HiAdjustments />
                </button>
                <button
                  className="btn-icon-action"
                  onClick={refetch}
                  disabled={isFetching}
                  title="Rafraîchir"
                >
                  <HiRefresh className={isFetching ? "spinning" : ""} />
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="articles-table-container">
              {loadingArticles || isFetching ? (
                <div className="table-loading">
                  <div className="loading-spinner"></div>
                  <p>Chargement des articles...</p>
                </div>
              ) : articlesError ? (
                <div className="table-error">
                  <HiExclamation />
                  <p>
                    Erreur:{" "}
                    {articlesError?.data?.message ||
                      "Impossible de charger les articles"}
                  </p>
                  <button onClick={refetch}>Réessayer</button>
                </div>
              ) : articles.length === 0 ? (
                <div className="table-empty">
                  <HiCube />
                  <h3>Aucun article trouvé</h3>
                  <p>Modifiez vos filtres pour afficher des résultats</p>
                </div>
              ) : (
                <table className="articles-table">
                  <thead>
                    <tr>
                      <th className="col-code">Code</th>
                      <th className="col-design">Désignation</th>
                      <th className="col-gencod">GENCOD</th>
                      <th className="col-groupe">Groupe</th>
                      <th className="col-fourn">Fourn.</th>
                      <th className="col-stock text-right">Stock Total</th>
                      <th className="col-s1 text-right">
                        {mappingEntrepots.S1}
                      </th>
                      <th className="col-price text-right">PV TTC</th>
                      <th className="col-badges">Statuts</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {articles.map((article, index) => {
                      const hasPromo = isPromoActive(article);
                      const hasDeprec = (parseFloat(article.DEPREC) || 0) > 0;
                      const isWeb =
                        article.WEB?.toString().toUpperCase().trim() === "O";
                      const hasPhoto =
                        article.FOTO?.toString().toUpperCase().trim() === "F";
                      const stockTotal = calculateStockTotal(article);
                      const s1 = parseFloat(article.S1) || 0;
                      const needsReappro = stockTotal > 0 && s1 === 0;

                      return (
                        <tr
                          key={`${article.NART}-${index}`}
                          className={`
                            ${hasPromo ? "row-promo" : ""}
                            ${hasDeprec ? "row-deprec" : ""}
                            ${needsReappro ? "row-reappro" : ""}
                          `}
                        >
                          <td className="col-code">
                            <Link
                              to={`/admin/articles/${selectedEntreprise}/${safeTrim(article.NART)}`}
                              className="article-nart-link"
                            >
                              {safeTrim(article.NART)}
                              <HiExternalLink className="link-icon" />
                            </Link>
                          </td>
                          <td className="col-design">
                            <div className="article-designation">
                              <span className="design-main">
                                {safeTrim(article.DESIGN)}
                              </span>
                              {safeTrim(article.DESIGN2) && (
                                <span className="design-sub">
                                  {safeTrim(article.DESIGN2)}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="col-gencod">
                            <span className="gencod-value">
                              {safeTrim(article.GENCOD) || "-"}
                            </span>
                          </td>
                          <td className="col-groupe">
                            {safeTrim(article.GROUPE) && (
                              <span className="groupe-tag">
                                {safeTrim(article.GROUPE)}
                              </span>
                            )}
                          </td>
                          <td className="col-fourn">
                            <span className="fourn-value">
                              {article.FOURN || "-"}
                            </span>
                          </td>
                          <td className="col-stock text-right">
                            <span
                              className={`stock-value ${
                                stockTotal > 0
                                  ? "positive"
                                  : stockTotal < 0
                                    ? "negative"
                                    : "zero"
                              }`}
                            >
                              {formatStock(stockTotal)}
                            </span>
                          </td>
                          <td className="col-s1 text-right">
                            <span
                              className={`stock-value ${s1 > 0 ? "positive" : "zero"}`}
                            >
                              {formatStock(s1)}
                            </span>
                          </td>
                          <td className="col-price text-right">
                            <div className="price-cell">
                              {hasPromo && (
                                <span className="price-promo">
                                  {formatPrice(article.PVPROMO)}
                                </span>
                              )}
                              <span
                                className={`price-value ${hasPromo ? "strikethrough" : ""}`}
                              >
                                {formatPrice(article.PVTETTC)}
                              </span>
                            </div>
                          </td>
                          <td className="col-badges">
                            <div className="badges-container">
                              {hasPromo && (
                                <span
                                  className="badge badge-promo"
                                  title="En promotion"
                                >
                                  <HiTag />
                                </span>
                              )}
                              {hasDeprec && (
                                <span
                                  className="badge badge-deprec"
                                  title="Déprécié"
                                >
                                  <HiExclamation />
                                </span>
                              )}
                              {isWeb && (
                                <span
                                  className="badge badge-web"
                                  title="Visible web"
                                >
                                  <HiGlobe />
                                </span>
                              )}
                              {hasPhoto && (
                                <span
                                  className="badge badge-photo"
                                  title="Photo disponible"
                                >
                                  <HiPhotograph />
                                </span>
                              )}
                              {needsReappro && (
                                <span
                                  className="badge badge-reappro"
                                  title="À réapprovisionner"
                                >
                                  <HiTrendingDown />
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="col-actions">
                            <button
                              className="btn-view"
                              onClick={() => handleViewArticle(article)}
                              title="Voir les détails"
                            >
                              <HiEye />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {articlesData?.pagination && (
              <div className="pagination-bar">
                <div className="pagination-info">
                  Affichage de{" "}
                  <strong>
                    {Math.min(
                      (articlesData.pagination.page - 1) * limit + 1,
                      articlesData.pagination.totalRecords,
                    )}
                  </strong>{" "}
                  à{" "}
                  <strong>
                    {Math.min(
                      articlesData.pagination.page * limit,
                      articlesData.pagination.totalRecords,
                    )}
                  </strong>{" "}
                  sur{" "}
                  <strong>
                    {articlesData.pagination.totalRecords.toLocaleString()}
                  </strong>{" "}
                  articles
                </div>
                <div className="pagination-controls">
                  <button
                    className="btn-page"
                    disabled={!articlesData.pagination.hasPrevPage}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <HiChevronLeft />
                    <span>Précédent</span>
                  </button>
                  <div className="page-indicator">
                    <span className="current-page">
                      {articlesData.pagination.page}
                    </span>
                    <span className="page-separator">/</span>
                    <span className="total-pages">
                      {articlesData.pagination.totalPages}
                    </span>
                  </div>
                  <button
                    className="btn-page"
                    disabled={!articlesData.pagination.hasNextPage}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <span>Suivant</span>
                    <HiChevronRight />
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {/* Modal Détails Article */}
      {selectedArticle && (
        <div
          className="article-modal-overlay"
          onClick={() => setSelectedArticle(null)}
        >
          <div className="article-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <HiCube />
                <div>
                  <h2>Détails de l'article</h2>
                  <span className="modal-nart">
                    {safeTrim(selectedArticle.NART)}
                  </span>
                </div>
              </div>
              <div className="modal-header-actions">
                <Link
                  to={`/admin/articles/${selectedEntreprise}/${safeTrim(selectedArticle.NART)}`}
                  className="btn-view-full"
                  title="Voir la fiche complète"
                >
                  <HiExternalLink />
                  <span>Fiche complète</span>
                </Link>
                <button
                  className="btn-close-modal"
                  onClick={() => setSelectedArticle(null)}
                >
                  <HiX />
                </button>
              </div>
            </div>

            <div className="modal-body">
              <div className="modal-grid">
                {/* Photo */}
                {hasPhotosConfigured && (
                  <div className="modal-photo-section">
                    {!photoError ? (
                      <div
                        className={`photo-wrapper ${photoLoaded ? "loaded" : ""}`}
                      >
                        <img
                          src={getPhotoUrl(
                            selectedEntrepriseData?.trigramme,
                            selectedArticle.NART,
                          )}
                          alt={safeTrim(selectedArticle.DESIGN)}
                          onError={() => setPhotoError(true)}
                          onLoad={() => setPhotoLoaded(true)}
                        />
                        {!photoLoaded && (
                          <div className="photo-loading">
                            <div className="loading-spinner small"></div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="no-photo">
                        <HiPhotograph />
                        <span>Photo non disponible</span>
                      </div>
                    )}

                    {/* Badges */}
                    <div className="modal-badges">
                      {isPromoActive(selectedArticle) && (
                        <span className="modal-badge promo">
                          <HiTag /> PROMO
                        </span>
                      )}
                      {(parseFloat(selectedArticle.DEPREC) || 0) > 0 && (
                        <span className="modal-badge deprec">
                          <HiExclamation /> DÉPRÉCIÉ {selectedArticle.DEPREC}%
                        </span>
                      )}
                      {selectedArticle.WEB?.toString().toUpperCase().trim() ===
                        "O" && (
                        <span className="modal-badge web">
                          <HiGlobe /> WEB
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Infos */}
                <div className="modal-info-section">
                  {/* Désignation */}
                  <div className="info-block designation-block">
                    <h3>{safeTrim(selectedArticle.DESIGN)}</h3>
                    {safeTrim(selectedArticle.DESIGN2) && (
                      <p>{safeTrim(selectedArticle.DESIGN2)}</p>
                    )}
                  </div>

                  {/* Codes */}
                  <div className="info-grid codes-grid">
                    <div className="info-item">
                      <label>Code NART</label>
                      <span className="value highlight">
                        {safeTrim(selectedArticle.NART)}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Code barre</label>
                      <span className="value mono">
                        {safeTrim(selectedArticle.GENCOD) || "-"}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Réf. fournisseur</label>
                      <span className="value">
                        {safeTrim(selectedArticle.REFER) || "-"}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Fournisseur</label>
                      <span className="value">
                        {selectedArticle.FOURN || "-"}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Groupe</label>
                      <span className="value tag">
                        {safeTrim(selectedArticle.GROUPE) || "-"}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Unité</label>
                      <span className="value">
                        {safeTrim(selectedArticle.UNITE) || "-"}
                      </span>
                    </div>
                  </div>

                  {/* Prix */}
                  <div className="info-block price-block">
                    <h4>💰 Prix</h4>
                    <div className="price-grid">
                      <div className="price-item main">
                        <label>PV TTC</label>
                        <span
                          className={
                            isPromoActive(selectedArticle)
                              ? "strikethrough"
                              : ""
                          }
                        >
                          {formatPrice(selectedArticle.PVTETTC)}
                        </span>
                      </div>
                      {isPromoActive(selectedArticle) && (
                        <div className="price-item promo">
                          <label>Prix PROMO</label>
                          <span>{formatPrice(selectedArticle.PVPROMO)}</span>
                        </div>
                      )}
                      <div className="price-item">
                        <label>PV HT</label>
                        <span>{formatPrice(selectedArticle.PVTE)}</span>
                      </div>
                      <div className="price-item">
                        <label>Prix achat</label>
                        <span>{formatPrice(selectedArticle.PACHAT)}</span>
                      </div>
                      <div className="price-item">
                        <label>Prix revient</label>
                        <span>{formatPrice(selectedArticle.PREV)}</span>
                      </div>
                      <div className="price-item">
                        <label>TGC</label>
                        <span>{selectedArticle.TAXES || 0}%</span>
                      </div>
                    </div>
                  </div>

                  {/* Stocks */}
                  <div className="info-block stock-block">
                    <h4>📦 Stocks par emplacement</h4>
                    <div className="stock-grid">
                      <div className="stock-item total">
                        <label>Stock Total</label>
                        <span
                          className={
                            calculateStockTotal(selectedArticle) > 0
                              ? "positive"
                              : "zero"
                          }
                        >
                          {formatStock(calculateStockTotal(selectedArticle))}
                        </span>
                      </div>
                      <div className="stock-item">
                        <label>{mappingEntrepots.S1}</label>
                        <span
                          className={
                            parseFloat(selectedArticle.S1) > 0
                              ? "positive"
                              : "zero"
                          }
                        >
                          {formatStock(selectedArticle.S1)}
                        </span>
                      </div>
                      <div className="stock-item">
                        <label>{mappingEntrepots.S2}</label>
                        <span>{formatStock(selectedArticle.S2)}</span>
                      </div>
                      <div className="stock-item">
                        <label>{mappingEntrepots.S3}</label>
                        <span>{formatStock(selectedArticle.S3)}</span>
                      </div>
                      <div className="stock-item">
                        <label>{mappingEntrepots.S4}</label>
                        <span>{formatStock(selectedArticle.S4)}</span>
                      </div>
                      <div className="stock-item">
                        <label>{mappingEntrepots.S5}</label>
                        <span>{formatStock(selectedArticle.S5)}</span>
                      </div>
                      <div className="stock-item">
                        <label>Réservé</label>
                        <span className="reserved">
                          {formatStock(selectedArticle.RESERV)}
                        </span>
                      </div>
                      <div className="stock-item">
                        <label>Mini</label>
                        <span>{formatStock(selectedArticle.SMINI)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Gisements */}
                  {(selectedArticle.GISM1 ||
                    selectedArticle.GISM2 ||
                    selectedArticle.GISM3 ||
                    selectedArticle.GISM4 ||
                    selectedArticle.GISM5 ||
                    selectedArticle.PLACE) && (
                    <div className="info-block gisement-block">
                      <h4>📍 Emplacements / Gisements</h4>
                      <div className="gisement-grid">
                        {selectedArticle.PLACE && (
                          <div className="gisement-item main">
                            <label>Place</label>
                            <span>{safeTrim(selectedArticle.PLACE)}</span>
                          </div>
                        )}
                        {selectedArticle.GISM1 && (
                          <div className="gisement-item">
                            <label>Gisement 1</label>
                            <span>{safeTrim(selectedArticle.GISM1)}</span>
                          </div>
                        )}
                        {selectedArticle.GISM2 && (
                          <div className="gisement-item">
                            <label>Gisement 2</label>
                            <span>{safeTrim(selectedArticle.GISM2)}</span>
                          </div>
                        )}
                        {selectedArticle.GISM3 && (
                          <div className="gisement-item">
                            <label>Gisement 3</label>
                            <span>{safeTrim(selectedArticle.GISM3)}</span>
                          </div>
                        )}
                        {selectedArticle.GISM4 && (
                          <div className="gisement-item">
                            <label>Gisement 4</label>
                            <span>{safeTrim(selectedArticle.GISM4)}</span>
                          </div>
                        )}
                        {selectedArticle.GISM5 && (
                          <div className="gisement-item">
                            <label>Gisement 5</label>
                            <span>{safeTrim(selectedArticle.GISM5)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Dates et autres infos */}
                  <div className="info-block dates-block">
                    <h4>📅 Informations complémentaires</h4>
                    <div className="info-grid">
                      <div className="info-item">
                        <label>Date création</label>
                        <span className="value">
                          {formatDate(selectedArticle.CREATION)}
                        </span>
                      </div>
                      <div className="info-item">
                        <label>Date inventaire</label>
                        <span className="value">
                          {formatDate(selectedArticle.DATINV)}
                        </span>
                      </div>
                      {selectedArticle.DPROMOD && (
                        <div className="info-item">
                          <label>Début promo</label>
                          <span className="value">
                            {formatDate(selectedArticle.DPROMOD)}
                          </span>
                        </div>
                      )}
                      {selectedArticle.DPROMOF && (
                        <div className="info-item">
                          <label>Fin promo</label>
                          <span className="value">
                            {formatDate(selectedArticle.DPROMOF)}
                          </span>
                        </div>
                      )}
                      <div className="info-item">
                        <label>Code douane</label>
                        <span className="value">
                          {safeTrim(selectedArticle.DOUANE) || "-"}
                        </span>
                      </div>
                      <div className="info-item">
                        <label>Volume</label>
                        <span className="value">
                          {selectedArticle.VOL || "-"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Observations */}
                  {safeTrim(selectedArticle.OBSERV) && (
                    <div className="info-block observations-block">
                      <h4>📝 Observations</h4>
                      <p className="observations-text">
                        {safeTrim(selectedArticle.OBSERV)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminArticlesScreen;
