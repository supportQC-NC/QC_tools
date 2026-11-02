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
// setupProxy.js).

import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import { useGetDocumentsFtpQuery } from "../../slices/documentsFtpApiSlice";
import { BASE_URL } from "../../constants";
import "./AdminDocumentsFtpScreen.css";

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

const AdminDocumentsFtpScreen = () => {
  const dossier = useSelector(selectGlobalDossier) || "";
  // Chemin courant sous la racine de la société (segments).
  const [segments, setSegments] = useState([]);

  useEffect(() => {
    setSegments([]);
  }, [dossier]);

  const chemin = segments.join("/");
  const { data, isFetching, error } = useGetDocumentsFtpQuery(
    { nomDossierDBF: dossier, chemin },
    { skip: !dossier },
  );

  const telecharger = (nom) => {
    const c = encodeURIComponent(chemin ? `${chemin}/${nom}` : nom);
    window.open(
      `${BASE_URL}/api/documents-ftp/${dossier}/telecharger?chemin=${c}`,
      "_blank",
    );
  };

  if (!dossier) {
    return (
      <div className="dftp-screen">
        <h1 className="dftp-titre">Documents FTP</h1>
        <p className="dftp-info">Sélectionnez une société dans l'en-tête.</p>
      </div>
    );
  }

  return (
    <div className="dftp-screen">
      <div className="dftp-entete">
        <h1 className="dftp-titre">Documents FTP — {dossier}</h1>
        <p className="dftp-sous-titre">
          Fichiers générés par l'application (fichiers de transfert .dat,
          rapports, fiches de contrôle), archivés sur le FTP robot-documents.
        </p>
      </div>

      {/* Fil d'Ariane */}
      <div className="dftp-ariane">
        <button type="button" onClick={() => setSegments([])}>
          {data?.racine || "racine"}
        </button>
        {segments.map((s, i) => (
          <React.Fragment key={`${s}-${i}`}>
            <span className="dftp-sep">/</span>
            <button
              type="button"
              onClick={() => setSegments(segments.slice(0, i + 1))}
            >
              {s}
            </button>
          </React.Fragment>
        ))}
        {isFetching && <span className="dftp-chargement">chargement…</span>}
      </div>

      {error && (
        <p className="dftp-erreur">
          {error?.data?.message || "Dossier FTP inaccessible."}
        </p>
      )}

      {!error && data && (
        <div className="dftp-table-wrap">
          <table className="dftp-table">
            <thead>
              <tr>
                <th className="gauche">Nom</th>
                <th>Taille</th>
                <th>Modifié le</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.entrees.length === 0 && (
                <tr>
                  <td colSpan={4} className="gauche vide">
                    Dossier vide — les fichiers apparaissent au fil des
                    générations.
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
                      <span className="dftp-fichier">📄 {e.nom}</span>
                    )}
                  </td>
                  <td>{fmtTaille(e.taille)}</td>
                  <td>{fmtDate(e.modifieLe)}</td>
                  <td>
                    {e.type === "fichier" && (
                      <button
                        type="button"
                        className="dftp-btn"
                        onClick={() => telecharger(e.nom)}
                      >
                        ⬇ Télécharger
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminDocumentsFtpScreen;
