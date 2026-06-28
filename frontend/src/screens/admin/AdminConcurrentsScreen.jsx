// src/screens/admin/AdminConcurrents.jsx
import React, { useState } from "react";
import {
  HiPlus,
  HiPencil,
  HiTrash,
  HiSearch,
  HiCheck,
  HiX,
  HiRefresh,
  HiOfficeBuilding,
  HiLocationMarker,
  HiPhone,
  HiGlobe,
} from "react-icons/hi";
import {
  useGetConcurrentsQuery,
  useDeleteConcurrentMutation,
  useToggleConcurrentActiveMutation,
} from "../../slices/concurrentApiSLice";
import ConcurrentModal from "../../components/Admin/ConcurrentModal";
import "./AdminConcurrentsScreen.css";

const TYPE_LABELS = {
  grande_surface: "Grande Surface",
  specialise: "Spécialisé",
  grossiste: "Grossiste",
  en_ligne: "En ligne",
  autre: "Autre",
};

const TYPE_COLORS = {
  grande_surface: "type-grande-surface",
  specialise: "type-specialise",
  grossiste: "type-grossiste",
  en_ligne: "type-en-ligne",
  autre: "type-autre",
};

const AdminConcurrents = () => {
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedConcurrent, setSelectedConcurrent] = useState(null);

  const {
    data: concurrents,
    isLoading,
    error,
    refetch,
  } = useGetConcurrentsQuery();
  const [deleteConcurrent, { isLoading: isDeleting }] =
    useDeleteConcurrentMutation();
  const [toggleActive, { isLoading: isToggling }] =
    useToggleConcurrentActiveMutation();

  // Filtrer les concurrents
  const filteredConcurrents = concurrents?.filter((concurrent) => {
    const searchLower = search.toLowerCase();
    const matchSearch =
      concurrent.nom?.toLowerCase().includes(searchLower) ||
      concurrent.adresse?.toLowerCase().includes(searchLower) ||
      concurrent.ville?.toLowerCase().includes(searchLower);

    const matchType = !filterType || concurrent.type === filterType;

    return matchSearch && matchType;
  });

  const handleCreate = () => {
    setSelectedConcurrent(null);
    setModalOpen(true);
  };

  const handleEdit = (concurrent) => {
    setSelectedConcurrent(concurrent);
    setModalOpen(true);
  };

  const handleDelete = async (concurrent) => {
    if (window.confirm(`Supprimer le concurrent "${concurrent.nom}" ?`)) {
      try {
        await deleteConcurrent(concurrent._id).unwrap();
      } catch (err) {
        alert(err?.data?.message || "Erreur lors de la suppression");
      }
    }
  };

  const handleToggleActive = async (concurrent) => {
    try {
      await toggleActive(concurrent._id).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Erreur lors de la modification");
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedConcurrent(null);
  };

  // Statistiques
  const stats = {
    total: concurrents?.length || 0,
    actifs: concurrents?.filter((c) => c.isActive).length || 0,
    parType: concurrents?.reduce((acc, c) => {
      acc[c.type] = (acc[c.type] || 0) + 1;
      return acc;
    }, {}),
  };

  if (isLoading) {
    return <div className="admin-loading">Chargement...</div>;
  }

  if (error) {
    return <div className="admin-error">Erreur: {error?.data?.message}</div>;
  }

  return (
    <div className="admin-concurrents">
      <div className="admin-concurrents-header">
        <h1>
          <HiOfficeBuilding /> Gestion des Concurrents
        </h1>
        <div className="admin-concurrents-actions">
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
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">Tous les types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="btn-icon" onClick={refetch} title="Rafraîchir">
            <HiRefresh />
          </button>
          <button className="btn-primary" onClick={handleCreate}>
            <HiPlus />
            <span>Nouveau concurrent</span>
          </button>
        </div>
      </div>

      <div className="admin-concurrents-stats">
        <div className="stat-card">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.actifs}</span>
          <span className="stat-label">Actifs</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">
            {stats.parType?.grande_surface || 0}
          </span>
          <span className="stat-label">Grandes Surfaces</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.parType?.specialise || 0}</span>
          <span className="stat-label">Spécialisés</span>
        </div>
      </div>

      <div className="admin-concurrents-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Concurrent</th>
              <th>Adresse</th>
              <th>Type</th>
              <th>Statut</th>
              <th>Créé le</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredConcurrents?.length === 0 ? (
              <tr>
                <td colSpan="6" className="no-data">
                  Aucun concurrent trouvé
                </td>
              </tr>
            ) : (
              filteredConcurrents?.map((concurrent) => (
                <tr key={concurrent._id}>
                  <td>
                    <div className="concurrent-info">
                      <span className="concurrent-avatar">
                        {concurrent.nom?.charAt(0).toUpperCase()}
                      </span>
                      <div className="concurrent-details">
                        <span className="concurrent-name">
                          {concurrent.nom}
                        </span>
                        {concurrent.telephone && (
                          <span className="concurrent-phone">
                            <HiPhone /> {concurrent.telephone}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="concurrent-address">
                      {concurrent.adresse && (
                        <span className="address-line">
                          <HiLocationMarker /> {concurrent.adresse}
                        </span>
                      )}
                      {concurrent.ville && (
                        <span className="city-line">
                          {concurrent.codePostal} {concurrent.ville}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span
                      className={`badge ${TYPE_COLORS[concurrent.type] || "type-autre"}`}
                    >
                      {TYPE_LABELS[concurrent.type] || concurrent.type}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status ${concurrent.isActive ? "active" : "inactive"}`}
                    >
                      {concurrent.isActive ? "Actif" : "Inactif"}
                    </span>
                  </td>
                  <td className="date-cell">
                    {new Date(concurrent.createdAt).toLocaleDateString(
                      "fr-FR",
                      {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      },
                    )}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="btn-action btn-toggle"
                        onClick={() => handleToggleActive(concurrent)}
                        disabled={isToggling}
                        title={concurrent.isActive ? "Désactiver" : "Activer"}
                      >
                        {concurrent.isActive ? <HiX /> : <HiCheck />}
                      </button>
                      <button
                        className="btn-action btn-edit"
                        onClick={() => handleEdit(concurrent)}
                        title="Modifier"
                      >
                        <HiPencil />
                      </button>
                      <button
                        className="btn-action btn-delete"
                        onClick={() => handleDelete(concurrent)}
                        disabled={isDeleting}
                        title="Supprimer"
                      >
                        <HiTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <ConcurrentModal
          concurrent={selectedConcurrent}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
};

export default AdminConcurrents;
