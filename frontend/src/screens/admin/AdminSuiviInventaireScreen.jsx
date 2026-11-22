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
import { useGetSuiviBipageQuery } from "../../slices/inventaireCollecteApiSlice";
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

// Le suivi bipage (bandeau « En zone maintenant ») est plus lourd que /active
// — il relit les collectes — : on le sonde trois fois moins souvent.
const POLL_BIPAGE = 30000;

// Durées : minutes tant que c'est lisible, puis heures — même règle que les
// autres écrans de suivi.
const fmtDuree = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const reste = min % 60;
  if (h < 24) return reste ? `${h} h ${reste} min` : `${h} h`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
};

// Durée relative « vivante » : en dessous de la minute, « il y a 0 min » n'a
// pas de sens — on dit « à l'instant ».
const fmtDepuis = (ms) =>
  !Number.isFinite(ms) || ms < 0
    ? "—"
    : ms < 60000
      ? "à l'instant"
      : `il y a ${fmtDuree(ms)}`;

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

  // Les collectes (dont celles encore ouvertes) pour « En zone maintenant ».
  const { data: bipageData } = useGetSuiviBipageQuery(
    { entrepriseId: selectedEntreprise },
    {
      skip: !selectedEntreprise,
      pollingInterval: selectedEntreprise ? POLL_BIPAGE : 0,
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

  // Minute courante : les durées relatives et l'ETA n'ont pas besoin de bouger
  // à la seconde — caler leurs useMemo sur l'horloge brute les recalculerait
  // 60 fois par minute pour rien.
  const minute = Math.floor(horloge.getTime() / 60000);

  // ── Projection de fin ──
  // Date de complétion d'une zone = le moment où sa DERNIÈRE phase a été faite
  // (max des trois `at`). Le rythme est pris sur les 7 derniers jours
  // calendaires, jours creux compris : c'est une date calendaire qu'on
  // projette, un week-end sans comptage retarde réellement la fin. Repli sur
  // le rythme depuis le début quand la semaine écoulée est vide.
  const eta = useMemo(() => {
    const actives = zones.filter((z) => !z.neutralisee);
    if (!actives.length) return null;
    const maintenant = minute * 60000;

    const completions = [];
    let completes = 0;
    for (const z of actives) {
      let n = 0;
      let dernier = 0;
      for (const ph of PHASES) {
        if (!z[ph]?.fait) continue;
        n += 1;
        const t = z[ph]?.at ? new Date(z[ph].at).getTime() : 0;
        if (t > dernier) dernier = t;
      }
      if (n === PHASES.length) {
        completes += 1;
        if (dernier) completions.push(dernier);
      }
    }
    const restantes = actives.length - completes;
    if (restantes <= 0) return { terminee: true };
    // Pas encore de zone complète : plutôt que de cacher la ligne (l'écran
    // semblerait amputé en début d'inventaire), on annonce la projection.
    if (!completions.length) return { enAttente: true };

    const JOUR_MS = 24 * 3600 * 1000;
    const sur7j = completions.filter((t) => t >= maintenant - 7 * JOUR_MS).length;
    let rythme = sur7j / 7;
    if (!rythme) {
      const depuisJours = Math.max(
        1,
        (maintenant - Math.min(...completions)) / JOUR_MS,
      );
      rythme = completions.length / depuisJours;
    }
    if (!rythme) return null;

    const joursRestants = Math.ceil(restantes / rythme);
    // Au-delà d'un an, la date n'informe plus personne.
    if (joursRestants > 365) return { rythme, horsPortee: true };
    return { rythme, date: new Date(maintenant + joursRestants * JOUR_MS) };
  }, [zones, minute]);

  // ── En zone maintenant ──
  // Les collectes encore OUVERTES sur un collecteur : qui est en zone, depuis
  // quand, et depuis combien de temps plus rien n'a été scanné — une zone
  // longtemps silencieuse est souvent une zone oubliée (son verrou empêche les
  // autres de la reprendre). Activité la plus récente d'abord.
  const zonesEnCours = useMemo(() => {
    const maintenant = minute * 60000;
    return (bipageData?.bipages || [])
      .filter((b) => b.status === "en_cours" && !b.annulee)
      .map((b) => {
        const dernierEvt = b.dernierScanAt || b.debutAt;
        const silenceMs = dernierEvt
          ? maintenant - new Date(dernierEvt).getTime()
          : null;
        return {
          ...b,
          ouvertureMs: b.debutAt
            ? maintenant - new Date(b.debutAt).getTime()
            : null,
          silenceMs,
          aScanne: !!b.dernierScanAt,
          etat:
            silenceMs != null && silenceMs < 5 * 60000
              ? "actif"
              : silenceMs != null && silenceMs >= 30 * 60000
                ? "silence"
                : "pause",
        };
      })
      .sort((a, b) => (a.silenceMs ?? Infinity) - (b.silenceMs ?? Infinity));
  }, [bipageData, minute]);

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
              {/* Projection de fin : LE chiffre mobilisateur du mur. */}
              {eta && (
                <div
                  className="si-eta"
                  title="Projection calculée sur le rythme de zones complétées des 7 derniers jours (jours sans comptage compris). Repli sur le rythme depuis le début si la semaine écoulée est vide."
                >
                  {eta.terminee ? (
                    <>Toutes les zones sont complètes.</>
                  ) : eta.enAttente ? (
                    <>
                      Fin estimée : calculée dès les premières zones complètes.
                    </>
                  ) : eta.horsPortee ? (
                    <>Rythme actuel trop faible pour estimer une date de fin.</>
                  ) : (
                    <>
                      Au rythme actuel (
                      {eta.rythme.toLocaleString("fr-FR", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      zone{eta.rythme >= 2 ? "s" : ""} complète
                      {eta.rythme >= 2 ? "s" : ""}/jour), fin estimée{" "}
                      <b>
                        {eta.date.toLocaleDateString("fr-FR", {
                          weekday: "long",
                          day: "numeric",
                          month: "long",
                        })}
                      </b>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── En zone maintenant ──
              La vie du terrain en temps réel : pastille verte = ça bipe,
              ambre = pause, rouge = plus rien depuis 30 min (zone probablement
              oubliée, que son verrou empêche les autres de reprendre). La
              section reste affichée à vide : « personne en zone » est une
              information en soi sur un mur d'affichage. */}
          <div className="si-live-section">
            <div className="si-live-titre">
              En zone maintenant
              {zonesEnCours.length > 0 && (
                <span className="si-live-nb">{zonesEnCours.length}</span>
              )}
            </div>
            {zonesEnCours.length === 0 ? (
              <p className="si-live-vide">
                Personne en zone pour l'instant — les collectes ouvertes
                s'afficheront ici.
              </p>
            ) : (
              <div className="si-live-grid">
                {zonesEnCours.map((z) => (
                  <div key={z._id} className={`si-live-card si-live-${z.etat}`}>
                    <div className="si-live-zone">
                      {z.zoneCode}
                      {z.estComplement && (
                        <span className="si-live-tag">complément</span>
                      )}
                    </div>
                    {(z.zoneLibelle || z.zoneType) && (
                      <div className="si-live-lib">
                        {z.zoneLibelle || ""}
                        {z.zoneLibelle && z.zoneType ? " · " : ""}
                        {z.zoneType || ""}
                      </div>
                    )}
                    <div className="si-live-agent">{z.agent?.nom || "—"}</div>
                    <div className="si-live-meta">
                      {z.totalArticles || 0} article
                      {(z.totalArticles || 0) > 1 ? "s" : ""} · ouverte depuis{" "}
                      {fmtDuree(z.ouvertureMs)}
                    </div>
                    <div className="si-live-etat">
                      <i />
                      {z.etat === "actif"
                        ? "En activité"
                        : z.aScanne
                          ? `Dernier scan ${fmtDepuis(z.silenceMs)}`
                          : "Aucun scan depuis l'ouverture"}
                    </div>
                  </div>
                ))}
              </div>
            )}
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
