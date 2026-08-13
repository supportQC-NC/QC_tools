// src/components/admin/UserModal.jsx
import React, { useState, useEffect, useMemo } from "react";
import { useSelector } from "react-redux";
import {
  HiX,
  HiCheck,
  HiSearch,
  HiUser,
  HiUserGroup,
  HiShieldCheck,
  HiTrendingUp,
} from "react-icons/hi";
import {
  useCreateUserMutation,
  useUpdateUserMutation,
} from "../../slices/userApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import ChampsDbfSection from "./ChampsDbfSection";
import {
  PERMISSION_MODULES,
  MODULE_GROUPS,
  assignableRoles,
  actorCanGrantAllModules,
  actorCanGrantAllEntreprises,
  actorGrantableEntrepriseIds,
  actorCanGrantModuleAction,
  isSuperAdminClient,
} from "../../config/adminModules";
import Modal from "../ui/Modal/Modal";
import "./UserModal.css";

// Réseaux de l'analyse Filiales (figés côté backend : DQ, QC, LD).
const FILIALE_RESEAUX = ["DQ", "QC", "LD"];

// Source de vérité : registre partagé (frontend/src/config/adminModules.js).
const modules = PERMISSION_MODULES.map((m) => m.key);
const moduleLabel = (key) =>
  PERMISSION_MODULES.find((m) => m.key === key)?.label || key;

// Modules regroupés par groupe, dans l'ordre du registre.
const GROUPS = Object.keys(MODULE_GROUPS).map((g) => ({
  group: g,
  label: MODULE_GROUPS[g],
  items: PERMISSION_MODULES.filter((m) => m.group === g),
}));

const actions = ["read", "write", "delete"];
const actionLabels = { read: "Lecture", write: "Écriture", delete: "Suppr." };
const ROLE_LABELS = {
  user: "Utilisateur",
  responsable: "Responsable",
  admin: "Administrateur",
};

// Icône + courte description par rôle (pour les cartes de sélection).
const ROLE_META = {
  user: { Icon: HiUser, desc: "Accès aux modules accordés" },
  responsable: { Icon: HiUserGroup, desc: "Gère une équipe et ses membres" },
  admin: { Icon: HiShieldCheck, desc: "Tous les modules, ses sociétés" },
};

// Permissions par défaut : toutes les clés du registre à false.
const getDefaultModulePermissions = () => {
  const permissions = {};
  modules.forEach((module) => {
    permissions[module] = { read: false, write: false, delete: false };
  });
  return permissions;
};

// Sections de la configuration utilisateur (mode PAGE). Même principe que la
// config entreprise : nav verticale à gauche, panneau à droite.
const SECTIONS = [
  { key: "identite", label: "Identité & rôle" },
  { key: "permissions", label: "Permissions" },
  { key: "commercial", label: "Profil commercial" },
  { key: "champsDbf", label: "Champs DBF", editionSeule: true },
];

