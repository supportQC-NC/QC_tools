// src/screens/admin/AdminReceptionSuiviScreen.jsx
//
// Suivi des réceptions : MÊME liste que le module Réception mobile (commandes
// à contrôler, ETAT >= 4, via /api/receptions/a-controler) + superposition de
// la PROGRESSION du contrôle (articles contrôlés, anomalies, photos, statut).
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HiRefresh, HiClipboardList, HiExclamation, HiCube, HiPhotograph, HiDownload, HiX, HiSparkles,
} from "react-icons/hi";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetCommandesAControlerQuery,
  useGetReceptionProgressQuery,
  useGetCommandesAgregatsQuery,
} from "../../slices/receptionSuiviApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import { BASE_URL } from "../../constants";
import "./AdminReceptionSuiviScreen.css";

const STORAGE_KEY = "receptionSuivi.entreprise";

const ANOMALIE = {
  avarie: { label: "Avarie", cls: "rs-ano-warn" },
  cassee: { label: "Cassée", cls: "rs-ano-danger" },
  manquant: { label: "Manquant", cls: "rs-ano-danger" },
  abimee: { label: "Abîmée", cls: "rs-ano-warn" },
};
const up = (v) => String(v || "").trim().toUpperCase();
const fmtNb = (n) => (n ?? 0).toLocaleString("fr-FR");
const fmtDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
};
const photoSrc = (recId, sigId) =>
  `${BASE_URL}/api/reception-suivi/${recId}/signalement/${sigId}/photo`;

