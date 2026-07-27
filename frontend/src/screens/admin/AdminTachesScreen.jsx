// src/screens/admin/AdminTachesScreen.jsx
import React, { useMemo, useState } from "react";
import {
  HiPlus,
  HiPencil,
  HiTrash,
  HiRefresh,
  HiClipboardList,
  HiExclamationCircle,
  HiFilter,
} from "react-icons/hi";
import {
  useGetTasksQuery,
  useDeleteTaskMutation,
} from "../../slices/taskApiSlice";
import { useGetTeamsQuery } from "../../slices/teamApiSlice";
import TacheModal from "../../components/Admin/TacheModal";
import {
  TASK_STATUTS,
  STATUT_LABELS,
  STATUT_COLORS,
  PRIORITE_LABELS,
  PRIORITE_COLORS,
  formatDeadline,
  isOverdue,
} from "../../config/taskMeta";
import "./AdminTachesScreen.css";

const AdminTachesScreen = () => {
  const [filters, setFilters] = useState({ equipe: "", statut: "", assigneA: "" });
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  const { data: teams } = useGetTeamsQuery();
  const {
    data: tasks,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useGetTasksQuery({
    equipe: filters.equipe || undefined,
    statut: filters.statut || undefined,
    assigneA: filters.assigneA || undefined,
  });
  const [deleteTask] = useDeleteTaskMutation();

  // Membres de l'équipe filtrée (pour le filtre « membre »).
  const membresDuFiltre = useMemo(() => {
    const t = (teams || []).find((x) => x._id === filters.equipe);
    return t?.membres || [];
  }, [teams, filters.equipe]);

  // Compteurs (sur le résultat filtré courant).
  const stats = useMemo(() => {
    const list = tasks || [];
    return {
      total: list.length,
      a_faire: list.filter((t) => t.statut === "a_faire").length,
      en_cours: list.filter((t) => t.statut === "en_cours").length,
      termine: list.filter((t) => t.statut === "termine").length,
      bloque: list.filter((t) => t.statut === "bloque").length,
      retard: list.filter((t) => isOverdue(t)).length,
    };
  }, [tasks]);

  const handleFilter = (e) => {
    const { name, value } = e.target;
    setFilters((prev) => {
      const next = { ...prev, [name]: value };
      if (name === "equipe") next.assigneA = ""; // reset membre si équipe change
      return next;
    });
  };

  const handleCreate = () => {
    setSelected(null);
    setModalOpen(true);
  };
  const handleEdit = (task) => {
    setSelected(task);
    setModalOpen(true);
  };
  const handleDelete = async (task) => {
    if (window.confirm(`Supprimer la tâche « ${task.titre} » ?`)) {
      try {
        await deleteTask(task._id).unwrap();
      } catch (err) {
        alert(err?.data?.message || "Erreur lors de la suppression");
      }
    }
  };

  return (
    <div className="admin-taches">
      {/* En-tête */}
      <header className="at-header">
        <div className="at-header-title">
          <div className="at-header-icon">
            <HiClipboardList />
          </div>
          <div>
            <h1>Gestion des tâches</h1>
            <p className="at-header-sub">
              Créer, assigner et suivre les tâches des équipes
            </p>
          </div>
        </div>
        <div className="at-header-actions">
          <button
            className="at-btn-ghost"
            onClick={refetch}
            disabled={isFetching}
            title="Rafraîchir"
          >
            <HiRefresh className={isFetching ? "spinning" : ""} />
          </button>
          <button className="at-btn-primary" onClick={handleCreate}>
            <HiPlus />
            <span>Nouvelle tâche</span>
          </button>
        </div>
      </header>

      {/* Cartes statistiques */}
      <div className="at-stats">
        <div className="at-stat">
          <span className="at-stat-value">{stats.total}</span>
          <span className="at-stat-label">Total</span>
        </div>
        <div className="at-stat">
          <span className="at-stat-dot" style={{ background: STATUT_COLORS.a_faire }} />
          <span className="at-stat-value">{stats.a_faire}</span>
          <span className="at-stat-label">À faire</span>
        </div>
        <div className="at-stat">
          <span className="at-stat-dot" style={{ background: STATUT_COLORS.en_cours }} />
          <span className="at-stat-value">{stats.en_cours}</span>
          <span className="at-stat-label">En cours</span>
        </div>
        <div className="at-stat">
          <span className="at-stat-dot" style={{ background: STATUT_COLORS.termine }} />
          <span className="at-stat-value">{stats.termine}</span>
          <span className="at-stat-label">Terminées</span>
        </div>
        <div className="at-stat">
          <span className="at-stat-dot" style={{ background: STATUT_COLORS.bloque }} />
          <span className="at-stat-value">{stats.bloque}</span>
          <span className="at-stat-label">Bloquées</span>
        </div>
        <div className={`at-stat ${stats.retard ? "danger" : ""}`}>
          <span className="at-stat-value">{stats.retard}</span>
          <span className="at-stat-label">En retard</span>
        </div>
      </div>

      {/* Filtres */}
      <div className="at-filters">
        <div className="at-filters-icon">
          <HiFilter />
          <span>Filtres</span>
        </div>
        <select name="equipe" value={filters.equipe} onChange={handleFilter}>
          <option value="">Toutes les équipes</option>
          {(teams || []).map((t) => (
            <option key={t._id} value={t._id}>
              {t.nom}
            </option>
          ))}
        </select>
        <select name="statut" value={filters.statut} onChange={handleFilter}>
          <option value="">Tous les statuts</option>
          {TASK_STATUTS.map((s) => (
            <option key={s} value={s}>
              {STATUT_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          name="assigneA"
          value={filters.assigneA}
          onChange={handleFilter}
          disabled={!filters.equipe}
        >
          <option value="">Tous les membres</option>
          {membresDuFiltre.map((m) => (
            <option key={m._id || m} value={m._id || m}>
              {m.prenom} {m.nom}
            </option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="at-table-container">
        {isLoading ? (
          <div className="at-state">
            <div className="at-spinner" />
            <p>Chargement des tâches…</p>
          </div>
        ) : error ? (
          <div className="at-state error">
            <HiExclamationCircle />
            <p>Erreur : {error?.data?.message || "chargement impossible"}</p>
            <button onClick={refetch}>Réessayer</button>
          </div>
        ) : (
          <table className="at-table">
            <thead>
              <tr>
                <th>Tâche</th>
                <th>Équipe</th>
                <th>Assigné à</th>
                <th>Échéance</th>
                <th>Priorité</th>
                <th>Statut</th>
                <th className="th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks?.length === 0 ? (
                <tr>
                  <td colSpan="7" className="at-nodata">
                    <HiClipboardList />
                    <span>Aucune tâche</span>
                  </td>
                </tr>
              ) : (
                tasks?.map((task) => (
                  <tr key={task._id}>
                    <td>
                      <strong className="at-titre">{task.titre}</strong>
                      {task.description && (
                        <div className="at-desc">{task.description}</div>
                      )}
                    </td>
                    <td className="at-cell-muted">{task.equipe?.nom || "—"}</td>
                    <td>
                      {task.assignes?.length ? (
                        <span className="at-assignee">
                          {task.assignes
                            .map((a) => `${a.prenom} ${a.nom}`)
                            .join(", ")}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={isOverdue(task) ? "at-overdue" : "at-cell-muted"}>
                      {formatDeadline(task.deadline)}
                    </td>
                    <td>
                      <span
                        className="at-badge"
                        style={{
                          color: PRIORITE_COLORS[task.priorite],
                          background: `${PRIORITE_COLORS[task.priorite]}22`,
                          border: `1px solid ${PRIORITE_COLORS[task.priorite]}55`,
                        }}
                      >
                        {PRIORITE_LABELS[task.priorite]}
                      </span>
                    </td>
                    <td>
                      <span
                        className="at-badge"
                        style={{
                          color: STATUT_COLORS[task.statut],
                          background: `${STATUT_COLORS[task.statut]}22`,
                          border: `1px solid ${STATUT_COLORS[task.statut]}55`,
                        }}
                      >
                        {STATUT_LABELS[task.statut]}
                      </span>
                    </td>
                    <td>
                      <div className="at-actions">
                        <button
                          className="at-action edit"
                          onClick={() => handleEdit(task)}
                          title="Modifier"
                        >
                          <HiPencil />
                        </button>
                        <button
                          className="at-action delete"
                          onClick={() => handleDelete(task)}
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
        )}
      </div>

      {modalOpen && (
        <TacheModal
          task={selected}
          onClose={() => {
            setModalOpen(false);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
};

export default AdminTachesScreen;
