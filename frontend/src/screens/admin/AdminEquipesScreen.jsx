// src/screens/admin/AdminEquipesScreen.jsx
import React, { useState } from "react";
import {
  HiPlus,
  HiPencil,
  HiTrash,
  HiRefresh,
  HiUserAdd,
  HiX,
} from "react-icons/hi";
import {
  useGetTeamsQuery,
  useDeleteTeamMutation,
  useAddTeamMembersMutation,
  useRemoveTeamMemberMutation,
} from "../../slices/teamApiSlice";
import { useGetUsersQuery } from "../../slices/userApiSlice";
import EquipeModal from "../../components/Admin/EquipeModal";
import "./AdminEquipesScreen.css";

const AdminEquipesScreen = () => {
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState(null);

  const {
    data: teams,
    isLoading,
    error,
    refetch,
  } = useGetTeamsQuery();
  const { data: users } = useGetUsersQuery();
  const [deleteTeam] = useDeleteTeamMutation();
  const [addMembers] = useAddTeamMembersMutation();
  const [removeMember] = useRemoveTeamMemberMutation();

  const handleCreate = () => {
    setSelectedTeam(null);
    setModalOpen(true);
  };

  const handleEdit = (team) => {
    setSelectedTeam(team);
    setModalOpen(true);
  };

  const handleDelete = async (team) => {
    if (window.confirm(`Supprimer l'équipe « ${team.nom} » ?`)) {
      try {
        await deleteTeam(team._id).unwrap();
      } catch (err) {
        alert(err?.data?.message || "Erreur lors de la suppression");
      }
    }
  };

  const handleAddMember = async (team, userId) => {
    if (!userId) return;
    try {
      await addMembers({ id: team._id, userIds: [userId] }).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Erreur lors de l'ajout");
    }
  };

  const handleRemoveMember = async (team, userId) => {
    try {
      await removeMember({ id: team._id, userId }).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Erreur lors du retrait");
    }
  };

  // Candidats à l'ajout : users du scope, pas déjà membres, pas le responsable.
  const candidatesFor = (team) => {
    const memberIds = new Set((team.membres || []).map((m) => m._id || m));
    const respId = team.responsable?._id || team.responsable;
    return (users || []).filter(
      (u) => !memberIds.has(u._id) && u._id !== respId,
    );
  };

  if (isLoading) {
    return <div className="admin-loading">Chargement...</div>;
  }
  if (error) {
    return <div className="admin-error">Erreur: {error?.data?.message}</div>;
  }

  return (
    <div className="admin-equipes">
      <div className="admin-equipes-header">
        <h1>Gestion des équipes</h1>
        <div className="admin-equipes-actions">
          <button className="btn-icon" onClick={refetch} title="Rafraîchir">
            <HiRefresh />
          </button>
          <button className="btn-primary" onClick={handleCreate}>
            <HiPlus />
            <span>Nouvelle équipe</span>
          </button>
        </div>
      </div>

      {teams?.length === 0 ? (
        <div className="equipes-empty">
          Aucune équipe pour le moment. Créez-en une pour commencer.
        </div>
      ) : (
        <div className="equipes-grid">
          {teams?.map((team) => (
            <div key={team._id} className="equipe-card">
              <div className="equipe-card-head">
                <div>
                  <h3>{team.nom}</h3>
                  <span className="equipe-ent">
                    {team.entreprise?.trigramme || "—"}
                  </span>
                </div>
                <div className="equipe-card-actions">
                  <button
                    className="btn-action btn-edit"
                    onClick={() => handleEdit(team)}
                    title="Modifier"
                  >
                    <HiPencil />
                  </button>
                  <button
                    className="btn-action btn-delete"
                    onClick={() => handleDelete(team)}
                    title="Supprimer"
                  >
                    <HiTrash />
                  </button>
                </div>
              </div>

              {team.description && (
                <p className="equipe-desc">{team.description}</p>
              )}

              <div className="equipe-resp">
                <span className="equipe-label">Responsable</span>
                <span>
                  {team.responsable
                    ? `${team.responsable.prenom} ${team.responsable.nom}`
                    : "—"}
                </span>
              </div>

              <div className="equipe-membres">
                <span className="equipe-label">
                  Membres ({team.membres?.length || 0})
                </span>
                <ul>
                  {(team.membres || []).map((m) => (
                    <li key={m._id || m}>
                      <span>
                        {m.prenom} {m.nom}
                      </span>
                      <button
                        className="btn-remove-member"
                        onClick={() => handleRemoveMember(team, m._id || m)}
                        title="Retirer"
                      >
                        <HiX />
                      </button>
                    </li>
                  ))}
                  {(team.membres || []).length === 0 && (
                    <li className="equipe-no-member">Aucun membre</li>
                  )}
                </ul>

                <div className="equipe-add-member">
                  <HiUserAdd />
                  <select
                    value=""
                    onChange={(e) => handleAddMember(team, e.target.value)}
                  >
                    <option value="">Ajouter un membre...</option>
                    {candidatesFor(team).map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.prenom} {u.nom} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <EquipeModal
          team={selectedTeam}
          onClose={() => {
            setModalOpen(false);
            setSelectedTeam(null);
          }}
        />
      )}
    </div>
  );
};

export default AdminEquipesScreen;
