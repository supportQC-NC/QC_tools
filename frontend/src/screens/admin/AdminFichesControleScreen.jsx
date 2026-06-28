// src/screens/admin/AdminFichesControleScreen.jsx
import React, { useState } from "react";
import {
  HiDocumentReport,
  HiRefresh,
  HiPrinter,
  HiEye,
  HiTrash,
  HiCheckCircle,
  HiExclamationCircle,
  HiClock,
  HiPlay,
  HiStop,
} from "react-icons/hi";
import {
  useGetFichesQuery,
  useScanFichesMutation,
  useReprintFicheMutation,
  useDeleteFicheMutation,
  useGetWatchStatusQuery,
  useStartWatchMutation,
  useStopWatchMutation,
  getFichePdfUrl,
} from "../../slices/ficheControleApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import "./AdminFichesControleScreen.css";

const POLL = 5000;

const AdminFichesControleScreen = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [scanReport, setScanReport] = useState(null);

  const { data: entreprises } = useGetMyEntreprisesQuery();

  const {
    data,
    isLoading,
    refetch,
  } = useGetFichesQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
    pollingInterval: selectedEntreprise ? POLL : 0,
  });

  const [scanFiches, { isLoading: scanning }] = useScanFichesMutation();
  const [reprintFiche, { isLoading: reprinting }] = useReprintFicheMutation();
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

  const handleReprint = async (id) => {
    try {
      await reprintFiche({ entrepriseId: selectedEntreprise, id }).unwrap();
    } catch {
      /* erreur déjà reflétée par le statut de la fiche */
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
    window.open(getFichePdfUrl(selectedEntreprise, id), "_blank");
  };

  return (
    <div className="admin-fiches">
      <div className="admin-fiches-header">
        <h1>
          <HiDocumentReport /> Fiches de contrôle
        </h1>
        <div className="admin-fiches-actions">
          <select
            className="filter-select"
            value={selectedEntreprise}
            onChange={(e) => setSelectedEntreprise(e.target.value)}
          >
            <option value="">Sélectionner une entreprise…</option>
            {entreprises?.map((e) => (
              <option key={e._id} value={e._id}>
                {e.trigramme} - {e.nomComplet}
              </option>
            ))}
          </select>
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
          <p>Sélectionnez une entreprise pour voir les fiches de contrôle.</p>
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
                            title="Ouvrir le PDF"
                          >
                            <HiEye />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => handleReprint(f._id)}
                            disabled={reprinting}
                            title="Réimprimer"
                          >
                            <HiPrinter />
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