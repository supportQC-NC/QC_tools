// src/screens/admin/AdminSuiviInventaireScreen.jsx
//
// SUIVI INVENTAIRE — écran d'affichage mural (TV / grand écran) de
// l'inventaire actif : avancement global et avancement PAR EMPLACEMENT
// (les types portés par les fiches d'inventaire : magasin, dock, réserve…).
//
// Pensé pour tourner sans personne au clavier :
//   - rafraîchissement AUTOMATIQUE par polling (aucun rechargement de page) ;
//   - bouton « Plein écran » (API Fullscreen du navigateur, Échap pour sortir) ;
//   - typographie en clamp() : lisible de loin une fois en plein écran.
// Aucune action n'est possible ici — c'est une vitrine, le pilotage reste sur
// l'écran Progression.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  HiPresentationChartBar,
  HiClipboardCheck,
  HiArrowsExpand,
  HiX,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { useGetActiveSessionQuery } from "../../slices/inventaireZoneApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import {
  PHASES,
  PHASE_META,
  STATUTS,
  ORDRE_STATUTS,
  calculerProgression,
  progressionParEmplacement,
} from "../../utils/progressionInventaire";
import "./AdminSuiviInventaireScreen.css";

// Polling un peu plus lent que les écrans de pilotage : l'écran tourne toute
// la journée, 10 s suffisent largement pour un mur d'affichage.
const POLL = 10000;

/** Anneau SVG de pourcentage (l'élément central du mur d'affichage). */
const AnneauPct = ({ pct, size = 180 }) => {
  const stroke = Math.max(10, Math.round(size * 0.07));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="si-ring"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Avancement global ${pct}%`}
    >
      <circle
        className="si-ring-bg"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
      />
      <circle
        className="si-ring-val"
        cx={size / 2}
        cy={size / 2}
        r={r}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        className="si-ring-text"
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
      >
        {pct}%
      </text>
    </svg>
  );
};

const AdminSuiviInventaireScreen = () => {
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";
  const rootRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [horloge, setHorloge] = useState(() => new Date());

  const { data: entreprises } = useGetMyEntreprisesQuery();
  const entrepriseObj = entreprises?.find((e) => e._id === selectedEntreprise);

  const { data: activeData, isLoading } = useGetActiveSessionQuery(
    selectedEntreprise,
    {
      skip: !selectedEntreprise,
      pollingInterval: selectedEntreprise ? POLL : 0,
    },
  );

  const session = activeData?.active || null;
  const zones = useMemo(() => session?.zones || [], [session]);

  // Avancement global + ventilation par emplacement, recalculés sur les mêmes
  // règles que le serveur (une zone = 3 phases, neutralisées exclues).
  const global = useMemo(() => calculerProgression(zones), [zones]);
  const parEmplacement = useMemo(
    () => progressionParEmplacement(zones),
    [zones],
  );

  // Horloge du mur d'affichage : elle montre aussi que l'écran est vivant.
  useEffect(() => {
    const t = setInterval(() => setHorloge(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Plein écran : on suit l'état réel du navigateur (Échap, F11…) plutôt que
  // notre propre booléen — c'est `fullscreenchange` qui fait foi.
  useEffect(() => {
    const onChange = () =>
      setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      rootRef.current?.requestFullscreen?.();
    }
  };

  const heure = horloge.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`suivi-inv${fullscreen ? " si-fs" : ""}`} ref={rootRef}>
      {/* Bandeau : identité + horloge + plein écran */}
      <div className="si-topbar">
        <h1>
          <HiPresentationChartBar /> Suivi inventaire
          {entrepriseObj?.trigramme && (
            <span className="si-societe">{entrepriseObj.trigramme}</span>
          )}
        </h1>
        <div className="si-topbar-right">
          <span
            className="si-live"
            title={`Actualisation automatique toutes les ${POLL / 1000} s`}
          >
            <i /> en direct
          </span>
          <span className="si-horloge">{heure}</span>
          <button
            className="si-fs-btn"
            onClick={toggleFullscreen}
            title={
              fullscreen
                ? "Quitter le plein écran (Échap)"
                : "Afficher en plein écran (pour un écran mural)"
            }
          >
            {fullscreen ? <HiX /> : <HiArrowsExpand />}
            {fullscreen ? "Quitter" : "Plein écran"}
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="si-placeholder">
          <HiPresentationChartBar />
          <p>Sélectionnez une société dans l'en-tête pour suivre son
            inventaire.</p>
        </div>
      ) : isLoading && !session ? (
        <div className="si-placeholder">Chargement…</div>
      ) : !session ? (
        <div className="si-placeholder">
          <HiClipboardCheck />
          <p>Aucun inventaire actif pour {entrepriseObj?.trigramme}.</p>
          {!fullscreen && (
            <Link className="btn-primary" to="/admin/inventaire-progression">
              Initialiser un inventaire
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* ── Avancement global ── */}
          <div className="si-global">
            <AnneauPct pct={global.pct} />
            <div className="si-global-infos">
              <div className="si-session-nom">{session.nom}</div>
              <div className="si-global-detail">
                {global.faites}/{global.totalPhases} phases validées ·{" "}
                {global.totalZones} zone{global.totalZones > 1 ? "s" : ""}
                {global.zonesNeutralisees > 0 &&
                  ` (+${global.zonesNeutralisees} neutralisée${
                    global.zonesNeutralisees > 1 ? "s" : ""
                  })`}
              </div>
              {/* Détail par phase, en barres : les trois jalons du parcours. */}
              <div className="si-global-phases">
                {PHASES.map((ph) => (
                  <div key={ph} className="si-phase">
                    <div className="si-phase-head">
                      <span>{PHASE_META[ph].label}</span>
                      <span>
                        {global.parPhase[ph].faites}/{global.parPhase[ph].total}{" "}
                        · {global.parPhase[ph].pct}%
                      </span>
                    </div>
                    <div className="si-track">
                      <div
                        className="si-fill"
                        style={{
                          width: `${global.parPhase[ph].pct}%`,
                          background: PHASE_META[ph].color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {/* Zones par statut : la lecture « combien reste-t-il ? ». */}
              <div className="si-statuts">
                {ORDRE_STATUTS.map((k) => (
                  <span key={k} className="si-statut">
                    <i style={{ background: STATUTS[k].color }} />
                    <b>{global.parStatut[k]}</b> {STATUTS[k].label.toLowerCase()}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ── Avancement par emplacement ── */}
          <div className="si-empl-grid">
            {parEmplacement.map((t) => (
              <div key={t.key || "__sans__"} className="si-empl-card">
                <div className="si-empl-head">
                  <span className="si-empl-nom">
                    {t.key || "Sans emplacement"}
                  </span>
                  <span className="si-empl-pct">{t.pct}%</span>
                </div>
                <div className="si-track si-track-lg">
                  <div
                    className="si-fill"
                    style={{ width: `${t.pct}%` }}
                  />
                </div>
                <div className="si-empl-detail">
                  {t.faites}/{t.totalPhases} phases · {t.totalZones} zone
                  {t.totalZones > 1 ? "s" : ""}
                </div>
                <div className="si-empl-phases">
                  {PHASES.map((ph) => (
                    <span
                      key={ph}
                      className="si-empl-phase"
                      title={`${PHASE_META[ph].label} : ${t.parPhase[ph].faites}/${t.parPhase[ph].total}`}
                    >
                      <i style={{ background: PHASE_META[ph].color }} />
                      {t.parPhase[ph].faites}/{t.parPhase[ph].total}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminSuiviInventaireScreen;
