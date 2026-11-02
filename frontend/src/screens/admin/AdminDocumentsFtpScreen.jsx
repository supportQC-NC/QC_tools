// src/screens/admin/AdminDocumentsFtpScreen.jsx
//
// DOCUMENTS FTP : consultation du miroir FTP des documents générés par
// l'application pour la société active (.dat collecteurs, rapports de
// réception/préparation, fiches de contrôle), rangés par catégorie puis par
// mois sur le FTPS robot-documents. Le miroir n'existe que pour les sociétés
// dont la fiche porte un « Dossier FTP documents » (ex. SEDQ pour DQ).
//
// Navigation en fil d'Ariane ; le téléchargement passe par window.open sur
// l'endpoint /telecharger (le proxy de dev relaie les navigations grâce à
// setupProxy.js). Ajout (téléversement, y compris par glisser-déposer) et
// suppression de fichiers selon les actions write/delete du module
// documents_ftp_admin — la suppression demande une confirmation EN LIGNE
// (pas de window.confirm, thème sombre oblige).

import React, { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  useGetDocumentsFtpQuery,
  useUploadDocumentsFtpMutation,
  useDeleteDocumentFtpMutation,
} from "../../slices/documentsFtpApiSlice";
import { hasModuleAccess } from "../../config/adminModules";
import { BASE_URL } from "../../constants";
import "./AdminDocumentsFtpScreen.css";

const MODULE = "documents_ftp_admin";

