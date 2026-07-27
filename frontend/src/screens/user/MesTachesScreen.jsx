// src/screens/user/MesTachesScreen.jsx
//
// « Mes tâches » — tableau type Trello. Colonnes actives (À faire / En cours /
// Bloqué) + bande « Terminées » (archive) repliable. Glisser-déposer pour
// changer de statut. Tout utilisateur crée des tâches PERSO (fond distinct,
// éditables). Cartes cliquables -> détail + documents.
import React, { useEffect, useMemo, useState } from "react";
import {
  HiRefresh,
  HiClipboardCheck,
  HiExclamationCircle,
  HiCalendar,
  HiUserGroup,
  HiPlus,
  HiUser,
  HiPaperClip,
  HiChevronDown,
  HiChevronRight,
  HiCheckCircle,
} from "react-icons/hi";
import {
  useGetTasksQuery,
  useUpdateTaskStatutMutation,
} from "../../slices/taskApiSlice";
import { useMarkTasksSeenMutation } from "../../slices/notificationApiSlice";
import PersoTaskModal from "../../components/user/PersoTaskModal";
import {
  STATUT_LABELS,
  STATUT_COLORS,
  PRIORITE_LABELS,
  PRIORITE_COLORS,
  formatDeadline,
  isOverdue,
} from "../../config/taskMeta";
import "./MesTachesScreen.css";

const isPerso = (t) => t.type === "perso";
// Colonnes ACTIVES (le statut "termine" est archivé à part).
const ACTIVE_STATUTS = ["a_faire", "en_cours", "bloque"];

