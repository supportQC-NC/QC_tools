// src/screens/user/UserArticleSearch.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  HiSearch,
  HiOfficeBuilding,
  HiCube,
  HiX,
  HiQrcode,
  HiPhotograph,
  HiExclamation,
  HiCubeTransparent,
  HiSwitchHorizontal,
  HiTag,
  HiGlobe,
  HiCurrencyDollar,
  HiChartBar,
  HiTruck,
  HiCheckCircle,
  HiXCircle,
} from "react-icons/hi";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetArticleByNartQuery,
  useGetArticleByGencodQuery,
  getPhotoUrl,
} from "../../slices/articleApiSlice";
import { useGetArticleFilialeDataQuery } from "../../slices/fillialeApiSlice";
import "./UserArticleSearch.css";

const ArticleSearch = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [selectedEntrepriseData, setSelectedEntrepriseData] = useState(null);
  const [searchValue, setSearchValue] = useState("");
  const [searchType, setSearchType] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [photoError, setPhotoError] = useState(false);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState("details"); // "details" ou "filiales"
  const inputRef = useRef(null);

  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetMyEntreprisesQuery();

  const {
    data: resultByNart,
    isLoading: loadingNart,
    error: errorNart,
    isFetching: fetchingNart,
  } = useGetArticleByNartQuery(
    { nomDossierDBF: selectedEntreprise, nart: searchTerm },
    { skip: !selectedEntreprise || !searchTerm || searchType !== "nart" },
  );

  const {
    data: resultByGencod,
    isLoading: loadingGencod,
    error: errorGencod,
    isFetching: fetchingGencod,
  } = useGetArticleByGencodQuery(
    { nomDossierDBF: selectedEntreprise, gencod: searchTerm },
    { skip: !selectedEntreprise || !searchTerm || searchType !== "gencod" },
  );

  // Récupérer l'article courant
  const result = searchType === "gencod" ? resultByGencod : resultByNart;
  const article = result?.article;

  // Requête pour les données filiales (seulement si article trouvé)
  const {
    data: filialeData,
    isLoading: loadingFiliales,
    isFetching: fetchingFiliales,
  } = useGetArticleFilialeDataQuery(
    {
      nomDossierDBF: selectedEntreprise,
      nart: article?.NART?.trim() || "",
    },
    {
      skip: !selectedEntreprise || !article?.NART,
    },
  );

  // Helper pour trim sécurisé
  const safeTrim = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value);
  };

  // Auto-select si une seule entreprise
  useEffect(() => {
    if (entreprises?.length === 1) {
      setSelectedEntreprise(entreprises[0].nomDossierDBF);
      setSelectedEntrepriseData(entreprises[0]);
    }
  }, [entreprises]);

  // Focus sur l'input quand entreprise sélectionnée
  useEffect(() => {
    if (selectedEntreprise && inputRef.current) {
      inputRef.current.focus();
    }
  }, [selectedEntreprise]);

  // Reset photo state quand l'article change
  useEffect(() => {
    setPhotoError(false);
    setPhotoLoaded(false);
    setActiveTab("details"); // Reset vers l'onglet détails
  }, [searchTerm]);

  // Vider l'input et garder le focus quand un article est trouvé
  useEffect(() => {
    const result = searchType === "gencod" ? resultByGencod : resultByNart;

    if (result?.article && searchTerm) {
      setSearchValue("");
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [resultByNart, resultByGencod, searchType, searchTerm]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (!searchValue.trim() || !selectedEntreprise) return;

    const value = searchValue.trim();
    setSearchTerm(value);

    if (/^\d{8,13}$/.test(value)) {
      setSearchType("gencod");
    } else {
      setSearchType("nart");
    }
  };

  const handleClear = () => {
    setSearchValue("");
    setSearchTerm("");
    setSearchType(null);
    setPhotoError(false);
    setPhotoLoaded(false);
    setActiveTab("details");
    inputRef.current?.focus();
  };

  const handleEntrepriseChange = (e) => {
    const nomDossier = e.target.value;
    setSelectedEntreprise(nomDossier);
    const entreprise = entreprises?.find(
      (ent) => ent.nomDossierDBF === nomDossier,
    );
    setSelectedEntrepriseData(entreprise);
    handleClear();
  };

  const isPromoActive = (article) => {
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

    const dateDebut = parseDate(article.DPROMOD);
    const dateFin = parseDate(article.DPROMOF);

    if (!dateDebut || !dateFin) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dateDebut.setHours(0, 0, 0, 0);
    dateFin.setHours(23, 59, 59, 999);

    return today >= dateDebut && today <= dateFin;
  };

  const formatPromoEndDate = (dateValue) => {
    const parseDate = (val) => {
      if (!val) return null;
      if (val instanceof Date) return val;
      if (typeof val === "string" && val.length === 8) {
        const year = parseInt(val.substring(0, 4));
        const month = parseInt(val.substring(4, 6)) - 1;
        const day = parseInt(val.substring(6, 8));
        return new Date(year, month, day);
      }
      if (typeof val === "string") {
        const parsed = new Date(val);
        if (!isNaN(parsed.getTime())) return parsed;
      }
      if (typeof val === "number" && val > 19000000 && val < 30000000) {
        const str = val.toString();
        const year = parseInt(str.substring(0, 4));
        const month = parseInt(str.substring(4, 6)) - 1;
        const day = parseInt(str.substring(6, 8));
        return new Date(year, month, day);
      }
      return null;
    };

    const date = parseDate(dateValue);
    if (!date) return "";

    return date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const isRenvoi = result?.isRenvoi || false;
  const articleOriginal = result?.articleOriginal;
  const nombreRenvois = result?.nombreRenvois || 0;

  const hasActivePromo = article ? isPromoActive(article) : false;

  const isLoading = loadingNart || loadingGencod;
  const isFetching = fetchingNart || fetchingGencod;
  const error = searchType === "gencod" ? errorGencod : errorNart;

  const hasPhotosConfigured = !!selectedEntrepriseData?.cheminPhotos;

  const mappingEntrepots = selectedEntrepriseData?.mappingEntrepots || {
    S1: "Magasin",
    S2: "S2",
    S3: "S3",
    S4: "S4",
    S5: "S5",
  };

  const photoUrl =
    hasPhotosConfigured && article
      ? getPhotoUrl(selectedEntrepriseData?.trigramme, article.NART)
      : null;

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
    return stock.toLocaleString("fr-FR");
  };

  const calculateDiscount = (originalPrice, promoPrice) => {
    if (!originalPrice || !promoPrice || originalPrice <= 0) return 0;
    return Math.round(((originalPrice - promoPrice) / originalPrice) * 100);
  };

  const getEntrepotLabel = (key) => {
    return mappingEntrepots[key] || key;
  };

  const calculateStockTotal = (article) => {
    if (!article) return 0;
    const s1 = parseFloat(article.S1) || 0;
    const s2 = parseFloat(article.S2) || 0;
    const s3 = parseFloat(article.S3) || 0;
    const s4 = parseFloat(article.S4) || 0;
    const s5 = parseFloat(article.S5) || 0;
    return s1 + s2 + s3 + s4 + s5;
  };

  // Récupérer la valeur En Commande (ENCDE)
  const getEnCommande = (article) => {
    if (!article) return 0;
    return parseFloat(article.ENCDE) || 0;
  };

  // Rendu de l'onglet Filiales avec des CARDS au lieu d'un tableau
  const renderFilialesTab = () => {
    if (loadingFiliales || fetchingFiliales) {
      return (
        <div className="filiales-loading">
          <div className="loading-spinner"></div>
          <p>Chargement des données inter-entreprises...</p>
        </div>
      );
    }

    if (
      !filialeData ||
      !filialeData.filiales ||
      filialeData.filiales.length === 0
    ) {
      return (
        <div className="filiales-empty">
          <HiGlobe className="filiales-empty-icon" />
          <h3>Aucune donnée disponible</h3>
          <p>Cet article n'a pas de correspondance dans les autres entités</p>
        </div>
      );
    }

    const filiales = filialeData.filiales;

    // Stock des filiales (depuis l'API)
    const stockFiliales = filialeData.stockTotal || 0;

    // Stock de l'entreprise sélectionnée (article courant)
    const stockEntrepriseSelectionnee = calculateStockTotal(article);

    // Stock TOTAL = filiales + entreprise sélectionnée
    const stockTotalGroupe = stockFiliales + stockEntrepriseSelectionnee;

    // Séparer les entités avec stock et sans stock
    const filialesAvecStock = filiales.filter((f) => f.stock > 0);
    const filialesSansStock = filiales.filter((f) => f.stock === 0);

    // Nombre total d'entités avec stock (filiales + entreprise sélectionnée si elle a du stock)
    const nbEntitesAvecStock =
      filialesAvecStock.length + (stockEntrepriseSelectionnee > 0 ? 1 : 0);

    return (
      <div className="filiales-content">
        <div className="filiales-summary">
          <div className="filiales-summary-card total">
            <HiChartBar className="summary-icon" />
            <div className="summary-info">
              <span className="summary-label">Stock Total Groupe</span>
              <span
                className={`summary-value ${stockTotalGroupe > 0 ? "positive" : "zero"}`}
              >
                {formatStock(stockTotalGroupe)}
              </span>
            </div>
          </div>
          <div className="filiales-summary-card count">
            <HiOfficeBuilding className="summary-icon" />
            <div className="summary-info">
              <span className="summary-label">Autres entités</span>
              <span className="summary-value">{filiales.length}</span>
            </div>
          </div>
          <div className="filiales-summary-card available">
            <HiCube className="summary-icon" />
            <div className="summary-info">
              <span className="summary-label">Entités en stock</span>
              <span className="summary-value positive">
                {nbEntitesAvecStock}
              </span>
            </div>
          </div>
        </div>

        <div className="filiales-list">
          <h3 className="filiales-list-title">
            <HiGlobe />
            Disponibilité par entité
          </h3>

          {/* CARDS au lieu du tableau */}
          <div className="filiales-cards-container">
            {/* D'abord les entités avec stock */}
            {filialesAvecStock.map((filiale, index) => (
              <div key={`stock-${index}`} className="filiale-card has-stock">
                <div className="filiale-card-header">
                  <div className="filiale-card-entity">
                    <span className="filiale-trigramme">
                      {filiale.trigramme}
                    </span>
                    <span className="filiale-nom">{filiale.entrepriseNom}</span>
                  </div>
                  <div className="filiale-card-status in-stock">
                    <HiCheckCircle />
                    <span>En stock</span>
                  </div>
                </div>
                <div className="filiale-card-body">
                  <div className="filiale-card-info">
                    <span className="filiale-card-label">Code Article</span>
                    <code className="filiale-card-nart">
                      {filiale.nartFiliale}
                    </code>
                  </div>
                  <div className="filiale-card-info">
                    <span className="filiale-card-label">Stock</span>
                    <span className="filiale-card-stock positive">
                      {formatStock(filiale.stock)}
                    </span>
                  </div>
                  <div className="filiale-card-info">
                    <span className="filiale-card-label">Prix TTC</span>
                    {filiale.hasPrix ? (
                      <span className="filiale-card-prix">
                        {formatPrice(filiale.prix)}
                      </span>
                    ) : (
                      <span className="filiale-card-prix-na">Grossiste</span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Puis les entités sans stock */}
            {filialesSansStock.map((filiale, index) => (
              <div key={`nostock-${index}`} className="filiale-card no-stock">
                <div className="filiale-card-header">
                  <div className="filiale-card-entity">
                    <span className="filiale-trigramme">
                      {filiale.trigramme}
                    </span>
                    <span className="filiale-nom">{filiale.entrepriseNom}</span>
                  </div>
                  <div className="filiale-card-status out-of-stock">
                    <HiXCircle />
                    <span>Rupture</span>
                  </div>
                </div>
                <div className="filiale-card-body">
                  <div className="filiale-card-info">
                    <span className="filiale-card-label">Code Article</span>
                    <code className="filiale-card-nart">
                      {filiale.nartFiliale}
                    </code>
                  </div>
                  <div className="filiale-card-info">
                    <span className="filiale-card-label">Stock</span>
                    <span className="filiale-card-stock zero">0</span>
                  </div>
                  <div className="filiale-card-info">
                    <span className="filiale-card-label">Prix TTC</span>
                    {filiale.hasPrix ? (
                      <span className="filiale-card-prix muted">
                        {formatPrice(filiale.prix)}
                      </span>
                    ) : (
                      <span className="filiale-card-prix-na">Grossiste</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  if (loadingEntreprises) {
    return (
      <div className="article-search-page">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Chargement...</p>
        </div>
      </div>
    );
  }

  if (!entreprises || entreprises.length === 0) {
    return (
      <div className="article-search-page">
        <div className="empty-state">
          <HiOfficeBuilding className="empty-icon" />
          <h2>Aucun accès</h2>
          <p>Vous n'avez accès à aucune entreprise</p>
        </div>
      </div>
    );
  }

  return (
    <div className="article-search-page">
      <header className="search-header">
        <div className="header-content">
          <div className="header-title">
            <HiCubeTransparent className="header-icon" />
            <h1>Recherche Article</h1>
          </div>

          {entreprises?.length > 1 ? (
            <div className="entreprise-select-wrapper">
              <HiOfficeBuilding className="select-icon" />
              <select
                value={selectedEntreprise}
                onChange={handleEntrepriseChange}
                className="entreprise-select"
              >
                <option value="">Sélectionner une entreprise</option>
                {entreprises?.map((e) => (
                  <option key={e._id} value={e.nomDossierDBF}>
                    {e.trigramme} - {e.nomComplet}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="entreprise-chip">
              <HiOfficeBuilding />
              <span>{entreprises[0].trigramme}</span>
              <span className="chip-separator">•</span>
              <span>{entreprises[0].nomComplet}</span>
            </div>
          )}
        </div>
      </header>

      <main className="search-main">
        {selectedEntreprise ? (
          <>
            <form className="search-form" onSubmit={handleSearch}>
              <div className="search-input-container">
                <HiQrcode className="input-icon" />
                <input
                  ref={inputRef}
                  type="text"
                  className="search-input"
                  placeholder="Scanner ou saisir le code barre / code article..."
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  autoFocus
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck="false"
                />
                {searchValue && (
                  <button
                    type="button"
                    className="clear-btn"
                    onClick={handleClear}
                    aria-label="Effacer"
                  >
                    <HiX />
                  </button>
                )}
              </div>
              <button
                type="submit"
                className="search-btn"
                disabled={!searchValue.trim() || isFetching}
              >
                <HiSearch />
                <span>{isFetching ? "..." : "Rechercher"}</span>
              </button>
            </form>

            <div className="results-container">
              {isLoading || isFetching ? (
                <div className="result-loading">
                  <div className="loading-spinner"></div>
                  <p>Recherche en cours...</p>
                </div>
              ) : error ? (
                <div className="result-not-found">
                  <div className="not-found-icon">
                    <HiCube />
                  </div>
                  <h3>Article non trouvé</h3>
                  <p>Vérifiez le code et réessayez</p>
                  <span className="searched-code">
                    Code recherché : {searchTerm}
                  </span>
                </div>
              ) : article ? (
                <div
                  className={`article-result ${isRenvoi ? "has-renvoi" : ""} ${hasActivePromo ? "has-promo" : ""}`}
                >
                  {hasActivePromo && (
                    <div className="promo-banner">
                      <div className="promo-banner-content">
                        <HiTag className="promo-icon" />
                        <span>PROMOTION EN COURS</span>
                        <span className="promo-discount">
                          -{calculateDiscount(article.PVTETTC, article.PVPROMO)}
                          %
                        </span>
                      </div>
                      <div className="promo-end-date">
                        Jusqu'au {formatPromoEndDate(article.DPROMOF)}
                      </div>
                    </div>
                  )}

                  {isRenvoi && (
                    <div className="renvoi-banner">
                      <div className="renvoi-banner-content">
                        <HiSwitchHorizontal className="renvoi-icon" />
                        <span>ARTICLE EN RENVOI</span>
                      </div>
                    </div>
                  )}

                  {isRenvoi && articleOriginal && (
                    <div className="renvoi-details-section">
                      <div className="renvoi-details">
                        <div className="renvoi-from">
                          <span className="renvoi-label">Article scanné</span>
                          <span className="renvoi-nart">
                            {articleOriginal.nart}
                          </span>
                          <span className="renvoi-design">
                            {articleOriginal.designation}
                          </span>
                          {articleOriginal.gencod && (
                            <span className="renvoi-gencod">
                              <HiQrcode /> {articleOriginal.gencod}
                            </span>
                          )}
                        </div>
                        <div className="renvoi-arrow">
                          <HiSwitchHorizontal />
                        </div>
                        <div className="renvoi-to">
                          <span className="renvoi-label">Remplacé par</span>
                          <span className="renvoi-nart">
                            {safeTrim(article.NART)}
                          </span>
                          <span className="renvoi-design">
                            {safeTrim(article.DESIGN)}
                          </span>
                          {safeTrim(article.GENCOD) && (
                            <span className="renvoi-gencod">
                              <HiQrcode /> {safeTrim(article.GENCOD)}
                            </span>
                          )}
                        </div>
                      </div>
                      {nombreRenvois > 1 && (
                        <div className="renvoi-chain-warning">
                          ⚠️ Chaîne de {nombreRenvois} renvois
                        </div>
                      )}
                    </div>
                  )}

                  {/* Onglets - TOUJOURS visibles même quand article en promo */}
                  <div className="article-tabs">
                    <button
                      className={`tab-btn ${activeTab === "details" ? "active" : ""}`}
                      onClick={() => setActiveTab("details")}
                    >
                      <HiCube />
                      <span>Détails Article</span>
                    </button>
                    <button
                      className={`tab-btn ${activeTab === "filiales" ? "active" : ""}`}
                      onClick={() => setActiveTab("filiales")}
                    >
                      <HiGlobe />
                      <span>Stock Groupe</span>
                      {filialeData?.filiales?.length > 0 && (
                        <span className="tab-badge">
                          {filialeData.filiales.length}
                        </span>
                      )}
                    </button>
                  </div>

                  {/* Contenu selon l'onglet actif */}
                  {activeTab === "details" ? (
                    <div className="article-details-container">
                      {hasPhotosConfigured && (
                        <div className="article-photo-section">
                          {hasActivePromo && (
                            <div className="photo-promo-badge">
                              <span className="promo-percent">
                                -
                                {calculateDiscount(
                                  article.PVTETTC,
                                  article.PVPROMO,
                                )}
                                %
                              </span>
                            </div>
                          )}
                          {!photoError ? (
                            <div
                              className={`photo-container ${photoLoaded ? "loaded" : ""}`}
                            >
                              <img
                                src={photoUrl}
                                alt={safeTrim(article.DESIGN)}
                                onError={() => setPhotoError(true)}
                                onLoad={() => setPhotoLoaded(true)}
                                className="article-photo"
                              />
                              {!photoLoaded && (
                                <div className="photo-placeholder">
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
                        </div>
                      )}

                      <div className="article-info-section">
                        <div className="article-header">
                          <div className="article-codes">
                            <span
                              className={`nart-badge ${isRenvoi ? "renvoi" : ""}`}
                            >
                              {isRenvoi && (
                                <HiSwitchHorizontal className="badge-icon" />
                              )}
                              {safeTrim(article.NART)}
                            </span>
                            {safeTrim(article.GENCOD) && (
                              <span className="gencod-label">
                                <HiQrcode />
                                {safeTrim(article.GENCOD)}
                              </span>
                            )}
                          </div>
                          <div
                            className={`stock-indicator ${
                              calculateStockTotal(article) > 0
                                ? "in-stock"
                                : "out-of-stock"
                            }`}
                          >
                            {calculateStockTotal(article) > 0 ? (
                              <>
                                <span className="stock-dot"></span>
                                En stock
                              </>
                            ) : (
                              <>
                                <HiExclamation />
                                Rupture
                              </>
                            )}
                          </div>
                        </div>

                        <div className="article-designation">
                          <h2>{safeTrim(article.DESIGN)}</h2>
                          {safeTrim(article.DESIGN2) && (
                            <p className="designation-2">
                              {safeTrim(article.DESIGN2)}
                            </p>
                          )}
                        </div>

                        <div className="entrepots-info-grid">
                          <div className="info-card fourn">
                            <span className="info-label">Fournisseur</span>
                            <span className="info-value">
                              {safeTrim(article.FOURN) || "-"}
                            </span>
                          </div>

                          {/* Card En Commande (ENCDE) */}
                          <div className="info-card en-commande">
                            <HiTruck className="info-card-icon" />
                            <span className="info-label">En Commande</span>
                            <span
                              className={`info-value ${getEnCommande(article) > 0 ? "positive" : ""}`}
                            >
                              {formatStock(getEnCommande(article))}
                            </span>
                          </div>

                          <div className="info-card stock-total">
                            <span className="info-label">Stock Total</span>
                            <span
                              className={`info-value ${calculateStockTotal(article) > 0 ? "positive" : "zero"}`}
                            >
                              {formatStock(calculateStockTotal(article))}
                            </span>
                          </div>

                          <div className="info-card">
                            <span className="info-label">
                              {getEntrepotLabel("S1")}
                            </span>
                            <span className="info-value highlight">
                              {formatStock(article.S1)}
                            </span>
                          </div>

                          <div className="info-card">
                            <span className="info-label">
                              {getEntrepotLabel("S2")}
                            </span>
                            <span className="info-value highlight">
                              {formatStock(article.S2)}
                            </span>
                          </div>

                          <div className="info-card">
                            <span className="info-label">
                              {getEntrepotLabel("S3")}
                            </span>
                            <span className="info-value highlight">
                              {formatStock(article.S3)}
                            </span>
                          </div>

                          <div className="info-card">
                            <span className="info-label">
                              {getEntrepotLabel("S4")}
                            </span>
                            <span className="info-value highlight">
                              {formatStock(article.S4)}
                            </span>
                          </div>

                          <div className="info-card">
                            <span className="info-label">
                              {getEntrepotLabel("S5")}
                            </span>
                            <span className="info-value highlight">
                              {formatStock(article.S5)}
                            </span>
                          </div>
                        </div>

                        <div className="article-extra-info">
                          {safeTrim(article.REFER) && (
                            <div className="extra-info-item">
                              <span className="extra-label">
                                Réf. fournisseur
                              </span>
                              <span className="extra-value">
                                {safeTrim(article.REFER)}
                              </span>
                            </div>
                          )}
                          {safeTrim(article.GROUPE) && (
                            <div className="extra-info-item">
                              <span className="extra-label">Groupe</span>
                              <span className="extra-value">
                                {safeTrim(article.GROUPE)}
                              </span>
                            </div>
                          )}
                          {safeTrim(article.PLACE) && (
                            <div className="extra-info-item">
                              <span className="extra-label">Emplacement</span>
                              <span className="extra-value">
                                {safeTrim(article.PLACE)}
                              </span>
                            </div>
                          )}
                        </div>

                        <div
                          className={`price-section ${hasActivePromo ? "has-promo" : ""}`}
                        >
                          {hasActivePromo ? (
                            <>
                              <div className="price-main promo">
                                <div className="price-promo-container">
                                  <span className="price-label">
                                    Prix PROMO TTC
                                  </span>
                                  <div className="price-with-badge">
                                    <span className="price-value promo-price">
                                      {formatPrice(article.PVPROMO)}
                                    </span>
                                    <span className="discount-badge">
                                      -
                                      {calculateDiscount(
                                        article.PVTETTC,
                                        article.PVPROMO,
                                      )}
                                      %
                                    </span>
                                  </div>
                                </div>
                                <div className="original-price-container">
                                  <span className="price-label-small">
                                    Prix normal
                                  </span>
                                  <span className="price-value original-price strikethrough">
                                    {formatPrice(article.PVTETTC)}
                                  </span>
                                </div>
                              </div>
                              <div className="promo-savings">
                                <HiTag />
                                <span>
                                  Économie de{" "}
                                  {formatPrice(
                                    article.PVTETTC - article.PVPROMO,
                                  )}
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="price-main">
                              <span className="price-label">Prix TTC</span>
                              <span className="price-value">
                                {formatPrice(article.PVTETTC)}
                              </span>
                            </div>
                          )}
                          <div className="price-details">
                            <div className="price-item">
                              <span>Prix HT</span>
                              <span>{formatPrice(article.PVTE)}</span>
                            </div>
                            <div className="price-item">
                              <span>Taxe</span>
                              <span>{article.TAXES || 0}%</span>
                            </div>
                          </div>
                        </div>

                        {/* Section stock réservé seulement si > 0 */}
                        {article.RESERV > 0 && (
                          <div className="stock-section">
                            <h3>Stock réservé</h3>
                            <div className="stock-grid">
                              <div className="stock-card reserved">
                                <span className="stock-label">Réservé</span>
                                <span className="stock-value">
                                  {formatStock(article.RESERV)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}

                        {safeTrim(article.OBSERV) && (
                          <div className="observations-section">
                            <h3>Observations</h3>
                            <p>{safeTrim(article.OBSERV)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    renderFilialesTab()
                  )}
                </div>
              ) : searchTerm ? (
                <div className="result-not-found">
                  <div className="not-found-icon">
                    <HiCube />
                  </div>
                  <h3>Article non trouvé</h3>
                  <p>Aucun article ne correspond à "{searchTerm}"</p>
                </div>
              ) : (
                <div className="result-placeholder">
                  <div className="placeholder-icon">
                    <HiQrcode />
                  </div>
                  <h3>Prêt à scanner</h3>
                  <p>Scannez un code barre ou saisissez un code article</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="select-entreprise-prompt">
            <div className="prompt-icon">
              <HiOfficeBuilding />
            </div>
            <h2>Sélectionnez une entreprise</h2>
            <p>Choisissez une entreprise pour commencer la recherche</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default ArticleSearch;
