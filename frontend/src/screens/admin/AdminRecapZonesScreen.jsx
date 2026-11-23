// src/screens/admin/AdminRecapZonesScreen.jsx
//
// Récap par zone de l'inventaire ACTIF : une carte par zone (fiche rayon), colorée
// selon son avancement.
//   rouge  = pas commencé (0 phase)
//   orange = papillonnage fait
//   violet = comptage (bipage) fait
//   vert   = complet (papillonnage + bipage + contrôle)
// Données : session active (inventaireZoneApiSlice → getActiveSession), zones[] avec
// les 3 sous-docs de phase { fait, at, by }.

import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  HiViewGrid,
  HiRefresh,
  HiSearch,
  HiClipboardCheck,
  HiCheck,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { useGetActiveSessionQuery } from "../../slices/inventaireZoneApiSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { progressionParEmplacement } from "../../utils/progressionInventaire";
import "./AdminRecapZonesScreen.css";

const POLL = 5000;

const PHASES = [
  { key: "papillonnage", label: "Papillonnage" },
  { key: "bipage", label: "Bipage" },
  { key: "controle", label: "Contrôle" },
];

// Statut d'avancement d'une zone (évalué de haut en bas).
const STATUTS = {
  complet: { label: "Complet", color: "#4ade80" },
  comptage: { label: "Bipage", color: "#8b5cf6" },
  papillonnage: { label: "Papillonnage", color: "#f59e0b" },
  todo: { label: "Pas commencé", color: "#ff6b6b" },
};
const ORDRE_STATUTS = ["todo", "papillonnage", "comptage", "complet"];

const zoneStatut = (z) => {
  const pap = !!z?.papillonnage?.fait;
  const bip = !!z?.bipage?.fait;
  const ctrl = !!z?.controle?.fait;
  if (pap && bip && ctrl) return "complet";
  if (bip) return "comptage";
  if (pap) return "papillonnage";
  return "todo";
};

// Ce que chaque statut veut dire SUR LE TERRAIN : affiché dans la légende et
// en infobulle des compteurs — le seul code couleur ne se devine pas.
const STATUT_EXPLICATIONS = {
  todo: "aucune phase validée, la zone reste entièrement à faire",
  papillonnage: "étiquettes posées (papillonnage fait), comptage à venir",
  comptage: "zone comptée (bipage fait), reste le contrôle",
  complet: "les 3 phases sont validées, la zone est terminée",
};

// « Fait par X le … » d'une phase : le serveur peuple `by`, les phases
// anciennes (avant la désignation d'agent) n'ont personne.
const detailPhase = (p) => {
  const u = p?.by;
  const nom =
    u && typeof u === "object"
      ? `${u.prenom || ""} ${u.nom || ""}`.trim() || u.email || ""
      : "";
  const date = p?.at
    ? new Date(p.at).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  if (nom && date) return `par ${nom} le ${date}`;
  if (nom) return `par ${nom}`;
  if (date) return `le ${date}`;
  return "";
};

