// src/components/admin/UserModal.jsx
import React, { useState, useEffect } from "react";
import { HiX, HiChevronDown, HiCheck } from "react-icons/hi";
import {
  useCreateUserMutation,
  useUpdateUserMutation,
} from "../../slices/userApiSlice";
import {
  useGetEntreprisesQuery,
  useGetEntrepriseRepresentantsQuery,
} from "../../slices/entrepriseApiSlice";
import "./UserModal.css";

// Définition des modules alignée avec menuConfig.js et le modèle Permission
const moduleConfig = {
  stock: "Recherche Article",
  inventaire: "Inventaire",
  reapro: "Reapro",
  proforma: "Proformas",
  ctr_commande: "CTRL Commandes",
  reception: "Réception marchandises",
  prep_commande: "PREPA Commandes",
  ctrl_info_produit: "CTRL Infos Produit",
  releve: "Releve Prix",
  etiquettes: "Générateur d'étiquettes",
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

// Écrans d'analyse (droit par écran)
const analyseScreens = [
  { key: "commerciaux", label: "Analyse Commerciaux" },
  { key: "reapproLocal", label: "Reappro Local" },
  { key: "debitComptant", label: "Débit / Comptant" },
  { key: "doublonsGencode", label: "Doublons GENCODE" },
];
// Analyse Filiales : droit PAR RÉSEAU (figés : DQ, QC, LD)
const FILIALE_RESEAUX = ["DQ", "QC", "LD"];
const getDefaultAnalyse = () => {
  const a = analyseScreens.reduce((acc, sc) => ({ ...acc, [sc.key]: false }), {});
  a.filiales = FILIALE_RESEAUX.reduce((acc, r) => ({ ...acc, [r]: false }), {});
  return a;
};

// Sélecteur des codes commerciaux d'UNE entreprise (fiche utilisateur).
// "NOM Prénom (code)" si le vendeur est renseigné, sinon juste le code.
const commercialLabel = (r) => (r.nom ? `${r.nom} (${r.code})` : r.code);

const CommerciauxEntreprisePicker = ({
  entreprise,
  selected,
  onToggle,
  onSelectAll,
}) => {
  const { data, isLoading } = useGetEntrepriseRepresentantsQuery(
    entreprise.nomDossierDBF,
  );
  const reps = data?.representants || [];
  const [open, setOpen] = useState(false);
  const allCodes = reps.map((r) => r.code);
  const allSelected =
    allCodes.length > 0 && allCodes.every((c) => selected.includes(c));

  const triggerText =
    selected.length === 0
      ? "Aucun commercial"
      : reps
          .filter((r) => selected.includes(r.code))
          .map(commercialLabel)
          .join(", ");

  return (
    <div className="commerciaux-ent">
      <label className="commerciaux-ent-label">
        {entreprise.trigramme} — {entreprise.nomComplet}
      </label>

      {isLoading ? (
        <span className="permissions-hint">Chargement…</span>
      ) : reps.length === 0 ? (
        <span className="permissions-hint">Aucun commercial détecté</span>
      ) : (
        <div className="multi-select">
          <div className="multi-select-trigger" onClick={() => setOpen(!open)}>
            <span className="multi-select-text">
              {triggerText || `${selected.length} sélectionné(s)`}
            </span>
            <HiChevronDown
              className={`multi-select-icon ${open ? "open" : ""}`}
            />
          </div>

          {open && (
            <div className="multi-select-dropdown">
              <div className="multi-select-header">
                <button
                  type="button"
                  className="btn-select-all"
                  onClick={() => onSelectAll(entreprise._id, allCodes)}
                >
                  {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
                </button>
                <span className="selected-count">
                  {selected.length} sélectionné(s)
                </span>
              </div>

              <div className="multi-select-options">
                {reps.map((r) => {
                  const checked = selected.includes(r.code);
                  return (
                    <div
                      key={r.code}
                      className={`multi-select-option ${
                        checked ? "selected" : ""
                      }`}
                      onClick={() => onToggle(entreprise._id, r.code)}
                    >
                      <div className="option-checkbox">
                        {checked && <HiCheck />}
                      </div>
                      <div className="option-content">
                        <span className="option-trigramme">
                          {commercialLabel(r)}
                        </span>
                        <span className="option-name">{r.count} factures</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
      analyse: getDefaultAnalyse(),
      commerciauxScope: {},
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

      // Permissions d'analyse (écran par écran)
      const analysePermissions = getDefaultAnalyse();
      analyseScreens.forEach((sc) => {
        analysePermissions[sc.key] = user.permissions?.analyse?.[sc.key] || false;
      });
      FILIALE_RESEAUX.forEach((r) => {
        analysePermissions.filiales[r] =
          user.permissions?.analyse?.filiales?.[r] || false;
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
          analyse: analysePermissions,
          commerciauxScope: user.permissions?.commerciauxScope || {},
        },
      });
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    // Passage en administrateur : super-admin par défaut (tous modules + toutes
    // entreprises). Décochez « Toutes les entreprises » pour le limiter ensuite.
    if (name === "role" && value === "admin") {
      setFormData((prev) => ({
        ...prev,
        role: "admin",
        permissions: {
          ...prev.permissions,
          allModules: true,
          allEntreprises: true,
        },
      }));
      return;
    }
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

  const handleAnalyseChange = (key) => {
    setFormData((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        analyse: {
          ...prev.permissions.analyse,
          [key]: !prev.permissions.analyse?.[key],
        },
      },
    }));
  };

  const handleFilialeReseauChange = (reseau) => {
    setFormData((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        analyse: {
          ...prev.permissions.analyse,
          filiales: {
            ...prev.permissions.analyse.filiales,
            [reseau]: !prev.permissions.analyse.filiales?.[reseau],
          },
        },
      },
    }));
  };

  const handleCommercialCodeToggle = (entrepriseId, code) => {
    setFormData((prev) => {
      const scope = { ...(prev.permissions.commerciauxScope || {}) };
      const current = new Set(scope[entrepriseId] || []);
      if (current.has(code)) current.delete(code);
      else current.add(code);
      scope[entrepriseId] = Array.from(current);
      return {
        ...prev,
        permissions: { ...prev.permissions, commerciauxScope: scope },
      };
    });
  };

  const handleCommercialSelectAll = (entrepriseId, allCodes) => {
    setFormData((prev) => {
      const scope = { ...(prev.permissions.commerciauxScope || {}) };
      const current = scope[entrepriseId] || [];
      const allSelected =
        allCodes.length > 0 && allCodes.every((c) => current.includes(c));
      scope[entrepriseId] = allSelected ? [] : [...allCodes];
      return {
        ...prev,
        permissions: { ...prev.permissions, commerciauxScope: scope },
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const payload = {
        ...formData,
        permissions: {
          ...formData.permissions,
          // Un admin conserve l'accès à TOUS les modules ; seul le périmètre
          // entreprise est ajustable (allEntreprises / liste de sociétés).
          allModules:
            formData.role === "admin"
              ? true
              : formData.permissions.allModules,
        },
      };
      if (isEdit) {
        await updateUser({ id: user._id, ...payload }).unwrap();
      } else {
        if (!payload.password) {
          setError("Le mot de passe est requis");
          return;
        }
        await createUser(payload).unwrap();
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

          <div className="permissions-section">
            <h3>
              {formData.role === "admin"
                ? "Périmètre d'accès (entreprises)"
                : "Permissions"}
            </h3>
            {formData.role === "admin" && (
              <p className="permissions-hint">
                Un administrateur a accès à tous les modules. « Toutes les
                entreprises » = super-admin (gestion des utilisateurs, des
                entreprises et analyses multi-sociétés). Décochez pour limiter
                cet administrateur à certaines sociétés.
              </p>
            )}

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
                {formData.role !== "admin" && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={formData.permissions.allModules}
                      onChange={() =>
                        handleGlobalPermissionChange("allModules")
                      }
                    />
                    <span>Tous les modules</span>
                  </label>
                )}
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

              {/* Modules (utilisateurs uniquement — un admin a tous les modules) */}
              {formData.role !== "admin" && !formData.permissions.allModules && (
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

          {/* Analyse — accès écran par écran (admins ET users) */}
          <div className="permissions-section">
            <h3>Analyse</h3>
            <p className="permissions-hint">
              Accès aux écrans d'analyse, écran par écran (admins et
              utilisateurs). Un super-admin y accède d'office.
            </p>
            <div className="global-permissions">
              {analyseScreens.map((sc) => (
                <label key={sc.key} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={!!formData.permissions.analyse?.[sc.key]}
                    onChange={() => handleAnalyseChange(sc.key)}
                  />
                  <span>{sc.label}</span>
                </label>
              ))}
            </div>

            <div className="form-group">
              <label>Analyse Filiales (par réseau)</label>
              <div className="global-permissions">
                {FILIALE_RESEAUX.map((r) => (
                  <label key={r} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={!!formData.permissions.analyse?.filiales?.[r]}
                      onChange={() => handleFilialeReseauChange(r)}
                    />
                    <span>{r}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Commerciaux visibles par entreprise (si Analyse Commerciaux activée) */}
          {formData.permissions.analyse?.commerciaux &&
            !(
              formData.role === "admin" &&
              formData.permissions.allEntreprises
            ) && (
              <div className="permissions-section">
                <h3>Commerciaux visibles (par entreprise)</h3>
                <p className="permissions-hint">
                  Coche les codes commerciaux que cet utilisateur peut voir
                  dans « Analyse Commerciaux », entreprise par entreprise.
                  Aucun code coché = aucun commercial pour cette société.
                </p>
                {formData.permissions.entreprises.length === 0 ? (
                  <p className="permissions-hint">
                    Sélectionne d'abord une ou plusieurs entreprises ci-dessus.
                  </p>
                ) : (
                  (entreprises || [])
                    .filter((e) =>
                      formData.permissions.entreprises.includes(e._id),
                    )
                    .map((ent) => (
                      <CommerciauxEntreprisePicker
                        key={ent._id}
                        entreprise={ent}
                        selected={
                          formData.permissions.commerciauxScope?.[ent._id] || []
                        }
                        onToggle={handleCommercialCodeToggle}
                        onSelectAll={handleCommercialSelectAll}
                      />
                    ))
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