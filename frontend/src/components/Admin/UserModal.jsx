// src/components/admin/UserModal.jsx
import React, { useState, useEffect } from "react";
import { HiX, HiChevronDown, HiCheck } from "react-icons/hi";
import {
  useCreateUserMutation,
  useUpdateUserMutation,
} from "../../slices/userApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import "./UserModal.css";

// Définition des modules alignée avec menuConfig.js
const moduleConfig = {
  stock: "Recherche Article",
  inventaire: "Inventaire",
  reapro: "Reapro",
  proformas: "Proformats",
  ctr_commande: "CTRL Commandes",
  prep_commande: "PREPA Commandes",
  ctrl_info_produit: "CTRL Infos Produit",
  releve: "Releve Prix",
};

const modules = Object.keys(moduleConfig);

// Fonction pour générer les permissions par défaut des modules
const getDefaultModulePermissions = () => {
  const permissions = {};
  modules.forEach((module) => {
    permissions[module] = { read: false, write: false, delete: false };
  });
  return permissions;
};

const UserModal = ({ user, onClose }) => {
  const isEdit = !!user;
  const [entreprisesOpen, setEntreprisesOpen] = useState(false);

  const [formData, setFormData] = useState({
    nom: "",
    prenom: "",
    email: "",
    password: "",
    role: "user",
    isActive: true,
    permissions: {
      allEntreprises: false,
      allModules: false,
      entreprises: [],
      modules: getDefaultModulePermissions(),
    },
  });

  const [error, setError] = useState("");

  const [createUser, { isLoading: isCreating }] = useCreateUserMutation();
  const [updateUser, { isLoading: isUpdating }] = useUpdateUserMutation();
  const { data: entreprises, isLoading: isLoadingEntreprises } =
    useGetEntreprisesQuery();

  useEffect(() => {
    if (user) {
      // Construire les permissions des modules en préservant les valeurs existantes
      const modulePermissions = getDefaultModulePermissions();
      modules.forEach((module) => {
        if (user.permissions?.modules?.[module]) {
          modulePermissions[module] = {
            read: user.permissions.modules[module].read || false,
            write: user.permissions.modules[module].write || false,
            delete: user.permissions.modules[module].delete || false,
          };
        }
      });

      setFormData({
        nom: user.nom || "",
        prenom: user.prenom || "",
        email: user.email || "",
        password: "",
        role: user.role || "user",
        isActive: user.isActive ?? true,
        permissions: {
          allEntreprises: user.permissions?.allEntreprises || false,
          allModules: user.permissions?.allModules || false,
          entreprises:
            user.permissions?.entreprises?.map((e) => e._id || e) || [],
          modules: modulePermissions,
        },
      });
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handlePermissionChange = (module, action) => {
    setFormData((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        modules: {
          ...prev.permissions.modules,
          [module]: {
            ...prev.permissions.modules[module],
            [action]: !prev.permissions.modules[module][action],
          },
        },
      },
    }));
  };

  const handleGlobalPermissionChange = (field) => {
    setFormData((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [field]: !prev.permissions[field],
      },
    }));
  };

  // Toggle une entreprise dans la sélection
  const handleEntrepriseToggle = (entrepriseId) => {
    setFormData((prev) => {
      const currentEntreprises = prev.permissions.entreprises;
      const isSelected = currentEntreprises.includes(entrepriseId);

      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          entreprises: isSelected
            ? currentEntreprises.filter((id) => id !== entrepriseId)
            : [...currentEntreprises, entrepriseId],
        },
      };
    });
  };

  // Sélectionner/Désélectionner toutes les entreprises
  const handleSelectAllEntreprises = () => {
    const allIds = entreprises?.map((e) => e._id) || [];
    const allSelected =
      allIds.length > 0 &&
      allIds.every((id) => formData.permissions.entreprises.includes(id));

    setFormData((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        entreprises: allSelected ? [] : allIds,
      },
    }));
  };

  // Obtenir les noms des entreprises sélectionnées pour l'affichage
  const getSelectedEntreprisesText = () => {
    const selected = formData.permissions.entreprises;
    if (selected.length === 0) return "Sélectionner les entreprises...";
    if (selected.length === entreprises?.length)
      return "Toutes les entreprises";

    const names = entreprises
      ?.filter((e) => selected.includes(e._id))
      .map((e) => e.trigramme)
      .slice(0, 3)
      .join(", ");

    if (selected.length > 3) {
      return `${names} +${selected.length - 3}`;
    }
    return names;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      if (isEdit) {
        await updateUser({ id: user._id, ...formData }).unwrap();
      } else {
        if (!formData.password) {
          setError("Le mot de passe est requis");
          return;
        }
        await createUser(formData).unwrap();
      }
      onClose();
    } catch (err) {
      setError(err?.data?.message || "Une erreur est survenue");
    }
  };

  const actions = ["read", "write", "delete"];
  const actionLabels = { read: "Lecture", write: "Écriture", delete: "Suppr." };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? "Modifier l'utilisateur" : "Nouvel utilisateur"}</h2>
          <button className="btn-close" onClick={onClose}>
            <HiX />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-row">
            <div className="form-group">
              <label>Prénom</label>
              <input
                type="text"
                name="prenom"
                value={formData.prenom}
                onChange={handleChange}
                placeholder="Jean"
                required
              />
            </div>
            <div className="form-group">
              <label>Nom</label>
              <input
                type="text"
                name="nom"
                value={formData.nom}
                onChange={handleChange}
                placeholder="Dupont"
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="jean.dupont@entreprise.com"
              required
            />
          </div>

          <div className="form-group">
            <label>
              {isEdit ? "Nouveau mot de passe" : "Mot de passe"}
              {isEdit && (
                <span className="label-hint">
                  {" "}
                  (laisser vide pour ne pas changer)
                </span>
              )}
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="••••••••"
              required={!isEdit}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Rôle</label>
              <select name="role" value={formData.role} onChange={handleChange}>
                <option value="user">Utilisateur</option>
                <option value="admin">Administrateur</option>
              </select>
            </div>
            <div className="form-group form-group-checkbox">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleChange}
                />
                <span>Compte actif</span>
              </label>
            </div>
          </div>

          {formData.role !== "admin" && (
            <div className="permissions-section">
              <h3>Permissions</h3>

              <div className="global-permissions">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.permissions.allEntreprises}
                    onChange={() =>
                      handleGlobalPermissionChange("allEntreprises")
                    }
                  />
                  <span>Toutes les entreprises</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={formData.permissions.allModules}
                    onChange={() => handleGlobalPermissionChange("allModules")}
                  />
                  <span>Tous les modules</span>
                </label>
              </div>

              {/* Sélection des entreprises */}
              {!formData.permissions.allEntreprises && (
                <div className="form-group">
                  <label>Entreprises accessibles</label>
                  <div className="multi-select">
                    <div
                      className="multi-select-trigger"
                      onClick={() => setEntreprisesOpen(!entreprisesOpen)}
                    >
                      <span className="multi-select-text">
                        {isLoadingEntreprises
                          ? "Chargement..."
                          : getSelectedEntreprisesText()}
                      </span>
                      <HiChevronDown
                        className={`multi-select-icon ${entreprisesOpen ? "open" : ""}`}
                      />
                    </div>

                    {entreprisesOpen && (
                      <div className="multi-select-dropdown">
                        <div className="multi-select-header">
                          <button
                            type="button"
                            className="btn-select-all"
                            onClick={handleSelectAllEntreprises}
                          >
                            {entreprises?.every((e) =>
                              formData.permissions.entreprises.includes(e._id),
                            )
                              ? "Tout désélectionner"
                              : "Tout sélectionner"}
                          </button>
                          <span className="selected-count">
                            {formData.permissions.entreprises.length}{" "}
                            sélectionnée(s)
                          </span>
                        </div>

                        <div className="multi-select-options">
                          {entreprises?.length === 0 ? (
                            <div className="no-options">
                              Aucune entreprise créée
                            </div>
                          ) : (
                            entreprises?.map((entreprise) => (
                              <div
                                key={entreprise._id}
                                className={`multi-select-option ${
                                  formData.permissions.entreprises.includes(
                                    entreprise._id,
                                  )
                                    ? "selected"
                                    : ""
                                }`}
                                onClick={() =>
                                  handleEntrepriseToggle(entreprise._id)
                                }
                              >
                                <div className="option-checkbox">
                                  {formData.permissions.entreprises.includes(
                                    entreprise._id,
                                  ) && <HiCheck />}
                                </div>
                                <div className="option-content">
                                  <span className="option-trigramme">
                                    {entreprise.trigramme}
                                  </span>
                                  <span className="option-name">
                                    {entreprise.nomComplet}
                                  </span>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Modules */}
              {!formData.permissions.allModules && (
                <div className="modules-permissions">
                  <label>Modules accessibles</label>
                  <table className="permissions-table">
                    <thead>
                      <tr>
                        <th>Module</th>
                        {actions.map((action) => (
                          <th key={action}>{actionLabels[action]}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {modules.map((module) => (
                        <tr key={module}>
                          <td className="module-name">
                            {moduleConfig[module]}
                          </td>
                          {actions.map((action) => (
                            <td key={action}>
                              <input
                                type="checkbox"
                                checked={
                                  formData.permissions.modules[module]?.[
                                    action
                                  ] || false
                                }
                                onChange={() =>
                                  handlePermissionChange(module, action)
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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

export default UserModal;
