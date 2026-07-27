// src/screens/admin/AdminReservationsScreen.jsx
//
// Écran « Réservations » (groupe Données, sous Clients).
// Il lit les proformas DBF (proforma.dbf / prodet.dbf) dont l'ETAT <= 2 :
//   - ETAT = 2  -> commandes À PRÉPARER
//   - ETAT < 2  -> réservations et commandes spéciales
// Les libellés d'états proviennent de la config entreprise
// (mappingEtatsProforma), avec repli sur des valeurs par défaut.
// Le détail (lignes prodet + client) réutilise l'écran proforma existant
// (/admin/proformas/:nomDossierDBF/:numfact).
import React, { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  HiSearch,
  HiRefresh,
  HiChevronLeft,
  HiChevronRight,
  HiEye,
  HiExternalLink,
  HiDocumentText,
  HiCheckCircle,
  HiExclamation,
  HiUser,
  HiUserGroup,
  HiClipboardList,
  HiArrowRight,
  HiStar,
  HiBookmark,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import {
  useGetProformasQuery,
  useGetRepresentantsQuery,
} from "../../slices/proformaApiSlice";
import { useGetEntrepriseByDossierQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import "./AdminProformasScreen.css";
import "./AdminReservationsScreen.css";

// Debounce hook
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

// Catégories métier + habillage (couleur/icône). Le libellé affiché vient
// en priorité de la config entreprise (mappingEtatsProforma) ; ceci ne sert
// qu'à choisir la couleur, l'icône et un libellé de repli.
const CAT_CONFIG = {
  speciale: { color: "special", icon: HiStar, defLabel: "Commande spéciale" },
  reservation: { color: "reservation", icon: HiBookmark, defLabel: "Réservation" },
  preparer: { color: "preparer", icon: HiCheckCircle, defLabel: "À préparer" },
  autre: { color: "muted", icon: HiDocumentText, defLabel: "Autre" },
};

// Normalise une chaîne (minuscule, sans accents) pour tester des mots-clés.
const DIACRITICS = /[̀-ͯ]/g;
const normalize = (s) =>
  (s ?? "").toString().toLowerCase().normalize("NFD").replace(DIACRITICS, "");

// Vues métier de la page (filtrage par code d'état)
const TYPES = [
  { key: "TOUTES", label: "Toutes (≤ 2)" },
  { key: "RESERVATIONS", label: "Réservations" },
  { key: "SPECIALES", label: "Commandes spéciales" },
  { key: "A_PREPARER", label: "À préparer" },
];

const AdminReservationsScreen = () => {
  const navigate = useNavigate();

  // Société active : sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalDossier) || "";

  const [page, setPage] = useState(1);
  const [limit] = useState(50);

  // Filtre « type » (Toutes / À préparer / Réservations)
  const [typeFilter, setTypeFilter] = useState("TOUTES");

  // Filtres complémentaires
  const [filters, setFilters] = useState({
    search: "",
    tiers: "",
    repres: "",
  });
  const debouncedFilters = useDebounce(filters, 400);

  // Saisie directe d'un numéro de proforma
  const [numfactInput, setNumfactInput] = useState("");

  // Comptes internes (code client TIERS >= 9900) : masqués par défaut ;
  // le bouton bascule pour n'afficher QUE les internes.
  const [showInternes, setShowInternes] = useState(false);

  // Traduction du type en paramètres API. Codes d'état :
  //   0 = commande spéciale · 1 = réservation · 2 = à préparer.
  const etatParams = useMemo(() => {
    switch (typeFilter) {
      case "A_PREPARER":
        return { etat: 2, maxEtat: undefined };
      case "RESERVATIONS":
        return { etat: 1, maxEtat: undefined };
      case "SPECIALES":
        return { etat: 0, maxEtat: undefined };
      case "TOUTES":
      default:
        return { etat: undefined, maxEtat: 2 };
    }
  }, [typeFilter]);

  // Query proformas
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
      etat: etatParams.etat,
      maxEtat: etatParams.maxEtat,
      interne: showInternes ? "seulement" : "exclure",
    },
    { skip: !selectedEntreprise },
  );

  const { data: representantsData } = useGetRepresentantsQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );

  // Entreprise (pour les libellés d'états personnalisés)
  const { data: entrepriseData } = useGetEntrepriseByDossierQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );

  // Réinitialise filtres/pagination quand la société globale change.
  useEffect(() => {
    setFilters({ search: "", tiers: "", repres: "" });
    setTypeFilter("TOUTES");
    setNumfactInput("");
    setShowInternes(false);
    setPage(1);
  }, [selectedEntreprise]);

  const proformas = proformasData?.proformas || [];
  const etatLabels = proformasData?.etatLabels || {};

  // Table de correspondance code vendeur (REPRES) -> identité, depuis la fiche
  // entreprise (entreprise.vendeurs). Clé normalisée en entier ("05" -> "5")
  // pour coller au REPRES numérique de proforma.dbf.
  const vendeurByCode = useMemo(() => {
    const map = {};
    (entrepriseData?.vendeurs || []).forEach((v) => {
      const n = parseInt(v.code, 10);
      if (!isNaN(n)) map[String(n)] = v;
    });
    return map;
  }, [entrepriseData]);

  const getVendeur = (repres) => {
    if (repres === undefined || repres === null || repres === "") return null;
    const n = parseInt(repres, 10);
    if (isNaN(n)) return null;
    return vendeurByCode[String(n)] || null;
  };

  const vendeurLabel = (v) => {
    if (!v) return null;
    const full = `${(v.nom || "").trim()} ${(v.prenom || "").trim()}`.trim();
    return full || null;
  };

  // Handlers
  const handleFilterChange = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleTypeChange = (key) => {
    setTypeFilter(key);
    setPage(1);
  };

  const handleGoToNumfact = (e) => {
    e.preventDefault();
    const n = numfactInput.trim();
    if (!n || !selectedEntreprise) return;
    navigate(`/admin/proformas/${selectedEntreprise}/${n}`);
  };

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

  // Libellé d'état configuré sur l'entreprise (ou undefined).
  const getEtatLabel = (etat) =>
    etatLabels?.[etat] ?? entrepriseData?.mappingEtatsProforma?.[etat];

  // Catégorie métier d'une proforma, déduite d'abord du LIBELLÉ d'état
  // (config entreprise), puis par repli sur le CODE d'état :
  //   - « commande spéciale » / état 0  -> speciale
  //   - « réservation »        / état 1  -> reservation
  //   - « à préparer »         / état 2  -> preparer
  const getCategorie = (etat) => {
    const label = normalize(getEtatLabel(etat));
    if (label.includes("special")) return "speciale";
    if (label.includes("reserv")) return "reservation";
    if (label.includes("prepar")) return "preparer";
    const n = Number(etat);
    if (n === 0) return "speciale";
    if (n === 1) return "reservation";
    if (n === 2) return "preparer";
    return "autre";
  };

  // Habillage (libellé + couleur + icône) pour une proforma.
  const getEtatInfo = (etat) => {
    const cat = getCategorie(etat);
    const conf = CAT_CONFIG[cat] || CAT_CONFIG.autre;
    const label = getEtatLabel(etat) || conf.defLabel || `État ${etat}`;
    return { cat, label, color: conf.color, icon: conf.icon };
  };

  return (
    <div className="admin-proformas-page admin-reservations-page">
      {/* Header */}
      <header className="admin-proformas-header">
        <div className="header-left">
          <div className="header-icon reservations-icon">
            <HiClipboardList />
          </div>
          <div className="header-title">
            <h1>Réservations</h1>
            <p className="header-subtitle">
              Proformas à préparer (état = 2), réservations et commandes
              spéciales (état &lt; 2)
            </p>
          </div>
        </div>

        {/* Saisie directe d'un N° de proforma */}
        {selectedEntreprise && (
          <form className="numfact-jump" onSubmit={handleGoToNumfact}>
            <HiSearch className="numfact-jump-icon" />
            <input
              type="text"
              placeholder="N° de proforma…"
              value={numfactInput}
              onChange={(e) => setNumfactInput(e.target.value)}
            />
            <button type="submit" disabled={!numfactInput.trim()}>
              <span>Ouvrir</span>
              <HiArrowRight />
            </button>
          </form>
        )}
      </header>

      {!selectedEntreprise ? (
        <div className="empty-state">
          <div className="empty-icon">
            <HiClipboardList />
          </div>
          <h2>Sélectionnez une entreprise</h2>
          <p>
            Choisissez une entreprise dans l'en-tête pour consulter ses
            réservations
          </p>
        </div>
      ) : (
        <div className="admin-proformas-content">
          <main className="proformas-main">
            {/* Onglets de type + bascule internes */}
            <div className="reservations-tabs">
              {TYPES.map((t) => (
                <button
                  key={t.key}
                  className={`reservation-tab ${typeFilter === t.key ? "active" : ""}`}
                  onClick={() => handleTypeChange(t.key)}
                >
                  {t.label}
                </button>
              ))}
              <button
                className={`internes-toggle ${showInternes ? "active" : ""}`}
                onClick={() => {
                  setShowInternes((v) => !v);
                  setPage(1);
                }}
                title={
                  showInternes
                    ? "Afficher les clients externes"
                    : "Afficher uniquement les comptes internes (code ≥ 9900)"
                }
              >
                <HiUserGroup />
                <span>
                  {showInternes ? "Internes uniquement" : "Afficher internes"}
                </span>
              </button>
            </div>

            {/* Barre de filtres */}
            <div className="reservations-filters">
              <div className="res-filter-group grow">
                <HiSearch />
                <input
                  type="text"
                  placeholder="Recherche (n°, nom, texte)…"
                  value={filters.search}
                  onChange={(e) => handleFilterChange("search", e.target.value)}
                />
              </div>
              <div className="res-filter-group">
                <HiUser />
                <input
                  type="text"
                  placeholder="Code tiers…"
                  value={filters.tiers}
                  onChange={(e) => handleFilterChange("tiers", e.target.value)}
                />
              </div>
              <div className="res-filter-group">
                <HiUserGroup />
                <select
                  value={filters.repres}
                  onChange={(e) => handleFilterChange("repres", e.target.value)}
                >
                  <option value="">Tous les représentants</option>
                  {representantsData?.representants?.map((r) => {
                    const name = vendeurLabel(getVendeur(r.code));
                    return (
                      <option key={r.code} value={r.code}>
                        {name
                          ? `${name} (${r.count})`
                          : `Rep. ${r.code} (${r.count})`}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {/* Stats Bar */}
            <div className="stats-bar">
              <div className="stat-item primary">
                <span className="stat-value">
                  {proformasData?.pagination?.totalRecords?.toLocaleString() ||
                    0}
                </span>
                <span className="stat-label">Réservations</span>
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
                  <span className="stat-value">{proformasData._queryTime}</span>
                  <span className="stat-label">Temps</span>
                </div>
              )}
              <div className="stats-actions">
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

            {/* Légende des couleurs de ligne */}
            <div className="reservations-legend">
              <span className="legend-item">
                <span className="legend-swatch swatch-reservation" />
                Réservation
              </span>
              <span className="legend-item">
                <span className="legend-swatch swatch-speciale" />
                Commande spéciale
              </span>
              <span className="legend-item">
                <span className="legend-swatch swatch-preparer" />
                À préparer
              </span>
            </div>

            {/* Table */}
            <div className="proformas-table-container">
              {loadingProformas || isFetching ? (
                <div className="table-loading">
                  <div className="loading-spinner"></div>
                  <p>Chargement des réservations...</p>
                </div>
              ) : proformasError ? (
                <div className="table-error">
                  <HiExclamation />
                  <p>
                    Erreur:{" "}
                    {proformasError?.data?.message ||
                      "Impossible de charger les réservations"}
                  </p>
                  <button onClick={refetch}>Réessayer</button>
                </div>
              ) : proformas.length === 0 ? (
                <div className="table-empty">
                  <HiClipboardList />
                  <h3>Aucune réservation trouvée</h3>
                  <p>Modifiez vos filtres pour afficher des résultats</p>
                </div>
              ) : (
                <table className="proformas-table">
                  <thead>
                    <tr>
                      <th className="col-numfact">N° Proforma</th>
                      <th className="col-datfact">Date</th>
                      <th className="col-tiers">Tiers</th>
                      <th className="col-nom">Client</th>
                      <th className="col-texte">Texte / Objet</th>
                      <th className="col-repres">Représentant</th>
                      <th className="col-montant text-right">Montant</th>
                      <th className="col-etat">État</th>
                      <th className="col-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proformas.map((proforma, index) => {
                      const etatInfo = getEtatInfo(proforma.ETAT);
                      const EtatIcon = etatInfo.icon;
                      const numfact = safeTrim(proforma.NUMFACT);

                      return (
                        <tr
                          key={`${numfact}-${index}`}
                          className={`row-cat-${etatInfo.cat}`}
                        >
                          <td className="col-numfact">
                            <Link
                              to={`/admin/proformas/${selectedEntreprise}/${numfact}`}
                              className="proforma-numfact-link"
                            >
                              {numfact}
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
                            {(() => {
                              const v = getVendeur(proforma.REPRES);
                              const name = vendeurLabel(v);
                              if (name) {
                                return (
                                  <span
                                    className="repres-name"
                                    title={v.email || name}
                                  >
                                    {name}
                                  </span>
                                );
                              }
                              return (
                                <span className="repres-badge">
                                  {proforma.REPRES || "-"}
                                </span>
                              );
                            })()}
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
                          <td className="col-actions">
                            <Link
                              to={`/admin/proformas/${selectedEntreprise}/${numfact}`}
                              className="btn-view btn-detail"
                              title="Voir le détail"
                            >
                              <HiEye />
                            </Link>
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
                  réservations
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
    </div>
  );
};

export default AdminReservationsScreen;
