// src/screens/admin/AdminUsers.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  HiPlus,
  HiPencil,
  HiTrash,
  HiSearch,
  HiCheck,
  HiX,
  HiRefresh,
  HiDownload,
  HiOfficeBuilding,
} from "react-icons/hi";
import * as XLSX from "xlsx";
import {
  useGetUsersQuery,
  useDeleteUserMutation,
  useToggleUserActiveMutation,
} from "../../slices/userApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import "./AdminUsersScreen.css";

const ROLE_FILTERS = [
  { key: "tous", label: "Tous" },
  { key: "admin", label: "Admins" },
  { key: "responsable", label: "Responsables" },
  { key: "user", label: "Utilisateurs" },
];

// Sociétés d'un compte : null = accès à TOUTES (allEntreprises, ou admin
// hérité sans document Permission — même règle que getAccessibleEntreprises),
// sinon la liste des sociétés de sa permission (peuplées par getUsers).
const societesUser = (user) => {
  const p = user.permissions;
  if ((p && p.allEntreprises) || (!p && user.role === "admin")) return null;
  return p?.entreprises || [];
};

const accedeEntreprise = (user, entrepriseId) => {
  const societes = societesUser(user);
  if (societes === null) return true;
  return societes.some((e) => (e?._id || e) === entrepriseId);
};

const AdminUsers = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("tous");
  const [entrepriseFilter, setEntrepriseFilter] = useState("toutes");

  // Un responsable ne supprime pas de compte (réservé aux admins côté API).
  const { userInfo } = useSelector((state) => state.auth);
  const canDeleteAccounts = userInfo?.role !== "responsable";

  const { data: users, isLoading, error, refetch } = useGetUsersQuery();
  // Sociétés accessibles à l'acteur : le filtre ne propose que son périmètre.
  const { data: entreprises } = useGetMyEntreprisesQuery();
  const [deleteUser, { isLoading: isDeleting }] = useDeleteUserMutation();
  const [toggleActive, { isLoading: isToggling }] =
    useToggleUserActiveMutation();

  // Filtrer les utilisateurs (recherche texte + rôle + société)
  const filteredUsers = users?.filter((user) => {
    const searchLower = search.toLowerCase();
    const matchSearch =
      user.nom?.toLowerCase().includes(searchLower) ||
      user.prenom?.toLowerCase().includes(searchLower) ||
      user.email?.toLowerCase().includes(searchLower);
    const matchRole = roleFilter === "tous" || user.role === roleFilter;
    const matchEntreprise =
      entrepriseFilter === "toutes" || accedeEntreprise(user, entrepriseFilter);
    return matchSearch && matchRole && matchEntreprise;
  });

  const roleCount = (key) =>
    key === "tous"
      ? users?.length || 0
      : users?.filter((u) => u.role === key).length || 0;

  // Création ET édition passent par une PAGE plein écran : il y a trop de
  // réglages par utilisateur (rôle, profil commercial, sociétés, modules,
  // champs DBF) pour tenir dans une modale.
  const handleCreate = () => navigate("/admin/users/nouveau");

  const handleEdit = (user) => navigate(`/admin/users/${user._id}`);

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

  const libelleSocietes = (user) => {
    const societes = societesUser(user);
    if (societes === null) return "Toutes";
    return societes
      .map((e) => e?.trigramme || e?.nomDossierDBF)
      .filter(Boolean)
      .join(", ");
  };

  // Export Excel de la liste AFFICHÉE (tous les filtres appliqués).
  const handleExportExcel = () => {
    const lignes = (filteredUsers || []).map((u) => ({
      Nom: u.nom || "",
      Prénom: u.prenom || "",
      Email: u.email || "",
      Rôle: u.role || "",
      Statut: u.isActive ? "Actif" : "Inactif",
      Sociétés: libelleSocietes(u),
      "Dernière connexion": u.lastLogin
        ? new Date(u.lastLogin).toLocaleString("fr-FR")
        : "Jamais",
      "Créé le": u.createdAt
        ? new Date(u.createdAt).toLocaleDateString("fr-FR")
        : "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(lignes),
      "Utilisateurs",
    );
    const ent = entreprises?.find((e) => e._id === entrepriseFilter);
    const suffixe = ent ? `_${ent.trigramme || ent.nomDossierDBF}` : "";
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `utilisateurs${suffixe}_${stamp}.xlsx`);
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
          <div className="entreprise-filter" title="Filtrer par société">
            <HiOfficeBuilding />
            <select
              value={entrepriseFilter}
              onChange={(e) => setEntrepriseFilter(e.target.value)}
            >
              <option value="toutes">Toutes les sociétés</option>
              {entreprises?.map((ent) => (
                <option key={ent._id} value={ent._id}>
                  {ent.trigramme
                    ? `${ent.trigramme} — ${ent.nomComplet || ent.nomDossierDBF}`
                    : ent.nomComplet || ent.nomDossierDBF}
                </option>
              ))}
            </select>
          </div>
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
          <button
            className="btn-icon"
            onClick={handleExportExcel}
            disabled={!filteredUsers?.length}
            title="Exporter la liste filtrée en Excel"
          >
            <HiDownload />
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

      <div className="role-filter">
        {ROLE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`role-filter-btn rf-${f.key} ${roleFilter === f.key ? "active" : ""}`}
            onClick={() => setRoleFilter(f.key)}
          >
            {f.label}
            <span className="rf-count">{roleCount(f.key)}</span>
          </button>
        ))}
      </div>

      <div className="admin-users-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Utilisateur</th>
              <th>Email</th>
              <th>Rôle</th>
              <th>Sociétés</th>
              <th>Statut</th>
              <th>Dernière connexion</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers?.length === 0 ? (
              <tr>
                <td colSpan="7" className="no-data">
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
                  <td className="societes-cell">
                    {libelleSocietes(user) || "—"}
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
                      {canDeleteAccounts && (
                        <button
                          className="btn-action btn-delete"
                          onClick={() => handleDelete(user)}
                          disabled={isDeleting || user.role === "admin"}
                          title="Supprimer"
                        >
                          <HiTrash />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
};

export default AdminUsers;
