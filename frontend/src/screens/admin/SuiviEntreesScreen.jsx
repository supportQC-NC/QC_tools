import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiTruck,
  HiDownload,
  HiRefresh,
  HiOfficeBuilding,
  HiExclamationCircle,
  HiExternalLink,
} from "react-icons/hi";
import {
  selectGlobalDossier,
  selectGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import {
  useGetSuiviEntreesQuery,
  useGetReservationsEntreesQuery,
} from "../../slices/suiviEntreesApiSlice";
import { BASE_URL } from "../../constants";
import "./SuiviEntreesScreen.css";

const toISOLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayISO = () => toISOLocal(new Date());

const fmtInt = (v) => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v)))
    return "—";
  return Math.trunc(Number(v)).toLocaleString("fr-FR").replace(/[\s,]/g, " ");
};
const fmtPrix = (v) => {
  const n = fmtInt(v);
  return n === "—" ? "—" : `${n} XPF`;
};

const SuiviEntreesScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState("");
  const [excelLoading, setExcelLoading] = useState(false);

  const { data, isFetching, isError, error: queryError, refetch } =
    useGetSuiviEntreesQuery({ nomDossierDBF, date }, { skip: !nomDossierDBF });

  const rows = useMemo(() => data?.rows || [], [data]);

  // Flag Résa chargé en arrière-plan (scan detail.dbf lourd) : on ne le lance
  // qu'une fois la grille chargée avec au moins une ligne.
  const { data: resaData, isFetching: resaFetching } =
    useGetReservationsEntreesQuery(
      { nomDossierDBF, date },
      { skip: !nomDossierDBF || rows.length === 0 },
    );
  const resaSet = useMemo(
    () => new Set(resaData?.narts || []),
    [resaData],
  );

  const exporterExcel = async () => {
    setError("");
    if (!nomDossierDBF) {
      setError("Sélectionnez une société dans l'en-tête.");
      return;
    }
    setExcelLoading(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/suivi-entrees/${nomDossierDBF}/excel?date=${date}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        let msg = `Échec (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* non-JSON */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `suivi_entrees_${nomDossierDBF}_${date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (e) {
      setError(e.message || "Erreur lors de l'export.");
    } finally {
      setExcelLoading(false);
    }
  };

  return (
    <div className="se-page">
      <header className="se-header">
        <div className="se-header-left">
          <div className="se-header-icon">
            <HiTruck />
          </div>
          <div>
            <h1>Suivi des entrées</h1>
            <p className="se-header-subtitle">
              Marchandises entrées à une date, enrichies (fournisseur, stock,
              résa, changement de prix, contrôle TGC).
            </p>
          </div>
        </div>
        {entreprise && (
          <div className="se-entreprise-badge">
            <HiOfficeBuilding />
            <span>{entreprise.nomComplet || entreprise.nom || nomDossierDBF}</span>
          </div>
        )}
      </header>

      {!nomDossierDBF ? (
        <div className="se-empty">
          <HiExclamationCircle className="se-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>Choisissez une société dans l'en-tête pour voir les entrées.</p>
        </div>
      ) : (
        <>
          <div className="se-toolbar">
            <div className="se-toolbar-left">
              <div className="se-field">
                <label htmlFor="se-date">Date d'entrée</label>
                <input
                  id="se-date"
                  type="date"
                  value={date}
                  max={todayISO()}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="se-stats">
                <div className="se-stat se-stat-primary">
                  <span className="se-stat-value">{data?.total ?? "—"}</span>
                  <span className="se-stat-label">Entrées</span>
                </div>
                <div className="se-stat">
                  <span
                    className={`se-stat-value ${
                      data?.anomaliesTgc ? "se-danger" : ""
                    }`}
                  >
                    {data?.anomaliesTgc ?? "—"}
                  </span>
                  <span className="se-stat-label">Anomalies TGC</span>
                </div>
                <div className="se-stat">
                  <span className="se-stat-value">
                    {resaFetching ? (
                      <span className="se-spinner" />
                    ) : (
                      resaSet.size
                    )}
                  </span>
                  <span className="se-stat-label">Réservations</span>
                </div>
              </div>
            </div>

            <div className="se-actions">
              <button
                type="button"
                className="se-btn se-btn-ghost"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <HiRefresh className={isFetching ? "se-spin" : ""} />
                Actualiser
              </button>
              <button
                type="button"
                className="se-btn se-btn-excel"
                onClick={exporterExcel}
                disabled={excelLoading || isFetching}
              >
                <HiDownload />
                {excelLoading ? "Excel…" : "Export Excel"}
              </button>
            </div>
          </div>

          {error && <div className="se-alert se-alert-err">{error}</div>}
          {isError && (
            <div className="se-alert se-alert-err">
              {queryError?.data?.message ||
                "Erreur lors du chargement des entrées."}
            </div>
          )}

          <div className="se-table-wrap">
            <table className="se-table">
              <thead>
                <tr>
                  <th>NART</th>
                  <th>Désignation</th>
                  <th>Fournisseur</th>
                  <th>N° Cde</th>
                  <th className="se-num">Qté</th>
                  <th className="se-num">PV TTC</th>
                  <th className="se-num">Stock Mag</th>
                  <th className="se-num">Stock Dock</th>
                  <th>Rayon</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {isFetching ? (
                  <tr>
                    <td colSpan={10} className="se-td-info">
                      <span className="se-spinner" /> Chargement…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="se-td-info">
                      Aucune entrée pour cette date.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr
                      key={`${r.nart}-${r.numcde}-${i}`}
                      className={r.pbTgc ? "se-row-tgc" : ""}
                    >
                      <td className="se-mono">
                        <a
                          className="se-nart-link"
                          href={`/admin/articles/${nomDossierDBF}/${encodeURIComponent(
                            r.nart,
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ouvrir la fiche article (nouvel onglet)"
                        >
                          {r.nart}
                          <HiExternalLink className="se-nart-ext" />
                        </a>
                      </td>
                      <td className="se-design">
                        {r.design || (
                          <em className="se-muted">Article introuvable</em>
                        )}
                        {r.refer && (
                          <span className="se-refer">réf. {r.refer}</span>
                        )}
                      </td>
                      <td>{r.fournisseur || "—"}</td>
                      <td className="se-mono">{r.numcde || "—"}</td>
                      <td className="se-num">{fmtInt(r.qte)}</td>
                      <td className="se-num se-mono">{fmtPrix(r.pvtettc)}</td>
                      <td className="se-num">{fmtInt(r.stockMag)}</td>
                      <td className="se-num">{fmtInt(r.stockDock)}</td>
                      <td>
                        {r.gism1 ? (
                          <span className="se-badge-code">{r.gism1}</span>
                        ) : (
                          "—"
                        )}
                        {r.place && <span className="se-place">{r.place}</span>}
                      </td>
                      <td>
                        <div className="se-flags">
                          {r.nouveaute && (
                            <span className="se-chip se-chip-new">NEW</span>
                          )}
                          {resaSet.has(r.nart) && (
                            <span className="se-chip se-chip-resa">RÉSA</span>
                          )}
                          {r.chgPrix && (
                            <span className="se-chip se-chip-prix">PRIX</span>
                          )}
                          {r.pbTgc && (
                            <span
                              className="se-chip se-chip-tgc"
                              title="Écart PVTE vs PVTETTC/(1+ATVA/100)"
                            >
                              TGC
                            </span>
                          )}
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

export default SuiviEntreesScreen;