const fmtTaille = (n) => {
  if (n == null) return "";
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} Mo`;
  if (n >= 1024) return `${Math.round(n / 1024)} Ko`;
  return `${n} o`;
};
const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";

// Icône par extension — purement cosmétique.
const iconeFichier = (nom) => {
  const ext = (nom.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") return "📕";
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return "📊";
  if (ext === "dat" || ext === "txt") return "📄";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "🖼️";
  if (ext === "zip") return "🗜️";
  return "📄";
};

const AdminDocumentsFtpScreen = () => {
  const dossier = useSelector(selectGlobalDossier) || "";
  const { userInfo } = useSelector((state) => state.auth);
  const peutAjouter = hasModuleAccess(userInfo, MODULE, "write");
  const peutSupprimer = hasModuleAccess(userInfo, MODULE, "delete");

  // Chemin courant sous la racine de la société (segments).
  const [segments, setSegments] = useState([]);
  // Nom du fichier dont la suppression attend confirmation (un seul à la fois).
  const [aConfirmer, setAConfirmer] = useState(null);
  // Bandeau de statut { type: "ok" | "erreur", texte }.
  const [statut, setStatut] = useState(null);
  const [glisseDessus, setGlisseDessus] = useState(false);
  const inputFichiers = useRef(null);

  useEffect(() => {
    setSegments([]);
    setAConfirmer(null);
    setStatut(null);
  }, [dossier]);

  useEffect(() => {
    setAConfirmer(null);
  }, [segments]);

  // Le bandeau de succès s'efface seul ; une erreur reste affichée.
  useEffect(() => {
    if (statut?.type !== "ok") return undefined;
    const t = setTimeout(() => setStatut(null), 5000);
    return () => clearTimeout(t);
  }, [statut]);

  const chemin = segments.join("/");
  const { data, isFetching, error, refetch } = useGetDocumentsFtpQuery(
    { nomDossierDBF: dossier, chemin },
    { skip: !dossier },
  );

  const [uploadDocuments, { isLoading: envoiEnCours }] =
    useUploadDocumentsFtpMutation();
  const [deleteDocument, { isLoading: suppressionEnCours }] =
    useDeleteDocumentFtpMutation();

  const telecharger = (nom) => {
    const c = encodeURIComponent(chemin ? `${chemin}/${nom}` : nom);
    window.open(
      `${BASE_URL}/api/documents-ftp/${dossier}/telecharger?chemin=${c}`,
      "_blank",
    );
  };

  const envoyerFichiers = async (fichiers) => {
    const liste = Array.from(fichiers || []);
    if (!liste.length) return;
    try {
      const r = await uploadDocuments({
        nomDossierDBF: dossier,
        chemin,
        fichiers: liste,
      }).unwrap();
      setStatut({
        type: "ok",
        texte:
          r.deposes.length > 1
            ? `${r.deposes.length} fichiers déposés.`
            : "Fichier déposé.",
      });
    } catch (err) {
      setStatut({
        type: "erreur",
        texte: err?.data?.message || "Téléversement impossible.",
      });
    }
  };

  const onChoixFichiers = (e) => {
    envoyerFichiers(e.target.files);
    e.target.value = ""; // permet de redéposer le même fichier
  };

  const onDrop = (e) => {
    e.preventDefault();
    setGlisseDessus(false);
    if (peutAjouter && !envoiEnCours) envoyerFichiers(e.dataTransfer.files);
  };

  const supprimer = async (nom) => {
    try {
      await deleteDocument({
        nomDossierDBF: dossier,
        chemin: chemin ? `${chemin}/${nom}` : nom,
      }).unwrap();
      setStatut({ type: "ok", texte: `« ${nom} » supprimé.` });
    } catch (err) {
      setStatut({
        type: "erreur",
        texte: err?.data?.message || "Suppression impossible.",
      });
    } finally {
      setAConfirmer(null);
    }
  };

  if (!dossier) {
    return (
      <div className="dftp-screen">
        <h1 className="dftp-titre">Documents FTP</h1>
        <p className="dftp-info">Sélectionnez une société dans l'en-tête.</p>
      </div>
    );
  }

  const nbDossiers = data?.entrees.filter((e) => e.type === "dossier").length || 0;
  const nbFichiers = data?.entrees.filter((e) => e.type === "fichier").length || 0;

  return (
    <div className="dftp-screen">
      <div className="dftp-entete">
        <div>
          <h1 className="dftp-titre">
            <span className="dftp-titre-icone">🗄️</span> Documents FTP —{" "}
            {dossier}
          </h1>
          <p className="dftp-sous-titre">
            Fichiers générés par l'application (fichiers de transfert .dat,
            rapports, fiches de contrôle), archivés sur le FTP robot-documents.
          </p>
        </div>
        <div className="dftp-actions">
          <button
            type="button"
            className="dftp-btn"
            onClick={refetch}
            disabled={isFetching}
            title="Relire le dossier courant sur le FTP"
          >
            ⟳ Actualiser
          </button>
          {peutAjouter && (
            <>
              <input
                ref={inputFichiers}
                type="file"
                multiple
                hidden
                onChange={onChoixFichiers}
              />
              <button
                type="button"
                className="dftp-btn dftp-btn-primaire"
                onClick={() => inputFichiers.current?.click()}
                disabled={envoiEnCours}
              >
                {envoiEnCours ? "Envoi…" : "⬆ Ajouter des fichiers"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Fil d'Ariane */}
      <div className="dftp-ariane">
        <button type="button" onClick={() => setSegments([])}>
          🏠 {data?.racine || "racine"}
        </button>
        {segments.map((s, i) => (
          <React.Fragment key={`${s}-${i}`}>
            <span className="dftp-sep">›</span>
            <button
              type="button"
              onClick={() => setSegments(segments.slice(0, i + 1))}
            >
              {s}
            </button>
          </React.Fragment>
        ))}
        {isFetching && <span className="dftp-chargement">chargement…</span>}
        {data && !isFetching && (
          <span className="dftp-compteurs">
            {nbDossiers > 0 && `${nbDossiers} dossier${nbDossiers > 1 ? "s" : ""}`}
            {nbDossiers > 0 && nbFichiers > 0 && " · "}
            {nbFichiers > 0 && `${nbFichiers} fichier${nbFichiers > 1 ? "s" : ""}`}
            {nbDossiers === 0 && nbFichiers === 0 && "vide"}
          </span>
        )}
      </div>

      {statut && (
        <p className={`dftp-statut ${statut.type === "ok" ? "ok" : "erreur"}`}>
          {statut.texte}
          <button type="button" onClick={() => setStatut(null)}>
            ✕
          </button>
        </p>
      )}

      {error && (
        <p className="dftp-erreur">
          {error?.data?.message || "Dossier FTP inaccessible."}
        </p>
      )}

      {!error && data && (
        <div
          className={`dftp-table-wrap${glisseDessus ? " dftp-drop-actif" : ""}`}
          onDragOver={
            peutAjouter
              ? (e) => {
                  e.preventDefault();
                  setGlisseDessus(true);
                }
              : undefined
          }
          onDragLeave={
            peutAjouter
              ? (e) => {
                  // Ignorer les dragleave internes (survol des lignes).
                  if (!e.currentTarget.contains(e.relatedTarget))
                    setGlisseDessus(false);
                }
              : undefined
          }
          onDrop={peutAjouter ? onDrop : undefined}
        >
          <table className="dftp-table">
            <thead>
              <tr>
                <th className="gauche">Nom</th>
                <th>Taille</th>
                <th>Modifié le</th>
                <th className="dftp-col-actions" />
              </tr>
            </thead>
            <tbody>
              {data.entrees.length === 0 && (
                <tr>
                  <td colSpan={4} className="gauche vide">
                    <div className="dftp-vide">
                      <span className="dftp-vide-icone">📂</span>
                      Dossier vide — les fichiers apparaissent au fil des
                      générations
                      {peutAjouter &&
                        ", ou déposez-en un avec « Ajouter des fichiers »"}
                      .
                    </div>
                  </td>
                </tr>
              )}
              {data.entrees.map((e) => (
                <tr key={e.nom}>
                  <td className="gauche">
                    {e.type === "dossier" ? (
                      <button
                        type="button"
                        className="dftp-dossier"
                        onClick={() => setSegments([...segments, e.nom])}
                      >
                        📁 {e.nom}
                      </button>
                    ) : (
                      <span className="dftp-fichier">
                        {iconeFichier(e.nom)} {e.nom}
                      </span>
                    )}
                  </td>
                  <td>{fmtTaille(e.taille)}</td>
                  <td>{fmtDate(e.modifieLe)}</td>
                  <td className="dftp-col-actions">
                    {e.type === "fichier" && aConfirmer !== e.nom && (
                      <div className="dftp-ligne-actions">
                        <button
                          type="button"
                          className="dftp-btn"
                          onClick={() => telecharger(e.nom)}
                          title="Télécharger"
                        >
                          ⬇ Télécharger
                        </button>
                        {peutSupprimer && (
                          <button
                            type="button"
                            className="dftp-btn dftp-btn-danger"
                            onClick={() => setAConfirmer(e.nom)}
                            title="Supprimer ce fichier du FTP"
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    )}
                    {e.type === "fichier" && aConfirmer === e.nom && (
                      <div className="dftp-ligne-actions dftp-confirm">
                        <span>Supprimer ?</span>
                        <button
                          type="button"
                          className="dftp-btn dftp-btn-danger"
                          onClick={() => supprimer(e.nom)}
                          disabled={suppressionEnCours}
                        >
                          {suppressionEnCours ? "…" : "Oui, supprimer"}
                        </button>
                        <button
                          type="button"
                          className="dftp-btn"
                          onClick={() => setAConfirmer(null)}
                          disabled={suppressionEnCours}
                        >
                          Annuler
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {glisseDessus && (
            <div className="dftp-drop-voile">
              Déposer ici pour téléverser dans{" "}
              <strong>{chemin || data.racine}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminDocumentsFtpScreen;
