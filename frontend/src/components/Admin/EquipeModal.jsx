// src/components/Admin/EquipeModal.jsx
import React, { useState, useEffect, useMemo } from "react";
import { useSelector } from "react-redux";
import { HiX } from "react-icons/hi";
import {
  useCreateTeamMutation,
  useUpdateTeamMutation,
} from "../../slices/teamApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetUsersQuery,
  useGetAssignableUsersQuery,
} from "../../slices/userApiSlice";
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
  // Membres pré-sélectionnés à la création (l'édition des membres se fait dans
  // l'écran détail). Tableau d'ids User.
  const [membres, setMembres] = useState([]);
  const [error, setError] = useState("");

  const { data: entreprises } = useGetEntreprisesQuery();
  const { data: users } = useGetUsersQuery();
  // Périmètre société : tous les users que l'acteur peut rattacher à une équipe
  // (y compris multi-sociétés). Sert au choix des membres à la création.
  const { data: assignables } = useGetAssignableUsersQuery();
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

  // Membres sélectionnables : tout le périmètre société, sauf le responsable de
  // l'équipe (lui-même pour un responsable, le responsable choisi pour un admin).
  const leadId = isResponsable ? actor?._id : form.responsable;
  const membresDispo = useMemo(
    () => (assignables || []).filter((u) => u._id !== leadId),
    [assignables, leadId],
  );

  const toggleMembre = (id) =>
    setMembres((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
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
        // Membres pré-sélectionnés uniquement à la création.
        await createTeam({ ...payload, membres }).unwrap();
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

          {/* Membres : sélection à la création. En édition, on gère les membres
              depuis l'écran détail de l'équipe. */}
          {!isEdit && (
            <div className="form-group">
              <label>Membres (optionnel)</label>
              {membresDispo.length === 0 ? (
                <span className="label-hint">
                  Aucun utilisateur disponible dans vos sociétés.
                </span>
              ) : (
                <div className="eq-members-picker">
                  {membresDispo.map((u) => (
                    <label key={u._id} className="eq-member-check">
                      <input
                        type="checkbox"
                        checked={membres.includes(u._id)}
                        onChange={() => toggleMembre(u._id)}
                      />
                      <span>
                        {u.prenom} {u.nom} ({u.email})
                        {u.entreprises?.length
                          ? ` — ${u.entreprises.join(", ")}`
                          : ""}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {membres.length > 0 && (
                <span className="label-hint">
                  {membres.length} membre(s) sélectionné(s).
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
