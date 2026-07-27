// src/components/Admin/TacheModal.jsx
import React, { useState, useEffect, useMemo } from "react";
import { HiX } from "react-icons/hi";
import {
  useCreateTaskMutation,
  useUpdateTaskMutation,
} from "../../slices/taskApiSlice";
import { useGetTeamsQuery } from "../../slices/teamApiSlice";
import {
  TASK_STATUTS,
  TASK_PRIORITES,
  STATUT_LABELS,
  PRIORITE_LABELS,
} from "../../config/taskMeta";
import "./UserModal.css";

// Convertit une date ISO en valeur d'input type="date" (yyyy-mm-dd).
const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

const TacheModal = ({ task, onClose }) => {
  const isEdit = !!task;
  const { data: teams } = useGetTeamsQuery();
  const [createTask, { isLoading: isCreating }] = useCreateTaskMutation();
  const [updateTask, { isLoading: isUpdating }] = useUpdateTaskMutation();

  const [form, setForm] = useState({
    titre: "",
    description: "",
    equipe: "",
    assignes: [],
    deadline: "",
    priorite: "normale",
    statut: "a_faire",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    if (task) {
      setForm({
        titre: task.titre || "",
        description: task.description || "",
        equipe: task.equipe?._id || task.equipe || "",
        assignes: (task.assignes || []).map((a) => a._id || a),
        deadline: toDateInput(task.deadline),
        priorite: task.priorite || "normale",
        statut: task.statut || "a_faire",
      });
    }
  }, [task]);

  // Membres de l'équipe sélectionnée (pour le champ « Assigné à »).
  const membresDispo = useMemo(() => {
    const team = (teams || []).find(
      (t) => t._id === (form.equipe?._id || form.equipe),
    );
    return team?.membres || [];
  }, [teams, form.equipe]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      // Changer d'équipe réinitialise les assignés (ils doivent en être membres).
      if (name === "equipe") next.assignes = [];
      return next;
    });
  };

  // Coche/décoche un membre assigné.
  const toggleAssigne = (userId) =>
    setForm((prev) => ({
      ...prev,
      assignes: prev.assignes.includes(userId)
        ? prev.assignes.filter((id) => id !== userId)
        : [...prev.assignes, userId],
    }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.titre || !form.equipe || form.assignes.length === 0) {
      setError("Titre, équipe et au moins un assigné sont requis");
      return;
    }
    const payload = {
      titre: form.titre,
      description: form.description,
      equipe: form.equipe,
      assignes: form.assignes,
      deadline: form.deadline || null,
      priorite: form.priorite,
    };
    try {
      if (isEdit) {
        await updateTask({ id: task._id, ...payload, statut: form.statut }).unwrap();
      } else {
        await createTask(payload).unwrap();
      }
      onClose();
    } catch (err) {
      setError(err?.data?.message || "Une erreur est survenue");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? "Modifier la tâche" : "Nouvelle tâche"}</h2>
          <button className="btn-close" onClick={onClose}>
            <HiX />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-group">
            <label>Titre</label>
            <input
              type="text"
              name="titre"
              value={form.titre}
              onChange={handleChange}
              placeholder="Ex : Ranger la zone 3"
              required
            />
          </div>

          <div className="form-group">
            <label>Description (optionnel)</label>
            <input
              type="text"
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Détails de la tâche"
            />
          </div>

          <div className="form-group">
            <label>Équipe</label>
            <select
              name="equipe"
              value={form.equipe}
              onChange={handleChange}
              disabled={isEdit}
              required
            >
              <option value="">Sélectionner...</option>
              {(teams || []).map((t) => (
                <option key={t._id} value={t._id}>
                  {t.nom} ({t.entreprise?.trigramme || "—"})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>
              Assigné(s) à{" "}
              {form.assignes.length > 0 && `(${form.assignes.length})`}
            </label>
            {!form.equipe ? (
              <span className="label-hint">
                Sélectionnez d'abord une équipe.
              </span>
            ) : membresDispo.length === 0 ? (
              <span className="label-hint">Cette équipe n'a aucun membre.</span>
            ) : (
              <div className="tache-assignes">
                {membresDispo.map((m) => {
                  const id = m._id || m;
                  const checked = form.assignes.includes(id);
                  return (
                    <button
                      type="button"
                      key={id}
                      className={`tache-assigne ${checked ? "on" : ""}`}
                      onClick={() => toggleAssigne(id)}
                    >
                      <span className="tache-assigne-check">
                        {checked ? "✓" : ""}
                      </span>
                      {m.prenom} {m.nom}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Échéance (optionnel)</label>
              <input
                type="date"
                name="deadline"
                value={form.deadline}
                onChange={handleChange}
              />
            </div>
            <div className="form-group">
              <label>Priorité</label>
              <select
                name="priorite"
                value={form.priorite}
                onChange={handleChange}
              >
                {TASK_PRIORITES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITE_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isEdit && (
            <div className="form-group">
              <label>Statut</label>
              <select name="statut" value={form.statut} onChange={handleChange}>
                {TASK_STATUTS.map((s) => (
                  <option key={s} value={s}>
                    {STATUT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Annuler
            </button>
            <button
              type="submit"
              className="btn-submit"
              disabled={isCreating || isUpdating}
            >
              {isCreating || isUpdating
                ? "Enregistrement..."
                : isEdit
                  ? "Modifier"
                  : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TacheModal;