const MesTachesScreen = () => {
  const { data: tasks, isLoading, error, refetch, isFetching } =
    useGetTasksQuery({ mine: true });
  const [updateStatut] = useUpdateTaskStatutMutation();

  // Ouvrir « Mes tâches » = marquer les tâches comme vues (efface le badge).
  const [markTasksSeen] = useMarkTasksSeenMutation();
  useEffect(() => {
    markTasksSeen();
  }, [markTasksSeen]);

  const [modal, setModal] = useState(null); // null | "create" | task
  const [dragId, setDragId] = useState(null);
  const [overZone, setOverZone] = useState(null);
  const [showArchive, setShowArchive] = useState(false);

  const { columns, archived } = useMemo(() => {
    const cols = Object.fromEntries(ACTIVE_STATUTS.map((s) => [s, []]));
    const arch = [];
    (tasks || []).forEach((t) => {
      if (t.archive || t.statut === "termine") arch.push(t);
      else if (cols[t.statut]) cols[t.statut].push(t);
    });
    return { columns: cols, archived: arch };
  }, [tasks]);

  const stats = useMemo(() => {
    const list = tasks || [];
    return {
      total: list.length,
      perso: list.filter(isPerso).length,
      retard: list.filter((t) => isOverdue(t)).length,
    };
  }, [tasks]);

  const moveTo = async (statut) => {
    const id = dragId;
    setDragId(null);
    setOverZone(null);
    if (!id) return;
    const task = (tasks || []).find((t) => t._id === id);
    if (!task || task.statut === statut) return;
    try {
      await updateStatut({ id, statut }).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Impossible de changer le statut");
    }
  };

  const renderCard = (task) => {
    const perso = isPerso(task);
    const overdue = isOverdue(task);
    const nbDocs = task.documents?.length || 0;
    return (
      <div
        key={task._id}
        className={`mt-task ${perso ? "perso" : ""} ${
          dragId === task._id ? "dragging" : ""
        } ${task.archive ? "archived" : ""}`}
        draggable
        onDragStart={() => setDragId(task._id)}
        onDragEnd={() => {
          setDragId(null);
          setOverZone(null);
        }}
        onClick={() => setModal(task)}
        title="Cliquer pour voir / gérer"
      >
        <div className="mt-task-top">
          <span
            className="mt-prio"
            style={{
              color: PRIORITE_COLORS[task.priorite],
              background: `${PRIORITE_COLORS[task.priorite]}22`,
              border: `1px solid ${PRIORITE_COLORS[task.priorite]}55`,
            }}
          >
            {PRIORITE_LABELS[task.priorite]}
          </span>
          {perso ? (
            <span className="mt-tag perso">
              <HiUser /> Perso
            </span>
          ) : (
            task.equipe?.nom && (
              <span className="mt-tag">
                <HiUserGroup /> {task.equipe.nom}
              </span>
            )
          )}
        </div>

        <p className="mt-task-title">{task.titre}</p>
        {task.description && <p className="mt-task-desc">{task.description}</p>}

        <div className="mt-task-foot">
          {task.deadline && (
            <span className={`mt-task-deadline ${overdue ? "overdue" : ""}`}>
              <HiCalendar />
              {formatDeadline(task.deadline)}
              {overdue && " · retard"}
            </span>
          )}
          {nbDocs > 0 && (
            <span className="mt-task-docs">
              <HiPaperClip />
              {nbDocs}
            </span>
          )}
        </div>
      </div>
    );
  };

  if (isLoading)
    return (
      <div className="mes-taches">
        <div className="mt-loading">
          <div className="mt-spinner" />
          <p>Chargement de vos tâches…</p>
        </div>
      </div>
    );
  if (error)
    return (
      <div className="mes-taches">
        <div className="mt-error">
          <HiExclamationCircle />
          <p>Erreur : {error?.data?.message || "chargement impossible"}</p>
          <button onClick={refetch}>Réessayer</button>
        </div>
      </div>
    );

  return (
    <div className="mes-taches">
      <header className="mt-header">
        <div className="mt-header-title">
          <div className="mt-header-icon">
            <HiClipboardCheck />
          </div>
          <div>
            <h1>Mes tâches</h1>
            <p className="mt-header-sub">
              {stats.total} tâche{stats.total > 1 ? "s" : ""} · {stats.perso}{" "}
              perso · {stats.retard} en retard
            </p>
          </div>
        </div>
        <div className="mt-header-actions">
          <button
            className="mt-refresh"
            onClick={refetch}
            disabled={isFetching}
            title="Rafraîchir"
          >
            <HiRefresh className={isFetching ? "spinning" : ""} />
          </button>
          <button className="mt-new" onClick={() => setModal("create")}>
            <HiPlus />
            <span>Nouvelle tâche</span>
          </button>
        </div>
      </header>

      <p className="mt-hint">
        Glissez-déposez une carte pour changer son statut. Les tâches{" "}
        <span className="mt-hint-perso">personnelles</span> (fond violet) sont
        cliquables et modifiables. Une tâche terminée est archivée automatiquement.
      </p>

      <div className="mt-board">
        {ACTIVE_STATUTS.map((statut) => (
          <div
            key={statut}
            className={`mt-col ${overZone === statut ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (overZone !== statut) setOverZone(statut);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setOverZone(null);
            }}
            onDrop={() => moveTo(statut)}
          >
            <div className="mt-col-head">
              <span
                className="mt-col-dot"
                style={{ background: STATUT_COLORS[statut] }}
              />
              <span className="mt-col-title">{STATUT_LABELS[statut]}</span>
              <span className="mt-col-count">{columns[statut].length}</span>
            </div>
            <div className="mt-col-body">
              {columns[statut].length === 0 ? (
                <div className="mt-col-empty">Déposez ici</div>
              ) : (
                columns[statut].map(renderCard)
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Bande ARCHIVE / Terminées (zone de dépôt + repliable) */}
      <div
        className={`mt-archive ${overZone === "termine" ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (overZone !== "termine") setOverZone("termine");
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setOverZone(null);
        }}
        onDrop={() => moveTo("termine")}
      >
        <button
          className="mt-archive-head"
          onClick={() => setShowArchive((v) => !v)}
        >
          {showArchive ? <HiChevronDown /> : <HiChevronRight />}
          <HiCheckCircle style={{ color: STATUT_COLORS.termine }} />
          <span>Terminées (archivées)</span>
          <span className="mt-col-count">{archived.length}</span>
          <span className="mt-archive-hint">
            Déposez une carte ici pour la marquer terminée
          </span>
        </button>
        {showArchive && (
          <div className="mt-archive-body">
            {archived.length === 0 ? (
              <div className="mt-col-empty">Aucune tâche terminée</div>
            ) : (
              archived.map(renderCard)
            )}
          </div>
        )}
      </div>

      {modal && (
        <PersoTaskModal
          task={modal === "create" ? null : modal}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
};

export default MesTachesScreen;
