// src/components/Admin/ConcurrentModal.jsx
import React, { useState, useEffect } from "react";
import {
  HiX,
  HiOfficeBuilding,
  HiLocationMarker,
  HiPhone,
  HiAnnotation,
  HiTag,
} from "react-icons/hi";
import {
  useCreateConcurrentMutation,
  useUpdateConcurrentMutation,
} from "../../slices/concurrentApiSLice";
import "./ConcurrentModal.css";

const TYPE_OPTIONS = [
  { value: "grande_surface", label: "Grande Surface" },
  { value: "specialise", label: "Magasin Spécialisé" },
  { value: "grossiste", label: "Grossiste" },
  { value: "en_ligne", label: "En ligne" },
  { value: "autre", label: "Autre" },
];

const ConcurrentModal = ({ concurrent, onClose }) => {
  const isEditing = !!concurrent;

  const [formData, setFormData] = useState({
    nom: "",
    adresse: "",
    ville: "",
    codePostal: "",
    telephone: "",
    type: "autre",
    notes: "",
  });

  const [error, setError] = useState("");

  const [createConcurrent, { isLoading: isCreating }] =
    useCreateConcurrentMutation();
  const [updateConcurrent, { isLoading: isUpdating }] =
    useUpdateConcurrentMutation();

  useEffect(() => {
    if (concurrent) {
      setFormData({
        nom: concurrent.nom || "",
        adresse: concurrent.adresse || "",
        ville: concurrent.ville || "",
        codePostal: concurrent.codePostal || "",
        telephone: concurrent.telephone || "",
        type: concurrent.type || "autre",
        notes: concurrent.notes || "",
      });
    }
  }, [concurrent]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!formData.nom.trim()) {
      setError("Le nom du concurrent est requis");
      return;
    }

    try {
      if (isEditing) {
        await updateConcurrent({
          id: concurrent._id,
          ...formData,
        }).unwrap();
      } else {
        await createConcurrent(formData).unwrap();
      }
      onClose();
    } catch (err) {
      setError(err?.data?.message || "Une erreur est survenue");
    }
  };

  const isLoading = isCreating || isUpdating;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content concurrent-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>
            <HiOfficeBuilding />
            {isEditing ? "Modifier le concurrent" : "Nouveau concurrent"}
          </h2>
          <button className="modal-close" onClick={onClose}>
            <HiX />
          </button>
        </div>

        {error && <div className="modal-error">{error}</div>}

        <form onSubmit={handleSubmit} className="concurrent-form">
          {/* Nom */}
          <div className="form-group">
            <label htmlFor="nom">
              <HiOfficeBuilding /> Nom du concurrent *
            </label>
            <input
              type="text"
              id="nom"
              name="nom"
              value={formData.nom}
              onChange={handleChange}
              placeholder="Ex: Carrefour, Leclerc, Amazon..."
              autoFocus
            />
          </div>

          {/* Type */}
          <div className="form-group">
            <label htmlFor="type">
              <HiTag /> Type
            </label>
            <select
              id="type"
              name="type"
              value={formData.type}
              onChange={handleChange}
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Adresse */}
          <div className="form-group">
            <label htmlFor="adresse">
              <HiLocationMarker /> Adresse
            </label>
            <input
              type="text"
              id="adresse"
              name="adresse"
              value={formData.adresse}
              onChange={handleChange}
              placeholder="Numéro et rue"
            />
          </div>

          {/* Ville & Code Postal */}
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="codePostal">Code Postal</label>
              <input
                type="text"
                id="codePostal"
                name="codePostal"
                value={formData.codePostal}
                onChange={handleChange}
                placeholder="98800"
              />
            </div>
            <div className="form-group flex-2">
              <label htmlFor="ville">Ville</label>
              <input
                type="text"
                id="ville"
                name="ville"
                value={formData.ville}
                onChange={handleChange}
                placeholder="Nouméa"
              />
            </div>
          </div>

          {/* Téléphone */}
          <div className="form-group">
            <label htmlFor="telephone">
              <HiPhone /> Téléphone
            </label>
            <input
              type="tel"
              id="telephone"
              name="telephone"
              value={formData.telephone}
              onChange={handleChange}
              placeholder="XX.XX.XX"
            />
          </div>

          {/* Notes */}
          <div className="form-group">
            <label htmlFor="notes">
              <HiAnnotation /> Notes
            </label>
            <textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Informations complémentaires..."
              rows={3}
            />
          </div>

          {/* Actions */}
          <div className="modal-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={onClose}
              disabled={isLoading}
            >
              Annuler
            </button>
            <button type="submit" className="btn-confirm" disabled={isLoading}>
              {isLoading
                ? "Enregistrement..."
                : isEditing
                  ? "Modifier"
                  : "Créer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ConcurrentModal;
