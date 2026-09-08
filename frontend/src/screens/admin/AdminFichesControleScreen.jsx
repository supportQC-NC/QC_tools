// src/screens/admin/AdminFichesControleScreen.jsx
import React, { useState } from "react";
import {
  HiDocumentReport,
  HiRefresh,
  HiDownload,
  HiEye,
  HiTrash,
  HiCheckCircle,
  HiExclamationCircle,
  HiClock,
  HiPlay,
  HiStop,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import {
  useGetFichesQuery,
  useScanFichesMutation,
  useDeleteFicheMutation,
  useGetWatchStatusQuery,
  useStartWatchMutation,
  useStopWatchMutation,
  getFichePdfUrl,
  telechargerFichePdf,
} from "../../slices/ficheControleApiSlice";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import "./AdminFichesControleScreen.css";

const POLL = 5000;

const AdminFichesControleScreen = () => {
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";
  const [scanReport, setScanReport] = useState(null);
  // Erreur d'aperçu / de téléchargement (message renvoyé par le backend).
  const [pdfErreur, setPdfErreur] = useState("");
  // Id de la fiche en cours de téléchargement (bouton désactivé pendant).
  const [enTelechargement, setEnTelechargement] = useState("");

  const {
    data,
    isLoading,
    refetch,
  } = useGetFichesQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
    pollingInterval: selectedEntreprise ? POLL : 0,
  });

  const [scanFiches, { isLoading: scanning }] = useScanFichesMutation();
  const [deleteFiche] = useDeleteFicheMutation();

  const { data: watchStatus } = useGetWatchStatusQuery(undefined, {
    pollingInterval: 5000,
  });
  const [startWatch, { isLoading: starting }] = useStartWatchMutation();
  const [stopWatch, { isLoading: stopping }] = useStopWatchMutation();

  const watching = !!watchStatus?.watching;

  const toggleWatch = async () => {
    try {
      if (watching) await stopWatch().unwrap();
      else await startWatch().unwrap();
    } catch {
      /* ignore */
    }
  };

  const active = data?.active;
  const fiches = data?.fiches || [];
  const session = data?.session;

  const formatDate = (d) =>
    d
      ? new Date(d).toLocaleString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";

  const handleScan = async () => {
    try {
      const res = await scanFiches(selectedEntreprise).unwrap();
      setScanReport(res?.report || null);
    } catch {
      setScanReport(null);
    }
  };

  // L'impression ne peut pas se faire depuis le serveur (le VPS n'a pas
  // d'imprimante) : on télécharge le PDF sur le poste, l'utilisateur l'imprime
  // ensuite depuis son lecteur PDF.
  const handleDownload = async (fiche) => {
    setPdfErreur("");
    setEnTelechargement(fiche._id);
    const nom =
      fiche.pdfFileName ||
      `fiche ${[fiche.zoneCode, fiche.zoneType].filter(Boolean).join(" ")}.pdf`;
    try {
      await telechargerFichePdf(selectedEntreprise, fiche._id, nom);
    } catch (err) {
      setPdfErreur(err.message || "Téléchargement impossible");
    } finally {
      setEnTelechargement("");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Supprimer cette fiche (et son PDF) ?")) return;
    try {
      await deleteFiche({ entrepriseId: selectedEntreprise, id }).unwrap();
    } catch {
      /* ignore */
    }
  };

  const openPdf = (id) => {
    setPdfErreur("");
    window.open(getFichePdfUrl(selectedEntreprise, id), "_blank", "noopener");
  };

  return (
    <div className="admin-fiches">
      <div className="admin-fiches-header">
        <h1>
          <HiDocumentReport /> Fiches de contrôle
        </h1>
        <div className="admin-fiches-actions">
          <button
            className="btn-icon"
            onClick={refetch}
            disabled={!selectedEntreprise}
            title="Rafraîchir"
          >
            <HiRefresh />
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="admin-fiches-placeholder">
          <HiDocumentReport />
          <p>
            Sélectionnez une société dans l'en-tête pour voir les fiches de
            contrôle.
          </p>
        </div>
      ) : isLoading ? (
        <div className="admin-loading">Chargement…</div>
      ) : !active ? (
        <div className="admin-fiches-placeholder">
          <HiDocumentReport />
          <p>
            Aucun inventaire actif. Initialisez-en un depuis l'écran
            « Progression d'inventaire ».
          </p>
        </div>
      ) : (
        <>
          <div className="fiches-bar">
            <div className="fiches-info">
              <strong>{session?.nom}</strong>
              {session?.dossierDat && (
                <span className="fiches-path">{session.dossierDat}</span>
              )}
            </div>
            <div className="fiches-bar-actions">
              <span className={`watch-pill ${watching ? "on" : "off"}`}>
                <span className="watch-dot" />
                Surveillance {watching ? "active" : "arrêtée"}
              </span>
              <button
                className={watching ? "btn-danger" : "btn-primary"}
                onClick={toggleWatch}
                disabled={starting || stopping}
              >
                {watching ? (
                  <>
                    <HiStop /> Arrêter
                  </>
                ) : (
                  <>
                    <HiPlay /> Démarrer
                  </>
                )}
              </button>
              <button
                className="btn-secondary"
                onClick={handleScan}
                disabled={scanning}
              >
                <HiRefresh /> {scanning ? "Scan…" : "Scanner une fois"}
              </button>
            </div>
          </div>

          {pdfErreur && (
            <div className="fiches-erreur">
              <HiExclamationCircle />
              <span>{pdfErreur}</span>
              <button
                className="scan-report-close"
                onClick={() => setPdfErreur("")}
              >
                ✕
              </button>
            </div>
          )}

          {scanReport && (
            <div className="scan-report">
              <div className="scan-report-head">
                <strong>Diagnostic du dernier scan</strong>
                <button
                  className="scan-report-close"
                  onClick={() => setScanReport(null)}
                >
                  ✕
                </button>
              </div>
              {scanReport.sessions?.length === 0 && (
                <p className="scan-line warn">
                  Aucun inventaire actif détecté côté serveur.
                </p>
              )}
              {scanReport.sessions?.map((s, i) => (
                <div key={i} className="scan-session">
                  <div className="scan-path">📂 {s.dossierDat || "(aucun dossier)"}</div>
                  {s.error && <p className="scan-line err">⚠ {s.error}</p>}
                  {s.ok && s.files.length === 0 && (
                    <p className="scan-line warn">
                      Dossier accessible mais aucun fichier .DAT trouvé dedans.
                    </p>
                  )}
                  {s.files.map((f, j) => (
                    <p key={j} className={`scan-line ${f.status}`}>
                      <code>{f.name}</code> — {f.status}
                      {f.message ? ` : ${f.message}` : ""}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="admin-fiches-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Date</th>
                  <th>Lignes</th>
                  <th>Anomalies</th>
                  <th>Impression</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fiches.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="no-data">
                      Aucune fiche pour l'instant. Les .DAT déposés dans le
                      dossier de l'inventaire seront traités automatiquement.
                    </td>
                  </tr>
                ) : (
                  fiches.map((f) => (
                    <tr key={f._id}>
                      <td>
                        <span className="zone-code">{f.zoneCode || "—"}</span>
                        {f.zoneLibelle && (
                          <span className="zone-lib">{f.zoneLibelle}</span>
                        )}
                      </td>
                      <td>{formatDate(f.date)}</td>
                      <td className="num-cell">{f.stats?.total ?? 0}</td>
                      <td>
                        <div className="badges">
                          {f.stats?.doublons > 0 && (
                            <span className="badge badge-d" title="Doublons">
                              D {f.stats.doublons}
                            </span>
                          )}
                          {f.stats?.attention > 0 && (
                            <span
                              className="badge badge-a"
                              title="Attention (stock > qté / non trouvé)"
                            >
                              A {f.stats.attention}
                            </span>
                          )}
                          {f.stats?.excedent > 0 && (
                            <span
                              className="badge badge-xx"
                              title="Quantité excédentaire"
                            >
                              XX {f.stats.excedent}
                            </span>
                          )}
                          {!f.stats?.doublons &&
                            !f.stats?.attention &&
                            !f.stats?.excedent && (
                              <span className="badge badge-ok">OK</span>
                            )}
                        </div>
                      </td>
                      <td>
                        {f.printed ? (
                          <span className="print-ok">
                            <HiCheckCircle /> Imprimée
                          </span>
                        ) : f.printError ? (
                          <span className="print-err" title={f.printError}>
                            <HiExclamationCircle /> Erreur
                          </span>
                        ) : (
                          <span className="print-wait">
                            <HiClock /> En attente
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            className="btn-icon"
                            onClick={() => openPdf(f._id)}
                            title="Aperçu du PDF"
                          >
                            <HiEye />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => handleDownload(f)}
                            disabled={enTelechargement === f._id}
                            title="Télécharger le PDF (à imprimer depuis le poste)"
                          >
                            <HiDownload />
                          </button>
                          <button
                            className="btn-icon danger"
                            onClick={() => handleDelete(f._id)}
                            title="Supprimer"
                          >
                            <HiTrash />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminFichesControleScreen;