// src/screens/admin/AdminSuiviBipageScreen.jsx
//
// Suivi bipage — pour chaque zone bipée sur le collecteur : qui l'a bipée,
// quand ça a commencé, quand ça s'est terminé, combien de temps ça a pris, et
// les observations (celle de l'agent, saisie au dépôt, et celle du suivi,
// saisie ici).
//
// Les durées sont reconstituées côté serveur depuis les horodatages de la
// collecte (entrée dans la zone, scans, dépôt) : rien n'est mesuré en plus sur
// le terminal, l'écran fonctionne donc aussi sur les bipages déjà faits.
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSelector } from "react-redux";
import {
  HiClock,
  HiRefresh,
  HiSearch,
  HiDownload,
  HiUserGroup,
  HiCheckCircle,
  HiPencilAlt,
} from "react-icons/hi";
import * as XLSX from "xlsx";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import {
  useGetSuiviBipageQuery,
  useUpdateObservationBipageMutation,
} from "../../slices/inventaireCollecteApiSlice";
import "./AdminSuiviBipageScreen.css";

// ── Helpers ─────────────────────────────────────────────────────────────────
// Durée lisible. Identique au formateur des statistiques réappro : même
// vocabulaire d'un écran à l'autre.
const fmtDuree = (ms) => {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s <= 0) return "—";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m} min ${rs} s` : `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} h ${String(rm).padStart(2, "0")}` : `${h} h`;
};

const fmtHeure = (v) =>
  v
    ? new Date(v).toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

const fmtDateHeure = (v) =>
  v ? new Date(v).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "";

// Le jour n'est répété dans la colonne « Début » que s'il diffère d'aujourd'hui.
const fmtJourSiUtile = (v) => {
  if (!v) return "";
  const d = new Date(v);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "";
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
};

const AdminSuiviBipageScreen = () => {
  // Société active : sélection GLOBALE (Header), comme les autres écrans admin.
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";

  const [session, setSession] = useState("active");
  const [statut, setStatut] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState("");

  // Brouillons d'observation en cours de saisie (id -> texte).
  const [brouillons, setBrouillons] = useState({});
  const dirty = useRef(new Set());

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(""), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  const { data, isLoading, isFetching, refetch } = useGetSuiviBipageQuery(
    { entrepriseId: selectedEntreprise, session, statut, search },
    // Un inventaire est une opération vivante : on rafraîchit tout seul, comme
    // l'écran de progression.
    { skip: !selectedEntreprise, pollingInterval: 15000 },
  );

  const [updateObservation] = useUpdateObservationBipageMutation();

  const bipages = useMemo(() => data?.bipages || [], [data]);
  const agents = data?.agents || [];
  const totaux = data?.totaux;

  const valeurObservation = (b) =>
    brouillons[b._id] !== undefined ? brouillons[b._id] : b.observation || "";

  const onObservationChange = (id, valeur) => {
    dirty.current.add(id);
    setBrouillons((p) => ({ ...p, [id]: valeur }));
  };

  // Enregistrement à la sortie du champ (même geste que « Détail des bipages »).
  const enregistrerObservation = async (b) => {
    if (!dirty.current.has(b._id)) return;
    dirty.current.delete(b._id);
    try {
      await updateObservation({
        entrepriseId: selectedEntreprise,
        id: b._id,
        observation: valeurObservation(b),
      }).unwrap();
      setBrouillons((p) => {
        const n = { ...p };
        delete n[b._id];
        return n;
      });
      setMsg(`Observation enregistrée pour la zone ${b.zoneCode}.`);
    } catch (e) {
      setMsg(e?.data?.message || "Échec de l'enregistrement de l'observation.");
    }
  };

  const exporterExcel = () => {
    if (!bipages.length) return;
    const lignes = bipages.map((b) => ({
      Zone: b.zoneCode,
      Libellé: b.zoneLibelle || "",
      Emplacement: b.zoneType || "",
      Agent: b.agent?.nom || "",
      Statut: b.status === "exporte" ? "Terminé" : "En cours",
      Début: fmtDateHeure(b.debutAt),
      "Premier scan": fmtDateHeure(b.premierScanAt),
      Fin: fmtDateHeure(b.finAt),
      "Temps effectif": fmtDuree(b.tempsActifMs),
      "Temps effectif (s)": Math.round((b.tempsActifMs || 0) / 1000),
      "Temps brut": fmtDuree(b.tempsBrutMs),
      Articles: b.totalArticles,
      Unités: b.totalQuantite,
      "Observation agent": b.observationAgent || "",
      "Observation suivi": b.observation || "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lignes), "Suivi bipage");
    if (agents.length) {
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(
          agents.map((a) => ({
            Agent: a.nom,
            Bipages: a.nbBipages,
            Terminés: a.nbTermines,
            Articles: a.totalArticles,
            Unités: a.totalQuantite,
            "Temps effectif": fmtDuree(a.tempsActifMs),
          })),
        ),
        "Par agent",
      );
    }
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `suivi_bipage_${stamp}.xlsx`);
  };

  return (
    <div className="suivi-bipage">
      <div className="suivi-bipage-header">
        <h1>
          <HiClock /> Suivi bipage
        </h1>
        <div className="suivi-bipage-actions">
          <button
            className="btn-icon"
            onClick={refetch}
            disabled={!selectedEntreprise || isFetching}
            title="Rafraîchir"
          >
            <HiRefresh />
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="suivi-bipage-placeholder">
          <HiClock />
          <p>Sélectionnez une société pour voir le suivi des bipages.</p>
        </div>
      ) : isLoading ? (
        <div className="admin-loading">Chargement…</div>
      ) : (
        <>
          {msg && <div className="suivi-bipage-msg">{msg}</div>}

          <div className="suivi-bipage-toolbar">
            <select
              className="filter-select"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              title="Inventaire concerné"
            >
              <option value="active">Inventaire en cours</option>
              <option value="toutes">Tous les inventaires</option>
              {(data?.sessions || []).map((s) => (
                <option key={s._id} value={s._id}>
                  {s.nom} {s.statut === "archive" ? "(archivé)" : ""}
                </option>
              ))}
            </select>

            <select
              className="filter-select"
              value={statut}
              onChange={(e) => setStatut(e.target.value)}
            >
              <option value="">Tous les états</option>
              <option value="exporte">Terminés (déposés)</option>
              <option value="en_cours">En cours</option>
            </select>

            <div className="search-box">
              <HiSearch />
              <input
                type="text"
                placeholder="Zone, agent, observation…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>

            <span className="suivi-bipage-count">
              {bipages.length} bipage{bipages.length > 1 ? "s" : ""}
              {isFetching ? " …" : ""}
            </span>

            <button
              className="btn-primary"
              onClick={exporterExcel}
              disabled={!bipages.length}
            >
              <HiDownload /> Excel
            </button>
          </div>

          {totaux && (
            <div className="suivi-bipage-kpis">
              <div className="kpi">
                <span className="kpi-val">{totaux.nbBipages}</span>
                <span className="kpi-lbl">zones bipées</span>
              </div>
              <div className="kpi">
                <span className="kpi-val">
                  <HiCheckCircle /> {totaux.nbTermines}
                </span>
                <span className="kpi-lbl">déposées</span>
              </div>
              <div className="kpi">
                <span className="kpi-val">{totaux.nbEnCours}</span>
                <span className="kpi-lbl">en cours</span>
              </div>
              <div className="kpi">
                <span className="kpi-val">{totaux.totalArticles}</span>
                <span className="kpi-lbl">articles</span>
              </div>
              <div className="kpi">
                <span className="kpi-val">{totaux.totalQuantite}</span>
                <span className="kpi-lbl">unités</span>
              </div>
              <div className="kpi">
                <span className="kpi-val">{fmtDuree(totaux.tempsActifMs)}</span>
                <span className="kpi-lbl">temps effectif cumulé</span>
              </div>
            </div>
          )}

          {agents.length > 1 && (
            <div className="suivi-bipage-agents">
              <h2>
                <HiUserGroup /> Par agent
              </h2>
              <div className="agents-grid">
                {agents.map((a) => (
                  <div className="agent-card" key={a.user || a.nom}>
                    <div className="agent-nom">{a.nom}</div>
                    <div className="agent-stats">
                      <span>
                        <b>{a.nbBipages}</b> zone{a.nbBipages > 1 ? "s" : ""}
                      </span>
                      <span>
                        <b>{a.totalArticles}</b> articles
                      </span>
                      <span>
                        <b>{fmtDuree(a.tempsActifMs)}</b> effectif
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="suivi-bipage-tablewrap">
            <table className="admin-table suivi-bipage-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Agent</th>
                  <th>Début</th>
                  <th>Fin</th>
                  <th
                    className="num"
                    title={`Somme des intervalles de travail. Un silence de plus de ${Math.round(
                      (data?.seuilPauseMs || 0) / 60000,
                    )} min est considéré comme une pause et n'est pas compté.`}
                  >
                    Temps effectif
                  </th>
                  <th className="num" title="De l'entrée dans la zone au dépôt, pauses comprises">
                    Temps brut
                  </th>
                  <th className="num">Articles</th>
                  <th className="num">Unités</th>
                  <th>Observations</th>
                </tr>
              </thead>
              <tbody>
                {bipages.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="vide">
                      Aucun bipage pour ce filtre. Les zones apparaissent ici dès
                      qu'un agent en ouvre une sur le collecteur.
                    </td>
                  </tr>
                ) : (
                  bipages.map((b) => (
                    <tr key={b._id} className={b.status === "en_cours" ? "en-cours" : ""}>
                      <td>
                        <div className="zone-code">{b.zoneCode}</div>
                        <div className="zone-lbl">
                          {b.zoneLibelle}
                          {b.zoneType ? ` · ${b.zoneType}` : ""}
                        </div>
                      </td>
                      <td>{b.agent?.nom || "—"}</td>
                      <td>
                        {fmtHeure(b.debutAt)}
                        {fmtJourSiUtile(b.debutAt) && (
                          <span className="jour"> {fmtJourSiUtile(b.debutAt)}</span>
                        )}
                      </td>
                      <td>
                        {b.status === "exporte" ? (
                          fmtHeure(b.finAt)
                        ) : (
                          <span className="badge-encours">en cours</span>
                        )}
                      </td>
                      <td className="num strong">{fmtDuree(b.tempsActifMs)}</td>
                      <td className="num dim">{fmtDuree(b.tempsBrutMs)}</td>
                      <td className="num">{b.totalArticles}</td>
                      <td className="num">{b.totalQuantite}</td>
                      <td className="obs-cell">
                        {b.observationAgent && (
                          <div className="obs-agent" title="Saisie par l'agent sur le collecteur">
                            <b>Agent :</b> {b.observationAgent}
                          </div>
                        )}
                        <div className="obs-suivi">
                          <HiPencilAlt />
                          <input
                            type="text"
                            placeholder="Observation du suivi…"
                            value={valeurObservation(b)}
                            onChange={(e) => onObservationChange(b._id, e.target.value)}
                            onBlur={() => enregistrerObservation(b)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.target.blur();
                            }}
                          />
                        </div>
                        {b.observation && b.observationPar && (
                          <div className="obs-meta">
                            {b.observationPar} · {fmtDateHeure(b.observationAt)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className="suivi-bipage-legende">
            Le <b>temps effectif</b> additionne les intervalles entre l'entrée dans
            la zone, chaque article compté et le dépôt ; au-delà de{" "}
            {Math.round((data?.seuilPauseMs || 0) / 60000)} minutes sans activité,
            l'intervalle est considéré comme une pause et n'est pas compté. Le{" "}
            <b>temps brut</b> va de l'entrée dans la zone au dépôt, pauses et
            reprises comprises.
          </p>
        </>
      )}
    </div>
  );
};

export default AdminSuiviBipageScreen;
