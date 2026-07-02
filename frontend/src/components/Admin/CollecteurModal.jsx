// src/components/admin/CollecteurModal.jsx
import React, { useState, useEffect } from "react";
import { HiX } from "react-icons/hi";
import {
  useCreateCollecteurMutation,
  useUpdateCollecteurMutation,
} from "../../slices/collecteurApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { useGetUsersQuery } from "../../slices/userApiSlice";
import "./CollecteurModal.css";

export const STATUTS = [
  { value: "stock", label: "En stock" },
  { value: "service", label: "En service" },
  { value: "panne", label: "En panne" },
  { value: "reparation", label: "En réparation" },
  { value: "reforme", label: "Réformé" },
  { value: "perdu", label: "Perdu / Volé" },
];

export const ACCESSOIRES = [
  "Étui",
  "Chargeur",
  "Batterie supplémentaire",
  "Dragonne",
  "Poignée-pistolet",
];

const toISODate = (d) => {
  if (!d) return "";
  const dd = new Date(d);
  return isNaN(dd.getTime()) ? "" : dd.toISOString().slice(0, 10);
};

const CollecteurModal = ({ collecteur, onClose }) => {
  const isEdit = !!collecteur;

  const [formData, setFormData] = useState({
    identifiant: "",
    nom: "",
    versionApp: "",
    recu: "",
    miseEnService: "",
    gachette: false,
    statut: "stock",
    entreprise: "",
    agent: "",
    emplacement: "",
    accessoires: [],
    observations: "",
    isActive: true,
  });
  const [error, setError] = useState("");

  const { data: entreprises } = useGetEntreprisesQuery();
  const { data: users } = useGetUsersQuery();

  const [createCollecteur, { isLoading: creating }] =
    useCreateCollecteurMutation();
  const [updateCollecteur, { isLoading: updating }] =
    useUpdateCollecteurMutation();

  useEffect(() => {
    if (collecteur) {
      setFormData({
        identifiant: collecteur.identifiant || "",
        nom: collecteur.nom || "",
        versionApp: collecteur.versionApp || "",
        recu: toISODate(collecteur.recu),
        miseEnService: toISODate(collecteur.miseEnService),
        gachette: !!collecteur.gachette,
        statut: collecteur.statut || "stock",
        entreprise: collecteur.entreprise?._id || collecteur.entreprise || "",
        agent: collecteur.agent?._id || collecteur.agent || "",
        emplacement: collecteur.emplacement || "",
        accessoires: Array.isArray(collecteur.accessoires)
          ? collecteur.accessoires
          : [],
        observations: collecteur.observations || "",
        isActive: collecteur.isActive ?? true,
      });
    }
  }, [collecteur]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name === "identifiant") {
      setFormData((p) => ({ ...p, identifiant: value.toUpperCase() }));
      return;
    }
    setFormData((p) => ({
      ...p,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const toggleAccessoire = (acc) => {
    setFormData((p) => ({
      ...p,
      accessoires: p.accessoires.includes(acc)
        ? p.accessoires.filter((a) => a !== acc)
        : [...p.accessoires, acc],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!formData.identifiant.trim()) {
      setError("L'identifiant est requis.");
      return;
    }
    try {
      if (isEdit) {
        await updateCollecteur({ id: collecteur._id, ...formData }).unwrap();
      } else {
        await createCollecteur(formData).unwrap();
      }
      onClose();
    } catch (err) {
      setError(err?.data?.message || "Une erreur est survenue");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-collecteur" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? "Modifier le collecteur" : "Nouveau collecteur"}</h2>
          <button className="btn-close" onClick={onClose}>
            <HiX />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-row">
            <div className="form-group">
              <label>Identifiant *</label>
              <input
                type="text"
                name="identifiant"
                value={formData.identifiant}
                onChange={handleChange}
                placeholder="HMC62Q260301158"
                required
              />
            </div>
            <div className="form-group">
              <label>Statut</label>
              <select name="statut" value={formData.statut} onChange={handleChange}>
                {STATUTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Nom du collecteur</label>
              <input
                type="text"
                name="nom"
                value={formData.nom}
                onChange={handleChange}
                placeholder="Ex: Collecteur magasin 1"
              />
            </div>
            <div className="form-group">
              <label>Version app installée</label>
              <input
                type="text"
                name="versionApp"
                value={formData.versionApp}
                onChange={handleChange}
                placeholder="Ex: 1.0.2"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Reçu le</label>
              <input
                type="date"
                name="recu"
                value={formData.recu}
                onChange={handleChange}
              />
            </div>
            <div className="form-group">
              <label>Mise en service</label>
              <input
                type="date"
                name="miseEnService"
                value={formData.miseEnService}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Entreprise</label>
              <select
                name="entreprise"
                value={formData.entreprise}
                onChange={handleChange}
              >
                <option value="">— Aucune —</option>
                {(entreprises || []).map((e) => (
                  <option key={e._id} value={e._id}>
                    {e.trigramme ? `${e.trigramme} - ` : ""}
                    {e.nomComplet || e.nomDossierDBF}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Agent</label>
              <select name="agent" value={formData.agent} onChange={handleChange}>
                <option value="">— Aucun —</option>
                {(users || []).map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.prenom} {u.nom}
                    {u.email ? ` (${u.email})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Gâchette (poignée-pistolet)</label>
              <select
                name="gachette"
                value={formData.gachette ? "oui" : "non"}
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    gachette: e.target.value === "oui",
                  }))
                }
              >
                <option value="non">Non</option>
                <option value="oui">Oui</option>
              </select>
            </div>
            <div className="form-group">
              <label>Emplacement / dépôt</label>
              <input
                type="text"
                name="emplacement"
                value={formData.emplacement}
                onChange={handleChange}
                placeholder="Bureau, dépôt, magasin…"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Accessoires</label>
            <div className="acc-checks">
              {ACCESSOIRES.map((acc) => (
                <label key={acc} className="acc-check">
                  <input
                    type="checkbox"
                    checked={formData.accessoires.includes(acc)}
                    onChange={() => toggleAccessoire(acc)}
                  />
                  <span>{acc}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>Observations</label>
            <textarea
              name="observations"
              rows={3}
              value={formData.observations}
              onChange={handleChange}
              placeholder="Remarques, état, historique…"
            />
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleChange}
              />
              <span>Actif (décocher pour archiver)</span>
            </label>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-cancel" onClick={onClose}>
              Annuler
            </button>
            <button
              type="submit"
              className="btn-submit"
              disabled={creating || updating}
            >
              {creating || updating
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

export default CollecteurModal;