// src/screens/admin/AdminTachesScreen.jsx
import React, { useMemo, useState } from "react";
import { HiPlus, HiPencil, HiTrash, HiRefresh } from "react-icons/hi";
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

  if (isLoading) return <div className="admin-loading">Chargement...</div>;
  if (error)
    return <div className="admin-error">Erreur: {error?.data?.message}</div>;

  return (
    <div className="admin-taches">
      <div className="admin-taches-header">
        <h1>Gestion des tâches</h1>
        <div className="admin-taches-actions">
          <button className="btn-icon" onClick={refetch} title="Rafraîchir">
            <HiRefresh />
          </button>
          <button className="btn-primary" onClick={handleCreate}>
            <HiPlus />
            <span>Nouvelle tâche</span>
          </button>
        </div>
      </div>

      <div className="taches-filters">
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

      <div className="admin-users-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Tâche</th>
              <th>Équipe</th>
              <th>Assigné à</th>
              <th>Échéance</th>
              <th>Priorité</th>
              <th>Statut</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tasks?.length === 0 ? (
              <tr>
                <td colSpan="7" className="no-data">
                  Aucune tâche
                </td>
              </tr>
            ) : (
              tasks?.map((task) => (
                <tr key={task._id}>
                  <td>
                    <strong>{task.titre}</strong>
                    {task.description && (
                      <div className="tache-desc">{task.description}</div>
                    )}
                  </td>
                  <td>{task.equipe?.nom || "—"}</td>
                  <td>
                    {task.assigneA
                      ? `${task.assigneA.prenom} ${task.assigneA.nom}`
                      : "—"}
                  </td>
                  <td className={isOverdue(task) ? "tache-overdue" : ""}>
                    {formatDeadline(task.deadline)}
                  </td>
                  <td>
                    <span
                      className="tache-badge"
                      style={{
                        color: PRIORITE_COLORS[task.priorite],
                        background: `${PRIORITE_COLORS[task.priorite]}1a`,
                      }}
                    >
                      {PRIORITE_LABELS[task.priorite]}
                    </span>
                  </td>
                  <td>
                    <span
                      className="tache-badge"
                      style={{
                        color: STATUT_COLORS[task.statut],
                        background: `${STATUT_COLORS[task.statut]}1a`,
                      }}
                    >
                      {STATUT_LABELS[task.statut]}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions">
                      <button
                        className="btn-action btn-edit"
                        onClick={() => handleEdit(task)}
                        title="Modifier"
                      >
                        <HiPencil />
                      </button>
                      <button
                        className="btn-action btn-delete"
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
