// src/screens/admin/AdminInventairesScreen.jsx
import React, { useState } from "react";
import {
  HiClipboardCheck,
  HiSearch,
  HiRefresh,
  HiDownload,
  HiEye,
  HiX,
  HiOfficeBuilding,
  HiCalendar,
  HiUser,
  HiDatabase,
  HiCube,
  HiDocumentText,
  HiServer,
} from "react-icons/hi";
import {
  useGetHistoriqueQuery,
  useDownloadInventaireMutation,
  useExportInventaireMutation,
} from "../../slices/inventaireApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import "./AdminInventairesScreen.css";

const AdminInventairesScreen = () => {
  const [search, setSearch] = useState("");
  const [filterEntreprise, setFilterEntreprise] = useState("");
  const [selectedInventaire, setSelectedInventaire] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exportPath, setExportPath] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingId, setExportingId] = useState(null);

  const {
    data: inventaires,
    isLoading,
    error,
    refetch,
  } = useGetHistoriqueQuery(filterEntreprise || undefined);

  const { data: entreprises } = useGetMyEntreprisesQuery();
  const [downloadInventaire, { isLoading: downloading }] =
    useDownloadInventaireMutation();
  const [exportInventaire, { isLoading: exporting }] =
    useExportInventaireMutation();

  // Filtrer les inventaires
  const filteredInventaires = inventaires?.filter((inv) => {
    const searchLower = search.toLowerCase();
    const matchSearch =
      inv.nom?.toLowerCase().includes(searchLower) ||
      inv.entreprise?.trigramme?.toLowerCase().includes(searchLower) ||
      inv.entreprise?.nomComplet?.toLowerCase().includes(searchLower) ||
      inv.depot?.toLowerCase().includes(searchLower) ||
      inv.createdBy?.name?.toLowerCase().includes(searchLower);

    return matchSearch;
  });

  const handleViewDetails = (inv) => {
    setSelectedInventaire(inv);
    setDetailsOpen(true);
  };

  const handleCloseDetails = () => {
    setDetailsOpen(false);
    setSelectedInventaire(null);
  };

  const handleDownload = async (inv) => {
    try {
      const content = await downloadInventaire({
        inventaireId: inv._id,
        nomInventaire: inv.nom || "Inventaire",
      }).unwrap();

      const dateStr = new Date(inv.createdAt)
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "");
      const entrepriseNom = inv.entreprise?.trigramme || "ENT";
      const nomFichier = `INV_${entrepriseNom}_${inv.depot || "DEPOT"}_${dateStr}.DAT`;

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

  const handleOpenExportModal = (inv) => {
    setExportingId(inv._id);
    setExportPath(inv.entreprise?.cheminExport || "");
    setShowExportModal(true);
  };

  const handleExportToServer = async () => {
    if (!exportPath.trim()) {
      alert("Veuillez saisir un chemin de destination");
      return;
    }

    const inv = inventaires?.find((i) => i._id === exportingId);
    if (!inv) return;

    try {
      await exportInventaire({
        inventaireId: inv._id,
        nomInventaire: inv.nom || "Inventaire",
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
    total: inventaires?.length || 0,
    termines: inventaires?.filter((i) => i.status === "termine").length || 0,
    enCours: inventaires?.filter((i) => i.status === "en_cours").length || 0,
    totalLignes:
      inventaires?.reduce((acc, i) => acc + (i.lignes?.length || 0), 0) || 0,
  };

  if (isLoading) {
    return <div className="admin-loading">Chargement...</div>;
  }

  if (error) {
    return <div className="admin-error">Erreur: {error?.data?.message}</div>;
  }

  return (
    <div className="admin-inventaires">
      <div className="admin-inventaires-header">
        <h1>
          <HiClipboardCheck /> Historique des Inventaires
        </h1>
        <div className="admin-inventaires-actions">
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

      <div className="admin-inventaires-stats">
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
          <span className="stat-label">Lignes total</span>
        </div>
      </div>

      <div className="admin-inventaires-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Inventaire</th>
              <th>Entreprise</th>
              <th>Dépôt</th>
              <th>Lignes</th>
              <th>Statut</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredInventaires?.length === 0 ? (
              <tr>
                <td colSpan="7" className="no-data">
                  Aucun inventaire trouvé
                </td>
              </tr>
            ) : (
              filteredInventaires?.map((inv) => (
                <tr key={inv._id}>
                  <td>
                    <div className="inventaire-info">
                      <span className="inventaire-avatar">
                        <HiClipboardCheck />
                      </span>
                      <div className="inventaire-details">
                        <span className="inventaire-name">
                          {inv.nom || "Sans nom"}
                        </span>
                        {inv.createdBy && (
                          <span className="inventaire-user">
                            <HiUser /> {inv.createdBy.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="entreprise-cell">
                      <HiOfficeBuilding />
                      <span>{inv.entreprise?.trigramme}</span>
                    </div>
                  </td>
                  <td>
                    <div className="depot-cell">
                      <HiDatabase />
                      <span>{inv.depot || "-"}</span>
                    </div>
                  </td>
                  <td>
                    <div className="lignes-cell">
                      <HiCube />
                      <span className="lignes-count">
                        {inv.lignes?.length || 0}
                      </span>
                    </div>
                  </td>
                  <td>{getStatusBadge(inv.status)}</td>
                  <td className="date-cell">
                    <div className="date-info">
                      <HiCalendar />
                      <span>{formatDate(inv.createdAt)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="btn-action btn-view"
                        onClick={() => handleViewDetails(inv)}
                        title="Voir détails"
                      >
                        <HiEye />
                      </button>
                      <button
                        className="btn-action btn-download"
                        onClick={() => handleDownload(inv)}
                        disabled={downloading}
                        title="Télécharger .DAT"
                      >
                        <HiDownload />
                      </button>
                      <button
                        className="btn-action btn-export"
                        onClick={() => handleOpenExportModal(inv)}
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
      {detailsOpen && selectedInventaire && (
        <div className="modal-backdrop" onClick={handleCloseDetails}>
          <div
            className="modal-box details-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>
                <HiClipboardCheck /> Détails de l'inventaire
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
                      {selectedInventaire.nom || "Sans nom"}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Entreprise</span>
                    <span className="detail-value">
                      {selectedInventaire.entreprise?.trigramme} -{" "}
                      {selectedInventaire.entreprise?.nomComplet}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Dépôt</span>
                    <span className="detail-value">
                      {selectedInventaire.depot || "-"}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Créé par</span>
                    <span className="detail-value">
                      {selectedInventaire.createdBy?.name || "Inconnu"}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Date création</span>
                    <span className="detail-value">
                      {formatDate(selectedInventaire.createdAt)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Statut</span>
                    {getStatusBadge(selectedInventaire.status)}
                  </div>
                </div>
              </div>

              <div className="details-section">
                <h3>Statistiques</h3>
                <div className="stats-grid-small">
                  <div className="stat-box">
                    <span className="stat-number">
                      {selectedInventaire.lignes?.length || 0}
                    </span>
                    <span className="stat-text">Lignes</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-number">
                      {selectedInventaire.lignes?.reduce(
                        (acc, l) => acc + (l.quantite || 0),
                        0,
                      ) || 0}
                    </span>
                    <span className="stat-text">Quantité totale</span>
                  </div>
                </div>
              </div>

              <div className="details-section">
                <h3>Articles ({selectedInventaire.lignes?.length || 0})</h3>
                <div className="lignes-table-container">
                  {selectedInventaire.lignes?.length === 0 ? (
                    <div className="no-lignes-msg">Aucun article</div>
                  ) : (
                    <table className="lignes-table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Désignation</th>
                          <th>Quantité</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedInventaire.lignes?.map((ligne, index) => (
                          <tr key={ligne._id || index}>
                            <td className="code-cell">{ligne.nart}</td>
                            <td className="designation-cell">
                              {ligne.designation}
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
                onClick={() => handleDownload(selectedInventaire)}
                disabled={downloading}
              >
                <HiDownload /> {downloading ? "..." : "Télécharger .DAT"}
              </button>
              <button
                className="btn-primary btn-export-modal"
                onClick={() => {
                  handleCloseDetails();
                  handleOpenExportModal(selectedInventaire);
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

export default AdminInventairesScreen;
