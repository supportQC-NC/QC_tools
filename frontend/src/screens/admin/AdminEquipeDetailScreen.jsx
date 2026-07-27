// src/screens/admin/AdminEquipeDetailScreen.jsx
//
// Détail d'une équipe : infos + gestion des membres (ajout / retrait),
// édition (nom/description/responsable via la modale) et suppression.
import React, { useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  HiArrowLeft,
  HiPencil,
  HiTrash,
  HiUserAdd,
  HiUserGroup,
  HiUser,
  HiOfficeBuilding,
  HiX,
  HiExclamationCircle,
  HiSearch,
} from "react-icons/hi";
import {
  useGetTeamByIdQuery,
  useDeleteTeamMutation,
  useAddTeamMembersMutation,
  useRemoveTeamMemberMutation,
} from "../../slices/teamApiSlice";
import { useGetAssignableUsersQuery } from "../../slices/userApiSlice";
import EquipeModal from "../../components/Admin/EquipeModal";
import "./AdminEquipesScreen.css";

const initials = (u) =>
  `${(u?.prenom || "").charAt(0)}${(u?.nom || "").charAt(0)}`.toUpperCase() || "?";

const AdminEquipeDetailScreen = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: team, isLoading, error } = useGetTeamByIdQuery(id);
  const { data: users } = useGetAssignableUsersQuery();
  const [deleteTeam] = useDeleteTeamMutation();
  const [addMembers] = useAddTeamMembersMutation();
  const [removeMember] = useRemoveTeamMemberMutation();

  const [editOpen, setEditOpen] = useState(false);
  const [addValue, setAddValue] = useState("");

  // Candidats à l'ajout : users du scope, pas déjà membres, pas le responsable.
  const candidates = useMemo(() => {
    if (!team) return [];
    const memberIds = new Set((team.membres || []).map((m) => m._id || m));
    const respId = team.responsable?._id || team.responsable;
    return (users || []).filter(
      (u) => !memberIds.has(u._id) && u._id !== respId,
    );
  }, [users, team]);

  const handleAdd = async (userId) => {
    if (!userId) return;
    try {
      await addMembers({ id: team._id, userIds: [userId] }).unwrap();
      setAddValue("");
    } catch (err) {
      alert(err?.data?.message || "Erreur lors de l'ajout");
    }
  };

  const handleRemove = async (userId) => {
    try {
      await removeMember({ id: team._id, userId }).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Erreur lors du retrait");
    }
  };

  const handleDelete = async () => {
    if (window.confirm(`Supprimer l'équipe « ${team.nom} » ?`)) {
      try {
        await deleteTeam(team._id).unwrap();
        navigate("/admin/equipes");
      } catch (err) {
        alert(err?.data?.message || "Erreur lors de la suppression");
      }
    }
  };

  if (isLoading) {
    return (
      <div className="admin-equipes eq-detail">
        <div className="eq-state">
          <div className="eq-spinner" />
          <p>Chargement…</p>
        </div>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="admin-equipes eq-detail">
        <div className="eq-state error">
          <HiExclamationCircle />
          <p>Équipe introuvable{error?.data?.message ? ` : ${error.data.message}` : ""}.</p>
          <Link to="/admin/equipes" className="eq-btn-ghost">
            Retour aux équipes
          </Link>
        </div>
      </div>
    );
  }

  const membres = team.membres || [];

  return (
    <div className="admin-equipes eq-detail">
      <div className="eq-detail-topbar">
        <Link to="/admin/equipes" className="eq-back">
          <HiArrowLeft />
          <span>Équipes</span>
        </Link>
        <div className="eq-detail-topactions">
          <button className="eq-btn-ghost" onClick={() => setEditOpen(true)}>
            <HiPencil />
            <span>Modifier</span>
          </button>
          <button className="eq-btn-danger" onClick={handleDelete}>
            <HiTrash />
            <span>Supprimer</span>
          </button>
        </div>
      </div>

      {/* En-tête équipe */}
      <header className="eq-detail-head">
        <div className="eq-header-icon lg">
          <HiUserGroup />
        </div>
        <div className="eq-detail-headinfo">
          <div className="eq-detail-titlerow">
            <h1>{team.nom}</h1>
            <span className="eq-ent">{team.entreprise?.trigramme || "—"}</span>
          </div>
          {team.description ? (
            <p className="eq-detail-desc">{team.description}</p>
          ) : (
            <p className="eq-detail-desc muted">Aucune description.</p>
          )}
          <div className="eq-detail-meta">
            <span className="eq-chip">
              <HiOfficeBuilding />
              {team.entreprise?.nomComplet || "—"}
            </span>
            <span className="eq-chip">
              <HiUser />
              Responsable :{" "}
              {team.responsable
                ? `${team.responsable.prenom} ${team.responsable.nom}`
                : "—"}
            </span>
          </div>
        </div>
      </header>

      {/* Membres */}
      <section className="eq-members-card">
        <div className="eq-members-head">
          <h2>
            <HiUserGroup /> Membres
            <span className="eq-members-count">{membres.length}</span>
          </h2>
        </div>

        {/* Ajout d'un membre */}
        <div className="eq-add">
          <HiUserAdd className="eq-add-icon" />
          <select
            className="eq-add-select"
            value={addValue}
            onChange={(e) => handleAdd(e.target.value)}
            disabled={candidates.length === 0}
          >
            <option value="">
              {candidates.length === 0
                ? "Aucun utilisateur disponible à ajouter"
                : "Ajouter un membre…"}
            </option>
            {candidates.map((u) => (
              <option key={u._id} value={u._id}>
                {u.prenom} {u.nom} ({u.email})
                {u.entreprises?.length ? ` — ${u.entreprises.join(", ")}` : ""}
              </option>
            ))}
          </select>
        </div>

        {membres.length === 0 ? (
          <div className="eq-members-empty">
            <HiSearch />
            <span>Aucun membre — ajoutez-en un ci-dessus.</span>
          </div>
        ) : (
          <ul className="eq-members-list">
            {membres.map((m) => (
              <li key={m._id || m} className="eq-member">
                <span className="eq-member-avatar">{initials(m)}</span>
                <div className="eq-member-info">
                  <span className="eq-member-name">
                    {m.prenom} {m.nom}
                  </span>
                  {m.email && <span className="eq-member-mail">{m.email}</span>}
                </div>
                <button
                  className="eq-member-remove"
                  onClick={() => handleRemove(m._id || m)}
                  title="Retirer de l'équipe"
                >
                  <HiX />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editOpen && (
        <EquipeModal team={team} onClose={() => setEditOpen(false)} />
      )}
    </div>
  );
};

export default AdminEquipeDetailScreen;
