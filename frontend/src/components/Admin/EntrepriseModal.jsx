// src/components/admin/EntrepriseModal.jsx
import React, { useState, useEffect } from "react";
import {
  HiX,
  HiPhotograph,
  HiFolder,
  HiDatabase,
  HiClipboardList,
  HiMail,
  HiUserGroup,
  HiPlus,
  HiTrash,
  HiSearch,
} from "react-icons/hi";
import {
  useCreateEntrepriseMutation,
  useUpdateEntrepriseMutation,
} from "../../slices/entrepriseApiSlice";
import { BASE_URL } from "../../constants";
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
    mappingEtatsFacture: {},
    mappingEtatsProforma: {},
    cheminRapportReception:
      "\\\\192.168.0.250\\Rcommun\\STOCK\\controle commande",
    emailsRapportReception: [],
    cheminLogoEtiquettes: "",
    vendeurs: [],
    isActive: true,
  });

  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("general");
  const [detecting, setDetecting] = useState(false);
  const [vendeursMsg, setVendeursMsg] = useState("");

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

      // États facture / proforma (libellés libres, défaut vide)
      const factureFromEnt = {};
      if (entreprise.mappingEtatsFacture) {
        Object.entries(entreprise.mappingEtatsFacture).forEach(([k, v]) => {
          factureFromEnt[k] = v;
        });
      }
      const proformaFromEnt = {};
      if (entreprise.mappingEtatsProforma) {
        Object.entries(entreprise.mappingEtatsProforma).forEach(([k, v]) => {
          proformaFromEnt[k] = v;
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
        mappingEtatsFacture: factureFromEnt,
        mappingEtatsProforma: proformaFromEnt,
        cheminRapportReception:
          entreprise.cheminRapportReception ||
          "\\\\192.168.0.250\\Rcommun\\STOCK\\controle commande",
        emailsRapportReception: Array.isArray(
          entreprise.emailsRapportReception,
        )
          ? entreprise.emailsRapportReception
          : [],
        cheminLogoEtiquettes: entreprise.cheminLogoEtiquettes || "",
        vendeurs: Array.isArray(entreprise.vendeurs)
          ? entreprise.vendeurs.map((v) => ({
              code: v.code || "",
              nom: v.nom || "",
              prenom: v.prenom || "",
              email: v.email || "",
              type: v.type || "vendeur",
            }))
          : [],
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

  const handleEtatFactureChange = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      mappingEtatsFacture: { ...prev.mappingEtatsFacture, [key]: value },
    }));
  };

  const handleEtatProformaChange = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      mappingEtatsProforma: { ...prev.mappingEtatsProforma, [key]: value },
    }));
  };

  const handleResetEtats = () => {
    setFormData((prev) => ({
      ...prev,
      mappingEtatsCommande: { ...DEFAULT_ETATS_COMMANDE },
    }));
  };

  // Emails du rapport réception : édition multi-lignes (1 email par ligne)
  const handleEmailsChange = (e) => {
    setFormData((prev) => ({
      ...prev,
      emailsRapportReception: e.target.value.split("\n"),
    }));
  };

  // ---- Vendeurs (codes REPRES) ----
  const addVendeur = () => {
    setFormData((prev) => ({
      ...prev,
      vendeurs: [
        ...prev.vendeurs,
        { code: "", nom: "", prenom: "", email: "", type: "vendeur" },
      ],
    }));
  };

  const updateVendeur = (index, field, value) => {
    setFormData((prev) => {
      const vendeurs = [...prev.vendeurs];
      const val =
        field === "code" ? value.replace(/\D/g, "").slice(0, 2) : value;
      vendeurs[index] = { ...vendeurs[index], [field]: val };
      return { ...prev, vendeurs };
    });
  };

  const removeVendeur = (index) => {
    setFormData((prev) => ({
      ...prev,
      vendeurs: prev.vendeurs.filter((_, i) => i !== index),
    }));
  };

  // Auto-détection des codes vendeurs depuis facture.REPRES
  const detecterVendeurs = async () => {
    if (!formData.nomDossierDBF.trim()) {
      setVendeursMsg("Renseignez d'abord le « Nom dossier DBF ».");
      return;
    }
    setDetecting(true);
    setVendeursMsg("");
    try {
      const res = await fetch(
        `${BASE_URL}/api/entreprises/${formData.nomDossierDBF.trim()}/representants`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || "Échec de la détection");
      }
      const data = await res.json();
      const existants = new Set(
        formData.vendeurs.map((v) => String(v.code).trim()),
      );
      const aAjouter = (data.representants || [])
        .filter((r) => !existants.has(String(r.code).trim()))
        .map((r) => ({
          code: r.code,
          nom: "",
          prenom: "",
          email: "",
          type: "vendeur",
        }));
      if (aAjouter.length === 0) {
        setVendeursMsg("Aucun nouveau code trouvé dans les factures.");
      } else {
        setFormData((prev) => ({
          ...prev,
          vendeurs: [...prev.vendeurs, ...aAjouter].sort((a, b) =>
            String(a.code).localeCompare(String(b.code)),
          ),
        }));
        setVendeursMsg(
          `${aAjouter.length} code(s) ajouté(s) depuis les factures.`,
        );
      }
    } catch (e) {
      setVendeursMsg(e.message);
    } finally {
      setDetecting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Validation
    if (formData.trigramme.length < 2 || formData.trigramme.length > 5) {
      setError("Le trigramme doit contenir entre 2 et 5 caractères");
      return;
    }

    // Normalisation des emails (accepte retours ligne, virgules, points-virgules)
    const emails = (formData.emailsRapportReception || [])
      .flatMap((l) => String(l).split(/[,;]+/))
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = { ...formData, emailsRapportReception: emails };

    try {
      if (isEdit) {
        await updateEntreprise({ id: entreprise._id, ...payload }).unwrap();
      } else {
        await createEntreprise(payload).unwrap();
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
          <button
            className={`tab-btn ${activeTab === "etatsFacture" ? "active" : ""}`}
            onClick={() => setActiveTab("etatsFacture")}
          >
            <HiClipboardList /> États Facture
          </button>
          <button
            className={`tab-btn ${activeTab === "etatsProforma" ? "active" : ""}`}
            onClick={() => setActiveTab("etatsProforma")}
          >
            <HiClipboardList /> États Proforma
          </button>
          <button
            className={`tab-btn ${activeTab === "reception" ? "active" : ""}`}
            onClick={() => setActiveTab("reception")}
          >
            <HiMail /> Réception
          </button>
          <button
            className={`tab-btn ${activeTab === "vendeurs" ? "active" : ""}`}
            onClick={() => setActiveTab("vendeurs")}
          >
            <HiUserGroup /> Vendeurs
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

              <div className="form-group">
                <label>
                  <HiFolder /> Logo étiquettes (optionnel)
                </label>
                <input
                  type="text"
                  name="cheminLogoEtiquettes"
                  value={formData.cheminLogoEtiquettes}
                  onChange={handleChange}
                  placeholder="\\192.168.0.250\Rcommun\STOCK\logo.png"
                />
                <span className="input-hint">
                  Chemin complet du fichier image (PNG/JPG) affiché sur les
                  étiquettes pleine page. Laisser vide pour aucun logo.
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

          {/* Tab États Facture */}
          {activeTab === "etatsFacture" && (
            <>
              <p className="tab-description">
                Définissez les libellés des états de facture (codes 0 à 9) pour
                cette entreprise. Ces libellés seront affichés dans les écrans
                Factures. Laissez vide un code non utilisé.
              </p>
              <div className="etats-grid">
                {Object.keys(DEFAULT_ETATS_COMMANDE).map((key) => (
                  <div className="form-group etat-field" key={key}>
                    <label>
                      <span className="etat-key">État {key}</span>
                    </label>
                    <input
                      type="text"
                      value={formData.mappingEtatsFacture[key] || ""}
                      onChange={(e) =>
                        handleEtatFactureChange(key, e.target.value)
                      }
                      placeholder={`Libellé état ${key}`}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Tab États Proforma */}
          {activeTab === "etatsProforma" && (
            <>
              <p className="tab-description">
                Définissez les libellés des états de proforma (codes 0 à 9) pour
                cette entreprise. Ces libellés seront affichés dans les écrans
                Proformas. Laissez vide un code non utilisé.
              </p>
              <div className="etats-grid">
                {Object.keys(DEFAULT_ETATS_COMMANDE).map((key) => (
                  <div className="form-group etat-field" key={key}>
                    <label>
                      <span className="etat-key">État {key}</span>
                    </label>
                    <input
                      type="text"
                      value={formData.mappingEtatsProforma[key] || ""}
                      onChange={(e) =>
                        handleEtatProformaChange(key, e.target.value)
                      }
                      placeholder={`Libellé état ${key}`}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Tab Réception */}
          {activeTab === "reception" && (
            <>
              <p className="tab-description">
                Paramètres du rapport de contrôle commande (réception de
                marchandises) : dossier d'enregistrement du PDF et destinataires
                de l'email.
              </p>

              <div className="form-group">
                <label>
                  <HiFolder /> Dossier d'enregistrement du rapport
                </label>
                <input
                  type="text"
                  name="cheminRapportReception"
                  value={formData.cheminRapportReception}
                  onChange={handleChange}
                  placeholder="\\192.168.0.250\Rcommun\STOCK\controle commande"
                />
                <span className="input-hint">
                  Dossier réseau (RCOMMUN) où le PDF du rapport sera déposé.
                </span>
              </div>

              <div className="form-group">
                <label>
                  <HiMail /> Emails destinataires du rapport
                </label>
                <textarea
                  name="emailsRapportReception"
                  rows={5}
                  value={(formData.emailsRapportReception || []).join("\n")}
                  onChange={handleEmailsChange}
                  placeholder={"achats@exemple.com\nresponsable@exemple.com"}
                />
                <span className="input-hint">
                  Un email par ligne (les virgules et points-virgules sont aussi
                  acceptés). Le rapport PDF leur sera envoyé en pièce jointe.
                </span>
              </div>
            </>
          )}

          {/* Tab Vendeurs */}
          {activeTab === "vendeurs" && (
            <>
              <p className="tab-description">
                Associez chaque code vendeur (champ <strong>REPRES</strong>, 2
                chiffres) à une identité et un type. « Détecter » récupère les
                codes réellement présents dans les factures ; vous pouvez aussi
                en ajouter manuellement.
              </p>

              <div className="vendeurs-toolbar">
                <button
                  type="button"
                  className="btn-detect-vendeur"
                  onClick={detecterVendeurs}
                  disabled={detecting}
                >
                  <HiSearch />{" "}
                  {detecting ? "Détection…" : "Détecter depuis les factures"}
                </button>
                <button
                  type="button"
                  className="btn-add-vendeur"
                  onClick={addVendeur}
                >
                  <HiPlus /> Ajouter un code
                </button>
                {vendeursMsg ? (
                  <span className="vendeurs-msg">{vendeursMsg}</span>
                ) : null}
              </div>

              {formData.vendeurs.length === 0 ? (
                <div className="vendeurs-empty">
                  Aucun code vendeur. Cliquez sur « Détecter » ou « Ajouter un
                  code ».
                </div>
              ) : (
                <table className="vendeurs-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Nom</th>
                      <th>Prénom</th>
                      <th>Email</th>
                      <th>Type</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formData.vendeurs.map((v, i) => (
                      <tr key={i}>
                        <td>
                          <input
                            className="vendeur-code-input"
                            type="text"
                            inputMode="numeric"
                            value={v.code}
                            maxLength={2}
                            placeholder="00"
                            onChange={(e) =>
                              updateVendeur(i, "code", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={v.nom}
                            placeholder="Nom"
                            onChange={(e) =>
                              updateVendeur(i, "nom", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            value={v.prenom}
                            placeholder="Prénom"
                            onChange={(e) =>
                              updateVendeur(i, "prenom", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <input
                            type="email"
                            value={v.email}
                            placeholder="email (optionnel)"
                            onChange={(e) =>
                              updateVendeur(i, "email", e.target.value)
                            }
                          />
                        </td>
                        <td>
                          <select
                            value={v.type}
                            onChange={(e) =>
                              updateVendeur(i, "type", e.target.value)
                            }
                          >
                            <option value="commercial">Commercial</option>
                            <option value="vendeur">Vendeur</option>
                            <option value="autre">Autre</option>
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-vendeur-remove"
                            onClick={() => removeVendeur(i)}
                            title="Supprimer"
                          >
                            <HiTrash />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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