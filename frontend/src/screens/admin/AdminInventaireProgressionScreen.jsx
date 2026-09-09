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
  useAnnulerInventaireZoneMutation,
  useBiperZoneMutation,
  useSetPhaseManuelleMutation,
  useGetZoneHistoriqueQuery,
  useDeleteZoneSessionMutation,
  useGetAgentsPossiblesQuery,
} from "../../slices/inventaireZoneApiSlice";
import { useSelector } from "react-redux";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import ImportComptageZone from "../../components/Admin/ImportComptageZone";
import UserPicker from "../../components/ui/UserPicker/UserPicker";
import "./AdminProgressionScreen.css";

const POLL = 4000;

const PHASES = ["papillonnage", "bipage", "controle"];
const PHASE_META = {
  papillonnage: { label: "Papillonnage", color: "#8b5cf6" },
  bipage: { label: "Bipage", color: "#4da6ff" },
  controle: { label: "Contrôle", color: "#4ade80" },
};

// Statut d'avancement d'une zone (même règle que le récap par zone) :
//   3 phases → vert (complet) ; bipage → violet ; papillonnage → orange ; sinon rouge.
const STATUT_META = {
  complet: { label: "Complet", color: "#4ade80" },
  comptage: { label: "Comptage", color: "#8b5cf6" },
  papillonnage: { label: "Papillonnage", color: "#f59e0b" },
  todo: { label: "Pas commencé", color: "#ff6b6b" },
};
// Nom de l'agent crédité d'une phase. Le serveur peuple `by` ; on retombe sur
// une chaîne vide si la phase est ancienne (avant la désignation d'agent).
const nomAgentPhase = (p) => {
  const u = p?.by;
  if (!u || typeof u !== "object") return "";
  return `${u.prenom || ""} ${u.nom || ""}`.trim() || u.email || "";
};

// Libellé de l'entrée « zones sans emplacement » du filtre. Valeur sentinelle :
// une chaîne vide dans un <select> vaut « tous les emplacements ».
const SANS_EMPLACEMENT = "__sans__";

/**
 * Avancement d'un lot de zones, mêmes règles que `computeProgress` du serveur
 * (une zone = 3 phases). Recalculé ici pour que le filtre d'emplacement fasse
 * bouger les compteurs sans aller-retour serveur.
 */
const calculerProgression = (lot) => {
  const compteurs = { papillonnage: 0, bipage: 0, controle: 0 };
  lot.forEach((z) => {
    PHASES.forEach((ph) => {
      if (z[ph]?.fait) compteurs[ph] += 1;
    });
  });
  const totalZones = lot.length;
  const totalPhases = totalZones * PHASES.length;
  const faites = PHASES.reduce((t, ph) => t + compteurs[ph], 0);
  const parPhase = {};
  PHASES.forEach((ph) => {
    parPhase[ph] = {
      faites: compteurs[ph],
      total: totalZones,
      pct: totalZones ? Math.round((compteurs[ph] / totalZones) * 100) : 0,
    };
  });
  return {
    totalZones,
    totalPhases,
    faites,
    pct: totalPhases ? Math.round((faites / totalPhases) * 100) : 0,
    parPhase,
  };
};

const zoneStatut = (z) => {
  const pap = !!z?.papillonnage?.fait;
  const bip = !!z?.bipage?.fait;
  const ctrl = !!z?.controle?.fait;
  if (pap && bip && ctrl) return "complet";
  if (bip) return "comptage";
  if (pap) return "papillonnage";
  return "todo";
};

