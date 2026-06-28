// src/screens/admin/AdminRelevesScreen.jsx
import React, { useState } from "react";
import {
  HiDocumentText,
  HiSearch,
  HiRefresh,
  HiDownload,
  HiEye,
  HiX,
  HiOfficeBuilding,
  HiShoppingCart,
  HiCalendar,
  HiUser,
  HiTrendingUp,
  HiTrendingDown,
  HiMinus,
  HiClipboardList,
} from "react-icons/hi";
import {
  useGetHistoriqueRelevesQuery,
  useDownloadReleveMutation,
} from "../../slices/releveApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { useGetConcurrentsQuery } from "../../slices/concurrentApiSLice";
import "./AdminRelevesScreen.css";

const AdminRelevesScreen = () => {
  const [search, setSearch] = useState("");
  const [filterEntreprise, setFilterEntreprise] = useState("");
  const [filterConcurrent, setFilterConcurrent] = useState("");
  const [selectedReleve, setSelectedReleve] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const {
    data: releves,
    isLoading,
    error,
    refetch,
  } = useGetHistoriqueRelevesQuery({
    entrepriseId: filterEntreprise || undefined,
    concurrentId: filterConcurrent || undefined,
  });

  const { data: entreprises } = useGetMyEntreprisesQuery();
  const { data: concurrents } = useGetConcurrentsQuery();
  const [downloadReleve, { isLoading: downloading }] =
    useDownloadReleveMutation();

  // Filtrer les relevés
  const filteredReleves = releves?.filter((releve) => {
    const searchLower = search.toLowerCase();
    const matchSearch =
      releve.nom?.toLowerCase().includes(searchLower) ||
      releve.entreprise?.trigramme?.toLowerCase().includes(searchLower) ||
      releve.entreprise?.nomComplet?.toLowerCase().includes(searchLower) ||
      releve.concurrent?.nom?.toLowerCase().includes(searchLower) ||
      releve.createdBy?.name?.toLowerCase().includes(searchLower);

    return matchSearch;
  });

  const handleViewDetails = (releve) => {
    setSelectedReleve(releve);
    setDetailsOpen(true);
  };

  const handleCloseDetails = () => {
    setDetailsOpen(false);
    setSelectedReleve(null);
  };

  const handleDownload = async (releve) => {
    try {
      const blob = await downloadReleve({
        releveId: releve._id,
        nomReleve: releve.nom || releve.concurrent?.nom || "Relevé",
      }).unwrap();

      const dateStr = new Date(releve.createdAt)
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "");
      const entrepriseNom = releve.entreprise?.trigramme || "ENT";
      const concurrentNom =
        releve.concurrent?.nom?.replace(/[^a-zA-Z0-9]/g, "_") || "CONCURRENT";
      const nomFichier = `releve_${entrepriseNom}_${concurrentNom}_${dateStr}.xlsx`;

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
    total: releves?.length || 0,
    termines: releves?.filter((r) => r.status === "termine").length || 0,
    enCours: releves?.filter((r) => r.status === "en_cours").length || 0,
    totalArticles:
      releves?.reduce((acc, r) => acc + (r.totalArticles || 0), 0) || 0,
  };

  if (isLoading) {
    return <div className="admin-loading">Chargement...</div>;
  }

  if (error) {
    return <div className="admin-error">Erreur: {error?.data?.message}</div>;
  }

  return (
    <div className="admin-releves">
      <div className="admin-releves-header">
        <h1>
          <HiClipboardList /> Historique des Relevés
        </h1>
        <div className="admin-releves-actions">
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
          <select
            className="filter-select"
            value={filterConcurrent}
            onChange={(e) => setFilterConcurrent(e.target.value)}
          >
            <option value="">Tous les concurrents</option>
            {concurrents?.map((c) => (
              <option key={c._id} value={c._id}>
                {c.nom}
              </option>
            ))}
          </select>
          <button className="btn-icon" onClick={refetch} title="Rafraîchir">
            <HiRefresh />
          </button>
        </div>
      </div>

      <div className="admin-releves-stats">
        <div className="stat-card">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Total Relevés</span>
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
          <span className="stat-value">{stats.totalArticles}</span>
          <span className="stat-label">Articles relevés</span>
        </div>
      </div>

      <div className="admin-releves-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Relevé</th>
              <th>Entreprise</th>
              <th>Concurrent</th>
              <th>Articles</th>
              <th>Statut</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredReleves?.length === 0 ? (
              <tr>
                <td colSpan="7" className="no-data">
                  Aucun relevé trouvé
                </td>
              </tr>
            ) : (
              filteredReleves?.map((releve) => (
                <tr key={releve._id}>
                  <td>
                    <div className="releve-info">
                      <span className="releve-avatar">
                        <HiDocumentText />
                      </span>
                      <div className="releve-details">
                        <span className="releve-name">
                          {releve.nom || "Sans nom"}
                        </span>
                        {releve.createdBy && (
                          <span className="releve-user">
                            <HiUser /> {releve.createdBy.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="entreprise-cell">
                      <HiOfficeBuilding />
                      <span>{releve.entreprise?.trigramme}</span>
                    </div>
                  </td>
                  <td>
                    <div className="concurrent-cell">
                      <HiShoppingCart />
                      <div>
                        <span className="concurrent-name">
                          {releve.concurrent?.nom}
                        </span>
                        {releve.concurrent?.ville && (
                          <span className="concurrent-ville">
                            {releve.concurrent.ville}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="articles-cell">
                      <span className="articles-count">
                        {releve.totalArticles || 0}
                      </span>
                      {releve.stats && (
                        <div className="articles-stats">
                          <span
                            className="stat-good"
                            title="Moins chers chez nous"
                          >
                            <HiTrendingUp />{" "}
                            {releve.stats.moinsCherChezNous || 0}
                          </span>
                          <span
                            className="stat-bad"
                            title="Plus chers chez nous"
                          >
                            <HiTrendingDown />{" "}
                            {releve.stats.plusCherChezNous || 0}
                          </span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td>{getStatusBadge(releve.status)}</td>
                  <td className="date-cell">
                    <div className="date-info">
                      <HiCalendar />
                      <span>{formatDate(releve.createdAt)}</span>
                    </div>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="btn-action btn-view"
                        onClick={() => handleViewDetails(releve)}
                        title="Voir détails"
                      >
                        <HiEye />
                      </button>
                      <button
                        className="btn-action btn-download"
                        onClick={() => handleDownload(releve)}
                        disabled={downloading || releve.status === "en_cours"}
                        title="Télécharger Excel"
                      >
                        <HiDownload />
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
      {detailsOpen && selectedReleve && (
        <div className="modal-backdrop" onClick={handleCloseDetails}>
          <div
            className="modal-box details-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>
                <HiDocumentText /> Détails du relevé
              </h2>
              <button className="btn-close-modal" onClick={handleCloseDetails}>
                <HiX />
              </button>
            </div>

            <div className="modal-content">
              {/* Infos générales */}
              <div className="details-section">
                <h3>Informations</h3>
                <div className="details-grid">
                  <div className="detail-item">
                    <span className="detail-label">Nom</span>
                    <span className="detail-value">
                      {selectedReleve.nom || "Sans nom"}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Entreprise</span>
                    <span className="detail-value">
                      {selectedReleve.entreprise?.trigramme} -{" "}
                      {selectedReleve.entreprise?.nomComplet}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Concurrent</span>
                    <span className="detail-value">
                      {selectedReleve.concurrent?.nom}
                      {selectedReleve.concurrent?.ville &&
                        ` (${selectedReleve.concurrent.ville})`}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Créé par</span>
                    <span className="detail-value">
                      {selectedReleve.createdBy?.name || "Inconnu"}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Date</span>
                    <span className="detail-value">
                      {formatDate(selectedReleve.createdAt)}
                    </span>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Statut</span>
                    {getStatusBadge(selectedReleve.status)}
                  </div>
                </div>
              </div>

              {/* Statistiques */}
              {selectedReleve.stats && (
                <div className="details-section">
                  <h3>Statistiques</h3>
                  <div className="stats-grid">
                    <div className="stat-box">
                      <span className="stat-number">
                        {selectedReleve.totalArticles || 0}
                      </span>
                      <span className="stat-text">Articles</span>
                    </div>
                    <div className="stat-box stat-good">
                      <span className="stat-number">
                        {selectedReleve.stats.moinsCherChezNous || 0}
                      </span>
                      <span className="stat-text">Moins chers</span>
                    </div>
                    <div className="stat-box stat-bad">
                      <span className="stat-number">
                        {selectedReleve.stats.plusCherChezNous || 0}
                      </span>
                      <span className="stat-text">Plus chers</span>
                    </div>
                    <div className="stat-box stat-equal">
                      <span className="stat-number">
                        {selectedReleve.stats.memePrix || 0}
                      </span>
                      <span className="stat-text">Même prix</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Liste des lignes */}
              <div className="details-section">
                <h3>Articles relevés ({selectedReleve.lignes?.length || 0})</h3>
                <div className="lignes-table-container">
                  {selectedReleve.lignes?.length === 0 ? (
                    <div className="no-lignes-msg">Aucun article</div>
                  ) : (
                    <table className="lignes-table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Désignation</th>
                          <th>Notre prix</th>
                          <th>Prix relevé</th>
                          <th>Écart</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedReleve.lignes?.map((ligne, index) => {
                          const ecart = ligne.pvtettc - ligne.prixReleve;
                          const ecartPct =
                            ligne.pvtettc > 0
                              ? ((ecart / ligne.pvtettc) * 100).toFixed(1)
                              : 0;
                          return (
                            <tr key={ligne._id || index}>
                              <td className="code-cell">{ligne.nart}</td>
                              <td className="designation-cell">
                                {ligne.designation}
                              </td>
                              <td className="prix-cell">
                                {ligne.pvtettc?.toLocaleString()} F
                              </td>
                              <td className="prix-cell">
                                {ligne.prixReleve?.toLocaleString()} F
                              </td>
                              <td>
                                <span
                                  className={`ecart-badge ${ecart > 0 ? "ecart-bad" : ecart < 0 ? "ecart-good" : "ecart-equal"}`}
                                >
                                  {ecart > 0 ? (
                                    <>
                                      <HiTrendingDown /> -
                                      {Math.abs(ecart).toLocaleString()}F (
                                      {ecartPct}%)
                                    </>
                                  ) : ecart < 0 ? (
                                    <>
                                      <HiTrendingUp /> +
                                      {Math.abs(ecart).toLocaleString()}F (
                                      {Math.abs(ecartPct)}%)
                                    </>
                                  ) : (
                                    <>
                                      <HiMinus /> 0F
                                    </>
                                  )}
                                </span>
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

            <div className="modal-footer">
              <button
                className="btn-primary btn-download-modal"
                onClick={() => handleDownload(selectedReleve)}
                disabled={downloading || selectedReleve.status === "en_cours"}
              >
                <HiDownload />{" "}
                {downloading ? "Téléchargement..." : "Télécharger Excel"}
              </button>
              <button className="btn-secondary" onClick={handleCloseDetails}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminRelevesScreen;