const AdminRecapZonesScreen = () => {
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";
  const [search, setSearch] = useState("");
  const [filtre, setFiltre] = useState("tous"); // "tous" | clé de STATUTS
  const [emplFiltre, setEmplFiltre] = useState("tous"); // "tous" | "MAGASIN" | "DOCK"

  const { data: entreprises } = useGetMyEntreprisesQuery();
  const entrepriseObj = entreprises?.find((e) => e._id === selectedEntreprise);

  const {
    data: activeData,
    isLoading,
    refetch,
  } = useGetActiveSessionQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
    pollingInterval: selectedEntreprise ? POLL : 0,
  });

  const session = activeData?.active || null;
  const progress = activeData?.progress || null;
  // Les zones NEUTRALISÉES (rayon qui n'existe plus, écran Progression) sont
  // hors inventaire : ni cartes, ni compteurs. Même règle que computeProgress.
  const zones = useMemo(
    () => (session?.zones || []).filter((z) => !z.neutralisee),
    [session],
  );

  // Statut calculé par zone.
  const zonesAvecStatut = useMemo(
    () => zones.map((z) => ({ z, statut: zoneStatut(z) })),
    [zones],
  );

  const compteurs = useMemo(() => {
    const c = { todo: 0, papillonnage: 0, comptage: 0, complet: 0 };
    for (const { statut } of zonesAvecStatut) c[statut] += 1;
    return c;
  }, [zonesAvecStatut]);

  // Emplacement = valeur libre de zone.type (MAGASIN/DOCK ou tout autre
  // emplacement du dictionnaire). Les zones sans type sont regroupées sous "—".
  const emplOf = (z) => String(z?.type || "").trim() || "—";

  // Liste des emplacements réellement présents (avec compteurs), triée.
  const emplacements = useMemo(() => {
    const c = new Map();
    for (const { z } of zonesAvecStatut) {
      const e = emplOf(z);
      c.set(e, (c.get(e) || 0) + 1);
    }
    return [...c.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], "fr", { numeric: true }),
    );
  }, [zonesAvecStatut]);

  // Avancement par emplacement (mêmes règles que le serveur) : affiché dans
  // le bandeau pour lire d'un coup d'œil où en est CHAQUE emplacement.
  const parEmplacement = useMemo(
    () => progressionParEmplacement(zones),
    [zones],
  );

  const zonesFiltrees = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lot = zonesAvecStatut.filter(({ z, statut }) => {
      if (filtre !== "tous" && statut !== filtre) return false;
      if (emplFiltre !== "tous" && emplOf(z) !== emplFiltre) return false;
      if (!q) return true;
      return [z.code, z.libelle, z.type].some((v) =>
        (v || "").toLowerCase().includes(q),
      );
    });
    // Tri par code dans l'ordre NATUREL du magasin (A_1, A_2d, A_9, A_10) :
    // sans lui, les cartes sortent dans l'ordre d'initialisation de la
    // session et une zone ajoutée après coup se retrouve en fin de grille.
    return [...lot].sort((a, b) =>
      String(a.z.code || "").localeCompare(String(b.z.code || ""), "fr", {
        numeric: true,
      }),
    );
  }, [zonesAvecStatut, search, filtre, emplFiltre]);

  return (
    <div className="recap-zones">
      {/* En-tête */}
      <div className="rz-header">
        <h1>
          <HiViewGrid /> Récap par zone
        </h1>
        <button
          className="btn-icon"
          onClick={refetch}
          disabled={!selectedEntreprise}
          title="Rafraîchir"
        >
          <HiRefresh />
        </button>
      </div>

      {!selectedEntreprise ? (
        <div className="rz-placeholder">
          <HiViewGrid />
          <p>Sélectionnez une société dans l'en-tête pour voir l'avancement.</p>
        </div>
      ) : isLoading ? (
        <div className="rz-placeholder">Chargement…</div>
      ) : !session ? (
        <div className="rz-placeholder">
          <HiClipboardCheck />
          <p>Aucun inventaire actif pour {entrepriseObj?.trigramme}.</p>
          <Link className="btn-primary" to="/admin/inventaire-progression">
            Initialiser un inventaire
          </Link>
        </div>
      ) : (
        <>
          {/* Bandeau récap + avancement global */}
          <div className="rz-summary">
            <div className="rz-summary-info">
              <strong>{session.nom}</strong>
              <span>
                {zones.length} zone{zones.length > 1 ? "s" : ""} ·{" "}
                {progress?.faites ?? 0}/{progress?.totalPhases ?? 0} phases
                validées · {progress?.pct ?? 0}% de l'inventaire
              </span>
              <div className="rz-progress">
                <div
                  className="rz-progress-fill"
                  style={{ width: `${progress?.pct ?? 0}%` }}
                />
              </div>
            </div>
            <div className="rz-counts">
              {ORDRE_STATUTS.map((k) => (
                <button
                  key={k}
                  className={`rz-count${filtre === k ? " on" : ""}`}
                  onClick={() => setFiltre(filtre === k ? "tous" : k)}
                  title={`${STATUTS[k].label} : ${STATUT_EXPLICATIONS[k]}. Cliquer pour ${
                    filtre === k ? "retirer le filtre" : "filtrer les cartes"
                  }.`}
                >
                  <span
                    className="rz-count-dot"
                    style={{ background: STATUTS[k].color }}
                  />
                  <span className="rz-count-n">{compteurs[k]}</span>
                  <span className="rz-count-lbl">{STATUTS[k].label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Avancement PAR EMPLACEMENT (types des fiches d'inventaire :
              magasin, dock, réserve…) — cliquer filtre la grille. Inutile
              quand tout l'inventaire est sur un seul emplacement. */}
          {parEmplacement.length > 1 && (
            <div className="rz-empl-bars">
              {parEmplacement.map((t) => {
                const key = t.key || "—";
                const actif = emplFiltre === key;
                return (
                  <button
                    key={key}
                    className={`rz-empl-bar${actif ? " on" : ""}`}
                    onClick={() => setEmplFiltre(actif ? "tous" : key)}
                    title={`${t.key || "Sans emplacement"} : ${t.faites}/${
                      t.totalPhases
                    } phases validées sur ${t.totalZones} zone${
                      t.totalZones > 1 ? "s" : ""
                    }. Cliquer pour ${
                      actif ? "retirer le filtre" : "n'afficher que ces zones"
                    }.`}
                  >
                    <span className="rz-empl-bar-head">
                      <span className="rz-empl-bar-nom">
                        {t.key || "Sans emplacement"}
                      </span>
                      <span className="rz-empl-bar-pct">{t.pct}%</span>
                    </span>
                    <span className="rz-progress">
                      <span
                        className="rz-progress-fill"
                        style={{ width: `${t.pct}%` }}
                      />
                    </span>
                    <span className="rz-empl-bar-detail">
                      {t.faites}/{t.totalPhases} phases · {t.totalZones} zone
                      {t.totalZones > 1 ? "s" : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Légende : le code couleur suit l'ordre du parcours terrain. */}
          <p className="rz-legende">
            Une zone passe du <b style={{ color: STATUTS.todo.color }}>rouge</b>{" "}
            (pas commencé) à l'
            <b style={{ color: STATUTS.papillonnage.color }}>orange</b>{" "}
            (papillonnage fait), puis au{" "}
            <b style={{ color: STATUTS.comptage.color }}>violet</b> (zone
            comptée) et enfin au{" "}
            <b style={{ color: STATUTS.complet.color }}>vert</b> quand les 3
            phases — papillonnage, comptage, contrôle — sont validées.
          </p>

          {/* Filtres + recherche */}
          <div className="rz-toolbar">
            <div className="rz-filters">
              {/* Filtre par statut */}
              <div className="rz-chips">
                <button
                  className={`rz-chip ${filtre === "tous" ? "on" : ""}`}
                  onClick={() => setFiltre("tous")}
                >
                  Tous ({zones.length})
                </button>
                {ORDRE_STATUTS.map((k) => (
                  <button
                    key={k}
                    className={`rz-chip ${filtre === k ? "on" : ""}`}
                    onClick={() => setFiltre(k)}
                    style={
                      filtre === k
                        ? { borderColor: STATUTS[k].color, color: STATUTS[k].color }
                        : undefined
                    }
                  >
                    <span
                      className="rz-dot"
                      style={{ background: STATUTS[k].color }}
                    />
                    {STATUTS[k].label} ({compteurs[k]})
                  </button>
                ))}
              </div>
              {/* Filtre par emplacement (dynamique : un bouton par type présent) */}
              {emplacements.length > 1 && (
                <div className="rz-chips">
                  <span className="rz-filter-lbl">Emplacement :</span>
                  <button
                    className={`rz-chip ${emplFiltre === "tous" ? "on" : ""}`}
                    onClick={() => setEmplFiltre("tous")}
                  >
                    Tous
                  </button>
                  {emplacements.map(([e, n]) => (
                    <button
                      key={e}
                      className={`rz-chip ${emplFiltre === e ? "on" : ""}`}
                      onClick={() => setEmplFiltre(e)}
                    >
                      {e} ({n})
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="rz-search">
              <HiSearch />
              <input
                type="text"
                placeholder="Rechercher (code, libellé)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Compteur du périmètre affiché : un filtre actif se voit. */}
          {zonesFiltrees.length !== zones.length && (
            <p className="rz-filtre-compte">
              {zonesFiltrees.length} zone{zonesFiltrees.length > 1 ? "s" : ""}{" "}
              affichée{zonesFiltrees.length > 1 ? "s" : ""} sur {zones.length}.
            </p>
          )}

          {/* Grille de cartes */}
          {zonesFiltrees.length === 0 ? (
            <div className="rz-placeholder">
              <p>Aucune zone ne correspond au filtre.</p>
            </div>
          ) : (
            <div className="rz-grid">
              {zonesFiltrees.map(({ z, statut }) => {
                const color = STATUTS[statut].color;
                return (
                  <div
                    /* code + emplacement : le même code peut exister au
                       magasin ET au dock. */
                    key={`${z.code}||${z.type || ""}`}
                    className="rz-card"
                    style={{
                      borderColor: color,
                      background: `linear-gradient(180deg, ${color}14, transparent 60%)`,
                    }}
                  >
                    <div className="rz-card-head">
                      <span className="rz-card-code">{z.code}</span>
                      <span
                        className="rz-card-statut"
                        style={{ background: color }}
                        title={STATUT_EXPLICATIONS[statut]}
                      >
                        {STATUTS[statut].label}
                      </span>
                    </div>
                    <div className="rz-card-lib" title={z.libelle}>
                      {z.libelle || "—"}
                    </div>
                    {z.type && <div className="rz-card-empl">{z.type}</div>}
                    <div className="rz-card-phases">
                      {PHASES.map((p) => {
                        const fait = !!z[p.key]?.fait;
                        const detail = fait ? detailPhase(z[p.key]) : "";
                        return (
                          <span
                            key={p.key}
                            className={`rz-phase ${fait ? "done" : ""}`}
                            title={
                              fait
                                ? `${p.label} : fait${detail ? ` ${detail}` : ""}`
                                : `${p.label} : à faire`
                            }
                          >
                            {fait ? <HiCheck /> : "○"} {p.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AdminRecapZonesScreen;
