// src/screens/admin/AdminReceptionSuiviScreen.jsx
import React, { useMemo, useState } from "react";
import {
  HiRefresh, HiClipboardList, HiExclamation, HiCube, HiPhotograph,
} from "react-icons/hi";
import { useGetReceptionsSuiviQuery } from "../../slices/receptionSuiviApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import { BASE_URL } from "../../constants";
import "./AdminReceptionSuiviScreen.css";

const STATUT = {
  en_cours: { label: "En cours", cls: "rs-st-cours" },
  analyse_ecarts: { label: "Analyse écarts", cls: "rs-st-ecarts" },
};
const ANOMALIE = {
  avarie: { label: "Avarie", cls: "rs-ano-warn" },
  cassee: { label: "Cassée", cls: "rs-ano-danger" },
  manquant: { label: "Manquant", cls: "rs-ano-danger" },
  abimee: { label: "Abîmée", cls: "rs-ano-warn" },
};
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("fr-FR") +
        " " +
        d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

const photoSrc = (recId, sigId) =>
  `${BASE_URL}/api/reception-suivi/${recId}/signalement/${sigId}/photo`;

const AdminReceptionSuiviScreen = () => {
  const { data: list = [], isLoading, isFetching, refetch } =
    useGetReceptionsSuiviQuery();
  const [selectedId, setSelectedId] = useState(null);
  const [entFilter, setEntFilter] = useState("");
  const [zoom, setZoom] = useState(null);

  const entreprises = useMemo(
    () => [...new Set(list.map((r) => r.entrepriseNom).filter(Boolean))].sort(),
    [list],
  );

  const filtered = entFilter
    ? list.filter((r) => r.entrepriseNom === entFilter)
    : list;

  const selected = list.find((r) => r._id === selectedId) || null;

  return (
    <div className="reception-suivi">
      <div className="rs-header">
        <div className="rs-head-title">
          <span className="rs-head-icon"><HiClipboardList /></span>
          <div>
            <h1>Suivi des réceptions</h1>
            <p>Contrôles en cours (non finalisés) : contrôlés, anomalies et photos.</p>
          </div>
        </div>
        <div className="rs-head-actions">
          <select
            className="rs-select"
            value={entFilter}
            onChange={(e) => setEntFilter(e.target.value)}
          >
            <option value="">Toutes les entreprises</option>
            {entreprises.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
          <button className="rs-refresh" onClick={() => refetch()} disabled={isFetching}>
            <HiRefresh className={isFetching ? "spin" : ""} /> Rafraîchir
          </button>
        </div>
      </div>

      {isLoading ? (
        <Loader />
      ) : (
        <div className="rs-layout">
          {/* Liste */}
          <div className="rs-list">
            {filtered.length === 0 ? (
              <div className="rs-empty">Aucun contrôle en cours.</div>
            ) : (
              filtered.map((r) => {
                const st = STATUT[r.status] || STATUT.en_cours;
                return (
                  <button
                    key={r._id}
                    className={`rs-card ${selectedId === r._id ? "active" : ""}`}
                    onClick={() => setSelectedId(r._id)}
                  >
                    <div className="rs-card-top">
                      <span className="rs-cde">Cmd {r.numcde}</span>
                      <span className={`rs-badge ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="rs-card-meta">{r.fournisseurNom || "—"} · {r.entrepriseNom}</div>
                    <div className="rs-card-stats">
                      <span><HiCube /> {r.nbComptages} contrôlé(s)</span>
                      {r.nbSignalements > 0 && (
                        <span className="rs-warn"><HiExclamation /> {r.nbSignalements} anomalie(s)</span>
                      )}
                    </div>
                    <div className="rs-card-date">{fmtDate(r.updatedAt)}</div>
                  </button>
                );
              })
            )}
          </div>

          {/* Détail */}
          <div className="rs-detail">
            {!selected ? (
              <div className="rs-empty">Sélectionnez un contrôle à gauche.</div>
            ) : (
              <>
                <div className="rs-detail-head">
                  <h2>Cmd {selected.numcde}</h2>
                  <span className="rs-detail-sub">
                    {selected.fournisseurNom || "—"} · {selected.entrepriseNom}
                  </span>
                </div>

                {/* Anomalies */}
                <h3 className="rs-section">
                  <HiExclamation /> Anomalies ({selected.signalements.length})
                </h3>
                {selected.signalements.length === 0 ? (
                  <p className="rs-none">Aucune anomalie signalée.</p>
                ) : (
                  <div className="rs-ano-grid">
                    {selected.signalements.map((s) => {
                      const a = ANOMALIE[s.type] || { label: s.type, cls: "" };
                      const src = photoSrc(selected._id, s._id);
                      return (
                        <div key={s._id} className="rs-ano">
                          {s.hasPhoto ? (
                            <img
                              className="rs-ano-photo"
                              src={src}
                              alt={s.nart}
                              onClick={() => setZoom(src)}
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                            />
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

                {/* Contrôlés */}
                <h3 className="rs-section">
                  <HiCube /> Articles contrôlés ({selected.comptages.length})
                </h3>
                {selected.comptages.length === 0 ? (
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
                        {selected.comptages.map((c, i) => (
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
          </div>
        </div>
      )}

      {zoom && (
        <div className="rs-zoom" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" />
          <span className="rs-zoom-hint">Cliquer pour fermer</span>
        </div>
      )}
    </div>
  );
};

export default AdminReceptionSuiviScreen;