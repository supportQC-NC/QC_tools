// src/screens/admin/AdminFacturesScreen.jsx
import React, { useState, useEffect, useMemo } from "react";
import {
  Link,
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
  HiExclamation,
  HiUser,
  HiUserGroup,
  HiReceiptTax,
  HiSwitchHorizontal,
  HiReply,
  HiClock,
} from "react-icons/hi";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetFacturesQuery,
  useGetFactureRepresentantsQuery,
} from "../../slices/factureApiSlice";
import "./AdminFacturesScreen.css";

const STORAGE_KEY_ENTREPRISE = "admin_factures_selected_entreprise";

const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

// Config TYPFACT
const TYPFACT_CONFIG = {
  F: { label: "Facture", color: "primary", icon: HiReceiptTax },
  A: { label: "Avoir", color: "danger", icon: HiReply },
  R: { label: "RESA", color: "warning", icon: HiClock },
  T: { label: "Transfert", color: "info", icon: HiSwitchHorizontal },
};

const AdminFacturesScreen = () => {
  const { nomDossierDBF: urlNomDossier } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const getInitialEntreprise = () => {
    if (urlNomDossier) return urlNomDossier;
    const saved = localStorage.getItem(STORAGE_KEY_ENTREPRISE);
    return saved || "";
  };

  const [selectedEntreprise, setSelectedEntreprise] = useState(getInitialEntreprise);
  const [page, setPage] = useState(parseInt(searchParams.get("page")) || 1);
  const [limit] = useState(50);

  const [filters, setFilters] = useState({
    search: searchParams.get("search") || "",
    tiers: searchParams.get("tiers") || "",
    repres: searchParams.get("repres") || "",
    typfact: searchParams.get("typfact") || "TOUT",
    dateDebut: searchParams.get("dateDebut") || "",
    dateFin: searchParams.get("dateFin") || "",
  });

  const debouncedFilters = useDebounce(filters, 400);

  const [showFilters, setShowFilters] = useState(true);
  const [selectedFacture, setSelectedFacture] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    identification: true,
    type: true,
    dates: false,
  });

  const { data: entreprises, isLoading: loadingEntreprises } = useGetEntreprisesQuery();

  const {
    data: facturesData,
    isLoading: loadingFactures,
    error: facturesError,
    refetch,
    isFetching,
  } = useGetFacturesQuery(
    {
      nomDossierDBF: selectedEntreprise,
      page,
      limit,
      search: debouncedFilters.search || undefined,
      tiers: debouncedFilters.tiers || undefined,
      repres: debouncedFilters.repres || undefined,
      typfact: debouncedFilters.typfact !== "TOUT" ? debouncedFilters.typfact : undefined,
      dateDebut: debouncedFilters.dateDebut || undefined,
      dateFin: debouncedFilters.dateFin || undefined,
    },
    { skip: !selectedEntreprise },
  );

  const { data: representantsData } = useGetFactureRepresentantsQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );

  useEffect(() => {
    if (entreprises && selectedEntreprise) {
      localStorage.setItem(STORAGE_KEY_ENTREPRISE, selectedEntreprise);
    }
  }, [entreprises, selectedEntreprise]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", page.toString());
    if (filters.search) params.set("search", filters.search);
    if (filters.tiers) params.set("tiers", filters.tiers);
    if (filters.repres) params.set("repres", filters.repres);
    if (filters.typfact !== "TOUT") params.set("typfact", filters.typfact);
    if (filters.dateDebut) params.set("dateDebut", filters.dateDebut);
    if (filters.dateFin) params.set("dateFin", filters.dateFin);
    setSearchParams(params, { replace: true });
  }, [filters, page, setSearchParams]);

  const factures = facturesData?.factures || [];

  const handleEntrepriseChange = (e) => {
    const nomDossier = e.target.value;
    setSelectedEntreprise(nomDossier);
    if (nomDossier) {
      localStorage.setItem(STORAGE_KEY_ENTREPRISE, nomDossier);
    } else {
      localStorage.removeItem(STORAGE_KEY_ENTREPRISE);
    }
    setPage(1);
    resetFilters();
  };

  const resetFilters = () => {
    setFilters({ search: "", tiers: "", repres: "", typfact: "TOUT", dateDebut: "", dateFin: "" });
    setPage(1);
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const activeFiltersCount = useMemo(() => {
    return Object.entries(filters).filter(([key, value]) => {
      if (["search", "tiers", "repres", "dateDebut", "dateFin"].includes(key)) return value !== "";
      return value !== "TOUT";
    }).length;
  }, [filters]);

  const formatPrice = (price) => {
    if (!price && price !== 0) return "-";
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XPF", minimumFractionDigits: 0 }).format(price);
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return "-";
    if (dateValue instanceof Date) {
      if (isNaN(dateValue.getTime())) return "-";
      return dateValue.toLocaleDateString("fr-FR");
    }
    if (typeof dateValue === "string" && dateValue.length === 8) {
      return `${dateValue.substring(6, 8)}/${dateValue.substring(4, 6)}/${dateValue.substring(0, 4)}`;
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

  const getTypfactInfo = (typfact) => {
    const t = safeTrim(typfact).toUpperCase();
    return TYPFACT_CONFIG[t] || { label: `Type ${t}`, color: "muted", icon: HiDocumentText };
  };

  if (loadingEntreprises) {
    return (
      <div className="admin-factures-page">
        <div className="admin-loading-state">
          <div className="loading-spinner"></div>
          <p>Chargement des entreprises...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-factures-page">
      {/* Header */}
      <header className="admin-factures-header">
        <div className="header-left">
          <div className="header-icon factures-icon">
            <HiReceiptTax />
          </div>
          <div className="header-title">
            <h1>Gestion des Factures</h1>
            <p className="header-subtitle">Consultation des factures — année en cours et précédente</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="entreprise-selector">
            <HiOfficeBuilding className="selector-icon" />
            <select value={selectedEntreprise} onChange={handleEntrepriseChange}>
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
          <div className="empty-icon"><HiReceiptTax /></div>
          <h2>Sélectionnez une entreprise</h2>
          <p>Choisissez une entreprise pour consulter ses factures</p>
        </div>
      ) : (
        <div className="admin-factures-content">
          {/* Sidebar Filtres */}
          <aside className={`filters-sidebar ${showFilters ? "open" : ""}`}>
            <div className="filters-header">
              <div className="filters-title">
                <HiFilter />
                <span>Filtres</span>
                {activeFiltersCount > 0 && <span className="filters-badge">{activeFiltersCount}</span>}
              </div>
              <button className="btn-toggle-filters" onClick={() => setShowFilters(!showFilters)}>
                {showFilters ? <HiX /> : <HiFilter />}
              </button>
            </div>

            <div className="filters-body">
              {/* Identification */}
              <div className="filter-section">
                <button className="section-header" onClick={() => toggleSection("identification")}>
                  <span className="section-icon">🔍</span>
                  <span>Identification</span>
                  {expandedSections.identification ? <HiChevronUp /> : <HiChevronDown />}
                </button>
                {expandedSections.identification && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label><HiSearch /> Recherche globale</label>
                      <input type="text" placeholder="N° facture, nom, texte, bon cde..." value={filters.search} onChange={(e) => handleFilterChange("search", e.target.value)} />
                    </div>
                    <div className="filter-group">
                      <label><HiUser /> Code tiers/client</label>
                      <input type="text" placeholder="Code tiers..." value={filters.tiers} onChange={(e) => handleFilterChange("tiers", e.target.value)} />
                    </div>
                    <div className="filter-group">
                      <label><HiUserGroup /> Représentant</label>
                      <select value={filters.repres} onChange={(e) => handleFilterChange("repres", e.target.value)}>
                        <option value="">Tous les représentants</option>
                        {representantsData?.representants?.map((r) => (
                          <option key={r.code} value={r.code}>Rep. {r.code} ({r.count} factures)</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Type */}
              <div className="filter-section">
                <button className="section-header" onClick={() => toggleSection("type")}>
                  <span className="section-icon">📋</span>
                  <span>Type</span>
                  {expandedSections.type ? <HiChevronUp /> : <HiChevronDown />}
                </button>
                {expandedSections.type && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label><HiReceiptTax /> Type de pièce</label>
                      <select value={filters.typfact} onChange={(e) => handleFilterChange("typfact", e.target.value)}>
                        <option value="TOUT">Tous les types</option>
                        <option value="F">Facture</option>
                        <option value="A">Avoir</option>
                        <option value="R">RESA</option>
                        <option value="T">Transfert</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Dates */}
              <div className="filter-section">
                <button className="section-header" onClick={() => toggleSection("dates")}>
                  <span className="section-icon">📅</span>
                  <span>Période</span>
                  {expandedSections.dates ? <HiChevronUp /> : <HiChevronDown />}
                </button>
                {expandedSections.dates && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label><HiCalendar /> Date début</label>
                      <input type="date" value={filters.dateDebut} onChange={(e) => handleFilterChange("dateDebut", e.target.value)} />
                    </div>
                    <div className="filter-group">
                      <label><HiCalendar /> Date fin</label>
                      <input type="date" value={filters.dateFin} onChange={(e) => handleFilterChange("dateFin", e.target.value)} />
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

          {/* Main */}
          <main className="factures-main">
            <div className="stats-bar">
              <div className="stat-item primary">
                <span className="stat-value">{facturesData?.pagination?.totalRecords?.toLocaleString() || 0}</span>
                <span className="stat-label">{activeFiltersCount > 0 ? "Factures filtrées" : "Factures"}</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{representantsData?.totalRepresentants || 0}</span>
                <span className="stat-label">Représentants</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{facturesData?.pagination?.page || 1}/{facturesData?.pagination?.totalPages || 1}</span>
                <span className="stat-label">Page</span>
              </div>
              {facturesData?._queryTime && (
                <div className="stat-item">
                  <span className="stat-value">{facturesData._queryTime}</span>
                  <span className="stat-label">Temps</span>
                </div>
              )}
              <div className="stats-actions">
                <button className={`btn-icon-action ${showFilters ? "active" : ""}`} onClick={() => setShowFilters(!showFilters)} title="Filtres">
                  <HiAdjustments />
                </button>
                <button className="btn-icon-action" onClick={refetch} disabled={isFetching} title="Rafraîchir">
                  <HiRefresh className={isFetching ? "spinning" : ""} />
                </button>
              </div>
            </div>

            <div className="factures-table-container">
              {loadingFactures || isFetching ? (
                <div className="table-loading"><div className="loading-spinner"></div><p>Chargement des factures...</p></div>
              ) : facturesError ? (
                <div className="table-error"><HiExclamation /><p>Erreur: {facturesError?.data?.message || "Impossible de charger les factures"}</p><button onClick={refetch}>Réessayer</button></div>
              ) : factures.length === 0 ? (
                <div className="table-empty"><HiReceiptTax /><h3>Aucune facture trouvée</h3><p>Modifiez vos filtres pour afficher des résultats</p></div>
              ) : (
                <table className="factures-table">
                  <thead>
                    <tr>
                      <th className="col-numfact">N° Facture</th>
                      <th className="col-typfact">Type</th>
                      <th className="col-datfact">Date</th>
                      <th className="col-tiers">Tiers</th>
                      <th className="col-nom">Nom</th>
                      <th className="col-boncde">Bon Cde</th>
                      <th className="col-repres">Rep.</th>
                      <th className="col-montant text-right">Montant</th>
                      <th className="col-montaxes text-right">Taxes</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {factures.map((facture, index) => {
                      const typInfo = getTypfactInfo(facture.TYPFACT);
                      const TypIcon = typInfo.icon;

                      return (
                        <tr key={`${facture.NUMFACT}-${index}`} className={`row-typ-${typInfo.color}`}>
                          <td className="col-numfact">
                            <Link
                              to={`/admin/factures/${selectedEntreprise}/${safeTrim(facture.NUMFACT)}`}
                              className="facture-numfact-link"
                            >
                              {safeTrim(facture.NUMFACT)}
                              <HiExternalLink className="link-icon" />
                            </Link>
                          </td>
                          <td className="col-typfact">
                            <span className={`typfact-badge typ-${typInfo.color}`}>
                              <TypIcon />
                              {typInfo.label}
                            </span>
                          </td>
                          <td className="col-datfact"><span className="date-value">{formatDate(facture.DATFACT)}</span></td>
                          <td className="col-tiers"><span className="tiers-badge">{facture.TIERS || "-"}</span></td>
                          <td className="col-nom"><span className="nom-text" title={safeTrim(facture.NOM)}>{safeTrim(facture.NOM) || "-"}</span></td>
                          <td className="col-boncde"><span className="boncde-text" title={safeTrim(facture.BONCDE)}>{safeTrim(facture.BONCDE) || "-"}</span></td>
                          <td className="col-repres"><span className="repres-badge">{facture.REPRES || "-"}</span></td>
                          <td className="col-montant text-right"><span className="montant-value">{formatPrice(facture.MONTANT)}</span></td>
                          <td className="col-montaxes text-right"><span className="montaxes-value">{formatPrice(facture.MONTAXES)}</span></td>
                          <td className="col-actions">
                            <div className="actions-group">
                              <button className="btn-view" onClick={() => setSelectedFacture(facture)} title="Aperçu rapide"><HiEye /></button>
                              <Link to={`/admin/factures/${selectedEntreprise}/${safeTrim(facture.NUMFACT)}`} className="btn-view btn-detail" title="Voir les détails"><HiExternalLink /></Link>
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
            {facturesData?.pagination && (
              <div className="pagination-bar">
                <div className="pagination-info">
                  Affichage de{" "}
                  <strong>{Math.min((facturesData.pagination.page - 1) * limit + 1, facturesData.pagination.totalRecords)}</strong>{" "}
                  à{" "}
                  <strong>{Math.min(facturesData.pagination.page * limit, facturesData.pagination.totalRecords)}</strong>{" "}
                  sur <strong>{facturesData.pagination.totalRecords.toLocaleString()}</strong> factures
                </div>
                <div className="pagination-controls">
                  <button className="btn-page" disabled={!facturesData.pagination.hasPrevPage} onClick={() => setPage((p) => p - 1)}>
                    <HiChevronLeft /><span>Précédent</span>
                  </button>
                  <div className="page-indicator">
                    <span className="current-page">{facturesData.pagination.page}</span>
                    <span className="page-separator">/</span>
                    <span className="total-pages">{facturesData.pagination.totalPages}</span>
                  </div>
                  <button className="btn-page" disabled={!facturesData.pagination.hasNextPage} onClick={() => setPage((p) => p + 1)}>
                    <span>Suivant</span><HiChevronRight />
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {/* Modal Aperçu */}
      {selectedFacture && (
        <div className="facture-modal-overlay" onClick={() => setSelectedFacture(null)}>
          <div className="facture-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <HiReceiptTax />
                <div>
                  <h2>Aperçu facture</h2>
                  <span className="modal-numfact">N° {safeTrim(selectedFacture.NUMFACT)}</span>
                </div>
              </div>
              <div className="modal-header-actions">
                <Link to={`/admin/factures/${selectedEntreprise}/${safeTrim(selectedFacture.NUMFACT)}`} className="btn-view-full" title="Fiche complète">
                  <HiExternalLink /><span>Fiche complète</span>
                </Link>
                <button className="btn-close-modal" onClick={() => setSelectedFacture(null)}><HiX /></button>
              </div>
            </div>
            <div className="modal-body">
              <div className="modal-info-section">
                <div className="modal-status-row">
                  {(() => {
                    const typInfo = getTypfactInfo(selectedFacture.TYPFACT);
                    return (
                      <span className={`typfact-badge typ-${typInfo.color} large`}>
                        {React.createElement(typInfo.icon)}
                        {typInfo.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="info-block">
                  <h4>📋 Informations générales</h4>
                  <div className="info-grid">
                    <div className="info-item"><label>N° Facture</label><span className="value highlight">{safeTrim(selectedFacture.NUMFACT)}</span></div>
                    <div className="info-item"><label>Code tiers</label><span className="value">{selectedFacture.TIERS || "-"}</span></div>
                    <div className="info-item"><label>Nom</label><span className="value">{safeTrim(selectedFacture.NOM) || "-"}</span></div>
                    <div className="info-item"><label>Date facture</label><span className="value">{formatDate(selectedFacture.DATFACT)}</span></div>
                    <div className="info-item"><label>Représentant</label><span className="value">{selectedFacture.REPRES || "-"}</span></div>
                    <div className="info-item"><label>Bon commande</label><span className="value">{safeTrim(selectedFacture.BONCDE) || "-"}</span></div>
                  </div>
                </div>
                <div className="info-block">
                  <h4>💰 Montants</h4>
                  <div className="montants-grid">
                    <div className="montant-item main"><label>Montant</label><span>{formatPrice(selectedFacture.MONTANT)}</span></div>
                    <div className="montant-item"><label>Taxes</label><span>{formatPrice(selectedFacture.MONTAXES)}</span></div>
                  </div>
                </div>
                {safeTrim(selectedFacture.TEXTE) && (
                  <div className="info-block observations-block">
                    <h4>📝 Texte / Objet</h4>
                    <p className="observations-text">{safeTrim(selectedFacture.TEXTE)}</p>
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

export default AdminFacturesScreen;