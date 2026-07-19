// src/components/Admin/EquipeModal.jsx
import React, { useState, useEffect, useMemo } from "react";
import { useSelector } from "react-redux";
import { HiX } from "react-icons/hi";
import {
  useCreateTeamMutation,
  useUpdateTeamMutation,
} from "../../slices/teamApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { useGetUsersQuery } from "../../slices/userApiSlice";
import { actorGrantableEntrepriseIds } from "../../config/adminModules";
import "./UserModal.css";

const EquipeModal = ({ team, onClose }) => {
  const isEdit = !!team;
  const { userInfo: actor } = useSelector((state) => state.auth);
  const isResponsable = actor?.role === "responsable";

  const [form, setForm] = useState({
    nom: "",
    entreprise: "",
    responsable: "",
    description: "",
  });
  const [error, setError] = useState("");

  const { data: entreprises } = useGetEntreprisesQuery();
  const { data: users } = useGetUsersQuery();
  const [createTeam, { isLoading: isCreating }] = useCreateTeamMutation();
  const [updateTeam, { isLoading: isUpdating }] = useUpdateTeamMutation();

  // Entreprises que l'acteur peut utiliser (null = toutes).
  const grantableEntIds = actorGrantableEntrepriseIds(actor);
  const entreprisesDispo = useMemo(() => {
    const list = entreprises || [];
    if (grantableEntIds === null) return list;
    return list.filter((e) => grantableEntIds.includes(e._id));
  }, [entreprises, grantableEntIds]);

  // Responsables sélectionnables (admins) : users de rôle "responsable" du scope.
  const responsablesDispo = useMemo(
    () => (users || []).filter((u) => u.role === "responsable"),
    [users],
  );

  useEffect(() => {
    if (team) {
      setForm({
        nom: team.nom || "",
        entreprise: team.entreprise?._id || team.entreprise || "",
        responsable: team.responsable?._id || team.responsable || "",
        description: team.description || "",
      });
    }
  }, [team]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.nom || !form.entreprise) {
      setError("Nom et entreprise sont requis");
      return;
    }
    if (!isResponsable && !isEdit && !form.responsable) {
      setError("Veuillez désigner un responsable");
      return;
    }

    // Un responsable ne renseigne pas ce champ (le backend force = lui-même).
    const payload = {
      nom: form.nom,
      entreprise: form.entreprise,
      description: form.description,
    };
    if (!isResponsable && form.responsable) {
      payload.responsable = form.responsable;
    }

    try {
      if (isEdit) {
        await updateTeam({ id: team._id, ...payload }).unwrap();
      } else {
        await createTeam(payload).unwrap();
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
          <h2>{isEdit ? "Modifier l'équipe" : "Nouvelle équipe"}</h2>
          <button className="btn-close" onClick={onClose}>
            <HiX />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-group">
            <label>Nom de l'équipe</label>
            <input
              type="text"
              name="nom"
              value={form.nom}
              onChange={handleChange}
              placeholder="Ex : Réception matin"
              required
            />
          </div>

          <div className="form-group">
            <label>Entreprise</label>
            <select
              name="entreprise"
              value={form.entreprise}
              onChange={handleChange}
              disabled={isEdit}
              required
            >
              <option value="">Sélectionner...</option>
              {entreprisesDispo.map((e) => (
                <option key={e._id} value={e._id}>
                  {e.trigramme} — {e.nomComplet}
                </option>
              ))}
            </select>
          </div>

          {/* Le responsable n'est désignable que par un admin. Un responsable
              crée toujours des équipes qu'il dirige lui-même. */}
          {!isResponsable && (
            <div className="form-group">
              <label>Responsable</label>
              <select
                name="responsable"
                value={form.responsable}
                onChange={handleChange}
              >
                <option value="">Sélectionner un responsable...</option>
                {responsablesDispo.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.prenom} {u.nom} ({u.email})
                  </option>
                ))}
              </select>
              {responsablesDispo.length === 0 && (
                <span className="label-hint">
                  Aucun utilisateur « responsable » disponible — créez-en un
                  d'abord.
                </span>
              )}
            </div>
          )}

          <div className="form-group">
            <label>Description (optionnel)</label>
            <input
              type="text"
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Rôle de l'équipe"
            />
          </div>

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

export default EquipeModal;
