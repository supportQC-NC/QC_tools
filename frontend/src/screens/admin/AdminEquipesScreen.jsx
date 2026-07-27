// src/screens/admin/AdminEquipesScreen.jsx
//
// Écran LISTE des équipes : cartes compactes cliquables -> page détail
// (/admin/equipes/:id) où l'on gère membres, description, responsable…
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  HiPlus,
  HiRefresh,
  HiUserGroup,
  HiChevronRight,
  HiUser,
  HiExclamationCircle,
} from "react-icons/hi";
import { useGetTeamsQuery } from "../../slices/teamApiSlice";
import EquipeModal from "../../components/Admin/EquipeModal";
import "./AdminEquipesScreen.css";

const AdminEquipesScreen = () => {
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);

  const { data: teams, isLoading, error, refetch, isFetching } =
    useGetTeamsQuery();

  return (
    <div className="admin-equipes">
      <header className="eq-header">
        <div className="eq-header-title">
          <div className="eq-header-icon">
            <HiUserGroup />
          </div>
          <div>
            <h1>Gestion des équipes</h1>
            <p className="eq-header-sub">
              {teams?.length || 0} équipe{(teams?.length || 0) > 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <div className="eq-header-actions">
          <button
            className="eq-btn-ghost icon"
            onClick={refetch}
            disabled={isFetching}
            title="Rafraîchir"
          >
            <HiRefresh className={isFetching ? "spinning" : ""} />
          </button>
          <button className="eq-btn-primary" onClick={() => setModalOpen(true)}>
            <HiPlus />
            <span>Nouvelle équipe</span>
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="eq-state">
          <div className="eq-spinner" />
          <p>Chargement des équipes…</p>
        </div>
      ) : error ? (
        <div className="eq-state error">
          <HiExclamationCircle />
          <p>Erreur : {error?.data?.message || "chargement impossible"}</p>
          <button onClick={refetch}>Réessayer</button>
        </div>
      ) : teams?.length === 0 ? (
        <div className="eq-empty">
          <HiUserGroup />
          <h3>Aucune équipe</h3>
          <p>Créez-en une avec « Nouvelle équipe » pour commencer.</p>
        </div>
      ) : (
        <div className="eq-grid">
          {teams?.map((team) => (
            <button
              key={team._id}
              className="eq-card"
              onClick={() => navigate(`/admin/equipes/${team._id}`)}
              title={`Gérer ${team.nom}`}
            >
              <div className="eq-card-icon">
                <HiUserGroup />
              </div>
              <div className="eq-card-body">
                <div className="eq-card-top">
                  <h2>{team.nom}</h2>
                  <span className="eq-ent">
                    {team.entreprise?.trigramme || "—"}
                  </span>
                </div>
                {team.description && (
                  <p className="eq-card-desc">{team.description}</p>
                )}
                <div className="eq-card-meta">
                  <span className="eq-chip">
                    <HiUser />
                    {team.responsable
                      ? `${team.responsable.prenom} ${team.responsable.nom}`
                      : "Sans responsable"}
                  </span>
                  <span className="eq-chip">
                    <HiUserGroup />
                    {team.membres?.length || 0} membre
                    {(team.membres?.length || 0) > 1 ? "s" : ""}
                  </span>
                </div>
              </div>
              <HiChevronRight className="eq-card-arrow" />
            </button>
          ))}
        </div>
      )}

      {modalOpen && <EquipeModal team={null} onClose={() => setModalOpen(false)} />}
    </div>
  );
};

export default AdminEquipesScreen;
