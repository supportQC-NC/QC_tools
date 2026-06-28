// src/screens/admin/AdminClientsScreen.jsx
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
  HiExclamation,
  HiUser,
  HiUserGroup,
  HiPhone,
  HiMail,
  HiLocationMarker,
  HiIdentification,
  HiCurrencyDollar,
  HiTag,
  HiCollection,
} from "react-icons/hi";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetClientsQuery,
  useGetClientFilterValuesQuery,
} from "../../slices/clientApiSlice";
import "./AdminClientsScreen.css";

const STORAGE_KEY_ENTREPRISE = "admin_clients_selected_entreprise";

const DEFAULT_FILTERS = {
  search: "",
  repres: "",
  catcli: "TOUT",
  type: "TOUT",
  categorie: "TOUT",
  groupe: "TOUT",
  banque: "TOUT",
  codtarif: "TOUT",
  cltva: "TOUT",
  ecotaxe: "TOUT",
  sav: "TOUT",
  fdm: "TOUT",
  compte: "TOUT",
};

const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

/**
 * Composant select de filtre réutilisable
 */
const FilterSelect = ({ label, icon, filterKey, value, options, onChange, displayFn }) => {
  const hasOptions = options && options.length > 0;
  return (
    <div className="filter-group">
      <label>{icon} {label}</label>
      <select
        value={value}
        onChange={(e) => onChange(filterKey, e.target.value)}
        disabled={!hasOptions}
      >
        <option value="TOUT">Tous {!hasOptions ? "(aucune valeur)" : `(${options.length})`}</option>
        {hasOptions && options.map((item) => (
          <option key={item.code} value={item.code}>
            {displayFn ? displayFn(item) : `${item.code} (${item.count})`}
          </option>
        ))}
      </select>
    </div>
  );
};

