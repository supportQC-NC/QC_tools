// src/screens/admin/AdminProformasScreen.jsx
import React, { useState, useEffect, useMemo } from "react";
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
  HiOfficeBuilding,
  HiEye,
  HiX,
  HiChevronDown,
  HiChevronUp,
  HiAdjustments,
  HiExternalLink,
  HiDocumentText,
  HiCalendar,
  HiCurrencyDollar,
  HiClipboardList,
  HiCheckCircle,
  HiClock,
  HiExclamation,
  HiUser,
  HiUserGroup,
} from "react-icons/hi";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetProformasQuery,
  useGetRepresentantsQuery,
} from "../../slices/proformaApiSlice";
import "./AdminProformasScreen.css";

// Clé pour le localStorage
const STORAGE_KEY_ENTREPRISE = "admin_proformas_selected_entreprise";

// Debounce hook
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

// Labels et styles des états
const ETAT_CONFIG = {
  0: { label: "Brouillon", color: "muted", icon: HiDocumentText },
  1: { label: "Validée", color: "success", icon: HiCheckCircle },
  2: { label: "Facturée", color: "info", icon: HiCurrencyDollar },
};

const AdminProformasScreen = () => {
  const navigate = useNavigate();
  const { nomDossierDBF: urlNomDossier } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

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

  // États des filtres
  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    tiers: searchParams.get("tiers") || "",
    repres: searchParams.get("repres") || "",
    etat: searchParams.get("etat") || "TOUT",
    dateDebut: searchParams.get("dateDebut") || "",
    dateFin: searchParams.get("dateFin") || "",
  });

  const debouncedFilters = useDebounce(filters, 400);

  // États UI
  const [showFilters, setShowFilters] = useState(true);
  const [selectedProforma, setSelectedProforma] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    identification: true,
    statut: true,
    dates: false,
  });

  // Queries
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();

  const {
    data: proformasData,
    isLoading: loadingProformas,
    error: proformasError,
    refetch,
    isFetching,
  } = useGetProformasQuery(
    {
      nomDossierDBF: selectedEntreprise,
      page,
      limit,
      search: debouncedFilters.search || undefined,
      tiers: debouncedFilters.tiers || undefined,
      repres: debouncedFilters.repres || undefined,
      etat:
        debouncedFilters.etat !== "TOUT" ? debouncedFilters.etat : undefined,
      dateDebut: debouncedFilters.dateDebut || undefined,
      dateFin: debouncedFilters.dateFin || undefined,
    },
    { skip: !selectedEntreprise },
  );

  const { data: representantsData } = useGetRepresentantsQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );

  // Effets
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

  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", page.toString());
    if (filters.search) params.set("search", filters.search);
    if (filters.tiers) params.set("tiers", filters.tiers);
    if (filters.repres) params.set("repres", filters.repres);
    if (filters.etat !== "TOUT") params.set("etat", filters.etat);
    if (filters.dateDebut) params.set("dateDebut", filters.dateDebut);
    if (filters.dateFin) params.set("dateFin", filters.dateFin);
    setSearchParams(params, { replace: true });
  }, [filters, page, setSearchParams]);

  // Les proformas viennent du serveur (déjà filtrées et triées)
  const proformas = proformasData?.proformas || [];

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
      search: "",
      tiers: "",
      repres: "",
      etat: "TOUT",
      dateDebut: "",
      dateFin: "",
    });
    setPage(1);
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Compteurs de filtres actifs
  const activeFiltersCount = useMemo(() => {
    return Object.entries(filters).filter(([key, value]) => {
      if (
        ["search", "tiers", "repres", "dateDebut", "dateFin"].includes(key)
      ) {
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

  const formatDate = (dateValue) => {
    if (!dateValue) return "-";
    if (dateValue instanceof Date) {
      if (isNaN(dateValue.getTime())) return "-";
      return dateValue.toLocaleDateString("fr-FR");
    }
    if (typeof dateValue === "string" && dateValue.length === 8) {
      const year = dateValue.substring(0, 4);
      const month = dateValue.substring(4, 6);
      const day = dateValue.substring(6, 8);
      return `${day}/${month}/${year}`;
    }
    if (typeof dateValue === "string" && dateValue.includes("-")) {
      const d = new Date(dateValue);
      if (!isNaN(d.getTime())) return d.toLocaleDateString("fr-FR");
    }
    return "-";
  };

  const safeTrim = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value);
  };

  const getEtatInfo = (etat) => {
    const base =
      ETAT_CONFIG[etat] || {
        label: `État ${etat}`,
        color: "muted",
        icon: HiDocumentText,
      };
    const custom = selectedEntrepriseData?.mappingEtatsProforma?.[etat];
    return custom ? { ...base, label: custom } : base;
  };

  if (loadingEntreprises) {
    return (
      <div className="admin-proformas-page">
        <div className="admin-loading-state">
          <div className="loading-spinner"></div>
          <p>Chargement des entreprises...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-proformas-page">
      {/* Header */}
      <header className="admin-proformas-header">
        <div className="header-left">
          <div className="header-icon proformas-icon">
            <HiDocumentText />
          </div>
          <div className="header-title">
            <h1>Gestion des Proformas</h1>
            <p className="header-subtitle">
              Consultation des proformas — entêtes et lignes détail
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
            <HiDocumentText />
          </div>
          <h2>Sélectionnez une entreprise</h2>
          <p>Choisissez une entreprise pour consulter ses proformas</p>
        </div>
      ) : (
        <div className="admin-proformas-content">
          {/* Sidebar Filtres */}
          <aside className={`filters-sidebar ${showFilters ? "open" : ""}`}>
            <div className="filters-header">
              <div className="filters-title">
                <HiFilter />
                <span>Filtres</span>
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
                  <span className="section-icon">🔍</span>
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
                        <HiSearch /> Recherche globale
                      </label>
                      <input
                        type="text"
                        placeholder="N° proforma, nom, texte..."
                        value={filters.search}
                        onChange={(e) =>
                          handleFilterChange("search", e.target.value)
                        }
                      />
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiUser /> Code tiers/client
                      </label>
                      <input
                        type="text"
                        placeholder="Code tiers..."
                        value={filters.tiers}
                        onChange={(e) =>
                          handleFilterChange("tiers", e.target.value)
                        }
                      />
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiUserGroup /> Représentant
                      </label>
                      <select
                        value={filters.repres}
                        onChange={(e) =>
                          handleFilterChange("repres", e.target.value)
                        }
                      >
                        <option value="">Tous les représentants</option>
                        {representantsData?.representants?.map((r) => (
                          <option key={r.code} value={r.code}>
                            Rep. {r.code} ({r.count} proformas)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Section Statut */}
              <div className="filter-section">
                <button
                  className="section-header"
                  onClick={() => toggleSection("statut")}
                >
                  <span className="section-icon">📋</span>
                  <span>Statut</span>
                  {expandedSections.statut ? (
                    <HiChevronUp />
                  ) : (
                    <HiChevronDown />
                  )}
                </button>
                {expandedSections.statut && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label>
                        <HiCheckCircle /> État
                      </label>
                      <select
                        value={filters.etat}
                        onChange={(e) =>
                          handleFilterChange("etat", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous les états</option>
                        <option value="0">Brouillon</option>
                        <option value="1">Validée</option>
                        <option value="2">Facturée</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Section Dates */}
              <div className="filter-section">
                <button
                  className="section-header"
                  onClick={() => toggleSection("dates")}
                >
                  <span className="section-icon">📅</span>
                  <span>Période</span>
                  {expandedSections.dates ? (
                    <HiChevronUp />
                  ) : (
                    <HiChevronDown />
                  )}
                </button>
                {expandedSections.dates && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label>
                        <HiCalendar /> Date début
                      </label>
                      <input
                        type="date"
                        value={filters.dateDebut}
                        onChange={(e) =>
                          handleFilterChange("dateDebut", e.target.value)
                        }
                      />
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiCalendar /> Date fin
                      </label>
                      <input
                        type="date"
                        value={filters.dateFin}
                        onChange={(e) =>
                          handleFilterChange("dateFin", e.target.value)
                        }
                      />
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
          <main className="proformas-main">
            {/* Stats Bar */}
            <div className="stats-bar">
              <div className="stat-item primary">
                <span className="stat-value">
                  {proformasData?.pagination?.totalRecords?.toLocaleString() ||
                    0}
                </span>
                <span className="stat-label">
                  {activeFiltersCount > 0
                    ? "Proformas filtrées"
                    : "Proformas"}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {representantsData?.totalRepresentants || 0}
                </span>
                <span className="stat-label">Représentants</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {proformasData?.pagination?.page || 1}/
                  {proformasData?.pagination?.totalPages || 1}
                </span>
                <span className="stat-label">Page</span>
              </div>
              {proformasData?._queryTime && (
                <div className="stat-item">
                  <span className="stat-value">
                    {proformasData._queryTime}
                  </span>
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
            <div className="proformas-table-container">
              {loadingProformas || isFetching ? (
                <div className="table-loading">
                  <div className="loading-spinner"></div>
                  <p>Chargement des proformas...</p>
                </div>
              ) : proformasError ? (
                <div className="table-error">
                  <HiExclamation />
                  <p>
                    Erreur:{" "}
                    {proformasError?.data?.message ||
                      "Impossible de charger les proformas"}
                  </p>
                  <button onClick={refetch}>Réessayer</button>
                </div>
              ) : proformas.length === 0 ? (
                <div className="table-empty">
                  <HiDocumentText />
                  <h3>Aucune proforma trouvée</h3>
                  <p>Modifiez vos filtres pour afficher des résultats</p>
                </div>
              ) : (
                <table className="proformas-table">
                  <thead>
                    <tr>
                      <th className="col-numfact">N° Proforma</th>
                      <th className="col-datfact">Date</th>
                      <th className="col-tiers">Tiers</th>
                      <th className="col-nom">Nom</th>
                      <th className="col-texte">Texte / Objet</th>
                      <th className="col-repres">Rep.</th>
                      <th className="col-montant text-right">Montant</th>
                      <th className="col-etat">État</th>
                      <th className="col-datchant">Date Chantier</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proformas.map((proforma, index) => {
                      const etatInfo = getEtatInfo(proforma.ETAT);
                      const EtatIcon = etatInfo.icon;

                      return (
                        <tr
                          key={`${proforma.NUMFACT}-${index}`}
                          className={`row-etat-${etatInfo.color}`}
                        >
                          <td className="col-numfact">
                            <Link
                              to={`/admin/proformas/${selectedEntreprise}/${safeTrim(proforma.NUMFACT)}`}
                              className="proforma-numfact-link"
                            >
                              {safeTrim(proforma.NUMFACT)}
                              <HiExternalLink className="link-icon" />
                            </Link>
                          </td>
                          <td className="col-datfact">
                            <span className="date-value">
                              {formatDate(proforma.DATFACT)}
                            </span>
                          </td>
                          <td className="col-tiers">
                            <span className="tiers-badge">
                              {proforma.TIERS || "-"}
                            </span>
                          </td>
                          <td className="col-nom">
                            <span
                              className="nom-text"
                              title={safeTrim(proforma.NOM)}
                            >
                              {safeTrim(proforma.NOM) || "-"}
                            </span>
                          </td>
                          <td className="col-texte">
                            <span
                              className="texte-text"
                              title={safeTrim(proforma.TEXTE)}
                            >
                              {safeTrim(proforma.TEXTE) || "-"}
                            </span>
                          </td>
                          <td className="col-repres">
                            <span className="repres-badge">
                              {proforma.REPRES || "-"}
                            </span>
                          </td>
                          <td className="col-montant text-right">
                            <span className="montant-value">
                              {formatPrice(proforma.MONTANT)}
                            </span>
                          </td>
                          <td className="col-etat">
                            <span
                              className={`etat-badge etat-${etatInfo.color}`}
                            >
                              <EtatIcon />
                              {etatInfo.label}
                            </span>
                          </td>
                          <td className="col-datchant">
                            <span className="date-value">
                              {formatDate(proforma.DATCHANT)}
                            </span>
                          </td>
                          <td className="col-actions">
                            <div className="actions-group">
                              <button
                                className="btn-view"
                                onClick={() => setSelectedProforma(proforma)}
                                title="Aperçu rapide"
                              >
                                <HiEye />
                              </button>
                              <Link
                                to={`/admin/proformas/${selectedEntreprise}/${safeTrim(proforma.NUMFACT)}`}
                                className="btn-view btn-detail"
                                title="Voir les détails"
                              >
                                <HiExternalLink />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Pagination */}
            {proformasData?.pagination && (
              <div className="pagination-bar">
                <div className="pagination-info">
                  Affichage de{" "}
                  <strong>
                    {Math.min(
                      (proformasData.pagination.page - 1) * limit + 1,
                      proformasData.pagination.totalRecords,
                    )}
                  </strong>{" "}
                  à{" "}
                  <strong>
                    {Math.min(
                      proformasData.pagination.page * limit,
                      proformasData.pagination.totalRecords,
                    )}
                  </strong>{" "}
                  sur{" "}
                  <strong>
                    {proformasData.pagination.totalRecords.toLocaleString()}
                  </strong>{" "}
                  proformas
                </div>
                <div className="pagination-controls">
                  <button
                    className="btn-page"
                    disabled={!proformasData.pagination.hasPrevPage}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <HiChevronLeft />
                    <span>Précédent</span>
                  </button>
                  <div className="page-indicator">
                    <span className="current-page">
                      {proformasData.pagination.page}
                    </span>
                    <span className="page-separator">/</span>
                    <span className="total-pages">
                      {proformasData.pagination.totalPages}
                    </span>
                  </div>
                  <button
                    className="btn-page"
                    disabled={!proformasData.pagination.hasNextPage}
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

      {/* Modal Aperçu Proforma */}
      {selectedProforma && (
        <div
          className="proforma-modal-overlay"
          onClick={() => setSelectedProforma(null)}
        >
          <div
            className="proforma-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                <HiDocumentText />
                <div>
                  <h2>Aperçu proforma</h2>
                  <span className="modal-numfact">
                    N° {safeTrim(selectedProforma.NUMFACT)}
                  </span>
                </div>
              </div>
              <div className="modal-header-actions">
                <Link
                  to={`/admin/proformas/${selectedEntreprise}/${safeTrim(selectedProforma.NUMFACT)}`}
                  className="btn-view-full"
                  title="Voir la fiche complète"
                >
                  <HiExternalLink />
                  <span>Fiche complète</span>
                </Link>
                <button
                  className="btn-close-modal"
                  onClick={() => setSelectedProforma(null)}
                >
                  <HiX />
                </button>
              </div>
            </div>

            <div className="modal-body">
              <div className="modal-info-section">
                {/* État */}
                <div className="modal-status-row">
                  <span
                    className={`etat-badge etat-${getEtatInfo(selectedProforma.ETAT).color} large`}
                  >
                    {React.createElement(
                      getEtatInfo(selectedProforma.ETAT).icon,
                    )}
                    {getEtatInfo(selectedProforma.ETAT).label}
                  </span>
                </div>

                {/* Infos principales */}
                <div className="info-block">
                  <h4>📋 Informations générales</h4>
                  <div className="info-grid">
                    <div className="info-item">
                      <label>N° Proforma</label>
                      <span className="value highlight">
                        {safeTrim(selectedProforma.NUMFACT)}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Code tiers</label>
                      <span className="value">
                        {selectedProforma.TIERS || "-"}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Nom</label>
                      <span className="value">
                        {safeTrim(selectedProforma.NOM) || "-"}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Date proforma</label>
                      <span className="value">
                        {formatDate(selectedProforma.DATFACT)}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Représentant</label>
                      <span className="value">
                        {selectedProforma.REPRES || "-"}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Date chantier</label>
                      <span className="value">
                        {formatDate(selectedProforma.DATCHANT)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Montant */}
                <div className="info-block">
                  <h4>💰 Montant</h4>
                  <div className="montants-grid">
                    <div className="montant-item main">
                      <label>Montant total</label>
                      <span>{formatPrice(selectedProforma.MONTANT)}</span>
                    </div>
                  </div>
                </div>

                {/* Texte / Objet */}
                {safeTrim(selectedProforma.TEXTE) && (
                  <div className="info-block observations-block">
                    <h4>📝 Texte / Objet</h4>
                    <p className="observations-text">
                      {safeTrim(selectedProforma.TEXTE)}
                    </p>
                  </div>
                )}

                {/* Adresse mailing */}
                {(safeTrim(selectedProforma.MAILING1) ||
                  safeTrim(selectedProforma.MAILING2)) && (
                  <div className="info-block">
                    <h4>📮 Adresse</h4>
                    <div className="mailing-lines">
                      {[1, 2, 3, 4, 5].map((i) => {
                        const line = safeTrim(
                          selectedProforma[`MAILING${i}`],
                        );
                        return line ? (
                          <p key={i} className="mailing-line">
                            {line}
                          </p>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminProformasScreen;