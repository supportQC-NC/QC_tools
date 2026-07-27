// src/screens/admin/AdminExecutableDetailScreen.jsx
//
// Détail d'un produit exécutable : toutes ses versions (triées de la plus
// récente à la plus ancienne), avec téléchargement, documentation et gestion.
import React, { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  HiArrowLeft,
  HiDownload,
  HiTrash,
  HiX,
  HiExternalLink,
  HiDocumentText,
  HiPhotograph,
  HiCube,
  HiPlus,
  HiPaperClip,
  HiExclamationCircle,
} from "react-icons/hi";
import { FaGithub } from "react-icons/fa";
import {
  useGetExecutablesQuery,
  useDeleteExecutableMutation,
  useDeleteExecutableDocumentMutation,
  useAddExecutableDocumentsMutation,
  executableDownloadUrl,
  executableDocumentUrl,
} from "../../slices/executableApiSlice";
import ExecutableCreateModal from "../../components/Admin/ExecutableCreateModal";
import { isSuperAdminClient } from "../../config/adminModules";
import {
  formatSize,
  formatDate,
  compareVersionsDesc,
  triggerDownload,
  openInNewTab,
} from "../../utils/executableHelpers";
import "./AdminExecutablesScreen.css";

const docIcon = (kind) =>
  kind === "image" ? <HiPhotograph /> : <HiDocumentText />;

const AdminExecutableDetailScreen = () => {
  const { name: rawName } = useParams();
  const name = decodeURIComponent(rawName || "");
  const { userInfo } = useSelector((state) => state.auth);
  const canManage = isSuperAdminClient(userInfo);

  const { data: executables, isLoading, error } = useGetExecutablesQuery();
  const [deleteExecutable] = useDeleteExecutableMutation();
  const [deleteDocument] = useDeleteExecutableDocumentMutation();
  const [addDocuments] = useAddExecutableDocumentsMutation();

  const [showNewVersion, setShowNewVersion] = React.useState(false);

  const versions = useMemo(() => {
    return (executables || [])
      .filter((e) => e.name === name)
      .sort(compareVersionsDesc);
  }, [executables, name]);

  const latest = versions[0];
  const githubLink = versions.find((v) => v.githubLink)?.githubLink;
  const description = latest?.description;

  const handleDeleteExe = async (exe) => {
    if (window.confirm(`Supprimer « ${exe.name} » v${exe.version} ?`)) {
      try {
        await deleteExecutable(exe._id).unwrap();
      } catch (err) {
        alert(err?.data?.message || "Erreur lors de la suppression");
      }
    }
  };

  const handleDeleteDoc = async (exe, doc) => {
    if (window.confirm(`Supprimer le document « ${doc.fileName} » ?`)) {
      try {
        await deleteDocument({ id: exe._id, docId: doc._id }).unwrap();
      } catch (err) {
        alert(err?.data?.message || "Erreur lors de la suppression");
      }
    }
  };

  const handleAddDocsToVersion = async (exeId, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      await addDocuments({ id: exeId, documents: files }).unwrap();
    } catch (err) {
      alert(err?.data?.message || "Erreur lors de l'ajout de documents");
    }
  };

  return (
    <div className="admin-executables exe-detail">
      <div className="exe-detail-topbar">
        <Link to="/admin/executables" className="exe-back">
          <HiArrowLeft />
          <span>Exécutables</span>
        </Link>
        {canManage && versions.length > 0 && (
          <button className="exe-btn-primary" onClick={() => setShowNewVersion(true)}>
            <HiPlus />
            <span>Nouvelle version</span>
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="exe-state">
          <div className="exe-spinner" />
          <p>Chargement…</p>
        </div>
      ) : error ? (
        <div className="exe-state error">
          <HiExclamationCircle />
          <p>Erreur : {error?.data?.message || "chargement impossible"}</p>
        </div>
      ) : versions.length === 0 ? (
        <div className="exe-empty">
          <HiCube />
          <h3>Produit introuvable</h3>
          <p>Aucune version pour « {name} ».</p>
          <Link to="/admin/executables" className="exe-btn-ghost">
            Retour au catalogue
          </Link>
        </div>
      ) : (
        <>
          <header className="exe-detail-head">
            <div className="exe-header-icon">
              <HiCube />
            </div>
            <div className="exe-detail-headinfo">
              <h1>{name}</h1>
              {description && <p className="exe-detail-desc">{description}</p>}
              <div className="exe-detail-meta">
                <span className="exe-cc-chip">
                  {versions.length} version{versions.length > 1 ? "s" : ""}
                </span>
                {githubLink && (
                  <a
                    className="exe-detail-gh"
                    href={githubLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FaGithub />
                    <span>Dépôt GitHub</span>
                    <HiExternalLink />
                  </a>
                )}
              </div>
            </div>
          </header>

          <h2 className="exe-versions-title">Versions (récente → ancienne)</h2>

          <div className="exe-versions-list">
            {versions.map((exe, idx) => (
              <div key={exe._id} className={`exe-version ${idx === 0 ? "latest" : ""}`}>
                <div className="exe-version-top">
                  <div className="exe-version-info">
                    <span className="exe-version-badge">v{exe.version}</span>
                    {idx === 0 && <span className="exe-latest-tag">Dernière</span>}
                    <span className="exe-version-meta">
                      {formatSize(exe.size)} · {formatDate(exe.createdAt)}
                    </span>
                  </div>
                  <div className="exe-version-actions">
                    {exe.githubLink && (
                      <a
                        className="exe-icon-link"
                        href={exe.githubLink}
                        target="_blank"
                        rel="noreferrer"
                        title="Dépôt GitHub"
                      >
                        <FaGithub />
                      </a>
                    )}
                    <button
                      type="button"
                      className="exe-download"
                      onClick={() =>
                        triggerDownload(executableDownloadUrl(exe._id), exe.fileName)
                      }
                      title="Télécharger l'exécutable"
                    >
                      <HiDownload />
                      <span>Télécharger</span>
                    </button>
                    {canManage && (
                      <button
                        className="exe-icon-btn danger"
                        onClick={() => handleDeleteExe(exe)}
                        title="Supprimer cette version"
                      >
                        <HiTrash />
                      </button>
                    )}
                  </div>
                </div>

                {(exe.documents?.length > 0 || canManage) && (
                  <div className="exe-docs">
                    <div className="exe-docs-head">
                      <span className="exe-docs-label">
                        <HiPaperClip /> Documentation
                      </span>
                      {canManage && (
                        <label className="exe-adddoc" title="Ajouter des documents">
                          <HiPlus />
                          <span>Ajouter</span>
                          <input
                            type="file"
                            multiple
                            accept=".pdf,image/*"
                            hidden
                            onChange={(e) => {
                              handleAddDocsToVersion(exe._id, e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                    </div>
                    {exe.documents?.length > 0 ? (
                      <div className="exe-docs-list">
                        {exe.documents.map((doc) => (
                          <span key={doc._id} className="exe-doc">
                            <button
                              type="button"
                              className="exe-doc-link"
                              onClick={() =>
                                openInNewTab(executableDocumentUrl(exe._id, doc._id))
                              }
                              title={`Voir ${doc.fileName}`}
                            >
                              {docIcon(doc.kind)}
                              <span className="exe-doc-name">{doc.fileName}</span>
                              <HiExternalLink className="exe-doc-ext" />
                            </button>
                            <button
                              type="button"
                              className="exe-doc-dl"
                              onClick={() =>
                                triggerDownload(
                                  executableDocumentUrl(exe._id, doc._id),
                                  doc.fileName,
                                )
                              }
                              title="Télécharger"
                            >
                              <HiDownload />
                            </button>
                            {canManage && (
                              <button
                                className="exe-doc-del"
                                onClick={() => handleDeleteDoc(exe, doc)}
                                title="Supprimer le document"
                              >
                                <HiX />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="exe-docs-none">Aucun document.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {showNewVersion && (
        <ExecutableCreateModal
          defaultName={name}
          onClose={() => setShowNewVersion(false)}
        />
      )}
    </div>
  );
};

export default AdminExecutableDetailScreen;
