// src/screens/user/MesTachesScreen.jsx
import React from "react";
import { HiRefresh } from "react-icons/hi";
import {
  useGetTasksQuery,
  useUpdateTaskStatutMutation,
} from "../../slices/taskApiSlice";
import {
  TASK_STATUTS,
  STATUT_LABELS,
  STATUT_COLORS,
  PRIORITE_LABELS,
  PRIORITE_COLORS,
  formatDeadline,
  isOverdue,
} from "../../config/taskMeta";
import "./MesTachesScreen.css";

const MesTachesScreen = () => {
  const { data: tasks, isLoading, error, refetch } = useGetTasksQuery();
  const [updateStatut] = useUpdateTaskStatutMutation();

  const handleStatut = async (task, statut) => {
    try {
      await updateStatut({ id: task._id, statut }).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Erreur lors de la mise à jour");
    }
  };

  if (isLoading) return <div className="admin-loading">Chargement...</div>;
  if (error)
    return <div className="admin-error">Erreur: {error?.data?.message}</div>;

  return (
    <div className="mes-taches">
      <div className="mes-taches-header">
        <h1>Mes tâches</h1>
        <button className="btn-icon" onClick={refetch} title="Rafraîchir">
          <HiRefresh />
        </button>
      </div>

      {tasks?.length === 0 ? (
        <div className="mes-taches-empty">
          Aucune tâche assignée pour le moment. 🎉
        </div>
      ) : (
        <div className="mes-taches-list">
          {tasks?.map((task) => (
            <div
              key={task._id}
              className={`tache-item ${task.statut === "termine" ? "done" : ""}`}
              style={{ borderLeftColor: STATUT_COLORS[task.statut] }}
            >
              <div className="tache-item-main">
                <div className="tache-item-title">
                  <strong>{task.titre}</strong>
                  <span
                    className="tache-badge"
                    style={{
                      color: PRIORITE_COLORS[task.priorite],
                      background: `${PRIORITE_COLORS[task.priorite]}1a`,
                    }}
                  >
                    {PRIORITE_LABELS[task.priorite]}
                  </span>
                </div>
                {task.description && (
                  <p className="tache-item-desc">{task.description}</p>
                )}
                <div className="tache-item-meta">
                  <span className={isOverdue(task) ? "tache-overdue" : ""}>
                    Échéance : {formatDeadline(task.deadline)}
                  </span>
                  {task.equipe?.nom && <span>• {task.equipe.nom}</span>}
                </div>
              </div>

              <div className="tache-item-statut">
                <label>Statut</label>
                <select
                  value={task.statut}
                  onChange={(e) => handleStatut(task, e.target.value)}
                  style={{ color: STATUT_COLORS[task.statut] }}
                >
                  {TASK_STATUTS.map((s) => (
                    <option key={s} value={s}>
                      {STATUT_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MesTachesScreen;
