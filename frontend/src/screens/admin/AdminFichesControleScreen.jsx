// src/screens/admin/AdminFichesControleScreen.jsx
import React, { useMemo, useState } from "react";
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
  HiSearch,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import {
  useGetFichesQuery,
  useScanFichesMutation,
  useDeleteFicheMutation,
  useMarquerImprimeesMutation,
  useGetWatchStatusQuery,
  useStartWatchMutation,
  useStopWatchMutation,
  getFichePdfUrl,
  telechargerFichePdf,
} from "../../slices/ficheControleApiSlice";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import "./AdminFichesControleScreen.css";

const POLL = 5000;

// Origine d'une fiche, lue dans sa référence (datFileName) : les imports
// portent un préfixe (« proforma … », « deduction proforma … », « excel … »,
// « deduction <fichier> ») ; tout le reste est un .DAT du collecteur.
const origineFiche = (f) => {
  const ref = String(f?.datFileName || "");
  if (/^(deduction )?proforma /.test(ref)) return "proforma";
  if (/^(excel |deduction )/.test(ref)) return "excel";
  return "dat";
};

const FILTRES_ORIGINE = [
  { cle: "", label: "Toutes" },
  { cle: "dat", label: "Collecteur (.DAT)" },
  { cle: "proforma", label: "Proformas importées" },
  { cle: "excel", label: "Excel importés" },
];

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
  const fiches = useMemo(() => data?.fiches || [], [data]);
  const session = data?.session;

  // Recherche + filtre d'origine (collecteur / proforma / Excel) — demande
  // client du 30/10/2026. Filtrage local : la liste est déjà en mémoire.
  const [recherche, setRecherche] = useState("");
  const [filtreOrigine, setFiltreOrigine] = useState("");
  // Onglets « À imprimer » / « Imprimées » : les fiches cochées puis marquées
  // imprimées quittent la liste de travail sans disparaître (réimpression
  // toujours possible depuis l'onglet Imprimées).
  const [onglet, setOnglet] = useState("a_imprimer"); // a_imprimer | imprimees
  const [selection, setSelection] = useState([]); // ids cochés (onglet courant)
  const [marquer, { isLoading: marquage }] = useMarquerImprimeesMutation();

  const nbParOrigine = useMemo(() => {
    const n = { dat: 0, proforma: 0, excel: 0 };
    for (const f of fiches) n[origineFiche(f)] += 1;
    return n;
  }, [fiches]);

  const fichesVisibles = useMemo(() => {
    let liste = fiches;
    if (filtreOrigine) {
      liste = liste.filter((f) => origineFiche(f) === filtreOrigine);
    }
    const mots = recherche.toLowerCase().split(/\s+/).filter(Boolean);
    if (mots.length) {
      liste = liste.filter((f) => {
        const p = f.proforma || {};
        const txt =
          `${f.zoneCode} ${f.zoneLibelle} ${f.zoneType} ${f.datFileName} ${p.tiers ?? ""} ${p.nomClient ?? ""} ${p.observation ?? ""}`.toLowerCase();
        return mots.every((m) => txt.includes(m));
      });
    }
    return liste;
  }, [fiches, filtreOrigine, recherche]);

  const aImprimer = useMemo(
    () => fichesVisibles.filter((f) => !f.printed),
    [fichesVisibles],
  );
  const imprimees = useMemo(
    () => fichesVisibles.filter((f) => f.printed),
    [fichesVisibles],
  );
  const fichesOnglet = onglet === "imprimees" ? imprimees : aImprimer;

  const toutCoche =
    fichesOnglet.length > 0 &&
    fichesOnglet.every((f) => selection.includes(f._id));

  const basculerSelection = (id) =>
    setSelection((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const changerOnglet = (o) => {
    setOnglet(o);
    setSelection([]); // ne jamais agir sur des fiches devenues invisibles
  };

  const appliquerMarquage = async (printed) => {
    if (!selection.length) return;
    try {
      await marquer({
        entrepriseId: selectedEntreprise,
        ids: selection,
        printed,
      }).unwrap();
      setSelection([]);
    } catch {
      /* le poll rafraîchira l'état réel */
    }
  };

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

          {/* ── Recherche + filtre d'origine ── */}
          <div className="fiches-filtres">
            <div className="fiches-recherche">
              <HiSearch />
              <input
                type="search"
                placeholder="Rechercher une zone, un libellé, un n° de proforma…"
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
            </div>
            <div className="fiches-chips">
              {FILTRES_ORIGINE.map((fo) => (
                <button
                  key={fo.cle || "toutes"}
                  type="button"
                  className={`fiches-chip ${filtreOrigine === fo.cle ? "on" : ""}`}
                  onClick={() => setFiltreOrigine(fo.cle)}
                >
                  {fo.label} (
                  {fo.cle ? nbParOrigine[fo.cle] : fiches.length})
                </button>
              ))}
            </div>
            <span className="fiches-compteur">
              {fichesOnglet.length} fiche{fichesOnglet.length > 1 ? "s" : ""}{" "}
              affichée{fichesOnglet.length > 1 ? "s" : ""}
            </span>
          </div>

          {/* ── Onglets À imprimer / Imprimées + action sur la sélection ── */}
          <div className="fiches-onglets">
            <button
              type="button"
              className={`fiches-onglet ${onglet === "a_imprimer" ? "actif" : ""}`}
              onClick={() => changerOnglet("a_imprimer")}
            >
              À imprimer ({aImprimer.length})
            </button>
            <button
              type="button"
              className={`fiches-onglet ${onglet === "imprimees" ? "actif" : ""}`}
              onClick={() => changerOnglet("imprimees")}
            >
              Imprimées ({imprimees.length})
            </button>
            {selection.length > 0 && (
              <button
                type="button"
                className="btn-primary fiches-marquer"
                disabled={marquage}
                onClick={() => appliquerMarquage(onglet === "a_imprimer")}
              >
                <HiCheckCircle />{" "}
                {marquage
                  ? "…"
                  : onglet === "a_imprimer"
                    ? `Marquer imprimée${selection.length > 1 ? "s" : ""} (${selection.length})`
                    : `Repasser à imprimer (${selection.length})`}
              </button>
            )}
          </div>

          <div className="admin-fiches-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={toutCoche}
                      title="Tout cocher"
                      onChange={() =>
                        setSelection(
                          toutCoche ? [] : fichesOnglet.map((f) => f._id),
                        )
                      }
                    />
                  </th>
                  <th>Zone</th>
                  <th>Origine</th>
                  <th>Date</th>
                  <th>Lignes</th>
                  <th>Anomalies</th>
                  <th>Impression</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fichesOnglet.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="no-data">
                      {fiches.length === 0
                        ? "Aucune fiche pour l'instant. Les .DAT déposés dans le dossier de l'inventaire seront traités automatiquement."
                        : onglet === "imprimees"
                          ? "Aucune fiche imprimée sur cette sélection."
                          : "Aucune fiche à imprimer sur cette sélection."}
                    </td>
                  </tr>
                ) : (
                  fichesOnglet.map((f) => (
                    <tr key={f._id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selection.includes(f._id)}
                          onChange={() => basculerSelection(f._id)}
                        />
                      </td>
                      <td>
                        <span className="zone-code">{f.zoneCode || "—"}</span>
                        {f.zoneLibelle && (
                          <span className="zone-lib">{f.zoneLibelle}</span>
                        )}
                        {/* Fiche issue d'une proforma : client et observation
                            du document ERP, résolus par le serveur. */}
                        {f.proforma && (
                          <>
                            <span className="zone-client">
                              Client {f.proforma.tiers ?? "?"}
                              {f.proforma.nomClient
                                ? ` — ${f.proforma.nomClient}`
                                : ""}
                            </span>
                            {f.proforma.observation && (
                              <span
                                className="zone-obs"
                                title={f.proforma.observation}
                              >
                                « {f.proforma.observation} »
                              </span>
                            )}
                          </>
                        )}
                      </td>
                      <td>
                        {origineFiche(f) === "proforma" ? (
                          <span className="fiches-origine proforma">Proforma</span>
                        ) : origineFiche(f) === "excel" ? (
                          <span className="fiches-origine excel">Excel</span>
                        ) : (
                          <span className="fiches-origine dat">Collecteur</span>
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
                        ) : f.reprintRequested ? (
                          <span
                            className="print-wait"
                            title="Impression demandée : c'est l'agent local (poste imprimante) qui l'exécute à son prochain passage. Si ce statut persiste, vérifier que l'agent tourne et qu'il est à jour."
                          >
                            <HiClock /> Envoi imprimante…
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