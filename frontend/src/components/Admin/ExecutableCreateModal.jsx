// src/components/Admin/ExecutableCreateModal.jsx
//
// Modale de création d'un exécutable (ou d'une nouvelle version d'un produit
// existant si `defaultName` est fourni). Réutilisée par l'écran liste et l'écran
// détail. Le binaire + les documents sont envoyés en multipart -> GridFS.
import React, { useState } from "react";
import { HiX } from "react-icons/hi";
import { useCreateExecutableMutation } from "../../slices/executableApiSlice";
import Modal from "../ui/Modal/Modal";
import "../../screens/admin/AdminExecutablesScreen.css";

const formatSize = (bytes) => {
  if (!bytes) return "—";
  const units = ["o", "Ko", "Mo", "Go"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
};

const ExecutableCreateModal = ({ onClose, defaultName = "" }) => {
  const [createExecutable, { isLoading }] = useCreateExecutableMutation();
  const [form, setForm] = useState({
    name: defaultName,
    version: "",
    description: "",
    githubLink: "",
  });
  const [exeFile, setExeFile] = useState(null);
  const [docFiles, setDocFiles] = useState([]);
  const [error, setError] = useState("");

  const handleChange = (e) =>
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));

  const handleAddDocs = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length) setDocFiles((prev) => [...prev, ...picked]);
    e.target.value = "";
  };

  const removeDoc = (i) =>
    setDocFiles((prev) => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim() || !form.version.trim()) {
      setError("Le nom et la version sont requis.");
      return;
    }
    if (!exeFile) {
      setError("Sélectionnez le fichier exécutable.");
      return;
    }
    try {
      await createExecutable({
        ...form,
        executable: exeFile,
        documents: docFiles,
      }).unwrap();
      onClose();
    } catch (err) {
      setError(err?.data?.message || "Erreur lors de l'enregistrement.");
    }
  };

  return (
    <Modal onClose={onClose} overlayClassName="exe-modal-overlay" contentClassName="exe-modal">
      <div className="exe-modal-head">
        <h2>{defaultName ? `Nouvelle version — ${defaultName}` : "Nouvel exécutable"}</h2>
        <button className="exe-modal-close" onClick={onClose}>
          <HiX />
        </button>
      </div>

      <form className="exe-form" onSubmit={handleSubmit}>
        {error && <div className="exe-form-error">{error}</div>}

        <div className="exe-form-row">
          <div className="exe-field">
            <label>Nom *</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="Ex : Collecteur Douchette"
              readOnly={!!defaultName}
              required
            />
          </div>
          <div className="exe-field exe-field-sm">
            <label>Version *</label>
            <input
              name="version"
              value={form.version}
              onChange={handleChange}
              placeholder="Ex : 1.2.0"
              required
            />
          </div>
        </div>

        <div className="exe-field">
          <label>Description courte</label>
          <input
            name="description"
            value={form.description}
            onChange={handleChange}
            placeholder="À quoi sert cet outil ?"
          />
        </div>

        <div className="exe-field">
          <label>Lien GitHub</label>
          <input
            name="githubLink"
            value={form.githubLink}
            onChange={handleChange}
            placeholder="https://github.com/…"
          />
        </div>

        <div className="exe-field">
          <label>Fichier exécutable *</label>
          <input
            type="file"
            onChange={(e) => setExeFile(e.target.files?.[0] || null)}
          />
          {exeFile && (
            <span className="exe-file-hint">
              {exeFile.name} · {formatSize(exeFile.size)}
            </span>
          )}
        </div>

        <div className="exe-field">
          <label>Documentation (PDF / images — ajoutez-en autant que voulu)</label>
          <input
            type="file"
            multiple
            accept=".pdf,image/*"
            onChange={handleAddDocs}
          />
          {docFiles.length > 0 && (
            <ul className="exe-doc-picklist">
              {docFiles.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span className="exe-doc-pick-name">{f.name}</span>
                  <span className="exe-doc-pick-size">{formatSize(f.size)}</span>
                  <button
                    type="button"
                    className="exe-doc-pick-del"
                    onClick={() => removeDoc(i)}
                    title="Retirer"
                  >
                    <HiX />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="exe-form-actions">
          <button type="button" className="exe-btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="exe-btn-primary" disabled={isLoading}>
            {isLoading ? "Envoi…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ExecutableCreateModal;