const AdminReceptionSuiviScreen = () => {
  const [selectedEnt, setSelectedEnt] = useState(
    localStorage.getItem(STORAGE_KEY) || "",
  );
  const [selectedNumcde, setSelectedNumcde] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [photoUrls, setPhotoUrls] = useState({});
  const urlsRef = useRef({});

  const { data: entreprises, isLoading: loadingEnt } = useGetEntreprisesQuery();

  const { data: cmdData, isFetching: fCmd, refetch: refetchCmd } =
    useGetCommandesAControlerQuery(selectedEnt, { skip: !selectedEnt });
  const { data: progressList = [], isFetching: fProg, refetch: refetchProg } =
    useGetReceptionProgressQuery(selectedEnt, { skip: !selectedEnt });
  const { data: agregats = {}, refetch: refetchAgg } =
    useGetCommandesAgregatsQuery(selectedEnt, { skip: !selectedEnt });

  // Entreprise par défaut : 1re active.
  useEffect(() => {
    if (!selectedEnt && entreprises && entreprises.length > 0) {
      const a = entreprises.find((e) => e.isActive) || entreprises[0];
      if (a) setSelectedEnt(a.nomDossierDBF);
    }
  }, [entreprises, selectedEnt]);
  useEffect(() => {
    if (selectedEnt) localStorage.setItem(STORAGE_KEY, selectedEnt);
    setSelectedNumcde(null);
  }, [selectedEnt]);

  const commandes = cmdData?.commandes || [];
  const progressByNumcde = useMemo(() => {
    const m = new Map();
    progressList.forEach((p) => m.set(up(p.numcde), p));
    return m;
  }, [progressList]);

  const merged = useMemo(
    () =>
      commandes.map((c) => ({
        ...c,
        progress: progressByNumcde.get(up(c.numcde)) || null,
        agg: agregats[up(c.numcde)] || null,
      })),
    [commandes, progressByNumcde, agregats],
  );

  const controlledCount = (c) =>
    (c.progress?.comptages || []).filter((x) => x.dansCommande).length;
  const pctControle = (c) => {
    const total = c.agg?.nbArticles || 0;
    if (!c.progress || total === 0) return null;
    return Math.min(100, Math.round((controlledCount(c) / total) * 100));
  };

  const selected = merged.find((c) => c.numcde === selectedNumcde) || null;
  const busy = Boolean(selectedEnt) && (fCmd || fProg);

  // Photos des anomalies du contrôle sélectionné (fetch + cookie -> blob URL).
  useEffect(() => {
    Object.values(urlsRef.current).forEach((u) => {
      if (typeof u === "string" && u.startsWith("blob:")) URL.revokeObjectURL(u);
    });
    urlsRef.current = {};
    setPhotoUrls({});
    const prog = selected?.progress;
    if (!prog?.receptionId) return undefined;
    let alive = true;
    (prog.signalements || [])
      .filter((s) => s.hasPhoto)
      .forEach(async (s) => {
        try {
          const res = await fetch(photoSrc(prog.receptionId, s._id), {
            credentials: "include",
          });
          if (!res.ok) throw new Error("http " + res.status);
          const blob = await res.blob();
          if (!alive || !blob || blob.size === 0) return;
          const url = URL.createObjectURL(blob);
          urlsRef.current[s._id] = url;
          setPhotoUrls((p) => ({ ...p, [s._id]: url }));
        } catch {
          if (alive) setPhotoUrls((p) => ({ ...p, [s._id]: "error" }));
        }
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNumcde]);

  const refresh = () => { refetchCmd(); refetchProg(); refetchAgg(); };

  return (
    <div className="reception-suivi">
      <div className="rs-header">
        <div className="rs-head-title">
          <span className="rs-head-icon"><HiClipboardList /></span>
          <div>
            <h1>Suivi des réceptions</h1>
            <p>Commandes à contrôler (ETAT ≥ 4) + progression, anomalies et photos.</p>
          </div>
        </div>
        <div className="rs-head-actions">
          <select
            className="rs-select"
            value={selectedEnt}
            onChange={(e) => setSelectedEnt(e.target.value)}
            disabled={loadingEnt}
          >
            <option value="">— Entreprise —</option>
            {(entreprises || []).map((e) => (
              <option key={e._id || e.nomDossierDBF} value={e.nomDossierDBF}>
                {e.nom || e.nomComplet || e.nomDossierDBF}
              </option>
            ))}
          </select>
          <button className="rs-refresh" onClick={refresh} disabled={busy}>
            <HiRefresh className={busy ? "spin" : ""} /> Rafraîchir
          </button>
        </div>
      </div>

      {!selectedEnt ? (
        <div className="rs-empty">Choisissez une entreprise.</div>
      ) : busy && merged.length === 0 ? (
        <Loader />
      ) : (
        <div className="rs-layout">
          {/* Liste des commandes à contrôler */}
          <div className="rs-list">
            {merged.length === 0 ? (
              <div className="rs-empty">Aucune commande à contrôler.</div>
            ) : (
              merged.map((c) => {
                const p = c.progress;
                return (
                  <button
                    key={c.numcde}
                    className={`rs-card ${selectedNumcde === c.numcde ? "active" : ""}`}
                    onClick={() => setSelectedNumcde(c.numcde)}
                  >
                    <div className="rs-card-top">
                      <span className="rs-cde">Cmd {c.numcde}</span>
                      {p ? (
                        <span className="rs-badge rs-st-cours">En cours</span>
                      ) : (
                        <span className="rs-badge rs-st-todo">À contrôler</span>
                      )}
                    </div>
                    <div className="rs-card-meta">{c.fournisseurNom || "—"}</div>
                    <div className="rs-card-stats">
                      {c.etatLabel ? <span>{c.etatLabel}</span> : c.etat != null && <span>ETAT {c.etat}</span>}
                      {!!c.bateau && <span>🚢 {c.bateau}</span>}
                      {c.arrivee && <span>Arr. {fmtDate(c.arrivee)}</span>}
                    </div>
                    {c.agg && (
                      <div className="rs-card-stats">
                        <span><HiCube /> {fmtNb(c.agg.nbArticles)} art.</span>
                        <span>{fmtNb(c.agg.totalUnites)} u.</span>
                        {c.agg.nbNouveautes > 0 && (
                          <span className="rs-nouv"><HiSparkles /> {c.agg.nbNouveautes} nouv.</span>
                        )}
                      </div>
                    )}
                    {p && (
                      <div className="rs-card-stats">
                        <span><HiCube /> {p.nbComptages} contrôlé(s)</span>
                        {p.nbSignalements > 0 && (
                          <span className="rs-warn"><HiExclamation /> {p.nbSignalements} anomalie(s)</span>
                        )}
                      </div>
                    )}
                    {pctControle(c) != null && (
                      <div className="rs-progress">
                        <div className="rs-progress-bar">
                          <div className="rs-progress-fill" style={{ width: `${pctControle(c)}%` }} />
                        </div>
                        <span className="rs-progress-txt">{pctControle(c)}%</span>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Détail */}
          <div className="rs-detail">
            {!selected ? (
              <div className="rs-empty">Sélectionnez une commande à gauche.</div>
            ) : (
              <>
                <div className="rs-detail-head">
                  <h2>Cmd {selected.numcde}</h2>
                  <span className="rs-detail-sub">
                    {selected.fournisseurNom || "—"}
                    {selected.bateau ? ` · 🚢 ${selected.bateau}` : ""}
                    {selected.arrivee ? ` · Arrivée ${fmtDate(selected.arrivee)}` : ""}
                    {selected.etatLabel ? ` · ${selected.etatLabel}` : ""}
                  </span>
                  {selected.agg && (
                    <div className="rs-detail-agg">
                      <span><HiCube /> {fmtNb(selected.agg.nbArticles)} articles</span>
                      <span>{fmtNb(selected.agg.totalUnites)} unités</span>
                      {selected.agg.nbNouveautes > 0 && (
                        <span className="rs-nouv"><HiSparkles /> {selected.agg.nbNouveautes} nouveautés</span>
                      )}
                    </div>
                  )}
                  {pctControle(selected) != null && (
                    <div className="rs-progress rs-progress-lg">
                      <div className="rs-progress-bar">
                        <div className="rs-progress-fill" style={{ width: `${pctControle(selected)}%` }} />
                      </div>
                      <span className="rs-progress-txt">{pctControle(selected)}% contrôlé</span>
                    </div>
                  )}
                </div>

                {!selected.progress ? (
                  <p className="rs-none">Contrôle non commencé pour cette commande.</p>
                ) : (
                  <>
                    {/* Anomalies */}
                    <h3 className="rs-section">
                      <HiExclamation /> Anomalies ({(selected.progress.signalements || []).length})
                    </h3>
                    {(selected.progress.signalements || []).length === 0 ? (
                      <p className="rs-none">Aucune anomalie signalée.</p>
                    ) : (
                      <div className="rs-ano-grid">
                        {selected.progress.signalements.map((s) => {
                          const a = ANOMALIE[s.type] || { label: s.type, cls: "" };
                          const pu = photoUrls[s._id];
                          return (
                            <div key={s._id} className="rs-ano">
                              {s.hasPhoto ? (
                                pu && pu !== "error" ? (
                                  <img className="rs-ano-photo" src={pu} alt={s.nart} onClick={() => setZoom({ url: pu, name: `anomalie_${up(s.nart) || "photo"}.jpg` })} />
                                ) : (
                                  <div className="rs-ano-nophoto">
                                    {pu === "error" ? <HiPhotograph /> : <span className="rs-spin-dot" />}
                                  </div>
                                )
                              ) : (
                                <div className="rs-ano-nophoto"><HiPhotograph /></div>
                              )}
                              <div className="rs-ano-info">
                                <span className={`rs-badge ${a.cls}`}>{a.label}</span>
                                <span className="rs-ano-nart">{s.nart || "—"}</span>
                                {!!s.designation && <span className="rs-ano-design">{s.designation}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Articles contrôlés */}
                    <h3 className="rs-section">
                      <HiCube /> Articles contrôlés ({(selected.progress.comptages || []).length})
                    </h3>
                    {(selected.progress.comptages || []).length === 0 ? (
                      <p className="rs-none">Aucun article compté.</p>
                    ) : (
                      <div className="rs-table-wrap">
                        <table className="rs-table">
                          <thead>
                            <tr>
                              <th>NART</th>
                              <th>Désignation</th>
                              <th className="num">Compté</th>
                              <th>État</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selected.progress.comptages.map((c, i) => (
                              <tr key={`${c.nart}-${i}`}>
                                <td className="mono">{c.nart || (c.isInconnu ? "Inconnu" : "—")}</td>
                                <td className="design" title={c.designation}>{c.designation || c.gencod}</td>
                                <td className="num strong">{c.qteValidee != null ? c.qteValidee : c.qteComptee}</td>
                                <td>
                                  {c.isInconnu ? (
                                    <span className="rs-tag rs-tag-warn">hors base</span>
                                  ) : !c.dansCommande ? (
                                    <span className="rs-tag">hors cmd</span>
                                  ) : (
                                    <span className="rs-tag rs-tag-ok">commande</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {zoom && (
        <div className="rs-zoom" onClick={() => setZoom(null)}>
          <div className="rs-zoom-box" onClick={(e) => e.stopPropagation()}>
            <img src={zoom.url} alt="" />
            <div className="rs-zoom-actions">
              <a className="rs-zoom-btn dl" href={zoom.url} download={zoom.name}>
                <HiDownload /> Télécharger
              </a>
              <button className="rs-zoom-btn" onClick={() => setZoom(null)}>
                <HiX /> Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminReceptionSuiviScreen;