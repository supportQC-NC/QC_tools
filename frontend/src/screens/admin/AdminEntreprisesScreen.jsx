// src/screens/admin/AdminEntreprises.jsx
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
} from "react-icons/hi";
import {
  useGetEntreprisesQuery,
  useDeleteEntrepriseMutation,
  useToggleEntrepriseActiveMutation,
} from "../../slices/entrepriseApiSlice";
import EntrepriseModal from "../../components/Admin/EntrepriseModal";
import "./AdminEntreprisesScreen.css";

const AdminEntreprises = () => {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedEntreprise, setSelectedEntreprise] = useState(null);

  const {
    data: entreprises,
    isLoading,
    error,
    refetch,
  } = useGetEntreprisesQuery();
  const [deleteEntreprise, { isLoading: isDeleting }] =
    useDeleteEntrepriseMutation();
  const [toggleActive, { isLoading: isToggling }] =
    useToggleEntrepriseActiveMutation();

  // Filtrer les entreprises
  const filteredEntreprises = entreprises?.filter((entreprise) => {
    const searchLower = search.toLowerCase();
    return (
      entreprise.nomComplet?.toLowerCase().includes(searchLower) ||
      entreprise.trigramme?.toLowerCase().includes(searchLower) ||
      entreprise.nomDossierDBF?.toLowerCase().includes(searchLower)
    );
  });

  const handleCreate = () => {
    setSelectedEntreprise(null);
    setModalOpen(true);
  };

  const handleEdit = (entreprise) => {
    setSelectedEntreprise(entreprise);
    setModalOpen(true);
  };

  const handleDelete = async (entreprise) => {
    if (window.confirm(`Supprimer l'entreprise "${entreprise.nomComplet}" ?`)) {
      try {
        await deleteEntreprise(entreprise._id).unwrap();
      } catch (err) {
        alert(err?.data?.message || "Erreur lors de la suppression");
      }
    }
  };

  const handleToggleActive = async (entreprise) => {
    try {
      await toggleActive(entreprise._id).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Erreur lors de la modification");
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedEntreprise(null);
  };

  if (isLoading) {
    return <div className="admin-loading">Chargement...</div>;
  }

  if (error) {
    return <div className="admin-error">Erreur: {error?.data?.message}</div>;
  }

  return (
    <div className="admin-entreprises">
      <div className="admin-entreprises-header">
        <h1>Gestion des entreprises</h1>
        <div className="admin-entreprises-actions">
          <div className="search-box">
            <HiSearch />
            <input
              type="text"
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn-icon" onClick={refetch} title="Rafraîchir">
            <HiRefresh />
          </button>
          <button className="btn-primary" onClick={handleCreate}>
            <HiPlus />
            <span>Nouvelle entreprise</span>
          </button>
        </div>
      </div>

      <div className="admin-entreprises-stats">
        <div className="stat-card">
          <span className="stat-value">{entreprises?.length || 0}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">
            {entreprises?.filter((e) => e.isActive).length || 0}
          </span>
          <span className="stat-label">Actives</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">
            {entreprises?.filter((e) => !e.isActive).length || 0}
          </span>
          <span className="stat-label">Inactives</span>
        </div>
      </div>

      <div className="admin-entreprises-grid">
        {filteredEntreprises?.length === 0 ? (
          <div className="no-data">
            <HiOfficeBuilding />
            <p>Aucune entreprise trouvée</p>
          </div>
        ) : (
          filteredEntreprises?.map((entreprise) => (
            <div
              key={entreprise._id}
              className={`entreprise-card ${!entreprise.isActive ? "inactive" : ""}`}
            >
              <div className="entreprise-card-header">
                <div className="entreprise-trigramme">
                  {entreprise.trigramme}
                </div>
                <span
                  className={`status-badge ${entreprise.isActive ? "active" : "inactive"}`}
                >
                  {entreprise.isActive ? "Active" : "Inactive"}
                </span>
              </div>

              <div className="entreprise-card-body">
                <h3 className="entreprise-nom">{entreprise.nomComplet}</h3>
                <div className="entreprise-info">
                  <div className="info-row">
                    <span className="info-label">Dossier DBF:</span>
                    <span className="info-value">
                      {entreprise.nomDossierDBF}
                    </span>
                  </div>
                  <div className="info-row">
                    <span className="info-label">Chemin:</span>
                    <span
                      className="info-value info-path"
                      title={entreprise.cheminBase}
                    >
                      {entreprise.cheminBase}
                    </span>
                  </div>
                  {entreprise.description && (
                    <div className="info-row">
                      <span className="info-label">Description:</span>
                      <span className="info-value">
                        {entreprise.description}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="entreprise-card-footer">
                <div className="card-actions">
                  <button
                    className="btn-action btn-toggle"
                    onClick={() => handleToggleActive(entreprise)}
                    disabled={isToggling}
                    title={entreprise.isActive ? "Désactiver" : "Activer"}
                  >
                    {entreprise.isActive ? <HiX /> : <HiCheck />}
                  </button>
                  <button
                    className="btn-action btn-edit"
                    onClick={() => handleEdit(entreprise)}
                    title="Modifier"
                  >
                    <HiPencil />
                  </button>
                  <button
                    className="btn-action btn-delete"
                    onClick={() => handleDelete(entreprise)}
                    disabled={isDeleting}
                    title="Supprimer"
                  >
                    <HiTrash />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {modalOpen && (
        <EntrepriseModal
          entreprise={selectedEntreprise}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
};

export default AdminEntreprises;
