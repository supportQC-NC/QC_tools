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
  HiOfficeBuilding,
  HiEye,
  HiX,
  HiChevronDown,
  HiChevronUp,
  HiAdjustments,
  HiExternalLink,
  HiDocumentText,
  HiTruck,
  HiCalendar,
  HiLockClosed,
  HiLockOpen,
  HiCurrencyDollar,
  HiClipboardList,
  HiShoppingCart,
  HiGlobe,
  HiDocumentDuplicate,
  HiCheckCircle,
  HiClock,
  HiExclamation,
  HiArchive,
} from "react-icons/hi";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetCommandesQuery,
  useGetFournisseursCommandesQuery,
  useGetBateauxQuery,
  useGetEtatsCommandesQuery,
} from "../../slices/commandeApiSlice";
import "./AdminCommandesScreen.css";

// Clé pour le localStorage
const STORAGE_KEY_ENTREPRISE = "admin_commandes_selected_entreprise";

// Debounce hook
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

// Icônes et couleurs par défaut par état (fallback)
const ETAT_DEFAULTS = {
  0: { color: "muted", icon: HiDocumentText },
  1: { color: "info", icon: HiClock },
  2: { color: "muted", icon: HiDocumentText },
  3: { color: "warning", icon: HiExclamation },
  4: { color: "info", icon: HiTruck },
  5: { color: "success", icon: HiCheckCircle },
  6: { color: "warning", icon: HiGlobe },
  7: { color: "info", icon: HiTruck },
  8: { color: "info", icon: HiTruck },
  9: { color: "muted", icon: HiShoppingCart },
};

// Labels par défaut si pas d'entreprise chargée
const DEFAULT_ETAT_LABELS = {
  0: "Brouillon",
  1: "A Préparer",
  2: "Proforma",
  3: "Reliquat",
  4: "Envoyée",
  5: "Confirmée",
  6: "Transit",
  7: "Bateau",
  8: "Avion",
  9: "Commande locale",
};

