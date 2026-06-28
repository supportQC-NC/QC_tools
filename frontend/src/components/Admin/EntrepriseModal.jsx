// src/components/admin/EntrepriseModal.jsx
import React, { useState, useEffect } from "react";
import {
  HiX,
  HiPhotograph,
  HiFolder,
  HiDatabase,
  HiClipboardList,
} from "react-icons/hi";
import {
  useCreateEntrepriseMutation,
  useUpdateEntrepriseMutation,
} from "../../slices/entrepriseApiSlice";
import "./EntrepriseModal.css";

const DEFAULT_ETATS_COMMANDE = {
  0: "Brouillon",
  1: "A Préparer",
  2: "Proforma",
  3: "Reliquat",
  4: "Envoyée",
  5: "Confirmée",
  6: "Transit",
  7: "Bateau",
  8: "Avion",
  9: "Commande locale",
};

const EntrepriseModal = ({ entreprise, onClose }) => {
  const isEdit = !!entreprise;

  const [formData, setFormData] = useState({
    nomDossierDBF: "",
    trigramme: "",
    nomComplet: "",
    description: "",
    cheminBase: "\\\\serveur\\Bases",
    cheminPhotos: "",
    cheminExportInventaire: "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec",
    mappingEntrepots: {
      S1: "Magasin",
      S2: "S2",
      S3: "S3",
      S4: "S4",
      S5: "S5",
    },
    mappingEtatsCommande: { ...DEFAULT_ETATS_COMMANDE },
    isActive: true,
  });

  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("general");

  const [createEntreprise, { isLoading: isCreating }] =
    useCreateEntrepriseMutation();
  const [updateEntreprise, { isLoading: isUpdating }] =
    useUpdateEntrepriseMutation();

  useEffect(() => {
    if (entreprise) {
      // Reconstruire le mapping des états depuis l'entreprise
      const etatsFromEntreprise = { ...DEFAULT_ETATS_COMMANDE };
      if (entreprise.mappingEtatsCommande) {
        const mapping = entreprise.mappingEtatsCommande;
        Object.keys(mapping).forEach((key) => {
          etatsFromEntreprise[key] = mapping[key];
        });
      }

      setFormData({
        nomDossierDBF: entreprise.nomDossierDBF || "",
        trigramme: entreprise.trigramme || "",
        nomComplet: entreprise.nomComplet || "",
        description: entreprise.description || "",
        cheminBase: entreprise.cheminBase || "\\\\serveur\\Bases",
        cheminPhotos: entreprise.cheminPhotos || "",
        cheminExportInventaire:
          entreprise.cheminExportInventaire ||
          "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec",
        mappingEntrepots: {
          S1: entreprise.mappingEntrepots?.S1 || "Magasin",
          S2: entreprise.mappingEntrepots?.S2 || "S2",
          S3: entreprise.mappingEntrepots?.S3 || "S3",
          S4: entreprise.mappingEntrepots?.S4 || "S4",
          S5: entreprise.mappingEntrepots?.S5 || "S5",
        },
        mappingEtatsCommande: etatsFromEntreprise,
        isActive: entreprise.isActive ?? true,
      });
    }
  }, [entreprise]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;

    // Auto-uppercase pour trigramme
    if (name === "trigramme") {
      setFormData((prev) => ({
        ...prev,
        [name]: value.toUpperCase(),
      }));
      return;
    }

    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleMappingChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      mappingEntrepots: {
        ...prev.mappingEntrepots,
        [field]: value,
      },
    }));
  };

  const handleEtatChange = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      mappingEtatsCommande: {
        ...prev.mappingEtatsCommande,
        [key]: value,
      },
    }));
  };

  const handleResetEtats = () => {
    setFormData((prev) => ({
      ...prev,
      mappingEtatsCommande: { ...DEFAULT_ETATS_COMMANDE },
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Validation
    if (formData.trigramme.length < 2 || formData.trigramme.length > 5) {
      setError("Le trigramme doit contenir entre 2 et 5 caractères");
      return;
    }

    try {
      if (isEdit) {
        await updateEntreprise({ id: entreprise._id, ...formData }).unwrap();
      } else {
        await createEntreprise(formData).unwrap();
      }
      onClose();
    } catch (err) {
      setError(err?.data?.message || "Une erreur est survenue");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-entreprise"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{isEdit ? "Modifier l'entreprise" : "Nouvelle entreprise"}</h2>
          <button className="btn-close" onClick={onClose}>
            <HiX />
          </button>
        </div>

        {/* Tabs */}
        <div className="modal-tabs">
          <button
            className={`tab-btn ${activeTab === "general" ? "active" : ""}`}
            onClick={() => setActiveTab("general")}
          >
            Général
          </button>
          <button
            className={`tab-btn ${activeTab === "chemins" ? "active" : ""}`}
            onClick={() => setActiveTab("chemins")}
          >
            <HiFolder /> Chemins
          </button>
          <button
            className={`tab-btn ${activeTab === "entrepots" ? "active" : ""}`}
            onClick={() => setActiveTab("entrepots")}
          >
            <HiDatabase /> Entrepôts
          </button>
          <button
            className={`tab-btn ${activeTab === "etats" ? "active" : ""}`}
            onClick={() => setActiveTab("etats")}
          >
            <HiClipboardList /> États Commande
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          {error && <div className="form-error">{error}</div>}

          {/* Tab Général */}
          {activeTab === "general" && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Trigramme *</label>
                  <input
                    type="text"
                    name="trigramme"
                    value={formData.trigramme}
                    onChange={handleChange}
                    placeholder="QC"
                    maxLength={5}
                    required
                  />
                  <span className="input-hint">2 à 5 caractères</span>
                </div>
                <div className="form-group">
                  <label>Nom dossier DBF *</label>
                  <input
                    type="text"
                    name="nomDossierDBF"
                    value={formData.nomDossierDBF}
                    onChange={handleChange}
                    placeholder="QC_DISTRIBUTION"
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Nom complet *</label>
                <input
                  type="text"
                  name="nomComplet"
                  value={formData.nomComplet}
                  onChange={handleChange}
                  placeholder="QC Distribution"
                  required
                />
              </div>

              <div className="form-group">
                <label>Description</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="Description de l'entreprise..."
                  rows={3}
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
                  <span>Entreprise active</span>
                </label>
              </div>
            </>
          )}

          {/* Tab Chemins */}
          {activeTab === "chemins" && (
            <>
              <div className="form-group">
                <label>
                  <HiDatabase /> Chemin de base (DBF)
                </label>
                <input
                  type="text"
                  name="cheminBase"
                  value={formData.cheminBase}
                  onChange={handleChange}
                  placeholder="\\serveur\Bases"
                />
                <span className="input-hint">
                  Chemin complet: {formData.cheminBase}\
                  {formData.nomDossierDBF || "[dossier]"}
                </span>
              </div>

              <div className="form-group">
                <label>
                  <HiPhotograph /> Chemin des photos
                </label>
                <input
                  type="text"
                  name="cheminPhotos"
                  value={formData.cheminPhotos}
                  onChange={handleChange}
                  placeholder="\\192.168.0.250\Rcommun\STOCK\photos"
                />
                <span className="input-hint">
                  Dossier contenant les photos des articles (ex: NART.jpg)
                </span>
              </div>

              <div className="form-group">
                <label>
                  <HiFolder /> Chemin export inventaire
                </label>
                <input
                  type="text"
                  name="cheminExportInventaire"
                  value={formData.cheminExportInventaire}
                  onChange={handleChange}
                  placeholder="\\192.168.0.250\Rcommun\STOCK\collect_sec"
                />
                <span className="input-hint">
                  Dossier où seront déposés les fichiers .dat d'inventaire
                </span>
              </div>
            </>
          )}

          {/* Tab Entrepôts */}
          {activeTab === "entrepots" && (
            <>
              <p className="tab-description">
                Personnalisez les noms des champs stock (S1 à S5) pour cette
                entreprise. Ces noms seront affichés dans la recherche article.
              </p>

              <div className="form-row">
                <div className="form-group">
                  <label>S1 (généralement Magasin)</label>
                  <input
                    type="text"
                    value={formData.mappingEntrepots.S1}
                    onChange={(e) => handleMappingChange("S1", e.target.value)}
                    placeholder="Magasin"
                  />
                </div>
                <div className="form-group">
                  <label>S2</label>
                  <input
                    type="text"
                    value={formData.mappingEntrepots.S2}
                    onChange={(e) => handleMappingChange("S2", e.target.value)}
                    placeholder="Réserve"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>S3</label>
                  <input
                    type="text"
                    value={formData.mappingEntrepots.S3}
                    onChange={(e) => handleMappingChange("S3", e.target.value)}
                    placeholder="Dépôt"
                  />
                </div>
                <div className="form-group">
                  <label>S4</label>
                  <input
                    type="text"
                    value={formData.mappingEntrepots.S4}
                    onChange={(e) => handleMappingChange("S4", e.target.value)}
                    placeholder="Transit"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>S5</label>
                  <input
                    type="text"
                    value={formData.mappingEntrepots.S5}
                    onChange={(e) => handleMappingChange("S5", e.target.value)}
                    placeholder="Autre"
                  />
                </div>
                <div className="form-group">
                  {/* Espace vide pour alignement */}
                </div>
              </div>
            </>
          )}

          {/* Tab États Commande */}
          {activeTab === "etats" && (
            <>
              <div className="tab-description-row">
                <p className="tab-description">
                  Personnalisez les libellés des états de commande (0 à 9) pour
                  cette entreprise. Ces libellés seront affichés dans le détail
                  des commandes.
                </p>
                <button
                  type="button"
                  className="btn-reset-etats"
                  onClick={handleResetEtats}
                  title="Réinitialiser les valeurs par défaut"
                >
                  Réinitialiser
                </button>
              </div>

              <div className="etats-grid">
                {Object.keys(DEFAULT_ETATS_COMMANDE).map((key) => (
                  <div className="form-group etat-field" key={key}>
                    <label>
                      <span className="etat-key">État {key}</span>
                      <span className="etat-default">
                        (défaut: {DEFAULT_ETATS_COMMANDE[key]})
                      </span>
                    </label>
                    <input
                      type="text"
                      value={formData.mappingEtatsCommande[key] || ""}
                      onChange={(e) => handleEtatChange(key, e.target.value)}
                      placeholder={DEFAULT_ETATS_COMMANDE[key]}
                    />
                  </div>
                ))}
              </div>
            </>
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

export default EntrepriseModal;