// Codes vendeur saisis pour une société : "12" ou "12, 15" -> ["12","15"].
const parseCodes = (saisie) =>
  String(saisie || "")
    .split(/[,;/\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);

const UserModal = ({ user, onClose, asPage = false }) => {
  const isEdit = !!user;
  const [entSearch, setEntSearch] = useState("");
  const [section, setSection] = useState("identite");

  // Acteur courant (celui qui édite) — sert à borner ce qu'il peut accorder.
  const { userInfo: actor } = useSelector((state) => state.auth);

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
      analyse: { filiales: { DQ: false, QC: false, LD: false } },
      commerciauxScope: {},
      // Profil commercial : { actif, codes: [{ entreprise, code }] }.
      commercial: { actif: false, codes: [] },
    },
  });

  const [error, setError] = useState("");

  const [createUser, { isLoading: isCreating }] = useCreateUserMutation();
  const [updateUser, { isLoading: isUpdating }] = useUpdateUserMutation();
  const { data: entreprises, isLoading: isLoadingEntreprises } =
    useGetEntreprisesQuery();

  // ── Atténuation (miroir client) : ce que l'ACTEUR a le droit d'accorder ──
  const canGrantAllModules = actorCanGrantAllModules(actor);
  const canGrantAllEntreprises = actorCanGrantAllEntreprises(actor);
  const grantableEntIds = actorGrantableEntrepriseIds(actor); // null = toutes
  const canGrantModule = (key, action) =>
    actorCanGrantModuleAction(actor, key, action);

  // Rôles proposables : ceux que l'acteur peut attribuer, + le rôle courant en
  // édition (pour ne pas « perdre » un rôle qu'il ne pourrait pas réattribuer).
  const roleOptions = useMemo(() => {
    const base = assignableRoles(actor);
    if (isEdit && user?.role && !base.includes(user.role)) {
      return [user.role, ...base];
    }
    return base.length ? base : ["user"];
  }, [actor, isEdit, user]);

  // Entreprises que l'acteur peut proposer (borne la sélection).
  const grantableEntreprises = useMemo(() => {
    const list = entreprises || [];
    if (grantableEntIds === null) return list;
    return list.filter((e) => grantableEntIds.includes(e._id));
  }, [entreprises, grantableEntIds]);

  // Filtrage par la recherche (trigramme ou nom complet).
  const filteredEntreprises = useMemo(() => {
    const q = entSearch.trim().toLowerCase();
    if (!q) return grantableEntreprises;
    return grantableEntreprises.filter(
      (e) =>
        e.trigramme?.toLowerCase().includes(q) ||
        e.nomComplet?.toLowerCase().includes(q),
    );
  }, [grantableEntreprises, entSearch]);

  const allEntSelected =
    grantableEntreprises.length > 0 &&
    grantableEntreprises.every((e) =>
      formData.permissions.entreprises.includes(e._id),
    );

  // ── Accès aux ANALYSES : réservé au super-admin (seul à le gérer). ──
  const canEditAnalyse = isSuperAdminClient(actor);
  // Sociétés concernées par les codes commerciaux : celles du périmètre du user
  // édité qui ont des vendeurs déclarés.
  const commEntreprises = useMemo(() => {
    const base = formData.permissions.allEntreprises
      ? grantableEntreprises
      : grantableEntreprises.filter((e) =>
          formData.permissions.entreprises.includes(e._id),
        );
    return base.filter((e) => (e.vendeurs?.length || 0) > 0);
  }, [
    grantableEntreprises,
    formData.permissions.allEntreprises,
    formData.permissions.entreprises,
  ]);

  // Groupes/modules visibles : seulement ceux où l'acteur peut accorder au
  // moins une action (un admin/super-admin voit tout, comme avant).
  const visibleGroups = useMemo(() => {
    return GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((m) =>
        actions.some((a) => canGrantModule(m.key, a)),
      ),
    })).filter((g) => g.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor]);

  useEffect(() => {
    if (user) {
      // Fusionne les permissions existantes avec les valeurs par défaut
      // (toutes les clés du registre, y compris les nouvelles).
      const modulePermissions = getDefaultModulePermissions();
      modules.forEach((module) => {
        const src = user.permissions?.modules?.[module];
        if (src) {
          modulePermissions[module] = {
            read: src.read || false,
            write: src.write || false,
            delete: src.delete || false,
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
          analyse: {
            filiales: {
              DQ: user.permissions?.analyse?.filiales?.DQ || false,
              QC: user.permissions?.analyse?.filiales?.QC || false,
              LD: user.permissions?.analyse?.filiales?.LD || false,
            },
          },
          commerciauxScope: user.permissions?.commerciauxScope || {},
          commercial: {
            actif: user.permissions?.commercial?.actif || false,
            codes: (user.permissions?.commercial?.codes || []).map((l) => ({
              entreprise: String(l.entreprise?._id || l.entreprise || ""),
              code: String(l.code || ""),
            })),
          },
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

  // Bascule une action (read/write/delete) d'un module.
  const handlePermissionChange = (module, action) => {
    if (!canGrantModule(module, action)) return; // garde-fou UI
    setFormData((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        modules: {
          ...prev.permissions.modules,
          [module]: {
            ...prev.permissions.modules[module],
            [action]: !prev.permissions.modules[module]?.[action],
          },
        },
      },
    }));
  };

  // Clés d'un groupe que l'acteur peut réellement accorder pour une action.
  const grantableKeysInGroup = (groupKey, action) =>
    PERMISSION_MODULES.filter(
      (m) => m.group === groupKey && canGrantModule(m.key, action),
    ).map((m) => m.key);

  // Bascule une action pour TOUS les modules (accordables) d'un groupe.
  const handleGroupActionToggle = (groupKey, action) => {
    const keys = grantableKeysInGroup(groupKey, action);
    if (keys.length === 0) return;
    setFormData((prev) => {
      const allChecked = keys.every(
        (k) => prev.permissions.modules[k]?.[action],
      );
      const nextModules = { ...prev.permissions.modules };
      keys.forEach((k) => {
        nextModules[k] = { ...nextModules[k], [action]: !allChecked };
      });
      return {
        ...prev,
        permissions: { ...prev.permissions, modules: nextModules },
      };
    });
  };

  // Un groupe a-t-il tous ses modules (accordables) cochés pour une action ?
  const isGroupActionChecked = (groupKey, action) => {
    const keys = grantableKeysInGroup(groupKey, action);
    return (
      keys.length > 0 &&
      keys.every((k) => formData.permissions.modules[k]?.[action])
    );
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

  // Sélectionner/Désélectionner toutes les entreprises (accordables).
  const handleSelectAllEntreprises = () => {
    const allIds = grantableEntreprises.map((e) => e._id);
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

  // (Analyse) Bascule un réseau Filiales (DQ/QC/LD).
  const toggleFiliale = (reseau) => {
    setFormData((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        analyse: {
          ...prev.permissions.analyse,
          filiales: {
            ...prev.permissions.analyse?.filiales,
            [reseau]: !prev.permissions.analyse?.filiales?.[reseau],
          },
        },
      },
    }));
  };

  // (Analyse) Bascule un code commercial autorisé pour une société.
  const toggleCommercialCode = (entId, code) => {
    setFormData((prev) => {
      const current = prev.permissions.commerciauxScope?.[entId] || [];
      const next = current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code];
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          commerciauxScope: {
            ...prev.permissions.commerciauxScope,
            [entId]: next,
          },
        },
      };
    });
  };

  // (Analyse) Tout / aucun code commercial pour une société.
  const setAllCommercialCodes = (entId, codes) => {
    setFormData((prev) => {
      const current = prev.permissions.commerciauxScope?.[entId] || [];
      const all = codes.length > 0 && codes.every((c) => current.includes(c));
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          commerciauxScope: {
            ...prev.permissions.commerciauxScope,
            [entId]: all ? [] : [...codes],
          },
        },
      };
    });
  };

  // ── PROFIL COMMERCIAL ────────────────────────────────────────────────────
  // Active/désactive le profil (le rattachement société+code reste conservé).
  const toggleCommercialActif = () => {
    setFormData((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        commercial: {
          ...prev.permissions.commercial,
          actif: !prev.permissions.commercial?.actif,
        },
      },
    }));
  };

  // Codes vendeur d'UNE société (remplace toutes ses lignes).
  const setCodesSociete = (entId, saisie) => {
    setFormData((prev) => {
      const autres = (prev.permissions.commercial?.codes || []).filter(
        (l) => String(l.entreprise) !== String(entId),
      );
      const nouveaux = parseCodes(saisie).map((code) => ({
        entreprise: String(entId),
        code,
      }));
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          commercial: {
            ...prev.permissions.commercial,
            codes: [...autres, ...nouveaux],
          },
        },
      };
    });
  };

  // Nombre total de codes vendeur retenus (toutes sociétés) — repère visuel.
  const nbCodesCommerciaux = (formData.permissions.commercial?.codes || [])
    .length;

  // Saisie courante d'une société ("12" ou "12, 15").
  const codesSociete = (entId) =>
    (formData.permissions.commercial?.codes || [])
      .filter((l) => String(l.entreprise) === String(entId))
      .map((l) => l.code)
      .join(", ");

  // Sociétés proposables pour le rattachement : le périmètre du compte édité.
  const societesCommerciales = useMemo(() => {
    if (formData.permissions.allEntreprises) return grantableEntreprises;
    return grantableEntreprises.filter((e) =>
      formData.permissions.entreprises.includes(e._id),
    );
  }, [
    grantableEntreprises,
    formData.permissions.allEntreprises,
    formData.permissions.entreprises,
  ]);

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

  // Sections visibles : « Champs DBF » n'a de sens que sur un compte existant.
  const sectionsVisibles = SECTIONS.filter((s) => !s.editionSeule || isEdit);

  const corps = (
      <form onSubmit={handleSubmit} className="modal-form">
        {error && <div className="form-error">{error}</div>}

        {(!asPage || section === "identite") && (
        <>
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

        <div className="form-group">
          <label>Rôle</label>
          <div className="role-cards">
            {roleOptions.map((r) => {
              const Icon = ROLE_META[r]?.Icon || HiUser;
              const selected = formData.role === r;
              return (
                <button
                  type="button"
                  key={r}
                  className={`role-card ${selected ? "selected" : ""}`}
                  onClick={() =>
                    setFormData((prev) => ({ ...prev, role: r }))
                  }
                >
                  {selected && <HiCheck className="role-card-check" />}
                  <span className="role-card-icon">
                    <Icon />
                  </span>
                  <span className="role-card-label">
                    {ROLE_LABELS[r] || r}
                  </span>
                  <span className="role-card-desc">{ROLE_META[r]?.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Profil COMMERCIAL — cumulable avec n'importe quel rôle : c'est un
            profil métier (rattachement à un code vendeur), pas un rôle d'accès.
            Un commercial peut donc aussi être responsable d'équipe, et recevoir
            n'importe quel module par la voie habituelle (onglet Permissions). */}
        <div className="form-group">
          <label>Profil métier</label>
          <div className="role-cards role-cards-solo">
            <button
              type="button"
              className={`role-card ${formData.permissions.commercial?.actif ? "selected" : ""}`}
              onClick={toggleCommercialActif}
            >
              {formData.permissions.commercial?.actif && (
                <HiCheck className="role-card-check" />
              )}
              <span className="role-card-icon">
                <HiTrendingUp />
              </span>
              <span className="role-card-label">Commercial</span>
              <span className="role-card-desc">
                Espace dédié : portefeuille, relances, alertes
              </span>
            </button>
          </div>
          {formData.permissions.commercial?.actif && (
            <span className="label-hint">
              Rattachez-le à ses sociétés (onglet Permissions), puis choisissez
              son code vendeur par société dans l'onglet « Profil commercial ».
              {nbCodesCommerciaux === 0
                ? " ⚠️ Aucun code sélectionné pour l'instant : son espace serait vide."
                : ` ${nbCodesCommerciaux} code(s) sélectionné(s).`}
            </span>
          )}
        </div>

        <div className="form-group">
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
        </>
        )}

        {(!asPage || section === "permissions") && (
        <div className="permissions-section">
          <h3>Permissions</h3>

          {formData.role === "admin" && (
            <p className="admin-note">
              Un administrateur a accès à tous les modules. Son périmètre reste
              limité aux sociétés sélectionnées ci-dessous.
            </p>
          )}

          {formData.role === "responsable" && (
            <p className="admin-note">
              Un responsable gère une équipe. Vous ne pouvez lui accorder que
              des droits et des sociétés que vous possédez vous-même.
            </p>
          )}

          <div className="global-permissions">
            {canGrantAllEntreprises && (
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
            )}
            {formData.role !== "admin" && canGrantAllModules && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={formData.permissions.allModules}
                  onChange={() => handleGlobalPermissionChange("allModules")}
                />
                <span>Tous les modules</span>
              </label>
            )}
          </div>

            {/* Sélection des entreprises — pastilles + recherche */}
            {!formData.permissions.allEntreprises && (
              <div className="form-group">
                <label>Entreprises accessibles</label>
                <div className="ent-picker">
                  <div className="ent-picker-toolbar">
                    <div className="ent-search">
                      <HiSearch />
                      <input
                        type="text"
                        placeholder="Rechercher une société..."
                        value={entSearch}
                        onChange={(e) => setEntSearch(e.target.value)}
                      />
                    </div>
                    <div className="ent-toolbar-right">
                      <button
                        type="button"
                        className="btn-select-all"
                        onClick={handleSelectAllEntreprises}
                        disabled={grantableEntreprises.length === 0}
                      >
                        {allEntSelected ? "Aucun" : "Tout"}
                      </button>
                      <span className="selected-count">
                        {formData.permissions.entreprises.length}/
                        {grantableEntreprises.length}
                      </span>
                    </div>
                  </div>

                  <div className="ent-pills">
                    {isLoadingEntreprises ? (
                      <div className="no-options">Chargement...</div>
                    ) : filteredEntreprises.length === 0 ? (
                      <div className="no-options">Aucune société</div>
                    ) : (
                      filteredEntreprises.map((entreprise) => {
                        const selected =
                          formData.permissions.entreprises.includes(
                            entreprise._id,
                          );
                        return (
                          <button
                            type="button"
                            key={entreprise._id}
                            className={`ent-pill ${selected ? "selected" : ""}`}
                            onClick={() =>
                              handleEntrepriseToggle(entreprise._id)
                            }
                            title={entreprise.nomComplet}
                          >
                            {selected && <HiCheck />}
                            <span>{entreprise.trigramme}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Modules groupés (Gestion / Données / Analyse / Administration) */}
            {/* Table masquée pour un admin (accès à tous les modules). */}
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
                  {visibleGroups.map((grp) => (
                    <tbody key={grp.group}>
                      <tr className="module-group-row">
                        <td className="module-group-name">{grp.label}</td>
                        {actions.map((action) => (
                          <td key={action} className="module-group-toggle">
                            <label
                              className="checkbox-label checkbox-label-inline"
                              title={`Tout ${actionLabels[action]} — ${grp.label}`}
                            >
                              <input
                                type="checkbox"
                                checked={isGroupActionChecked(
                                  grp.group,
                                  action,
                                )}
                                disabled={
                                  grantableKeysInGroup(grp.group, action)
                                    .length === 0
                                }
                                onChange={() =>
                                  handleGroupActionToggle(grp.group, action)
                                }
                              />
                            </label>
                          </td>
                        ))}
                      </tr>
                      {grp.items.map((mod) => (
                        <tr key={mod.key}>
                          <td className="module-name">
                            {moduleLabel(mod.key)}
                          </td>
                          {actions.map((action) => (
                            <td key={action}>
                              <input
                                type="checkbox"
                                checked={
                                  formData.permissions.modules[mod.key]?.[
                                    action
                                  ] || false
                                }
                                disabled={!canGrantModule(mod.key, action)}
                                onChange={() =>
                                  handlePermissionChange(mod.key, action)
                                }
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
            )}

            {/* ── Accès aux analyses (super-admin uniquement) ── */}
            {canEditAnalyse && (
              <div className="analyse-section">
                <label className="analyse-title">Accès aux analyses</label>

                {/* Filiales : réseaux visibles */}
                <div className="analyse-block">
                  <span className="analyse-block-label">
                    Filiales — réseaux visibles
                  </span>
                  <div className="analyse-reseaux">
                    {FILIALE_RESEAUX.map((r) => (
                      <label
                        key={r}
                        className="checkbox-label checkbox-label-inline"
                      >
                        <input
                          type="checkbox"
                          checked={
                            !!formData.permissions.analyse?.filiales?.[r]
                          }
                          onChange={() => toggleFiliale(r)}
                        />
                        <span>{r}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Commerciaux : codes autorisés par société */}
                <div className="analyse-block">
                  <span className="analyse-block-label">
                    Commerciaux — codes autorisés par société
                  </span>
                  {commEntreprises.length === 0 ? (
                    <div className="no-options">
                      Sélectionnez des sociétés ayant des vendeurs déclarés.
                    </div>
                  ) : (
                    commEntreprises.map((e) => {
                      const codes = (e.vendeurs || [])
                        .map((v) => v.code)
                        .filter(Boolean);
                      const selected =
                        formData.permissions.commerciauxScope?.[e._id] || [];
                      const allSel =
                        codes.length > 0 &&
                        codes.every((c) => selected.includes(c));
                      return (
                        <div key={e._id} className="comm-ent">
                          <div className="comm-ent-head">
                            <span className="comm-ent-trig">
                              {e.trigramme}
                            </span>
                            <button
                              type="button"
                              className="btn-select-all"
                              onClick={() =>
                                setAllCommercialCodes(e._id, codes)
                              }
                            >
                              {allSel ? "Aucun" : "Tous"}
                            </button>
                          </div>
                          <div className="ent-pills">
                            {codes.map((code) => {
                              const v = e.vendeurs.find(
                                (x) => x.code === code,
                              );
                              const on = selected.includes(code);
                              return (
                                <button
                                  type="button"
                                  key={code}
                                  className={`ent-pill ${on ? "selected" : ""}`}
                                  onClick={() =>
                                    toggleCommercialCode(e._id, code)
                                  }
                                  title={
                                    v
                                      ? `${v.prenom || ""} ${v.nom || ""}`.trim()
                                      : code
                                  }
                                >
                                  {on && <HiCheck />}
                                  <span>{code}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PROFIL COMMERCIAL ──────────────────────────────────────────
            Un commercial accède à son espace dédié (/commercial) : dashboard,
            portefeuille, proformas, réservations, commandes spéciales, alertes.
            Le rattachement est le couple SOCIÉTÉ + CODE VENDEUR (REPRES) : le
            même commercial peut avoir un code différent par société. */}
        {(!asPage || section === "commercial") && (
          <div className="permissions-section">
            <h3>Profil commercial</h3>
            <p className="admin-note">
              Un utilisateur marqué commercial dispose de son espace dédié
              (tableau de bord, portefeuille clients, proformas, réservations,
              commandes spéciales, alertes). Ses données y sont filtrées sur le
              couple société + code vendeur (clients.REPRES, facture.REPRES,
              proforma.REPRES). À l'activation, la « Recherche Article » lui est
              accordée — vous pouvez ensuite la retirer, et lui accorder
              n'importe quel autre module ou société via l'onglet Permissions :
              le profil commercial ne verrouille aucun droit.
            </p>

            <div className="global-permissions">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={!!formData.permissions.commercial?.actif}
                  onChange={toggleCommercialActif}
                />
                <span>Cet utilisateur est un commercial</span>
              </label>
            </div>

            {formData.permissions.commercial?.actif && (
              <div className="analyse-section">
                <label className="analyse-title">
                  Code vendeur par société
                </label>
                <p className="admin-note">
                  Choisissez son code REPRES pour chaque société (ex. QC → 12,
                  KQ → 08) — plusieurs codes possibles. Seuls les codes typés
                  « Commercial » dans la fiche société (onglet Vendeurs) sont
                  proposés : un code de caisse ou de vendeur magasin n'ouvre pas
                  d'espace commercial. Une société sans code sélectionné
                  n'apparaîtra pas dans son espace.
                </p>

                {societesCommerciales.length === 0 ? (
                  <div className="no-options">
                    Accordez d'abord au moins une société à cet utilisateur
                    (onglet Permissions).
                  </div>
                ) : (
                  societesCommerciales.map((e) => {
                    // DICTIONNAIRE de la société : seuls les codes REPRES typés
                    // « Commercial » (onglet Vendeurs de la fiche entreprise)
                    // ouvrent droit à l'espace. Un code de caisse ou de vendeur
                    // magasin est refusé à l'enregistrement.
                    const declares = (e.vendeurs || []).filter(
                      (v) => v.code && v.type === "commercial",
                    );
                    const nomVendeur = (v) =>
                      `${v.prenom || ""} ${v.nom || ""}`.trim() || "sans nom";
                    return (
                      <div key={e._id} className="comm-ent">
                        <div className="comm-ent-head">
                          <span className="comm-ent-trig">{e.trigramme}</span>
                          <span className="label-hint">{e.nomComplet}</span>
                        </div>
                        <div className="form-group">
                          {declares.length === 0 ? (
                            <span className="label-hint">
                              Aucun code REPRES n'est typé « Commercial » pour
                              cette société. Renseignez-le dans la fiche société
                              (onglet Vendeurs) : les codes de caisse ou de
                              vendeur magasin n'ouvrent pas d'espace commercial.
                            </span>
                          ) : (
                            <>
                              <div className="ent-pills">
                                {declares.map((v) => {
                                  const on = codesSociete(e._id)
                                    .split(/[,;/\s]+/)
                                    .filter(Boolean)
                                    .includes(v.code);
                                  return (
                                    <button
                                      type="button"
                                      key={v.code}
                                      className={`ent-pill ${on ? "selected" : ""}`}
                                      onClick={() =>
                                        setCodesSociete(
                                          e._id,
                                          on
                                            ? codesSociete(e._id)
                                                .split(/[,;/\s]+/)
                                                .filter(
                                                  (c) => c && c !== v.code,
                                                )
                                                .join(", ")
                                            : `${codesSociete(e._id)}, ${v.code}`,
                                        )
                                      }
                                      title={nomVendeur(v)}
                                    >
                                      {on && <HiCheck />}
                                      <span>
                                        {v.code} · {nomVendeur(v)}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                              <span className="label-hint">
                                Codes retenus : {codesSociete(e._id) || "aucun"}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}

        {asPage && section === "champsDbf" && (
          <ChampsDbfSection userId={user?._id} />
        )}

        <div className="modal-footer">
          <button type="button" className="btn-cancel" onClick={onClose}>
            {asPage ? "← Retour à la liste" : "Annuler"}
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
  );

  // Mode PAGE plein écran (édition depuis /admin/users/:id) — même structure
  // que la configuration entreprise : en-tête + nav verticale + panneau.
  if (asPage) {
    return (
      <div className="user-config-page">
        <div className="ucp-header">
          <h2>
            {isEdit
              ? `Configuration — ${user.prenom || ""} ${user.nom || ""}`.trim()
              : "Nouvel utilisateur"}
          </h2>
          <button type="button" className="btn-cancel" onClick={onClose}>
            ← Retour à la liste
          </button>
        </div>

        <div className="ucp-body">
          <nav className="ucp-nav">
            {sectionsVisibles.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`ucp-nav-item ${section === s.key ? "active" : ""}`}
                onClick={() => setSection(s.key)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="ucp-content">{corps}</div>
        </div>
      </div>
    );
  }

  // Mode MODALE (création rapide depuis la liste)
  return (
    <Modal onClose={onClose} contentClassName="modal modal-large">
      <div className="modal-header">
        <h2>{isEdit ? "Modifier l'utilisateur" : "Nouvel utilisateur"}</h2>
        <button className="btn-close" onClick={onClose}>
          <HiX />
        </button>
      </div>
      {corps}
    </Modal>
  );
};

export default UserModal;
