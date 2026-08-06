import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiCurrencyDollar,
  HiDownload,
  HiRefresh,
  HiOfficeBuilding,
  HiExclamationCircle,
  HiExclamation,
} from "react-icons/hi";
import {
  selectGlobalDossier,
  selectGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import { useGetRapportTgcQuery } from "../../slices/rapportTgcApiSlice";
import { BASE_URL } from "../../constants";
import "./RapportTgcScreen.css";

// Mois précédent au format "YYYY-MM" (défaut = déclaration du mois écoulé).
const prevMonthISO = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const fmt = (v) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return Math.round(Number(v)).toLocaleString("fr-FR").replace(/[\s,]/g, " ");
};

const RapportTgcScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  const [mois, setMois] = useState(prevMonthISO());
  const [vue, setVue] = useState("totaux"); // totaux | detail | alertes
  const [error, setError] = useState("");
  const [excelLoading, setExcelLoading] = useState(false);

  const [year, month] = mois.split("-").map((n) => parseInt(n, 10));

  const { data, isFetching, isError, error: queryError, refetch } =
    useGetRapportTgcQuery(
      { nomDossierDBF, year, month },
      { skip: !nomDossierDBF || !year || !month },
    );

  const totaux = useMemo(() => data?.totaux || [], [data]);
  const detail = useMemo(() => data?.detail || [], [data]);
  const alertes = useMemo(() => data?.alertes || [], [data]);

  const exporterExcel = async () => {
    setError("");
    if (!nomDossierDBF) {
      setError("Sélectionnez une société dans l'en-tête.");
      return;
    }
    setExcelLoading(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/rapport-tgc/${nomDossierDBF}/excel?year=${year}&month=${month}`,
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
      a.download = `rapport_tgc_${nomDossierDBF}_${mois}.xlsx`;
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
    <div className="tgc-page">
      <header className="tgc-header">
        <div className="tgc-header-left">
          <div className="tgc-header-icon">
            <HiCurrencyDollar />
          </div>
          <div>
            <h1>Rapports TGC mensuels</h1>
            <p className="tgc-header-subtitle">
              Déclaration TGC (base HT &amp; TGC par taux) depuis les factures du
              mois — détail par facture et alertes.
            </p>
          </div>
        </div>
        {entreprise && (
          <div className="tgc-entreprise-badge">
            <HiOfficeBuilding />
            <span>{entreprise.nomComplet || entreprise.nom || nomDossierDBF}</span>
          </div>
        )}
      </header>

      {!nomDossierDBF ? (
        <div className="tgc-empty">
          <HiExclamationCircle className="tgc-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>Choisissez une société dans l'en-tête pour générer le rapport TGC.</p>
        </div>
      ) : (
        <>
          <div className="tgc-toolbar">
            <div className="tgc-toolbar-left">
              <div className="tgc-field">
                <label htmlFor="tgc-mois">Mois de déclaration</label>
                <input
                  id="tgc-mois"
                  type="month"
                  value={mois}
                  max={prevMonthISO()}
                  onChange={(e) => setMois(e.target.value)}
                />
              </div>
              <div className="tgc-stats">
                <div className="tgc-stat tgc-stat-primary">
                  <span className="tgc-stat-value">{fmt(data?.grandTotal?.tgc)}</span>
                  <span className="tgc-stat-label">TGC totale (XPF)</span>
                </div>
                <div className="tgc-stat">
                  <span className="tgc-stat-value">{fmt(data?.grandTotal?.base)}</span>
                  <span className="tgc-stat-label">Base HT (XPF)</span>
                </div>
                <div className="tgc-stat">
                  <span className="tgc-stat-value">{data?.nbFactures ?? "—"}</span>
                  <span className="tgc-stat-label">Factures</span>
                </div>
                <div className="tgc-stat">
                  <span
                    className={`tgc-stat-value ${alertes.length ? "tgc-danger" : ""}`}
                  >
                    {data ? alertes.length : "—"}
                  </span>
                  <span className="tgc-stat-label">Alertes</span>
                </div>
              </div>
            </div>
            <div className="tgc-actions">
              <button
                type="button"
                className="tgc-btn tgc-btn-ghost"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <HiRefresh className={isFetching ? "tgc-spin" : ""} />
                Actualiser
              </button>
              <button
                type="button"
                className="tgc-btn tgc-btn-excel"
                onClick={exporterExcel}
                disabled={excelLoading || isFetching}
              >
                <HiDownload />
                {excelLoading ? "Excel…" : "Export Excel"}
              </button>
            </div>
          </div>

          {error && <div className="tgc-alert tgc-alert-err">{error}</div>}
          {isError && (
            <div className="tgc-alert tgc-alert-err">
              {queryError?.data?.message || "Erreur lors du calcul du rapport TGC."}
            </div>
          )}

          {/* Onglets */}
          <div className="tgc-tabs">
            <button
              className={`tgc-tab ${vue === "totaux" ? "active" : ""}`}
              onClick={() => setVue("totaux")}
            >
              Totaux par taux
            </button>
            <button
              className={`tgc-tab ${vue === "detail" ? "active" : ""}`}
              onClick={() => setVue("detail")}
            >
              Détail par facture ({detail.length})
            </button>
            <button
              className={`tgc-tab ${vue === "alertes" ? "active" : ""}`}
              onClick={() => setVue("alertes")}
            >
              Alertes{alertes.length ? ` (${alertes.length})` : ""}
            </button>
          </div>

          {isFetching ? (
            <div className="tgc-loading">
              <span className="tgc-spinner" /> Calcul en cours (scan des factures)…
            </div>
          ) : vue === "totaux" ? (
            <div className="tgc-table-wrap">
              <table className="tgc-table">
                <thead>
                  <tr>
                    <th>Taux TGC</th>
                    <th className="tgc-num">Base HT</th>
                    <th className="tgc-num">TGC</th>
                  </tr>
                </thead>
                <tbody>
                  {totaux.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="tgc-td-info">
                        Aucune donnée pour ce mois.
                      </td>
                    </tr>
                  ) : (
                    totaux.map((t) => (
                      <tr key={t.dtva}>
                        <td>
                          <span className="tgc-rate">{t.dtva} %</span>
                        </td>
                        <td className="tgc-num tgc-mono">{fmt(t.base)}</td>
                        <td className="tgc-num tgc-mono">{fmt(t.tgc)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {totaux.length > 0 && (
                  <tfoot>
                    <tr className="tgc-total-row">
                      <td>TOTAL</td>
                      <td className="tgc-num tgc-mono">{fmt(data?.grandTotal?.base)}</td>
                      <td className="tgc-num tgc-mono">{fmt(data?.grandTotal?.tgc)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          ) : vue === "detail" ? (
            <div className="tgc-table-wrap">
              <table className="tgc-table">
                <thead>
                  <tr>
                    <th>N° Facture</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th className="tgc-num">Taux</th>
                    <th className="tgc-num">Base HT</th>
                    <th className="tgc-num">TGC</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="tgc-td-info">
                        Aucune ligne pour ce mois.
                      </td>
                    </tr>
                  ) : (
                    detail.map((r, i) => (
                      <tr key={`${r.numfact}-${r.dtva}-${i}`}>
                        <td className="tgc-mono">{r.numfact}</td>
                        <td>
                          <span
                            className={`tgc-typ ${r.typfact === "A" ? "avoir" : ""}`}
                          >
                            {r.typfact}
                          </span>
                        </td>
                        <td>{r.datfact}</td>
                        <td className="tgc-client">
                          {r.nom || <span className="tgc-muted">{r.tiers}</span>}
                        </td>
                        <td className="tgc-num">{r.dtva} %</td>
                        <td className="tgc-num tgc-mono">{fmt(r.base)}</td>
                        <td className="tgc-num tgc-mono">{fmt(r.tgc)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="tgc-table-wrap">
              <table className="tgc-table">
                <thead>
                  <tr>
                    <th>N° Facture</th>
                    <th>Date</th>
                    <th>NART</th>
                    <th className="tgc-num">PV HT</th>
                    <th>Client</th>
                  </tr>
                </thead>
                <tbody>
                  {alertes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="tgc-td-info">
                        Aucune alerte (aucune ligne taxable au taux 0).
                      </td>
                    </tr>
                  ) : (
                    alertes.map((a, i) => (
                      <tr key={`${a.numfact}-${a.nart}-${i}`} className="tgc-row-alert">
                        <td className="tgc-mono">{a.numfact}</td>
                        <td>{a.datfact}</td>
                        <td className="tgc-mono">
                          <HiExclamation className="tgc-alert-ic" />
                          {a.nart}
                        </td>
                        <td className="tgc-num tgc-mono">{fmt(a.pvte)}</td>
                        <td className="tgc-client">
                          {a.nom || <span className="tgc-muted">{a.tiers}</span>}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default RapportTgcScreen;
