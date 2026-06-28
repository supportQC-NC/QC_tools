
// src/screens/admin/AdminCommandeDetailScreen.jsx
import React, { useState, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import {
  HiArrowLeft,
  HiChevronLeft,
  HiChevronRight,
  HiClipboardList,
  HiDocumentText,
  HiTruck,
  HiCalendar,
  HiLockClosed,
  HiLockOpen,
  HiCurrencyDollar,
  HiShoppingCart,
  HiGlobe,
  HiDocumentDuplicate,
  HiCheckCircle,
  HiClock,
  HiExclamation,
  HiArchive,
  HiRefresh,
  HiSearch,
  HiCheck,
  HiX,
  HiExternalLink,
  HiEye,
} from "react-icons/hi";
import {
  useGetCommandeByNumcdeQuery,
  useGetAdjacentCommandesQuery,
} from "../../slices/commandeApiSlice";
import { useGetEntrepriseByDossierQuery } from "../../slices/entrepriseApiSlice";
import "./AdminCommandeDetailsScreen.css";

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

const AdminCommandeDetailScreen = () => {
  const { nomDossierDBF, numcde } = useParams();
  const navigate = useNavigate();

  // State pour la recherche dans les lignes
  const [searchLignes, setSearchLignes] = useState("");
  const [filterPointe, setFilterPointe] = useState("TOUT"); // TOUT, OUI, NON

  // Queries
  const {
    data: commandeData,
    isLoading,
    error,
    refetch,
  } = useGetCommandeByNumcdeQuery(
    { nomDossierDBF, numcde },
    { skip: !nomDossierDBF || !numcde },
  );

  const { data: adjacentData } = useGetAdjacentCommandesQuery(
    { nomDossierDBF, numcde },
    { skip: !nomDossierDBF || !numcde },
  );

  // Récupération de l'entreprise pour le mapping des états
  const { data: entreprise } = useGetEntrepriseByDossierQuery(nomDossierDBF, {
    skip: !nomDossierDBF,
  });

  // Données
  const commande = commandeData?.commande;
  const details = commandeData?.details;
  const lignes = details?.lignes || [];
  const totaux = details?.totaux || {};

  // Construire le mapping des états à partir de l'entreprise
  const etatLabelsMap = useMemo(() => {
    if (entreprise?.mappingEtatsCommande) {
      const mapping = entreprise.mappingEtatsCommande;
      // mappingEtatsCommande peut être un objet simple ou un Map sérialisé
      const result = { ...DEFAULT_ETAT_LABELS };
      Object.keys(mapping).forEach((key) => {
        result[key] = mapping[key];
      });
      return result;
    }
    return DEFAULT_ETAT_LABELS;
  }, [entreprise]);

  // Filtrage local des lignes
  const filteredLignes = useMemo(() => {
    let result = [...lignes];

    if (searchLignes) {
      const searchLower = searchLignes.toLowerCase();
      result = result.filter(
        (l) =>
          (l.NART && l.NART.trim().toLowerCase().includes(searchLower)) ||
          (l.DESIGN && l.DESIGN.trim().toLowerCase().includes(searchLower)) ||
          (l.REFER && l.REFER.trim().toLowerCase().includes(searchLower)),
      );
    }

    if (filterPointe === "OUI") {
      result = result.filter(
        (l) => l.POINTE && l.POINTE.trim().toUpperCase() === "O",
      );
    } else if (filterPointe === "NON") {
      result = result.filter(
        (l) => !l.POINTE || l.POINTE.trim().toUpperCase() !== "O",
      );
    }

    return result;
  }, [lignes, searchLignes, filterPointe]);

  // Helpers
  const safeTrim = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    return String(value);
  };

  const formatPrice = (price) => {
    if (!price && price !== 0) return "-";
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "XPF",
      minimumFractionDigits: 0,
    }).format(price);
  };

  const formatNumber = (num, decimals = 2) => {
    if (num === null || num === undefined) return "-";
    const n = parseFloat(num);
    if (isNaN(n)) return "-";
    return n.toLocaleString("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const formatDate = (dateValue) => {
    if (!dateValue) return "-";
    if (dateValue instanceof Date) {
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

  // Navigation
  const handleNavigate = (targetNumcde) => {
    if (targetNumcde) {
      navigate(`/admin/commandes/${nomDossierDBF}/${targetNumcde}`);
    }
  };

  // Loading
  if (isLoading) {
    return (
      <div className="commande-detail-page">
        <div className="detail-loading">
          <div className="loading-spinner"></div>
          <p>Chargement de la commande...</p>
        </div>
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="commande-detail-page">
        <div className="detail-error">
          <HiExclamation />
          <h2>Erreur</h2>
          <p>{error?.data?.message || "Impossible de charger la commande"}</p>
          <div className="error-actions">
            <button onClick={refetch} className="btn-retry">
              <HiRefresh /> Réessayer
            </button>
            <Link
              to={`/admin/commandes/${nomDossierDBF}`}
              className="btn-back"
            >
              <HiArrowLeft /> Retour aux commandes
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!commande) return null;

  const etatInfo = getEtatInfo(commande.ETAT);
  const EtatIcon = etatInfo.icon;
  const isVerrouille = safeTrim(commande.VERROU).toUpperCase() === "O";
  const hasFacture = safeTrim(commande.NUMFACT).length > 0;
  const isGroupage = safeTrim(commande.GROUPAGE).toUpperCase() === "O";

  return (
    <div className="commande-detail-page">
      {/* Top Bar - Navigation */}
      <div className="detail-topbar">
        <Link
          to={`/admin/commandes/${nomDossierDBF}`}
          className="btn-back-list"
        >
          <HiArrowLeft />
          <span>Commandes</span>
        </Link>

        <div className="topbar-nav">
          <button
            className="btn-nav"
            disabled={!adjacentData?.previous}
            onClick={() => handleNavigate(adjacentData?.previous?.NUMCDE)}
            title="Commande précédente"
          >
            <HiChevronLeft />
          </button>
          <span className="nav-current">
            <HiClipboardList />
            N° {safeTrim(commande.NUMCDE)}
          </span>
          <button
            className="btn-nav"
            disabled={!adjacentData?.next}
            onClick={() => handleNavigate(adjacentData?.next?.NUMCDE)}
            title="Commande suivante"
          >
            <HiChevronRight />
          </button>
        </div>

        <div className="topbar-meta">
          {commandeData?._queryTime && (
            <span className="query-time">{commandeData._queryTime}</span>
          )}
          <button className="btn-refresh" onClick={refetch} title="Rafraîchir">
            <HiRefresh />
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="detail-content">
        {/* Header Card */}
        <div className="detail-header-card">
          <div className="header-card-top">
            <div className="header-card-title">
              <div className="numcde-display">
                <span className="numcde-label">Commande</span>
                <span className="numcde-value">
                  {safeTrim(commande.NUMCDE)}
                </span>
              </div>
              <span className={`etat-badge etat-${etatInfo.color} large`}>
                <EtatIcon />
                {etatInfo.label}
              </span>
            </div>

            <div className="header-badges">
              {isVerrouille ? (
                <span className="detail-badge verrou">
                  <HiLockClosed /> Verrouillée
                </span>
              ) : (
                <span className="detail-badge unlocked">
                  <HiLockOpen /> Non verrouillée
                </span>
              )}
              {isGroupage && (
                <span className="detail-badge groupage">
                  <HiDocumentDuplicate /> Groupage
                </span>
              )}
              {hasFacture && (
                <span className="detail-badge facture">
                  <HiCurrencyDollar /> Facturée
                </span>
              )}
            </div>
          </div>

          {/* Info Grid */}
          <div className="header-info-grid">
            <div className="info-card">
              <div className="info-card-icon">
                <HiShoppingCart />
              </div>
              <div className="info-card-content">
                <label>Fournisseur</label>
                <span>{commande.FOURN || "-"}</span>
              </div>
            </div>

            <div className="info-card">
              <div className="info-card-icon">
                <HiCalendar />
              </div>
              <div className="info-card-content">
                <label>Date commande</label>
                <span>{formatDate(commande.DATCDE)}</span>
              </div>
            </div>

            <div className="info-card">
              <div className="info-card-icon">
                <HiTruck />
              </div>
              <div className="info-card-content">
                <label>Bateau</label>
                <span>{safeTrim(commande.BATEAU) || "-"}</span>
              </div>
            </div>

            <div className="info-card">
              <div className="info-card-icon">
                <HiCalendar />
              </div>
              <div className="info-card-content">
                <label>Arrivée prévue</label>
                <span>{formatDate(commande.ARRIVEE)}</span>
              </div>
            </div>

            <div className="info-card">
              <div className="info-card-icon">
                <HiGlobe />
              </div>
              <div className="info-card-content">
                <label>Devise</label>
                <span>
                  {commande.DVISE || "-"}{" "}
                  {safeTrim(commande.CDVISE) &&
                    `(${safeTrim(commande.CDVISE)})`}
                </span>
              </div>
            </div>

            <div className="info-card">
              <div className="info-card-icon">
                <HiClipboardList />
              </div>
              <div className="info-card-content">
                <label>Nb lignes</label>
                <span>{commande.COMPTLIG || details?.totalLignes || 0}</span>
              </div>
            </div>
          </div>

          {/* Observations */}
          {safeTrim(commande.OBSERV) && (
            <div className="header-observ">
              <span className="observ-label">📝 Observations</span>
              <p>{safeTrim(commande.OBSERV)}</p>
            </div>
          )}
        </div>

        {/* Montants Summary Cards */}
        <div className="montants-cards">
          <div className="montant-card main">
            <span className="montant-label">Total Produits</span>
            <span className="montant-value">
              {formatPrice(commande.TOTPR)}
            </span>
          </div>
          <div className="montant-card">
            <span className="montant-label">Taxes</span>
            <span className="montant-value">
              {formatPrice(commande.TAXES)}
            </span>
          </div>
          <div className="montant-card">
            <span className="montant-label">Fret</span>
            <span className="montant-value">
              {formatPrice(commande.FRET)}
            </span>
          </div>
          <div className="montant-card">
            <span className="montant-label">Fret Transit</span>
            <span className="montant-value">
              {formatPrice(commande.FRTRANSIT)}
            </span>
          </div>
          {/* Totaux calculés depuis les détails */}
          {totaux.totalMontant > 0 && (
            <div className="montant-card calculated">
              <span className="montant-label">Total Montant (détails)</span>
              <span className="montant-value">
                {formatPrice(totaux.totalMontant)}
              </span>
            </div>
          )}
        </div>

        {/* Facture Section */}
        {hasFacture && (
          <div className="facture-card">
            <h3>🧾 Facturation</h3>
            <div className="facture-grid">
              <div className="facture-item">
                <label>N° Facture</label>
                <span className="facture-value">
                  {safeTrim(commande.NUMFACT)}
                </span>
              </div>
              <div className="facture-item">
                <label>Date Facture</label>
                <span>{formatDate(commande.DATFACT)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Notes Section */}
        {(safeTrim(commande.NOT1) ||
          safeTrim(commande.NOT2) ||
          safeTrim(commande.NOT3)) && (
          <div className="notes-card">
            <h3>📄 Notes</h3>
            <div className="notes-list">
              {[...Array(10)].map((_, i) => {
                const noteKey = `NOT${i + 1}`;
                const noteVal = safeTrim(commande[noteKey]);
                return noteVal ? (
                  <p key={noteKey} className="note-line">
                    {noteVal}
                  </p>
                ) : null;
              })}
            </div>
          </div>
        )}

        {/* Detail Lines Section */}
        <div className="detail-lines-section">
          <div className="lines-header">
            <h2>
              <HiDocumentText />
              Lignes de commande
              <span className="lines-count">{lignes.length} lignes</span>
            </h2>

            <div className="lines-controls">
              <div className="lines-search">
                <HiSearch />
                <input
                  type="text"
                  placeholder="Rechercher article, désignation..."
                  value={searchLignes}
                  onChange={(e) => setSearchLignes(e.target.value)}
                />
                {searchLignes && (
                  <button
                    className="btn-clear-search"
                    onClick={() => setSearchLignes("")}
                  >
                    <HiX />
                  </button>
                )}
              </div>

              <select
                className="lines-filter-pointe"
                value={filterPointe}
                onChange={(e) => setFilterPointe(e.target.value)}
              >
                <option value="TOUT">Toutes les lignes</option>
                <option value="OUI">Pointées</option>
                <option value="NON">Non pointées</option>
              </select>
            </div>
          </div>

          {/* Résumé lignes */}
          <div className="lines-summary">
            <div className="summary-item">
              <label>Total Qté</label>
              <span>{formatNumber(totaux.totalQte)}</span>
            </div>
            <div className="summary-item">
              <label>Total Rentrée</label>
              <span>{formatNumber(totaux.totalRentre)}</span>
            </div>
            <div className="summary-item">
              <label>Total Montant</label>
              <span className="highlight">
                {formatPrice(totaux.totalMontant)}
              </span>
            </div>
            <div className="summary-item">
              <label>Total Fret</label>
              <span>{formatPrice(totaux.totalFret)}</span>
            </div>
            <div className="summary-item">
              <label>Total Taxes</label>
              <span>{formatPrice(totaux.totalTaxes)}</span>
            </div>
          </div>

          {/* Lines Table */}
          <div className="lines-table-container">
            {filteredLignes.length === 0 ? (
              <div className="table-empty">
                <HiDocumentText />
                <h3>Aucune ligne trouvée</h3>
                <p>
                  {searchLignes || filterPointe !== "TOUT"
                    ? "Modifiez vos filtres"
                    : "Cette commande ne contient aucune ligne"}
                </p>
              </div>
            ) : (
              <table className="lines-table">
                <thead>
                  <tr>
                    <th className="col-nl">#</th>
                    <th className="col-pointe">Pté</th>
                    <th className="col-nart">Code Art.</th>
                    <th className="col-design">Désignation</th>
                    <th className="col-refer">Réf. Fourn.</th>
                    <th className="col-qte text-right">Qté</th>
                    <th className="col-rentre text-right">Rentrée</th>
                    <th className="col-pachat text-right">P. Achat</th>
                    <th className="col-montant text-right">Montant</th>
                    <th className="col-fret text-right">Fret</th>
                    <th className="col-taxes text-right">Taxes</th>
                    <th className="col-pcaf text-right">P. CAF</th>
                    <th className="col-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLignes.map((ligne, index) => {
                    const isPointe =
                      ligne.POINTE &&
                      ligne.POINTE.trim().toUpperCase() === "O";
                    const qte = parseFloat(ligne.QTE) || 0;
                    const rentre = parseFloat(ligne.RENTRE) || 0;
                    const receptionComplete = qte > 0 && rentre >= qte;
                    const receptionPartielle =
                      qte > 0 && rentre > 0 && rentre < qte;

                    return (
                      <tr
                        key={`${ligne.IDLIGN || index}`}
                        className={`
                          ${isPointe ? "row-pointe" : ""}
                          ${receptionComplete ? "row-complete" : ""}
                          ${receptionPartielle ? "row-partielle" : ""}
                        `}
                      >
                        <td className="col-nl">
                          <span className="nl-value">
                            {ligne.NL || index + 1}
                          </span>
                        </td>
                        <td className="col-pointe">
                          {isPointe ? (
                            <span className="pointe-yes" title="Pointée">
                              <HiCheck />
                            </span>
                          ) : (
                            <span className="pointe-no" title="Non pointée">
                              <HiX />
                            </span>
                          )}
                        </td>
                        <td className="col-nart">
                          <Link
                            to={`/admin/articles/${nomDossierDBF}/${safeTrim(ligne.NART)}`}
                            className="nart-link"
                            title="Voir l'article"
                          >
                            {safeTrim(ligne.NART)}
                            <HiExternalLink className="link-icon" />
                          </Link>
                        </td>
                        <td className="col-design">
                          <span className="design-text">
                            {safeTrim(ligne.DESIGN) || "-"}
                          </span>
                        </td>
                        <td className="col-refer">
                          <span className="refer-text">
                            {safeTrim(ligne.REFER) || "-"}
                          </span>
                        </td>
                        <td className="col-qte text-right">
                          <span className="qte-value">
                            {formatNumber(ligne.QTE)}
                          </span>
                        </td>
                        <td className="col-rentre text-right">
                          <span
                            className={`rentre-value ${
                              receptionComplete
                                ? "complete"
                                : receptionPartielle
                                  ? "partielle"
                                  : ""
                            }`}
                          >
                            {formatNumber(ligne.RENTRE)}
                          </span>
                        </td>
                        <td className="col-pachat text-right">
                          {formatNumber(ligne.PACHAT, 3)}
                        </td>
                        <td className="col-montant text-right">
                          <span className="montant-cell">
                            {formatPrice(ligne.MONTANT)}
                          </span>
                        </td>
                        <td className="col-fret text-right">
                          {formatNumber(ligne.FRET, 3)}
                        </td>
                        <td className="col-taxes text-right">
                          {formatNumber(ligne.TAXES, 3)}
                        </td>
                        <td className="col-pcaf text-right">
                          {formatNumber(ligne.PCAF, 3)}
                        </td>
                        <td className="col-actions">
                          <Link
                            to={`/admin/articles/${nomDossierDBF}/${safeTrim(ligne.NART)}`}
                            className="btn-view-article"
                            title="Voir l'article"
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
        </div>
      </div>
    </div>
  );
};

export default AdminCommandeDetailScreen;