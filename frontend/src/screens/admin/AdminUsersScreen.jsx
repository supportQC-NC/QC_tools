// src/screens/admin/AdminUsers.jsx
import React, { useState } from "react";
import {
  HiPlus,
  HiPencil,
  HiTrash,
  HiSearch,
  HiCheck,
  HiX,
  HiRefresh,
} from "react-icons/hi";
import {
  useGetUsersQuery,
  useDeleteUserMutation,
  useToggleUserActiveMutation,
} from "../../slices/userApiSlice";
import UserModal from "../../components/Admin/UserModal";
import "./AdminUsersScreen.css";

const AdminUsers = () => {
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  const { data: users, isLoading, error, refetch } = useGetUsersQuery();
  const [deleteUser, { isLoading: isDeleting }] = useDeleteUserMutation();
  const [toggleActive, { isLoading: isToggling }] =
    useToggleUserActiveMutation();

  // Filtrer les utilisateurs
  const filteredUsers = users?.filter((user) => {
    const searchLower = search.toLowerCase();
    return (
      user.nom?.toLowerCase().includes(searchLower) ||
      user.prenom?.toLowerCase().includes(searchLower) ||
      user.email?.toLowerCase().includes(searchLower)
    );
  });

  const handleCreate = () => {
    setSelectedUser(null);
    setModalOpen(true);
  };

  const handleEdit = (user) => {
    setSelectedUser(user);
    setModalOpen(true);
  };

  const handleDelete = async (user) => {
    if (window.confirm(`Supprimer ${user.prenom} ${user.nom} ?`)) {
      try {
        await deleteUser(user._id).unwrap();
      } catch (err) {
        alert(err?.data?.message || "Erreur lors de la suppression");
      }
    }
  };

  const handleToggleActive = async (user) => {
    try {
      await toggleActive(user._id).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Erreur lors de la modification");
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedUser(null);
  };

  if (isLoading) {
    return <div className="admin-loading">Chargement...</div>;
  }

  if (error) {
    return <div className="admin-error">Erreur: {error?.data?.message}</div>;
  }

  return (
    <div className="admin-users">
      <div className="admin-users-header">
        <h1>Gestion des utilisateurs</h1>
        <div className="admin-users-actions">
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
            <span>Nouvel utilisateur</span>
          </button>
        </div>
      </div>

      <div className="admin-users-stats">
        <div className="stat-card">
          <span className="stat-value">{users?.length || 0}</span>
          <span className="stat-label">Total</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">
            {users?.filter((u) => u.isActive).length || 0}
          </span>
          <span className="stat-label">Actifs</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">
            {users?.filter((u) => u.role === "admin").length || 0}
          </span>
          <span className="stat-label">Admins</span>
        </div>
      </div>

      <div className="admin-users-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Utilisateur</th>
              <th>Email</th>
              <th>Rôle</th>
              <th>Statut</th>
              <th>Dernière connexion</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers?.length === 0 ? (
              <tr>
                <td colSpan="6" className="no-data">
                  Aucun utilisateur trouvé
                </td>
              </tr>
            ) : (
              filteredUsers?.map((user) => (
                <tr key={user._id}>
                  <td>
                    <div className="user-info">
                      <span className="user-avatar">
                        {user.prenom?.charAt(0)}
                        {user.nom?.charAt(0)}
                      </span>
                      <span className="user-name">
                        {user.prenom} {user.nom}
                      </span>
                    </div>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <span className={`badge badge-${user.role}`}>
                      {user.role}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`status ${user.isActive ? "active" : "inactive"}`}
                    >
                      {user.isActive ? "Actif" : "Inactif"}
                    </span>
                  </td>
                  <td className="date-cell">
                    {user.lastLogin
                      ? new Date(user.lastLogin).toLocaleDateString("fr-FR", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "Jamais"}
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="btn-action btn-toggle"
                        onClick={() => handleToggleActive(user)}
                        disabled={isToggling}
                        title={user.isActive ? "Désactiver" : "Activer"}
                      >
                        {user.isActive ? <HiX /> : <HiCheck />}
                      </button>
                      <button
                        className="btn-action btn-edit"
                        onClick={() => handleEdit(user)}
                        title="Modifier"
                      >
                        <HiPencil />
                      </button>
                      <button
                        className="btn-action btn-delete"
                        onClick={() => handleDelete(user)}
                        disabled={isDeleting || user.role === "admin"}
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
        <UserModal user={selectedUser} onClose={handleCloseModal} />
      )}
    </div>
  );
};

export default AdminUsers;