const AdminClientsScreen = () => {
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

  const [filters, setFilters] = useState(() => {
    const f = { ...DEFAULT_FILTERS };
    for (const key of Object.keys(DEFAULT_FILTERS)) {
      const v = searchParams.get(key);
      if (v) f[key] = v;
    }
    return f;
  });

  const debouncedFilters = useDebounce(filters, 400);
  const [showFilters, setShowFilters] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    identification: true,
    classification: false,
    comptabilite: false,
    divers: false,
  });

  const { data: entreprises, isLoading: loadingEntreprises } = useGetEntreprisesQuery();

  // UN SEUL appel pour toutes les valeurs de filtres
  const {
    data: filterValuesData,
    isLoading: loadingFilterValues,
    error: filterValuesError,
  } = useGetClientFilterValuesQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );

  // Debug: log en console si erreur
  useEffect(() => {
    if (filterValuesError) {
      console.error("[AdminClients] Erreur chargement filter-values:", filterValuesError);
    }
    if (filterValuesData) {
      console.log("[AdminClients] filter-values chargées:",
        "representants=", filterValuesData.representants?.length,
        "catclis=", filterValuesData.catclis?.length,
        "types=", filterValuesData.types?.length,
        "categories=", filterValuesData.categories?.length,
        "groupes=", filterValuesData.groupes?.length,
        "banques=", filterValuesData.banques?.length,
        "comptes=", filterValuesData.comptes?.length,
      );
    }
  }, [filterValuesData, filterValuesError]);

  const {
    data: clientsData,
    isLoading: loadingClients,
    error: clientsError,
    refetch,
    isFetching,
  } = useGetClientsQuery(
    {
      nomDossierDBF: selectedEntreprise,
      page,
      limit,
      search: debouncedFilters.search || undefined,
      repres: debouncedFilters.repres || undefined,
      catcli: debouncedFilters.catcli !== "TOUT" ? debouncedFilters.catcli : undefined,
      type: debouncedFilters.type !== "TOUT" ? debouncedFilters.type : undefined,
      categorie: debouncedFilters.categorie !== "TOUT" ? debouncedFilters.categorie : undefined,
      groupe: debouncedFilters.groupe !== "TOUT" ? debouncedFilters.groupe : undefined,
      banque: debouncedFilters.banque !== "TOUT" ? debouncedFilters.banque : undefined,
      codtarif: debouncedFilters.codtarif !== "TOUT" ? debouncedFilters.codtarif : undefined,
      cltva: debouncedFilters.cltva !== "TOUT" ? debouncedFilters.cltva : undefined,
      ecotaxe: debouncedFilters.ecotaxe !== "TOUT" ? debouncedFilters.ecotaxe : undefined,
      sav: debouncedFilters.sav !== "TOUT" ? debouncedFilters.sav : undefined,
      fdm: debouncedFilters.fdm !== "TOUT" ? debouncedFilters.fdm : undefined,
      compte: debouncedFilters.compte !== "TOUT" ? debouncedFilters.compte : undefined,
    },
    { skip: !selectedEntreprise },
  );

  useEffect(() => {
    if (selectedEntreprise) localStorage.setItem(STORAGE_KEY_ENTREPRISE, selectedEntreprise);
  }, [selectedEntreprise]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", page.toString());
    for (const [key, value] of Object.entries(filters)) {
      if (key === "search" && value) params.set(key, value);
      else if (key === "repres" && value) params.set(key, value);
      else if (value !== "TOUT" && value !== "" && key !== "search" && key !== "repres") params.set(key, value);
    }
    setSearchParams(params, { replace: true });
  }, [filters, page, setSearchParams]);

  const clients = clientsData?.clients || [];

  const handleEntrepriseChange = (e) => {
    const v = e.target.value;
    setSelectedEntreprise(v);
    if (v) localStorage.setItem(STORAGE_KEY_ENTREPRISE, v);
    else localStorage.removeItem(STORAGE_KEY_ENTREPRISE);
    setPage(1);
    resetFilters();
  };

  const resetFilters = () => {
    setFilters({ ...DEFAULT_FILTERS });
    setPage(1);
  };

  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const toggleSection = (s) => setExpandedSections((prev) => ({ ...prev, [s]: !prev[s] }));

  const activeFiltersCount = useMemo(() => {
    return Object.entries(filters).filter(([key, value]) => {
      if (key === "search" || key === "repres") return value !== "";
      return value !== "TOUT";
    }).length;
  }, [filters]);

  const formatPrice = (price) => {
    if (!price && price !== 0) return "-";
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "XPF", minimumFractionDigits: 0 }).format(price);
  };

  const safeTrim = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value);
  };

  if (loadingEntreprises) {
    return (
      <div className="admin-clients-page">
        <div className="admin-loading-state"><div className="loading-spinner"></div><p>Chargement...</p></div>
      </div>
    );
  }

  return (
    <div className="admin-clients-page">
      <header className="admin-clients-header">
        <div className="header-left">
          <div className="header-icon clients-icon"><HiUser /></div>
          <div className="header-title">
            <h1>Gestion des Clients</h1>
            <p className="header-subtitle">Consultation des fiches clients</p>
          </div>
        </div>
        <div className="header-actions">
          <div className="entreprise-selector">
            <HiOfficeBuilding className="selector-icon" />
            <select value={selectedEntreprise} onChange={handleEntrepriseChange}>
              <option value="">Sélectionner une entreprise</option>
              {entreprises?.map((e) => (
                <option key={e._id} value={e.nomDossierDBF}>{e.trigramme} - {e.nomComplet}</option>
              ))}
            </select>
            <HiChevronDown className="selector-arrow" />
          </div>
        </div>
      </header>

      {!selectedEntreprise ? (
        <div className="empty-state">
          <div className="empty-icon"><HiUser /></div>
          <h2>Sélectionnez une entreprise</h2>
          <p>Choisissez une entreprise pour consulter ses clients</p>
        </div>
      ) : (
        <div className="admin-clients-content">
          <aside className={`filters-sidebar ${showFilters ? "open" : ""}`}>
            <div className="filters-header">
              <div className="filters-title">
                <HiFilter /><span>Filtres</span>
                {activeFiltersCount > 0 && <span className="filters-badge">{activeFiltersCount}</span>}
              </div>
              <button className="btn-toggle-filters" onClick={() => setShowFilters(!showFilters)}>
                {showFilters ? <HiX /> : <HiFilter />}
              </button>
            </div>

            {/* Bandeau erreur si filter-values échoue */}
            {filterValuesError && (
              <div className="filters-error-banner">
                ⚠️ Erreur chargement filtres
                <small>{filterValuesError?.data?.message || filterValuesError?.error || "Vérifiez la console"}</small>
              </div>
            )}

            {loadingFilterValues && (
              <div className="filters-loading-banner">
                <div className="loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }}></div>
                <span>Chargement des filtres...</span>
              </div>
            )}

            <div className="filters-body">
              {/* ===== IDENTIFICATION ===== */}
              <div className="filter-section">
                <button className="section-header" onClick={() => toggleSection("identification")}>
                  <span className="section-icon">🔍</span><span>Identification</span>
                  {expandedSections.identification ? <HiChevronUp /> : <HiChevronDown />}
                </button>
                {expandedSections.identification && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label><HiSearch /> Recherche</label>
                      <input type="text" placeholder="Nom, tiers, tél, RIDET, email..." value={filters.search} onChange={(e) => handleFilterChange("search", e.target.value)} />
                    </div>
                    <div className="filter-group">
                      <label><HiUserGroup /> Représentant</label>
                      <select value={filters.repres} onChange={(e) => handleFilterChange("repres", e.target.value)}>
                        <option value="">Tous</option>
                        {filterValuesData?.representants?.map((r) => (
                          <option key={r.code} value={r.code}>{r.code} ({r.count})</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* ===== CLASSIFICATION ===== */}
              <div className="filter-section">
                <button className="section-header" onClick={() => toggleSection("classification")}>
                  <span className="section-icon">📋</span><span>Classification</span>
                  {expandedSections.classification ? <HiChevronUp /> : <HiChevronDown />}
                </button>
                {expandedSections.classification && (
                  <div className="section-content">
                    <FilterSelect label="Cat. client (CATCLI)" icon={<HiTag />} filterKey="catcli"
                      value={filters.catcli} options={filterValuesData?.catclis} onChange={handleFilterChange}
                      displayFn={(i) => `Cat. ${i.code} (${i.count})`} />
                    <FilterSelect label="Type" icon={<HiCollection />} filterKey="type"
                      value={filters.type} options={filterValuesData?.types} onChange={handleFilterChange} />
                    <FilterSelect label="Catégorie détaillée" icon="📂" filterKey="categorie"
                      value={filters.categorie} options={filterValuesData?.categories} onChange={handleFilterChange} />
                    <FilterSelect label="Groupe" icon="👥" filterKey="groupe"
                      value={filters.groupe} options={filterValuesData?.groupes} onChange={handleFilterChange} />
                  </div>
                )}
              </div>

              {/* ===== COMPTABILITÉ ===== */}
              <div className="filter-section">
                <button className="section-header" onClick={() => toggleSection("comptabilite")}>
                  <span className="section-icon">💰</span><span>Comptabilité</span>
                  {expandedSections.comptabilite ? <HiChevronUp /> : <HiChevronDown />}
                </button>
                {expandedSections.comptabilite && (
                  <div className="section-content">
                    <FilterSelect label="Compte tiers" icon={<HiCurrencyDollar />} filterKey="compte"
                      value={filters.compte} options={filterValuesData?.comptes} onChange={handleFilterChange} />
                    <FilterSelect label="Code tarif" icon="🏷️" filterKey="codtarif"
                      value={filters.codtarif} options={filterValuesData?.codtarifs} onChange={handleFilterChange} />
                    <FilterSelect label="Code TVA" icon="📊" filterKey="cltva"
                      value={filters.cltva} options={filterValuesData?.cltvas} onChange={handleFilterChange} />
                    <FilterSelect label="Banque" icon="🏦" filterKey="banque"
                      value={filters.banque} options={filterValuesData?.banques} onChange={handleFilterChange} />
                    <FilterSelect label="Fin de mois" icon="📅" filterKey="fdm"
                      value={filters.fdm} options={filterValuesData?.fdms} onChange={handleFilterChange} />
                  </div>
                )}
              </div>

              {/* ===== DIVERS ===== */}
              <div className="filter-section">
                <button className="section-header" onClick={() => toggleSection("divers")}>
                  <span className="section-icon">⚙️</span><span>Divers</span>
                  {expandedSections.divers ? <HiChevronUp /> : <HiChevronDown />}
                </button>
                {expandedSections.divers && (
                  <div className="section-content">
                    <FilterSelect label="Écotaxe" icon="♻️" filterKey="ecotaxe"
                      value={filters.ecotaxe} options={filterValuesData?.ecotaxes} onChange={handleFilterChange} />
                    <FilterSelect label="SAV" icon="🔧" filterKey="sav"
                      value={filters.sav} options={filterValuesData?.savs} onChange={handleFilterChange} />
                  </div>
                )}
              </div>
            </div>
            <div className="filters-footer">
              <button className="btn-reset" onClick={resetFilters}><HiRefresh /><span>Réinitialiser</span></button>
            </div>
          </aside>

          <main className="clients-main">
            <div className="stats-bar">
              <div className="stat-item primary">
                <span className="stat-value">{clientsData?.pagination?.totalRecords?.toLocaleString() || 0}</span>
                <span className="stat-label">{activeFiltersCount > 0 ? "Clients filtrés" : "Clients"}</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{clientsData?.pagination?.page || 1}/{clientsData?.pagination?.totalPages || 1}</span>
                <span className="stat-label">Page</span>
              </div>
              {clientsData?._queryTime && (
                <div className="stat-item">
                  <span className="stat-value">{clientsData._queryTime}</span>
                  <span className="stat-label">Temps</span>
                </div>
              )}
              <div className="stats-actions">
                <button className={`btn-icon-action ${showFilters ? "active" : ""}`} onClick={() => setShowFilters(!showFilters)} title="Filtres"><HiAdjustments /></button>
                <button className="btn-icon-action" onClick={refetch} disabled={isFetching} title="Rafraîchir"><HiRefresh className={isFetching ? "spinning" : ""} /></button>
              </div>
            </div>

            <div className="clients-table-container">
              {loadingClients || isFetching ? (
                <div className="table-loading"><div className="loading-spinner"></div><p>Chargement...</p></div>
              ) : clientsError ? (
                <div className="table-error"><HiExclamation /><p>Erreur: {clientsError?.data?.message || "Impossible de charger"}</p><button onClick={refetch}>Réessayer</button></div>
              ) : clients.length === 0 ? (
                <div className="table-empty"><HiUser /><h3>Aucun client trouvé</h3><p>Modifiez vos filtres</p></div>
              ) : (
                <table className="clients-table">
                  <thead>
                    <tr>
                      <th className="col-tiers">Tiers</th>
                      <th className="col-nom">Nom</th>
                      <th className="col-ad1">Adresse</th>
                      <th className="col-tel">Téléphone</th>
                      <th className="col-ridet">RIDET</th>
                      <th className="col-type">Type</th>
                      <th className="col-categorie">Catégorie</th>
                      <th className="col-compte">Compte</th>
                      <th className="col-repres">Rep.</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {clients.map((client, index) => (
                      <tr key={`${client.TIERS}-${index}`}>
                        <td className="col-tiers">
                          <Link to={`/admin/clients/${selectedEntreprise}/${client.TIERS}`} className="client-tiers-link">
                            {client.TIERS}
                            <HiExternalLink className="link-icon" />
                          </Link>
                        </td>
                        <td className="col-nom"><span className="nom-text" title={safeTrim(client.NOM)}>{safeTrim(client.NOM) || "-"}</span></td>
                        <td className="col-ad1"><span className="ad-text" title={safeTrim(client.AD1)}>{safeTrim(client.AD1) || "-"}</span></td>
                        <td className="col-tel">{safeTrim(client.TEL) || "-"}</td>
                        <td className="col-ridet">
                          {client._ridet ? (
                            <span className="ridet-badge" title={`AD5 brut: ${safeTrim(client.AD5)}`}>{client._ridet}</span>
                          ) : <span className="ridet-badge-none">Aucun</span>}
                        </td>
                        <td className="col-type">
                          {safeTrim(client.TYPE) ? (
                            <span className="type-badge-cell">{safeTrim(client.TYPE)}</span>
                          ) : <span className="no-data-cell">-</span>}
                        </td>
                        <td className="col-categorie">
                          {safeTrim(client.CATEGORIE) ? (
                            <span className="categorie-badge-cell" title={safeTrim(client.CATEGORIE)}>{safeTrim(client.CATEGORIE)}</span>
                          ) : <span className="no-data-cell">-</span>}
                        </td>
                        <td className="col-compte">
                          {client._comptes && client._comptes.length > 0 ? (
                            <span className="compte-badge" title={client._comptes.join(", ")}>{client._comptes.join(", ")}</span>
                          ) : <span className="no-data-cell">-</span>}
                        </td>
                        <td className="col-repres"><span className="ridet-badge">{client.REPRES || "Aucun"}</span></td>
                        <td className="col-actions">
                          <div className="actions-group">
                            <button className="btn-view" onClick={() => setSelectedClient(client)} title="Aperçu"><HiEye /></button>
                            <Link to={`/admin/clients/${selectedEntreprise}/${client.TIERS}`} className="btn-view btn-detail" title="Fiche"><HiExternalLink /></Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {clientsData?.pagination && (
              <div className="pagination-bar">
                <div className="pagination-info">
                  <strong>{Math.min((clientsData.pagination.page - 1) * limit + 1, clientsData.pagination.totalRecords)}</strong>
                  {" "}à{" "}
                  <strong>{Math.min(clientsData.pagination.page * limit, clientsData.pagination.totalRecords)}</strong>
                  {" "}sur <strong>{clientsData.pagination.totalRecords.toLocaleString()}</strong>
                </div>
                <div className="pagination-controls">
                  <button className="btn-page" disabled={!clientsData.pagination.hasPrevPage} onClick={() => setPage((p) => p - 1)}><HiChevronLeft /><span>Préc.</span></button>
                  <div className="page-indicator">
                    <span className="current-page">{clientsData.pagination.page}</span>/<span className="total-pages">{clientsData.pagination.totalPages}</span>
                  </div>
                  <button className="btn-page" disabled={!clientsData.pagination.hasNextPage} onClick={() => setPage((p) => p + 1)}><span>Suiv.</span><HiChevronRight /></button>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {/* Modal aperçu */}
      {selectedClient && (
        <div className="client-modal-overlay" onClick={() => setSelectedClient(null)}>
          <div className="client-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <HiUser />
                <div>
                  <h2>{safeTrim(selectedClient.NOM) || "Client"}</h2>
                  <span className="modal-tiers">Tiers {selectedClient.TIERS}</span>
                </div>
              </div>
              <div className="modal-header-actions">
                <Link to={`/admin/clients/${selectedEntreprise}/${selectedClient.TIERS}`} className="btn-view-full" title="Fiche complète">
                  <HiExternalLink /><span>Fiche complète</span>
                </Link>
                <button className="btn-close-modal" onClick={() => setSelectedClient(null)}><HiX /></button>
              </div>
            </div>
            <div className="modal-body">
              <div className="info-block">
                <h4>📋 Identification</h4>
                <div className="info-grid">
                  <div className="info-item"><label>Code tiers</label><span className="value highlight">{selectedClient.TIERS}</span></div>
                  <div className="info-item"><label>Nom</label><span className="value">{safeTrim(selectedClient.NOM)}</span></div>
                  <div className="info-item"><label>RIDET</label><span className="value">{selectedClient._ridet || "-"}</span></div>
                  <div className="info-item"><label>Cat. client</label><span className="value">{safeTrim(selectedClient.CATCLI) || "-"}</span></div>
                  <div className="info-item"><label>Type</label><span className="value">{safeTrim(selectedClient.TYPE) || "-"}</span></div>
                  <div className="info-item"><label>Catégorie</label><span className="value">{safeTrim(selectedClient.CATEGORIE) || "-"}</span></div>
                  <div className="info-item"><label>Groupe</label><span className="value">{safeTrim(selectedClient.GROUPE) || "-"}</span></div>
                  <div className="info-item"><label>Compte(s)</label><span className="value">{selectedClient._comptes && selectedClient._comptes.length > 0 ? selectedClient._comptes.join(", ") : "-"}</span></div>
                </div>
              </div>
              <div className="info-block">
                <h4><HiLocationMarker /> Adresse</h4>
                <div className="address-lines">
                  {[1, 2, 3, 4].map((i) => {
                    const line = safeTrim(selectedClient[`AD${i}`]);
                    return line ? <p key={i}>{line}</p> : null;
                  })}
                </div>
              </div>
              <div className="info-block">
                <h4><HiPhone /> Contact</h4>
                <div className="info-grid">
                  <div className="info-item"><label>Téléphone</label><span className="value">{safeTrim(selectedClient.TEL) || "-"}</span></div>
                  <div className="info-item"><label>Fax</label><span className="value">{safeTrim(selectedClient.FAX) || "-"}</span></div>
                  <div className="info-item"><label>Email</label><span className="value">{safeTrim(selectedClient.ADMAIL) || "-"}</span></div>
                  <div className="info-item"><label>Interlocuteur</label><span className="value">{safeTrim(selectedClient.INTERLOC) || "-"}</span></div>
                </div>
              </div>
              <div className="info-block">
                <h4><HiCurrencyDollar /> Financier</h4>
                <div className="montants-grid">
                  <div className="montant-item"><label>Débit</label><span>{formatPrice(selectedClient.DEBIT)}</span></div>
                  <div className="montant-item"><label>Crédit</label><span>{formatPrice(selectedClient.CREDIT)}</span></div>
                  <div className="montant-item"><label>Solde</label><span>{formatPrice((selectedClient.DEBIT || 0) - (selectedClient.CREDIT || 0))}</span></div>
                  <div className="montant-item"><label>Débit max</label><span>{formatPrice(selectedClient.DEBIMAX)}</span></div>
                </div>
              </div>
              {selectedClient._tiersInfo && selectedClient._tiersInfo.length > 0 && (
                <div className="info-block">
                  <h4>💰 Comptes tiers (comptabilité)</h4>
                  <div className="tiers-compta-list">
                    {selectedClient._tiersInfo.map((t, idx) => (
                      <div key={idx} className="tiers-compta-row">
                        <span className="tiers-compta-compte">{t.COMPTE}</span>
                        <span className="tiers-compta-nom">{t.NOM}</span>
                        <span className="tiers-compta-debit">D: {formatPrice(t.DEBIT)}</span>
                        <span className="tiers-compta-credit">C: {formatPrice(t.CREDIT)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminClientsScreen;