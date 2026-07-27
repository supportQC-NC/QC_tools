// src/components/user/PersoTaskModal.jsx
//
// Modale de tâche côté utilisateur :
//   - création d'une tâche PERSONNELLE (pour soi) ;
//   - consultation d'une tâche existante (perso éditable, équipe en lecture) ;
//   - gestion des DOCUMENTS (PDF/Excel/images) : dépôt par le créateur ou
//     l'assigné, consultation et suppression.
import React, { useState } from "react";
import { useSelector } from "react-redux";
import {
  HiX,
  HiTrash,
  HiPaperClip,
  HiPlus,
  HiDownload,
  HiExternalLink,
  HiDocumentText,
  HiPhotograph,
  HiTable,
} from "react-icons/hi";
import {
  useCreatePersonalTaskMutation,
  useUpdateTaskMutation,
  useDeleteTaskMutation,
  useAddTaskDocumentsMutation,
  useDeleteTaskDocumentMutation,
  taskDocumentUrl,
} from "../../slices/taskApiSlice";
import {
  TASK_PRIORITES,
  PRIORITE_LABELS,
  STATUT_LABELS,
} from "../../config/taskMeta";
import { triggerDownload, openInNewTab } from "../../utils/executableHelpers";
import ChatPanel from "../chat/ChatPanel";

const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

const docIcon = (kind) => {
  if (kind === "image") return <HiPhotograph />;
  if (kind === "tableur") return <HiTable />;
  return <HiDocumentText />;
};

const PersoTaskModal = ({ task, onClose }) => {
  const isEdit = !!task;
  const isPerso = !task || task.type === "perso";
  const editable = !isEdit || isPerso; // champs modifiables (création ou perso)

  const { userInfo } = useSelector((state) => state.auth);
  const myId = userInfo?._id;

  const [createPerso, { isLoading: creating }] = useCreatePersonalTaskMutation();
  const [updateTask, { isLoading: updating }] = useUpdateTaskMutation();
  const [deleteTask, { isLoading: deleting }] = useDeleteTaskMutation();
  const [addDocuments, { isLoading: uploading }] = useAddTaskDocumentsMutation();
  const [deleteDocument] = useDeleteTaskDocumentMutation();

  const [form, setForm] = useState({
    titre: task?.titre || "",
    description: task?.description || "",
    deadline: toDateInput(task?.deadline),
    priorite: task?.priorite || "normale",
  });
  const [pendingDocs, setPendingDocs] = useState([]); // création : à envoyer après
  const [error, setError] = useState("");

  const documents = task?.documents || [];

  const handleChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (editable && !form.titre.trim()) {
      setError("Le titre est requis.");
      return;
    }
    try {
      if (!isEdit) {
        // Création perso puis upload des documents joints.
        const created = await createPerso({
          titre: form.titre.trim(),
          description: form.description,
          deadline: form.deadline || null,
          priorite: form.priorite,
        }).unwrap();
        if (pendingDocs.length) {
          await addDocuments({ id: created._id, documents: pendingDocs }).unwrap();
        }
      } else if (editable) {
        await updateTask({
          id: task._id,
          titre: form.titre.trim(),
          description: form.description,
          deadline: form.deadline || null,
          priorite: form.priorite,
        }).unwrap();
      }
      onClose();
    } catch (err) {
      setError(err?.data?.message || "Une erreur est survenue.");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Supprimer la tâche « ${task.titre} » ?`)) return;
    try {
      await deleteTask(task._id).unwrap();
      onClose();
    } catch (err) {
      setError(err?.data?.message || "Erreur lors de la suppression.");
    }
  };

  // Sélection de fichiers : à la création on cumule ; sur une tâche existante on
  // envoie immédiatement.
  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    if (!isEdit) {
      setPendingDocs((prev) => [...prev, ...files]);
      return;
    }
    try {
      await addDocuments({ id: task._id, documents: files }).unwrap();
    } catch (err) {
      setError(err?.data?.message || "Erreur lors de l'ajout du document.");
    }
  };

  const handleRemovePending = (i) =>
    setPendingDocs((prev) => prev.filter((_, idx) => idx !== i));

  const handleDeleteDoc = async (doc) => {
    if (!window.confirm(`Supprimer « ${doc.fileName} » ?`)) return;
    try {
      await deleteDocument({ id: task._id, docId: doc._id }).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Suppression impossible.");
    }
  };

  const canDeleteDoc = (doc) =>
    isPerso || (doc.uploadedBy?._id || doc.uploadedBy) === myId;

  return (
    <div className="ptm-overlay" onClick={onClose}>
      <div className="ptm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ptm-head">
          <h2>
            {!isEdit
              ? "Nouvelle tâche personnelle"
              : editable
                ? "Modifier ma tâche"
                : "Détail de la tâche"}
          </h2>
          <button className="ptm-close" onClick={onClose}>
            <HiX />
          </button>
        </div>

        <form className="ptm-form" onSubmit={handleSubmit}>
          {error && <div className="ptm-error">{error}</div>}

          {/* Bandeau contexte pour une tâche d'équipe (lecture seule) */}
          {isEdit && !isPerso && (
            <div className="ptm-context">
              <span className="ptm-context-tag">Tâche d'équipe</span>
              {task.equipe?.nom && <span>Équipe : {task.equipe.nom}</span>}
              <span>Statut : {STATUT_LABELS[task.statut]}</span>
            </div>
          )}

          <div className="ptm-field">
            <label>Titre {editable && "*"}</label>
            {editable ? (
              <input
                name="titre"
                value={form.titre}
                onChange={handleChange}
                placeholder="Ex : Rappeler le fournisseur"
                autoFocus
                required
              />
            ) : (
              <p className="ptm-readonly">{task.titre}</p>
            )}
          </div>

          <div className="ptm-field">
            <label>Description</label>
            {editable ? (
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                placeholder="Détails (optionnel)"
                rows={3}
              />
            ) : (
              <p className="ptm-readonly">{task.description || "—"}</p>
            )}
          </div>

          <div className="ptm-row">
            <div className="ptm-field">
              <label>Échéance</label>
              {editable ? (
                <input
                  type="date"
                  name="deadline"
                  value={form.deadline}
                  onChange={handleChange}
                />
              ) : (
                <p className="ptm-readonly">
                  {task.deadline
                    ? new Date(task.deadline).toLocaleDateString("fr-FR")
                    : "—"}
                </p>
              )}
            </div>
            <div className="ptm-field">
              <label>Priorité</label>
              {editable ? (
                <select name="priorite" value={form.priorite} onChange={handleChange}>
                  {TASK_PRIORITES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITE_LABELS[p]}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="ptm-readonly">{PRIORITE_LABELS[task.priorite]}</p>
              )}
            </div>
          </div>

          {/* Documents */}
          <div className="ptm-field">
            <div className="ptm-docs-head">
              <label>
                <HiPaperClip /> Documents (PDF, Excel, images…)
              </label>
              <label className="ptm-adddoc" title="Ajouter des documents">
                <HiPlus />
                <span>{uploading ? "Envoi…" : "Ajouter"}</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.xls,.xlsx,.csv,image/*"
                  hidden
                  onChange={handleFiles}
                  disabled={uploading}
                />
              </label>
            </div>

            {/* Fichiers en attente (création) */}
            {!isEdit && pendingDocs.length > 0 && (
              <ul className="ptm-doclist">
                {pendingDocs.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <span className="ptm-doc-name">{f.name}</span>
                    <button
                      type="button"
                      className="ptm-doc-x"
                      onClick={() => handleRemovePending(i)}
                    >
                      <HiX />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Documents existants */}
            {isEdit && (
              documents.length === 0 ? (
                <p className="ptm-docs-none">Aucun document.</p>
              ) : (
                <ul className="ptm-doclist">
                  {documents.map((doc) => (
                    <li key={doc._id}>
                      <button
                        type="button"
                        className="ptm-doc-open"
                        onClick={() => openInNewTab(taskDocumentUrl(task._id, doc._id))}
                        title={`Voir ${doc.fileName}`}
                      >
                        {docIcon(doc.kind)}
                        <span className="ptm-doc-name">{doc.fileName}</span>
                        <HiExternalLink className="ptm-doc-ext" />
                      </button>
                      <button
                        type="button"
                        className="ptm-doc-dl"
                        onClick={() =>
                          triggerDownload(
                            taskDocumentUrl(task._id, doc._id),
                            doc.fileName,
                          )
                        }
                        title="Télécharger"
                      >
                        <HiDownload />
                      </button>
                      {canDeleteDoc(doc) && (
                        <button
                          type="button"
                          className="ptm-doc-x"
                          onClick={() => handleDeleteDoc(doc)}
                          title="Supprimer"
                        >
                          <HiX />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>

          <div className="ptm-actions">
            {isEdit && isPerso && (
              <button
                type="button"
                className="ptm-btn-delete"
                onClick={handleDelete}
                disabled={deleting}
              >
                <HiTrash />
                <span>Supprimer</span>
              </button>
            )}
            <div className="ptm-actions-right">
              <button type="button" className="ptm-btn-ghost" onClick={onClose}>
                Fermer
              </button>
              {editable && (
                <button
                  type="submit"
                  className="ptm-btn-primary"
                  disabled={creating || updating}
                >
                  {creating || updating
                    ? "Enregistrement…"
                    : isEdit
                      ? "Enregistrer"
                      : "Créer"}
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Chat de la tâche (manager ↔ assigné) — hors du <form> pour ne pas
            imbriquer deux formulaires. Uniquement pour les tâches d'équipe. */}
        {isEdit && !isPerso && (
          <div className="ptm-chat">
            <ChatPanel
              room={`task:${task._id}`}
              title="Discussion sur la tâche"
              compact
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default PersoTaskModal;
