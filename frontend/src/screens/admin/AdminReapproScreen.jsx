// src/screens/admin/AdminReapprosScreen.jsx
import React, { useState } from "react";
import {
  HiTruck,
  HiSearch,
  HiRefresh,
  HiDownload,
  HiEye,
  HiX,
  HiOfficeBuilding,
  HiCalendar,
  HiUser,
  HiCube,
  HiServer,
  HiShoppingCart,
} from "react-icons/hi";
import {
  useGetHistoriqueReapproQuery,
  useDownloadReapproMutation,
  useExportReapproMutation,
} from "../../slices/reapproApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import "./AdminReapproScreen.css";

const AdminReapprosScreen = () => {
  const [search, setSearch] = useState("");
  const [filterEntreprise, setFilterEntreprise] = useState("");
  const [selectedReappro, setSelectedReappro] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exportPath, setExportPath] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingId, setExportingId] = useState(null);

  const {
    data: reappros,
    isLoading,
    error,
    refetch,
  } = useGetHistoriqueReapproQuery(filterEntreprise || undefined);

  const { data: entreprises } = useGetMyEntreprisesQuery();
  const [downloadReappro, { isLoading: downloading }] =
    useDownloadReapproMutation();
  const [exportReappro, { isLoading: exporting }] = useExportReapproMutation();

  // Filtrer les réappros
  const filteredReappros = reappros?.filter((reappro) => {
    const searchLower = search.toLowerCase();
    const matchSearch =
      reappro.nom?.toLowerCase().includes(searchLower) ||
      reappro.entreprise?.trigramme?.toLowerCase().includes(searchLower) ||
      reappro.entreprise?.nomComplet?.toLowerCase().includes(searchLower) ||
      reappro.createdBy?.name?.toLowerCase().includes(searchLower);

    return matchSearch;
  });

  const handleViewDetails = (reappro) => {
    setSelectedReappro(reappro);
    setDetailsOpen(true);
  };

  const handleCloseDetails = () => {
    setDetailsOpen(false);
    setSelectedReappro(null);
  };

  const handleDownload = async (reappro) => {
    try {
      const content = await downloadReappro({
        reapproId: reappro._id,
        nomReappro: reappro.nom || "Reappro",
      }).unwrap();

      const dateStr = new Date(reappro.createdAt)
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "");
      const entrepriseNom = reappro.entreprise?.trigramme || "ENT";
      const nomFichier = `REAPPRO_${entrepriseNom}_${dateStr}.DAT`;

      const blob = new Blob([content], { type: "text/plain" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = nomFichier;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err?.data?.message || "Erreur lors du téléchargement");
    }
  };

  const handleOpenExportModal = (reappro) => {
    setExportingId(reappro._id);
    setExportPath(reappro.entreprise?.cheminExport || "");
    setShowExportModal(true);
  };

  const handleExportToServer = async () => {
    if (!exportPath.trim()) {
      alert("Veuillez saisir un chemin de destination");
      return;
    }

    const reappro = reappros?.find((r) => r._id === exportingId);
    if (!reappro) return;

    try {
      await exportReappro({
        reapproId: reappro._id,
        nomReappro: reappro.nom || "Reappro",
        cheminDestination: exportPath.trim(),
      }).unwrap();

      alert("Fichier exporté avec succès sur le serveur !");
      setShowExportModal(false);
      setExportPath("");
      setExportingId(null);
    } catch (err) {
      alert(err?.data?.message || "Erreur lors de l'export");
    }
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "termine":
        return <span className="badge status-termine">Terminé</span>;
      case "en_cours":
        return <span className="badge status-en-cours">En cours</span>;
      default:
        return <span className="badge status-autre">{status}</span>;
    }
  };

  // Statistiques
  const stats = {
    total: reappros?.length || 0,
    termines: reappros?.filter((r) => r.status === "termine").length || 0,
    enCours: reappros?.filter((r) => r.status === "en_cours").length || 0,
    totalLignes:
      reappros?.reduce((acc, r) => acc + (r.lignes?.length || 0), 0) || 0,
    totalQuantite:
      reappros?.reduce(
        (acc, r) =>
          acc + (r.lignes?.reduce((sum, l) => sum + (l.quantite || 0), 0) || 0),
        0,
      ) || 0,
  };

  if (isLoading) {
    return <div className="admin-loading">Chargement...</div>;
  }

  if (error) {
    return <div className="admin-error">Erreur: {error?.data?.message}</div>;
  }

  return (
    <div className="admin-reappros">
      <div className="admin-reappros-header">
        <h1>
          <HiTruck /> Historique des Réappros
        </h1>
        <div className="admin-reappros-actions">
          <div className="search-box">
            <HiSearch />
            <input
              type="text"
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
            value={filterEntreprise}
            onChange={(e) => setFilterEntreprise(e.target.value)}
          >
            <option value="">Toutes les entreprises</option>
            {entreprises?.map((e) => (
              <option key={e._id} value={e._id}>
                {e.trigramme} - {e.nomComplet}
              </option>
            ))}
          </select>
          <button className="btn-icon" onClick={refetch} title="Rafraîchir">
            <HiRefresh />
          </button>
        </div>
      </div>

      <div className="admin-reappros-stats">
        <div className="stat-card">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.termines}</span>
          <span className="stat-label">Terminés</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.enCours}</span>
          <span className="stat-label">En cours</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.totalLignes}</span>
          <span className="stat-label">Articles</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.totalQuantite}</span>
          <span className="stat-label">Qté totale</span>
        </div>
      </div>

      <div className="admin-reappros-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Réappro</th>
              <th>Entreprise</th>
              <th>Articles</th>
              <th>Quantité</th>
              <th>Statut</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredReappros?.length === 0 ? (
              <tr>
                <td colSpan="7" className="no-data">
                  Aucun réappro trouvé
                </td>
              </tr>
            ) : (
              filteredReappros?.map((reappro) => (
                <tr key={reappro._id}>
                  <td>
                    <div className="reappro-info">
                      <span className="reappro-avatar">
                        <HiTruck />
                      </span>
                      <div className="reappro-details">
                        <span className="reappro-name">
                          {reappro.nom || "Sans nom"}
                        </span>
                        {reappro.createdBy && (
                          <span className="reappro-user">
                            <HiUser /> {reappro.createdBy.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="entreprise-cell">
                      <HiOfficeBuilding />
                      <span>{reappro.entreprise?.trigramme}</span>
                    </div>
                  </td>
                  <td>
                    <div className="articles-cell">
                      <HiCube />
                      <span className="articles-count">
                        {reappro.lignes?.length || 0}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="quantite-total-cell">
                      <HiShoppingCart />
                      <span>
                        {reappro.lignes?.reduce(
                          (sum, l) => sum + (l.quantite || 0),
                          0,
                        ) || 0}
                      </span>
                    </div>
                  </td>
                  <td>{getStatusBadge(reappro.status)}</td>
                  <td className="date-cell">
                    <div className="date-info">
                      <HiCalendar />
                      <span>{formatDate(reappro.createdAt)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="btn-action btn-view"
                        onClick={() => handleViewDetails(reappro)}
                        title="Voir détails"
                      >
                        <HiEye />
                      </button>
                      <button
                        className="btn-action btn-download"
                        onClick={() => handleDownload(reappro)}
                        disabled={downloading}
                        title="Télécharger .DAT"
                      >
                        <HiDownload />
                      </button>
                      <button
                        className="btn-action btn-export"
                        onClick={() => handleOpenExportModal(reappro)}
                        disabled={exporting}
                        title="Exporter sur serveur"
                      >
                        <HiServer />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Détails */}
      {detailsOpen && selectedReappro && (
        <div className="modal-backdrop" onClick={handleCloseDetails}>
          <div
            className="modal-box details-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>
                <HiTruck /> Détails du réappro
              </h2>
              <button className="btn-close-modal" onClick={handleCloseDetails}>
                <HiX />
              </button>
            </div>

            <div className="modal-content">
              <div className="details-section">
                <h3>Informations</h3>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">Nom</span>
                    <span className="detail-value">
                      {selectedReappro.nom || "Sans nom"}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Entreprise</span>
                    <span className="detail-value">
                      {selectedReappro.entreprise?.trigramme} -{" "}
                      {selectedReappro.entreprise?.nomComplet}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Créé par</span>
                    <span className="detail-value">
                      {selectedReappro.createdBy?.name || "Inconnu"}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Date création</span>
                    <span className="detail-value">
                      {formatDate(selectedReappro.createdAt)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Statut</span>
                    {getStatusBadge(selectedReappro.status)}
                  </div>
                </div>
              </div>

              <div className="details-section">
                <h3>Statistiques</h3>
                <div className="stats-grid-small">
                  <div className="stat-box">
                    <span className="stat-number">
                      {selectedReappro.lignes?.length || 0}
                    </span>
                    <span className="stat-text">Articles</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-number">
                      {selectedReappro.lignes?.reduce(
                        (acc, l) => acc + (l.quantite || 0),
                        0,
                      ) || 0}
                    </span>
                    <span className="stat-text">Quantité totale</span>
                  </div>
                </div>
              </div>

              <div className="details-section">
                <h3>Articles ({selectedReappro.lignes?.length || 0})</h3>
                <div className="lignes-table-container">
                  {selectedReappro.lignes?.length === 0 ? (
                    <div className="no-lignes-msg">Aucun article</div>
                  ) : (
                    <table className="lignes-table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Désignation</th>
                          <th>Stock actuel</th>
                          <th>Quantité</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedReappro.lignes?.map((ligne, index) => (
                          <tr key={ligne._id || index}>
                            <td className="code-cell">{ligne.nart}</td>
                            <td className="designation-cell">
                              {ligne.designation}
                            </td>
                            <td className="stock-cell">
                              {ligne.stockActuel ?? "-"}
                            </td>
                            <td className="quantite-cell">{ligne.quantite}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn-primary btn-download-modal"
                onClick={() => handleDownload(selectedReappro)}
                disabled={downloading}
              >
                <HiDownload /> {downloading ? "..." : "Télécharger .DAT"}
              </button>
              <button
                className="btn-primary btn-export-modal"
                onClick={() => {
                  handleCloseDetails();
                  handleOpenExportModal(selectedReappro);
                }}
              >
                <HiServer /> Exporter sur serveur
              </button>
              <button className="btn-secondary" onClick={handleCloseDetails}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Export Serveur */}
      {showExportModal && (
        <div
          className="modal-backdrop"
          onClick={() => setShowExportModal(false)}
        >
          <div
            className="modal-box export-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>
                <HiServer /> Exporter sur le serveur
              </h2>
              <button
                className="btn-close-modal"
                onClick={() => setShowExportModal(false)}
              >
                <HiX />
              </button>
            </div>

            <div className="modal-content">
              <div className="export-field">
                <label>Chemin de destination</label>
                <input
                  type="text"
                  value={exportPath}
                  onChange={(e) => setExportPath(e.target.value)}
                  placeholder="Ex: /chemin/vers/dossier/"
                />
                <small>
                  Le fichier .DAT sera créé dans ce répertoire sur le serveur
                </small>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn-primary"
                onClick={handleExportToServer}
                disabled={exporting || !exportPath.trim()}
              >
                <HiServer /> {exporting ? "Export..." : "Exporter"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setShowExportModal(false)}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminReapprosScreen;
