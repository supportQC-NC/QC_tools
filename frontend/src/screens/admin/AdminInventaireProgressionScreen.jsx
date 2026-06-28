// src/screens/admin/AdminInventaireProgressionScreen.jsx
import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  HiChartBar,
  HiRefresh,
  HiPlay,
  HiArchive,
  HiClipboardCheck,
  HiSearch,
  HiCheck,
  HiX,
  HiCheckCircle,
  HiExclamationCircle,
  HiTrash,
} from "react-icons/hi";
import {
  useGetActiveSessionQuery,
  useInitInventaireZoneMutation,
  useBiperZoneMutation,
  useSetPhaseManuelleMutation,
  useGetZoneHistoriqueQuery,
  useDeleteZoneSessionMutation,
} from "../../slices/inventaireZoneApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import "./AdminInventaireProgressionScreen.css";

const POLL = 4000;

const PHASES = ["papillonnage", "bipage", "controle"];
const PHASE_META = {
  papillonnage: { label: "Papillonnage", color: "#8b5cf6" },
  bipage: { label: "Bipage", color: "#4da6ff" },
  controle: { label: "Contrôle", color: "#4ade80" },
};

const AdminInventaireProgressionScreen = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState("");
  const [bipCode, setBipCode] = useState("");
  const [bipFeedback, setBipFeedback] = useState(null); // { tone, message }
  const [search, setSearch] = useState("");
  const [showInitConfirm, setShowInitConfirm] = useState(false);
  const [showHistorique, setShowHistorique] = useState(false);

  const bipInputRef = useRef(null);

  const { data: entreprises } = useGetMyEntreprisesQuery();

  const {
    data: activeData,
    isLoading: loadingActive,
    refetch,
  } = useGetActiveSessionQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
    pollingInterval: selectedEntreprise ? POLL : 0,
  });

  const { data: historiqueData } = useGetZoneHistoriqueQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise || !showHistorique },
  );

  const [initInventaire, { isLoading: initializing }] =
    useInitInventaireZoneMutation();
  const [biperZone, { isLoading: biping }] = useBiperZoneMutation();
  const [setPhaseManuelle] = useSetPhaseManuelleMutation();
  const [deleteZoneSession, { isLoading: deletingSession }] =
    useDeleteZoneSessionMutation();

  const session = activeData?.active || null;
  const progress = activeData?.progress || null;

  const zones = useMemo(() => session?.zones || [], [session]);

  const filteredZones = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) =>
      [z.code, z.libelle, z.type].some((v) =>
        (v || "").toLowerCase().includes(q),
      ),
    );
  }, [zones, search]);

  const entrepriseObj = entreprises?.find((e) => e._id === selectedEntreprise);

  // Auto-focus du champ bip dès qu'une session active est présente
  useEffect(() => {
    if (session && bipInputRef.current) {
      bipInputRef.current.focus();
    }
  }, [session]);

  const handleEntrepriseChange = (e) => {
    setSelectedEntreprise(e.target.value);
    setBipFeedback(null);
    setBipCode("");
    setSearch("");
    setShowHistorique(false);
  };

  const handleConfirmInit = async () => {
    setShowInitConfirm(false);
    setBipFeedback(null);
    try {
      await initInventaire({ entrepriseId: selectedEntreprise }).unwrap();
    } catch (err) {
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Erreur lors de l'initialisation",
      });
    }
  };

  const handleBip = async () => {
    const code = bipCode.trim();
    if (!code || biping) return;
    try {
      const res = await biperZone({
        entrepriseId: selectedEntreprise,
        code,
      }).unwrap();
      const tone =
        res.action === "deja_fait"
          ? "warning"
          : res.action === "identifiee"
            ? "info"
            : "success";
      setBipFeedback({ tone, message: res.message });
    } catch (err) {
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Code inconnu",
      });
    } finally {
      setBipCode("");
      if (bipInputRef.current) bipInputRef.current.focus();
    }
  };

  const handleBipKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBip();
    }
  };

  const handleTogglePhase = async (code, phase, currentFait) => {
    try {
      await setPhaseManuelle({
        entrepriseId: selectedEntreprise,
        code,
        phase,
        fait: !currentFait,
      }).unwrap();
    } catch {
      // silencieux : le polling resynchronise
    }
  };

  const handleDeleteHisto = async (id) => {
    try {
      await deleteZoneSession({ entrepriseId: selectedEntreprise, id }).unwrap();
    } catch {
      /* ignore */
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

  const ProgressBar = ({ label, pct, count, total, color }) => (
    <div className="prog-item">
      <div className="prog-head">
        <span className="prog-label">{label}</span>
        <span className="prog-count">
          {count}/{total} · {pct}%
        </span>
      </div>
      <div className="prog-track">
        <div
          className="prog-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );

  return (
    <div className="admin-prog">
      {/* En-tête */}
      <div className="admin-prog-header">
        <h1>
          <HiChartBar /> Progression d'inventaire
        </h1>
        <div className="admin-prog-actions">
          <select
            className="filter-select"
            value={selectedEntreprise}
            onChange={handleEntrepriseChange}
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
        <div className="admin-prog-placeholder">
          <HiChartBar />
          <p>Sélectionnez une entreprise pour suivre son inventaire.</p>
        </div>
      ) : loadingActive ? (
        <div className="admin-loading">Chargement…</div>
      ) : !session ? (
        <div className="admin-prog-placeholder">
          <HiClipboardCheck />
          <p>Aucun inventaire actif pour {entrepriseObj?.trigramme}.</p>
          <button
            className="btn-primary"
            onClick={() => setShowInitConfirm(true)}
            disabled={initializing}
          >
            <HiPlay /> Initialiser un inventaire
          </button>
          <button
            className="btn-secondary"
            onClick={() => setShowHistorique(true)}
          >
            <HiArchive /> Historique
          </button>
        </div>
      ) : (
        <>
          {/* Barre d'action session */}
          <div className="session-bar">
            <div className="session-info">
              <strong>{session.nom}</strong>
              <span className="session-meta">
                Démarré le {formatDate(session.createdAt)}
                {session.createdBy &&
                  ` · par ${session.createdBy.prenom || ""} ${session.createdBy.nom || ""}`}
              </span>
            </div>
            <div className="session-actions">
              <button
                className="btn-secondary"
                onClick={() => setShowHistorique(true)}
              >
                <HiArchive /> Historique
              </button>
              <button
                className="btn-primary"
                onClick={() => setShowInitConfirm(true)}
                disabled={initializing}
              >
                <HiRefresh /> Réinitialiser
              </button>
            </div>
          </div>

          {/* Bip */}
          <div className="bip-card">
            <h2>
              <HiClipboardCheck /> Bip code-barres
            </h2>
            <div className="bip-row">
              <input
                ref={bipInputRef}
                className="bip-input"
                type="text"
                value={bipCode}
                onChange={(e) => setBipCode(e.target.value)}
                onKeyDown={handleBipKeyDown}
                placeholder="Scannez ou saisissez un code-barres puis Entrée…"
                autoFocus
              />
              <button
                className="btn-primary"
                onClick={handleBip}
                disabled={biping || !bipCode.trim()}
              >
                Valider
              </button>
            </div>
            {bipFeedback && (
              <div className={`bip-feedback ${bipFeedback.tone}`}>
                {bipFeedback.tone === "error" ||
                bipFeedback.tone === "warning" ? (
                  <HiExclamationCircle />
                ) : (
                  <HiCheckCircle />
                )}
                <span>{bipFeedback.message}</span>
              </div>
            )}
          </div>

          {/* Progression */}
          {progress && (
            <div className="prog-cards">
              <div className="prog-global">
                <div className="prog-global-pct">{progress.pct}%</div>
                <div className="prog-global-label">
                  Avancement global
                  <span>
                    {progress.faites}/{progress.totalPhases} phases
                  </span>
                </div>
              </div>
              <div className="prog-bars">
                {PHASES.map((ph) => (
                  <ProgressBar
                    key={ph}
                    label={PHASE_META[ph].label}
                    color={PHASE_META[ph].color}
                    pct={progress.parPhase[ph].pct}
                    count={progress.parPhase[ph].faites}
                    total={progress.parPhase[ph].total}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recherche */}
          <div className="search-box">
            <HiSearch />
            <input
              type="text"
              placeholder="Filtrer les zones (code, libellé)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Tableau zones */}
          <div className="admin-prog-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Libellé</th>
                  {PHASES.map((ph) => (
                    <th key={ph} className="phase-col">
                      {PHASE_META[ph].label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredZones.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="no-data">
                      Aucune zone.
                    </td>
                  </tr>
                ) : (
                  filteredZones.map((z) => (
                    <tr key={z.code}>
                      <td className="code-cell">{z.code}</td>
                      <td>{z.libelle}</td>
                      {PHASES.map((ph) => {
                        const fait = !!z[ph]?.fait;
                        return (
                          <td key={ph} className="phase-col">
                            <button
                              className={`phase-badge ${fait ? "done" : ""}`}
                              style={
                                fait
                                  ? { borderColor: PHASE_META[ph].color }
                                  : undefined
                              }
                              onClick={() =>
                                handleTogglePhase(z.code, ph, fait)
                              }
                              title={
                                fait
                                  ? `Fait — cliquer pour annuler`
                                  : `À faire — cliquer pour valider`
                              }
                            >
                              {fait ? <HiCheck /> : "—"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Modal confirmation init */}
      {showInitConfirm && (
        <div className="modal-backdrop" onClick={() => setShowInitConfirm(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <HiPlay /> Initialiser un inventaire
              </h2>
              <button
                className="btn-close-modal"
                onClick={() => setShowInitConfirm(false)}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              <p>
                Un nouvel inventaire sera créé pour{" "}
                <strong>{entrepriseObj?.trigramme}</strong> à partir des zones
                actuelles.
                {session && (
                  <>
                    {" "}
                    L'inventaire actif sera <strong>archivé</strong>.
                  </>
                )}
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="btn-primary"
                onClick={handleConfirmInit}
                disabled={initializing}
              >
                {initializing ? "Initialisation…" : "Initialiser"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setShowInitConfirm(false)}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal historique */}
      {showHistorique && (
        <div className="modal-backdrop" onClick={() => setShowHistorique(false)}>
          <div
            className="modal-box modal-large"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>
                <HiArchive /> Historique des inventaires
              </h2>
              <button
                className="btn-close-modal"
                onClick={() => setShowHistorique(false)}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              {!historiqueData ? (
                <p>Chargement…</p>
              ) : historiqueData.sessions.length === 0 ? (
                <p>Aucun inventaire archivé.</p>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th>Archivé le</th>
                      <th>Avancement</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historiqueData.sessions.map((s) => (
                      <tr key={s._id}>
                        <td>{s.nom}</td>
                        <td>{formatDate(s.archivedAt)}</td>
                        <td>
                          {s.progress.pct}% ({s.progress.faites}/
                          {s.progress.totalPhases})
                        </td>
                        <td>
                          <button
                            className="btn-icon danger"
                            onClick={() => handleDeleteHisto(s._id)}
                            disabled={deletingSession}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminInventaireProgressionScreen;