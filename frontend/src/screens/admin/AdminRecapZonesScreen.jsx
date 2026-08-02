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
import "./AdminRecapZonesScreen.css";

const POLL = 5000;

const PHASES = [
  { key: "papillonnage", label: "Papillonnage" },
  { key: "bipage", label: "Comptage" },
  { key: "controle", label: "Contrôle" },
];

// Statut d'avancement d'une zone (évalué de haut en bas).
const STATUTS = {
  complet: { label: "Complet", color: "#4ade80" },
  comptage: { label: "Comptage", color: "#8b5cf6" },
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
  const zones = useMemo(() => session?.zones || [], [session]);

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

  const zonesFiltrees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return zonesAvecStatut.filter(({ z, statut }) => {
      if (filtre !== "tous" && statut !== filtre) return false;
      if (emplFiltre !== "tous" && emplOf(z) !== emplFiltre) return false;
      if (!q) return true;
      return [z.code, z.libelle, z.type].some((v) =>
        (v || "").toLowerCase().includes(q),
      );
    });
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
                {zones.length} zone(s) · {progress?.pct ?? 0}% complété
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
                <div key={k} className="rz-count">
                  <span
                    className="rz-count-dot"
                    style={{ background: STATUTS[k].color }}
                  />
                  <span className="rz-count-n">{compteurs[k]}</span>
                  <span className="rz-count-lbl">{STATUTS[k].label}</span>
                </div>
              ))}
            </div>
          </div>

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
                    key={z.code}
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
                        return (
                          <span
                            key={p.key}
                            className={`rz-phase ${fait ? "done" : ""}`}
                            title={`${p.label} : ${fait ? "fait" : "à faire"}`}
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
