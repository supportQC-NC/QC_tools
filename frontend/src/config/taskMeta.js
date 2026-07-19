// src/config/taskMeta.js
// Métadonnées d'affichage des tâches (miroir des enums backend TaskModel).

export const TASK_STATUTS = ["a_faire", "en_cours", "termine", "bloque"];
export const TASK_PRIORITES = ["basse", "normale", "haute", "urgente"];

export const STATUT_LABELS = {
  a_faire: "À faire",
  en_cours: "En cours",
  termine: "Terminé",
  bloque: "Bloqué",
};

export const STATUT_COLORS = {
  a_faire: "#64748b",
  en_cours: "#3b82f6",
  termine: "#22c55e",
  bloque: "#ef4444",
};

export const PRIORITE_LABELS = {
  basse: "Basse",
  normale: "Normale",
  haute: "Haute",
  urgente: "Urgente",
};

export const PRIORITE_COLORS = {
  basse: "#94a3b8",
  normale: "#64748b",
  haute: "#f59e0b",
  urgente: "#ef4444",
};

// Formatte une date d'échéance (ou "—").
export const formatDeadline = (d) =>
  d
    ? new Date(d).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

// Une échéance est-elle dépassée (et la tâche non terminée) ?
export const isOverdue = (task) =>
  task?.deadline &&
  task.statut !== "termine" &&
  new Date(task.deadline) < new Date(new Date().toDateString());
