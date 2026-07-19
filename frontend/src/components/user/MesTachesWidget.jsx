// src/components/user/MesTachesWidget.jsx
//
// Widget d'accueil : aperçu des tâches ASSIGNÉES à l'utilisateur courant
// (non terminées, échéance la plus proche d'abord). Filtré côté client sur
// assigneA pour rester « personnel » même pour un admin/responsable (dont
// l'API renvoie aussi les tâches qu'il gère).

import React from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { HiClipboardCheck } from "react-icons/hi";
import { useGetTasksQuery } from "../../slices/taskApiSlice";
import {
  STATUT_LABELS,
  STATUT_COLORS,
  formatDeadline,
  isOverdue,
} from "../../config/taskMeta";
import "./MesTachesWidget.css";

const MesTachesWidget = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const { data: tasks } = useGetTasksQuery();

  const myId = userInfo?._id;
  const actives = (tasks || [])
    .filter((t) => {
      const assigneeId = t.assigneA?._id || t.assigneA;
      return assigneeId === myId && t.statut !== "termine";
    })
    .sort((a, b) => {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    })
    .slice(0, 5);

  if (!tasks) return null;

  return (
    <div className="mt-widget">
      <div className="mt-widget-head">
        <div className="mt-widget-title">
          <HiClipboardCheck />
          <h2>Mes tâches</h2>
        </div>
        <Link to="/mes-taches" className="mt-widget-link">
          Voir tout →
        </Link>
      </div>

      {actives.length === 0 ? (
        <p className="mt-widget-empty">Aucune tâche en cours 🎉</p>
      ) : (
        <ul className="mt-widget-list">
          {actives.map((t) => (
            <li key={t._id} className="mt-widget-item">
              <span
                className="mt-widget-dot"
                style={{ background: STATUT_COLORS[t.statut] }}
              />
              <span className="mt-widget-item-titre">{t.titre}</span>
              <span
                className={`mt-widget-item-date ${
                  isOverdue(t) ? "overdue" : ""
                }`}
              >
                {t.deadline ? formatDeadline(t.deadline) : STATUT_LABELS[t.statut]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default MesTachesWidget;