const AdminCommandesScreen = () => {
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
    numcde: searchParams.get("numcde") || "",
    fourn: searchParams.get("fourn") || "",
    bateau: searchParams.get("bateau") || "",
    cdvise: searchParams.get("cdvise") || "",
    etat: searchParams.get("etat") || "TOUT",
    verrou: searchParams.get("verrou") || "TOUT",
    hasFacture: searchParams.get("hasFacture") || "TOUT",
    groupage: searchParams.get("groupage") || "TOUT",
    dateDebut: searchParams.get("dateDebut") || "",
    dateFin: searchParams.get("dateFin") || "",
  });

  const debouncedFilters = useDebounce(filters, 400);

  // États UI
  const [showFilters, setShowFilters] = useState(true);
  const [selectedCommande, setSelectedCommande] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    identification: true,
    logistique: true,
    statut: true,
    dates: false,
  });

  // Queries
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();

  const {
    data: commandesData,
    isLoading: loadingCommandes,
    error: commandesError,
    refetch,
    isFetching,
  } = useGetCommandesQuery(
    {
      nomDossierDBF: selectedEntreprise,
      page,
      limit,
      search: debouncedFilters.search || undefined,
      numcde: debouncedFilters.numcde || undefined,
      fourn: debouncedFilters.fourn || undefined,
      bateau: debouncedFilters.bateau || undefined,
      cdvise: debouncedFilters.cdvise || undefined,
      etat:
        debouncedFilters.etat !== "TOUT" ? debouncedFilters.etat : undefined,
      verrou: debouncedFilters.verrou,
      hasFacture: debouncedFilters.hasFacture,
      groupage: debouncedFilters.groupage,
      dateDebut: debouncedFilters.dateDebut || undefined,
      dateFin: debouncedFilters.dateFin || undefined,
    },
    { skip: !selectedEntreprise },
  );

  const { data: fournisseursData } = useGetFournisseursCommandesQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );

  const { data: bateauxData } = useGetBateauxQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
  });

  const { data: etatsData } = useGetEtatsCommandesQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
  });

  // Construire le mapping des états à partir de l'entreprise sélectionnée
  const etatLabelsMap = useMemo(() => {
    if (selectedEntrepriseData?.mappingEtatsCommande) {
      const mapping = selectedEntrepriseData.mappingEtatsCommande;
      const result = { ...DEFAULT_ETAT_LABELS };
      Object.keys(mapping).forEach((key) => {
        result[key] = mapping[key];
      });
      return result;
    }
    return DEFAULT_ETAT_LABELS;
  }, [selectedEntrepriseData]);

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
    if (filters.numcde) params.set("numcde", filters.numcde);
    if (filters.fourn) params.set("fourn", filters.fourn);
    if (filters.bateau) params.set("bateau", filters.bateau);
    if (filters.cdvise) params.set("cdvise", filters.cdvise);
    if (filters.etat !== "TOUT") params.set("etat", filters.etat);
    if (filters.verrou !== "TOUT") params.set("verrou", filters.verrou);
    if (filters.hasFacture !== "TOUT")
      params.set("hasFacture", filters.hasFacture);
    if (filters.groupage !== "TOUT") params.set("groupage", filters.groupage);
    if (filters.dateDebut) params.set("dateDebut", filters.dateDebut);
    if (filters.dateFin) params.set("dateFin", filters.dateFin);
    setSearchParams(params, { replace: true });
  }, [filters, page, setSearchParams]);

  // Les commandes viennent directement du serveur (déjà filtrées)
  const commandes = commandesData?.commandes || [];

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
      numcde: "",
      fourn: "",
      bateau: "",
      cdvise: "",
      etat: "TOUT",
      verrou: "TOUT",
      hasFacture: "TOUT",
      groupage: "TOUT",
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
        [
          "search",
          "numcde",
          "fourn",
          "bateau",
          "cdvise",
          "dateDebut",
          "dateFin",
        ].includes(key)
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
    const label = etatLabelsMap[etat] || `État ${etat}`;
    const defaults = ETAT_DEFAULTS[etat] || {
      color: "muted",
      icon: HiDocumentText,
    };

    return {
      label,
      color: defaults.color,
      icon: defaults.icon,
    };
  };

  if (loadingEntreprises) {
    return (
      <div className="admin-commandes-page">
        <div className="admin-loading-state">
          <div className="loading-spinner"></div>
          <p>Chargement des entreprises...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-commandes-page">
      {/* Header */}
      <header className="admin-commandes-header">
        <div className="header-left">
          <div className="header-icon commandes-icon">
            <HiClipboardList />
          </div>
          <div className="header-title">
            <h1>Gestion des Commandes</h1>
            <p className="header-subtitle">
              Consultation des commandes fournisseurs — entêtes et détails
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
            <HiClipboardList />
          </div>
          <h2>Sélectionnez une entreprise</h2>
          <p>Choisissez une entreprise pour consulter ses commandes</p>
        </div>
      ) : (
        <div className="admin-commandes-content">
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
                        placeholder="N° commande, observation, bateau..."
                        value={filters.search}
                        onChange={(e) =>
                          handleFilterChange("search", e.target.value)
                        }
                      />
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiDocumentText /> N° Commande
                      </label>
                      <input
                        type="text"
                        placeholder="Rechercher par numéro..."
                        value={filters.numcde}
                        onChange={(e) =>
                          handleFilterChange("numcde", e.target.value)
                        }
                      />
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiShoppingCart /> Fournisseur
                      </label>
                      <select
                        value={filters.fourn}
                        onChange={(e) =>
                          handleFilterChange("fourn", e.target.value)
                        }
                      >
                        <option value="">Tous les fournisseurs</option>
                        {fournisseursData?.fournisseurs?.map((f) => (
                          <option key={f.code} value={f.code}>
                            {f.code} ({f.count} cmd)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Section Logistique */}
              <div className="filter-section">
                <button
                  className="section-header"
                  onClick={() => toggleSection("logistique")}
                >
                  <span className="section-icon">🚢</span>
                  <span>Logistique</span>
                  {expandedSections.logistique ? (
                    <HiChevronUp />
                  ) : (
                    <HiChevronDown />
                  )}
                </button>
                {expandedSections.logistique && (
                  <div className="section-content">
                    <div className="filter-group">
                      <label>
                        <HiTruck /> Bateau
                      </label>
                      <select
                        value={filters.bateau}
                        onChange={(e) =>
                          handleFilterChange("bateau", e.target.value)
                        }
                      >
                        <option value="">Tous les bateaux</option>
                        {bateauxData?.bateaux?.map((b) => (
                          <option key={b.nom} value={b.nom}>
                            {b.nom} ({b.count})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiGlobe /> Devise
                      </label>
                      <input
                        type="text"
                        placeholder="Code devise (EUR, USD...)"
                        value={filters.cdvise}
                        onChange={(e) =>
                          handleFilterChange("cdvise", e.target.value)
                        }
                      />
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiDocumentDuplicate /> Groupage
                      </label>
                      <select
                        value={filters.groupage}
                        onChange={(e) =>
                          handleFilterChange("groupage", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous</option>
                        <option value="OUI">En groupage</option>
                        <option value="NON">Hors groupage</option>
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
                        {etatsData?.etats?.map((et) => (
                          <option key={et.code} value={et.code}>
                            {getEtatInfo(et.code).label} ({et.count})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiLockClosed /> Verrouillage
                      </label>
                      <select
                        value={filters.verrou}
                        onChange={(e) =>
                          handleFilterChange("verrou", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous</option>
                        <option value="OUI">Verrouillées</option>
                        <option value="NON">Non verrouillées</option>
                      </select>
                    </div>

                    <div className="filter-group">
                      <label>
                        <HiCurrencyDollar /> Facture
                      </label>
                      <select
                        value={filters.hasFacture}
                        onChange={(e) =>
                          handleFilterChange("hasFacture", e.target.value)
                        }
                      >
                        <option value="TOUT">Tous</option>
                        <option value="OUI">Facturées</option>
                        <option value="NON">Non facturées</option>
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
          <main className="commandes-main">
            {/* Stats Bar */}
            <div className="stats-bar">
              <div className="stat-item primary">
                <span className="stat-value">
                  {commandesData?.pagination?.totalRecords?.toLocaleString() ||
                    0}
                </span>
                <span className="stat-label">
                  {activeFiltersCount > 0
                    ? "Commandes filtrées"
                    : "Commandes"}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {fournisseursData?.totalFournisseurs || 0}
                </span>
                <span className="stat-label">Fournisseurs</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {commandesData?.pagination?.page || 1}/
                  {commandesData?.pagination?.totalPages || 1}
                </span>
                <span className="stat-label">Page</span>
              </div>
              {commandesData?._queryTime && (
                <div className="stat-item">
                  <span className="stat-value">
                    {commandesData._queryTime}
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
            <div className="commandes-table-container">
              {loadingCommandes || isFetching ? (
                <div className="table-loading">
                  <div className="loading-spinner"></div>
                  <p>Chargement des commandes...</p>
                </div>
              ) : commandesError ? (
                <div className="table-error">
                  <HiExclamation />
                  <p>
                    Erreur:{" "}
                    {commandesError?.data?.message ||
                      "Impossible de charger les commandes"}
                  </p>
                  <button onClick={refetch}>Réessayer</button>
                </div>
              ) : commandes.length === 0 ? (
                <div className="table-empty">
                  <HiClipboardList />
                  <h3>Aucune commande trouvée</h3>
                  <p>Modifiez vos filtres pour afficher des résultats</p>
                </div>
              ) : (
                <table className="commandes-table">
                  <thead>
                    <tr>
                      <th className="col-numcde">N° Cde</th>
                      <th className="col-fourn">Fourn.</th>
                      <th className="col-datcde">Date Cde</th>
                      <th className="col-bateau">Bateau</th>
                      <th className="col-arrivee">Arrivée</th>
                      <th className="col-observ">Observation</th>
                      <th className="col-etat">État</th>
                      <th className="col-lignes text-right">Lignes</th>
                      <th className="col-total text-right">Total (Détail)</th>
                      <th className="col-statuts">Statuts</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commandes.map((commande, index) => {
                      const etatInfo = getEtatInfo(commande.ETAT);
                      const isVerrouille =
                        safeTrim(commande.VERROU).toUpperCase() === "O";
                      const hasFacture =
                        safeTrim(commande.NUMFACT).length > 0;
                      const isGroupage =
                        safeTrim(commande.GROUPAGE).toUpperCase() === "O";
                      const EtatIcon = etatInfo.icon;

                      return (
                        <tr
                          key={`${commande.NUMCDE}-${index}`}
                          className={`row-etat-${etatInfo.color}`}
                        >
                          <td className="col-numcde">
                            <Link
                              to={`/admin/commandes/${selectedEntreprise}/${safeTrim(commande.NUMCDE)}`}
                              className="commande-numcde-link"
                            >
                              {safeTrim(commande.NUMCDE)}
                              <HiExternalLink className="link-icon" />
                            </Link>
                          </td>
                          <td className="col-fourn">
                            <span className="fourn-badge">
                              {commande.FOURN || "-"}
                            </span>
                          </td>
                          <td className="col-datcde">
                            <span className="date-value">
                              {formatDate(commande.DATCDE)}
                            </span>
                          </td>
                          <td className="col-bateau">
                            <span className="bateau-value">
                              {safeTrim(commande.BATEAU) || "-"}
                            </span>
                          </td>
                          <td className="col-arrivee">
                            <span className="date-value">
                              {formatDate(commande.ARRIVEE)}
                            </span>
                          </td>
                          <td className="col-observ">
                            <span
                              className="observ-text"
                              title={safeTrim(commande.OBSERV)}
                            >
                              {safeTrim(commande.OBSERV) || "-"}
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
                          <td className="col-lignes text-right">
                            <span className="lignes-value">
                              {commande.COMPTLIG || 0}
                            </span>
                          </td>
                          <td className="col-total text-right">
                            <span className="total-value">
                              {formatPrice(commande.TOTAL_DETAIL)}
                            </span>
                            {commande.TOTAL_DETAIL > 0 &&
                              commande.TOTPR > 0 &&
                              commande.TOTAL_DETAIL !== commande.TOTPR && (
                                <span
                                  className="total-entete"
                                  title={`Total entête (TOTPR): ${formatPrice(commande.TOTPR)}`}
                                >
                                  ({formatPrice(commande.TOTPR)})
                                </span>
                              )}
                          </td>
                          <td className="col-statuts">
                            <div className="badges-container">
                              {isVerrouille && (
                                <span
                                  className="badge badge-verrou"
                                  title="Verrouillée"
                                >
                                  <HiLockClosed />
                                </span>
                              )}
                              {hasFacture && (
                                <span
                                  className="badge badge-facture"
                                  title={`Facture: ${safeTrim(commande.NUMFACT)}`}
                                >
                                  <HiCurrencyDollar />
                                </span>
                              )}
                              {isGroupage && (
                                <span
                                  className="badge badge-groupage"
                                  title="Groupage"
                                >
                                  <HiDocumentDuplicate />
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="col-actions">
                            <div className="actions-group">
                              <button
                                className="btn-view"
                                onClick={() => setSelectedCommande(commande)}
                                title="Aperçu rapide"
                              >
                                <HiEye />
                              </button>
                              <Link
                                to={`/admin/commandes/${selectedEntreprise}/${safeTrim(commande.NUMCDE)}`}
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
            {commandesData?.pagination && (
              <div className="pagination-bar">
                <div className="pagination-info">
                  Affichage de{" "}
                  <strong>
                    {Math.min(
                      (commandesData.pagination.page - 1) * limit + 1,
                      commandesData.pagination.totalRecords,
                    )}
                  </strong>{" "}
                  à{" "}
                  <strong>
                    {Math.min(
                      commandesData.pagination.page * limit,
                      commandesData.pagination.totalRecords,
                    )}
                  </strong>{" "}
                  sur{" "}
                  <strong>
                    {commandesData.pagination.totalRecords.toLocaleString()}
                  </strong>{" "}
                  commandes
                </div>
                <div className="pagination-controls">
                  <button
                    className="btn-page"
                    disabled={!commandesData.pagination.hasPrevPage}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <HiChevronLeft />
                    <span>Précédent</span>
                  </button>
                  <div className="page-indicator">
                    <span className="current-page">
                      {commandesData.pagination.page}
                    </span>
                    <span className="page-separator">/</span>
                    <span className="total-pages">
                      {commandesData.pagination.totalPages}
                    </span>
                  </div>
                  <button
                    className="btn-page"
                    disabled={!commandesData.pagination.hasNextPage}
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

      {/* Modal Aperçu Commande */}
      {selectedCommande && (
        <div
          className="commande-modal-overlay"
          onClick={() => setSelectedCommande(null)}
        >
          <div
            className="commande-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title">
                <HiClipboardList />
                <div>
                  <h2>Aperçu commande</h2>
                  <span className="modal-numcde">
                    N° {safeTrim(selectedCommande.NUMCDE)}
                  </span>
                </div>
              </div>
              <div className="modal-header-actions">
                <Link
                  to={`/admin/commandes/${selectedEntreprise}/${safeTrim(selectedCommande.NUMCDE)}`}
                  className="btn-view-full"
                  title="Voir la fiche complète"
                >
                  <HiExternalLink />
                  <span>Fiche complète</span>
                </Link>
                <button
                  className="btn-close-modal"
                  onClick={() => setSelectedCommande(null)}
                >
                  <HiX />
                </button>
              </div>
            </div>

            <div className="modal-body">
              <div className="modal-info-section">
                {/* État et badges */}
                <div className="modal-status-row">
                  <span
                    className={`etat-badge etat-${getEtatInfo(selectedCommande.ETAT).color} large`}
                  >
                    {React.createElement(
                      getEtatInfo(selectedCommande.ETAT).icon,
                    )}
                    {getEtatInfo(selectedCommande.ETAT).label}
                  </span>
                  <div className="modal-badges">
                    {safeTrim(selectedCommande.VERROU).toUpperCase() ===
                      "O" && (
                      <span className="modal-badge verrou">
                        <HiLockClosed /> Verrouillée
                      </span>
                    )}
                    {safeTrim(selectedCommande.GROUPAGE).toUpperCase() ===
                      "O" && (
                      <span className="modal-badge groupage">
                        <HiDocumentDuplicate /> Groupage
                      </span>
                    )}
                  </div>
                </div>

                {/* Infos principales */}
                <div className="info-block">
                  <h4>📋 Informations générales</h4>
                  <div className="info-grid">
                    <div className="info-item">
                      <label>N° Commande</label>
                      <span className="value highlight">
                        {safeTrim(selectedCommande.NUMCDE)}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Fournisseur</label>
                      <span className="value">
                        {selectedCommande.FOURN || "-"}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Date commande</label>
                      <span className="value">
                        {formatDate(selectedCommande.DATCDE)}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Bateau</label>
                      <span className="value">
                        {safeTrim(selectedCommande.BATEAU) || "-"}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Date arrivée</label>
                      <span className="value">
                        {formatDate(selectedCommande.ARRIVEE)}
                      </span>
                    </div>
                    <div className="info-item">
                      <label>Nb lignes</label>
                      <span className="value">
                        {selectedCommande.COMPTLIG || 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Montants */}
                <div className="info-block">
                  <h4>💰 Montants</h4>
                  <div className="montants-grid">
                    <div className="montant-item main">
                      <label>Total (QTE × P.Achat)</label>
                      <span>{formatPrice(selectedCommande.TOTAL_DETAIL)}</span>
                    </div>
                    <div className="montant-item">
                      <label>Total produits (entête)</label>
                      <span>{formatPrice(selectedCommande.TOTPR)}</span>
                    </div>
                    <div className="montant-item">
                      <label>Taxes</label>
                      <span>{formatPrice(selectedCommande.TAXES)}</span>
                    </div>
                    <div className="montant-item">
                      <label>Fret</label>
                      <span>{formatPrice(selectedCommande.FRET)}</span>
                    </div>
                    <div className="montant-item">
                      <label>Fret transit</label>
                      <span>{formatPrice(selectedCommande.FRTRANSIT)}</span>
                    </div>
                    <div className="montant-item">
                      <label>Devise</label>
                      <span>
                        {selectedCommande.DVISE || "-"}{" "}
                        {safeTrim(selectedCommande.CDVISE) &&
                          `(${safeTrim(selectedCommande.CDVISE)})`}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Facture */}
                {safeTrim(selectedCommande.NUMFACT) && (
                  <div className="info-block">
                    <h4>🧾 Facturation</h4>
                    <div className="info-grid">
                      <div className="info-item">
                        <label>N° Facture</label>
                        <span className="value mono">
                          {safeTrim(selectedCommande.NUMFACT)}
                        </span>
                      </div>
                      <div className="info-item">
                        <label>Date facture</label>
                        <span className="value">
                          {formatDate(selectedCommande.DATFACT)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Observations */}
                {safeTrim(selectedCommande.OBSERV) && (
                  <div className="info-block observations-block">
                    <h4>📝 Observations</h4>
                    <p className="observations-text">
                      {safeTrim(selectedCommande.OBSERV)}
                    </p>
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

export default AdminCommandesScreen;