const AdminInventaireProgressionScreen = () => {
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";
  const [bipCode, setBipCode] = useState("");
  // Désignation de l'agent : elle a lieu APRÈS le scan. Le coupon ne porte
  // aucune identité, donc le scan ne fait que RÉSOUDRE le code (rien n'est
  // marqué) ; cette fenêtre demande qui a fait le travail, et c'est sa
  // validation qui écrit. Annuler ne laisse aucune trace.
  // { source: 'bip'|'manuel', code?, zone, phase }
  const [designation, setDesignation] = useState(null);
  const [agentUserId, setAgentUserId] = useState("");
  // Dernier agent désigné : re-proposé au coupon suivant, un agent en rapporte
  // en général plusieurs d'affilée.
  const [dernierAgentId, setDernierAgentId] = useState("");
  const [bipFeedback, setBipFeedback] = useState(null); // { tone, message }
  const [search, setSearch] = useState("");
  // Filtre d'emplacement (MAGASIN, DOCK…). Il agit sur le tableau ET sur
  // l'avancement : pendant un inventaire on pilote une zone géographique à la
  // fois, et le pourcentage global ne dit rien de l'avancement du dock.
  const [emplacement, setEmplacement] = useState("");
  const [showInitConfirm, setShowInitConfirm] = useState(false);
  // Sélection des proformas du « comptage sans collecteur », saisie une seule
  // fois ici : elle est ensuite portée par l'inventaire.
  const [initProformas, setInitProformas] = useState({
    dateDebut: "",
    dateFin: "",
    clients: "",
  });
  const [showAnnulerConfirm, setShowAnnulerConfirm] = useState(false);
  const [showHistorique, setShowHistorique] = useState(false);

  const bipInputRef = useRef(null);

  const { data: entreprises } = useGetMyEntreprisesQuery();

  // TOUS les comptes actifs, pas seulement ceux de la société : un inventaire
  // est souvent renforcé par du personnel d'une autre société du groupe.
  const { data: agentsPossibles } = useGetAgentsPossiblesQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );

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
  const [annulerInventaire, { isLoading: annulating }] =
    useAnnulerInventaireZoneMutation();
  const [biperZone, { isLoading: biping }] = useBiperZoneMutation();
  const [setPhaseManuelle] = useSetPhaseManuelleMutation();
  const [deleteZoneSession, { isLoading: deletingSession }] =
    useDeleteZoneSessionMutation();

  const session = activeData?.active || null;
  const progress = activeData?.progress || null;

  const zones = useMemo(() => session?.zones || [], [session]);

  // Emplacements réellement présents dans l'inventaire (jamais une liste en
  // dur : chaque société a les siens). Les zones sans emplacement sont
  // regroupées sous une entrée explicite plutôt que d'être invisibles.
  const emplacements = useMemo(() => {
    const set = new Set();
    zones.forEach((z) => set.add((z.type || "").trim()));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [zones]);

  const zonesEmplacement = useMemo(() => {
    if (!emplacement) return zones;
    if (emplacement === SANS_EMPLACEMENT)
      return zones.filter((z) => !(z.type || "").trim());
    return zones.filter((z) => (z.type || "").trim() === emplacement);
  }, [zones, emplacement]);

  const filteredZones = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return zonesEmplacement;
    return zonesEmplacement.filter((z) =>
      [z.code, z.libelle, z.type].some((v) =>
        (v || "").toLowerCase().includes(q),
      ),
    );
  }, [zonesEmplacement, search]);

  // Avancement du PÉRIMÈTRE AFFICHÉ. Recalculé côté client sur les mêmes règles
  // que le serveur (une zone = 3 phases) : sans ça, filtrer sur le dock
  // laisserait un pourcentage global qui ne parle de rien.
  const progressFiltre = useMemo(
    () => calculerProgression(zonesEmplacement),
    [zonesEmplacement],
  );

  const entrepriseObj = entreprises?.find((e) => e._id === selectedEntreprise);

  // Auto-focus du champ bip dès qu'une session active est présente
  useEffect(() => {
    if (session && bipInputRef.current) {
      bipInputRef.current.focus();
    }
  }, [session]);

  // Réinitialise l'état local quand la société sélectionnée change
  useEffect(() => {
    setBipFeedback(null);
    setBipCode("");
    setSearch("");
    setEmplacement("");
    setShowHistorique(false);
    setDesignation(null);
    setAgentUserId("");
    setDernierAgentId("");
  }, [selectedEntreprise]);

  const handleConfirmInit = async () => {
    setShowInitConfirm(false);
    setBipFeedback(null);
    try {
      await initInventaire({
        entrepriseId: selectedEntreprise,
        filtreProformas: initProformas,
      }).unwrap();
    } catch (err) {
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Erreur lors de l'initialisation",
      });
    }
  };

  const handleConfirmAnnuler = async () => {
    setShowAnnulerConfirm(false);
    setBipFeedback(null);
    try {
      const res = await annulerInventaire(selectedEntreprise).unwrap();
      if (res?.dossierSupprime === false) {
        setBipFeedback({
          tone: "warning",
          message: `Inventaire annulé, mais le dossier réseau n'a pas pu être supprimé${
            res.dossierErreur ? ` : ${res.dossierErreur}` : ""
          }. Supprimez-le manuellement si besoin.`,
        });
      }
    } catch (err) {
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Erreur lors de l'annulation",
      });
    }
  };

  // Message de retour homogène : "<zone> · <phase> — <message serveur>".
  const messageBip = (res) =>
    res.zone?.code && res.phase && PHASE_META[res.phase]
      ? `${res.zone.code} · ${PHASE_META[res.phase].label} — ${res.message}`
      : res.message;

  // ÉTAPE 1 — le scan ne marque RIEN : il résout le code pour savoir quelle
  // zone et quelle phase annoncer dans la fenêtre de désignation.
  const handleBip = async () => {
    const code = bipCode.trim();
    if (!code || biping) return;
    try {
      const res = await biperZone({
        entrepriseId: selectedEntreprise,
        code,
        previsualiser: true,
      }).unwrap();

      if (res.action === "a_confirmer" && !res.dejaFait) {
        // Le code est bon et la phase reste à faire → on demande QUI.
        setBipFeedback(null);
        setAgentUserId(dernierAgentId);
        setDesignation({
          source: "bip",
          code,
          zone: res.zone,
          phase: res.phase,
        });
        setBipCode("");
        return;
      }

      // Garde-fou : on n'a demandé qu'une RÉSOLUTION. Si le serveur répond
      // qu'il a marqué la phase, c'est qu'il n'a pas honoré `previsualiser`
      // (backend en retard sur le front) — la phase a été écrite sans que
      // personne n'ait été désigné. On le dit, plutôt que de laisser croire
      // que le parcours s'est déroulé normalement.
      if (res.action === "marque" || res.action === "deja_fait") {
        setBipFeedback({
          tone: "warning",
          message: `${messageBip(res)} — validée sans désignation : le serveur n'a pas pris en compte la demande. Mettez le backend à jour.`,
        });
        setBipCode("");
        if (bipInputRef.current) bipInputRef.current.focus();
        return;
      }

      // Zone seulement identifiée, phase déjà faite ou verrouillée : rien à
      // désigner, on affiche le message tel quel.
      const tone = res.action === "identifiee" ? "info" : "warning";
      setBipFeedback({ tone, message: messageBip(res) });
      setBipCode("");
      if (bipInputRef.current) bipInputRef.current.focus();
    } catch (err) {
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Code inconnu",
      });
      setBipCode("");
      if (bipInputRef.current) bipInputRef.current.focus();
    }
  };

  // ÉTAPE 2 — validation de la désignation : c'est ICI que la phase est marquée,
  // que l'on soit venu du scan d'un coupon ou d'une coche manuelle.
  const handleConfirmerDesignation = async () => {
    if (!designation || biping) return;
    try {
      const res =
        designation.source === "manuel"
          ? await setPhaseManuelle({
              entrepriseId: selectedEntreprise,
              code: designation.zone.code,
              phase: designation.phase,
              fait: true,
              agentUserId,
            }).unwrap()
          : await biperZone({
              entrepriseId: selectedEntreprise,
              code: designation.code,
              agentUserId,
            }).unwrap();
      setDernierAgentId(agentUserId);
      setBipFeedback({
        tone: res.action === "deja_fait" ? "warning" : "success",
        message:
          designation.source === "manuel"
            ? `${designation.zone.code} · ${
                PHASE_META[designation.phase]?.label
              } — validé${res.agent?.nom ? ` (${res.agent.nom})` : ""}`
            : messageBip(res),
      });
    } catch (err) {
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Validation impossible",
      });
    } finally {
      setDesignation(null);
      if (bipInputRef.current) bipInputRef.current.focus();
    }
  };

  const handleAnnulerDesignation = () => {
    const manuel = designation?.source === "manuel";
    setDesignation(null);
    setBipFeedback({
      tone: "warning",
      message: manuel
        ? "Validation annulée : la phase reste à faire."
        : "Scan annulé : aucune phase n'a été validée.",
    });
    if (bipInputRef.current) bipInputRef.current.focus();
  };

  const handleBipKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBip();
    }
  };

  // Coche manuelle. VALIDER passe par la même fenêtre de désignation que le
  // scan : sans elle, la phase serait créditée à la personne au poste, ce qui
  // fausserait l'écran « Agents de l'inventaire ». DÉVALIDER est immédiat
  // (rien à attribuer).
  const handleTogglePhase = async (zone, phase, currentFait) => {
    if (!currentFait) {
      setBipFeedback(null);
      setAgentUserId(dernierAgentId);
      setDesignation({
        source: "manuel",
        zone: { code: zone.code, libelle: zone.libelle, type: zone.type },
        phase,
      });
      return;
    }
    try {
      await setPhaseManuelle({
        entrepriseId: selectedEntreprise,
        code: zone.code,
        phase,
        fait: false,
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
          <p>
            Sélectionnez une société dans l'en-tête pour suivre son inventaire.
          </p>
        </div>
      ) : loadingActive ? (
        <div className="admin-loading">Chargement…</div>
      ) : !session ? (
        <div className="admin-prog-placeholder">
          <HiClipboardCheck />
          <p>Aucun inventaire actif pour {entrepriseObj?.trigramme}.</p>
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
              <button
                className="btn-danger"
                onClick={() => setShowAnnulerConfirm(true)}
                disabled={annulating}
                title="Supprime le dossier de dépôt et l'inventaire actif"
              >
                <HiTrash /> Annuler l'inventaire
              </button>
            </div>
          </div>

          {/* Bip */}
          <div className="bip-card">
            <h2>
              <HiClipboardCheck /> Scanner un coupon détachable
            </h2>
            <p className="bip-hint">
              Scannez le code-barres du coupon (papillonnage / bipage /
              contrôle) rapporté par l'agent : le code est reconnu, puis
              l'application demande <b>qui</b> a fait le travail avant de
              valider la phase.
            </p>
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

          {/* Comptage sans collecteur (Excel / proforma), zone par zone.
              Ici et pas dans « Détail des bipages » : c'est le pilotage de
              l'inventaire, et un import vaut passage de l'agent — il coche
              papillonnage et bipage quand la zone n'avait jamais été comptée. */}
          <ImportComptageZone
            entrepriseId={selectedEntreprise}
            zones={zones}
            filtreProformas={session?.filtreProformas}
            onMessage={(message, tone) =>
              setBipFeedback({ tone: tone === "error" ? "error" : "success", message })
            }
          />

          {/* Progression — du périmètre affiché, avec rappel du total quand un
              emplacement est isolé. */}
          {progress && (
            <div className="prog-cards">
              <div className="prog-global">
                <div className="prog-global-pct">{progressFiltre.pct}%</div>
                <div className="prog-global-label">
                  {emplacement
                    ? `Avancement · ${
                        emplacement === SANS_EMPLACEMENT
                          ? "sans emplacement"
                          : emplacement
                      }`
                    : "Avancement global"}
                  <span>
                    {progressFiltre.faites}/{progressFiltre.totalPhases} phases
                    {" · "}
                    {progressFiltre.totalZones} zone
                    {progressFiltre.totalZones > 1 ? "s" : ""}
                  </span>
                  {emplacement && (
                    <span className="prog-global-total">
                      Tous emplacements : {progress.pct}% ({progress.faites}/
                      {progress.totalPhases})
                    </span>
                  )}
                </div>
              </div>
              <div className="prog-bars">
                {PHASES.map((ph) => (
                  <ProgressBar
                    key={ph}
                    label={PHASE_META[ph].label}
                    color={PHASE_META[ph].color}
                    pct={progressFiltre.parPhase[ph].pct}
                    count={progressFiltre.parPhase[ph].faites}
                    total={progressFiltre.parPhase[ph].total}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Filtres du tableau */}
          <div className="zones-filtres">
            <select
              className="filter-select"
              value={emplacement}
              onChange={(e) => setEmplacement(e.target.value)}
              title="N'afficher qu'un emplacement (magasin, dock…)"
            >
              <option value="">Tous les emplacements</option>
              {emplacements.map((e) =>
                e ? (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ) : (
                  <option key={SANS_EMPLACEMENT} value={SANS_EMPLACEMENT}>
                    Sans emplacement
                  </option>
                ),
              )}
            </select>

            <div className="search-box">
              <HiSearch />
              <input
                type="text"
                placeholder="Filtrer les zones (code, libellé)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <span className="zones-compte">
              {filteredZones.length} zone{filteredZones.length > 1 ? "s" : ""}
              {filteredZones.length !== zones.length
                ? ` sur ${zones.length}`
                : ""}
            </span>
          </div>

          {/* Tableau zones */}
          <div className="admin-prog-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="statut-col"></th>
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
                    <td colSpan={6} className="no-data">
                      Aucune zone.
                    </td>
                  </tr>
                ) : (
                  filteredZones.map((z) => {
                    const st = zoneStatut(z);
                    return (
                    <tr key={z.code}>
                      <td className="statut-col">
                        <span
                          className="statut-dot"
                          style={{ background: STATUT_META[st].color }}
                          title={STATUT_META[st].label}
                        />
                      </td>
                      <td className="code-cell">{z.code}</td>
                      <td>
                        {z.libelle}
                        {z.type && <span className="zone-type">{z.type}</span>}
                      </td>
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
                                handleTogglePhase(z, ph, fait)
                              }
                              title={
                                fait
                                  ? `Fait${
                                      nomAgentPhase(z[ph])
                                        ? ` par ${nomAgentPhase(z[ph])}`
                                        : ""
                                    }${
                                      z[ph]?.at
                                        ? ` le ${formatDate(z[ph].at)}`
                                        : ""
                                    } — cliquer pour annuler`
                                  : `À faire — cliquer pour valider`
                              }
                            >
                              {fait ? <HiCheck /> : "—"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                    );
                  })
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

              {/* Sélection des proformas : demandée UNE SEULE FOIS, ici. Les
                  imports « comptage sans collecteur » s'en serviront ensuite
                  sans jamais rien redemander. Modifiable plus tard depuis le
                  bloc de comptage. */}
              <div className="init-proformas">
                <h3>Proformas du comptage sans collecteur</h3>
                <p>
                  Plage de dates et clients des proformas qui serviront à
                  compter les rayons sans collecteur. Renseignés une fois pour
                  tout l'inventaire ; facultatif si vous n'importez que des
                  fichiers Excel.
                </p>
                <div className="init-proformas-champs">
                  <label>
                    Du
                    <input
                      type="date"
                      value={initProformas.dateDebut}
                      onChange={(e) =>
                        setInitProformas((f) => ({
                          ...f,
                          dateDebut: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    au
                    <input
                      type="date"
                      value={initProformas.dateFin}
                      onChange={(e) =>
                        setInitProformas((f) => ({
                          ...f,
                          dateFin: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="init-proformas-grow">
                    Client(s)
                    <input
                      type="text"
                      placeholder="9900 ou 9900, 9901…"
                      value={initProformas.clients}
                      onChange={(e) =>
                        setInitProformas((f) => ({
                          ...f,
                          clients: e.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
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

      {/* Désignation de l'agent — s'ouvre APRÈS le scan, avant toute écriture.
          Le coupon détachable ne porte aucune identité : sans cette étape, la
          phase serait créditée à la personne au poste, jamais à l'agent. */}
      {designation && (
        <div className="modal-backdrop" onClick={handleAnnulerDesignation}>
          <div
            className="modal-box modal-agent"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>
                <HiClipboardCheck /> Qui a réalisé ce travail ?
              </h2>
              <button
                className="btn-close-modal"
                onClick={handleAnnulerDesignation}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              <div className="designation-zone">
                <span
                  className="designation-phase"
                  style={{
                    borderColor: PHASE_META[designation.phase]?.color,
                    color: PHASE_META[designation.phase]?.color,
                  }}
                >
                  {PHASE_META[designation.phase]?.label || designation.phase}
                </span>
                <span className="designation-code">
                  {designation.zone?.code}
                </span>
                {designation.zone?.libelle && (
                  <span className="designation-lib">
                    {designation.zone.libelle}
                  </span>
                )}
              </div>
              <UserPicker
                users={agentsPossibles || []}
                value={agentUserId}
                onChange={setAgentUserId}
                placeholder="Moi (par défaut)"
                emptyLabel="Moi (par défaut)"
              />
              <p className="designation-hint">
                Cherchez la personne par son nom ou son e-mail. Tous les comptes
                de l'application sont proposés, pas seulement ceux de la
                société : un renfort venu d'une autre société doit pouvoir être
                crédité. Sans choix, la phase est mise à votre nom.
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="btn-primary"
                onClick={handleConfirmerDesignation}
                disabled={biping}
                autoFocus
              >
                {biping ? "Validation…" : "Valider la phase"}
              </button>
              <button
                className="btn-secondary"
                onClick={handleAnnulerDesignation}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmation annulation */}
      {showAnnulerConfirm && (
        <div
          className="modal-backdrop"
          onClick={() => setShowAnnulerConfirm(false)}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <HiTrash /> Annuler l'inventaire
              </h2>
              <button
                className="btn-close-modal"
                onClick={() => setShowAnnulerConfirm(false)}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              <p>
                L'inventaire actif de{" "}
                <strong>{entrepriseObj?.trigramme}</strong> sera{" "}
                <strong>définitivement supprimé</strong> :
              </p>
              <ul>
                <li>
                  le dossier de dépôt réseau et son contenu (fichiers .DAT et
                  fiches PDF) seront <strong>effacés</strong> ;
                </li>
                <li>
                  les collectes, bipages et fiches de contrôle liés seront
                  purgés ;
                </li>
                <li>aucun historique ne sera conservé.</li>
              </ul>
              <p>Cette action est irréversible.</p>
            </div>
            <div className="modal-footer">
              <button
                className="btn-danger"
                onClick={handleConfirmAnnuler}
                disabled={annulating}
              >
                {annulating ? "Annulation…" : "Oui, annuler l'inventaire"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setShowAnnulerConfirm(false)}
              >
                Retour
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