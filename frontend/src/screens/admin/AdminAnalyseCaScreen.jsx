// src/screens/admin/AdminAnalyseCaScreen.jsx
import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  useGetAnalyseCaApercuQuery,
  useGenererAnalyseCaMutation,
} from "../../slices/analyseCaApiSlice";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import "./AdminAnalyseCaScreen.css";

// Palette (cohérente avec les onglets Excel du module)
const CHART_COLORS = [
  "#1f4e79", "#2e75b6", "#70ad47", "#ffc000", "#c55a11",
  "#8db4e2", "#a5a5a5", "#9966cc", "#ed7d31", "#5b9bd5",
];

// Format XPF compact pour les axes (1 234 567 -> 1,2 M)
const fmtCompact = (n) => {
  if (typeof n !== "number") return "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)} Md`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (abs >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
};

// Mois précédent au format YYYY-MM (défaut du sélecteur).
function moisPrecedent() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
}

const fmtXPF = (n) =>
  typeof n === "number"
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " XPF"
    : "—";
const fmtPct = (n) =>
  typeof n === "number" ? `${n > 0 ? "+" : ""}${n.toFixed(1)} %` : "—";
const fmtNb = (n) =>
  typeof n === "number" ? new Intl.NumberFormat("fr-FR").format(n) : "—";

// Tooltip affichant les valeurs en XPF complet.
const XpfTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="aca-tooltip">
      {label != null && <div className="aca-tooltip-label">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="aca-tooltip-row">
          <span className="aca-tooltip-dot" style={{ background: p.color }} />
          {p.name} :{" "}
          <strong>
            {typeof p.value === "number"
              ? new Intl.NumberFormat("fr-FR").format(p.value) + " XPF"
              : p.value}
          </strong>
        </div>
      ))}
    </div>
  );
};

const AdminAnalyseCaScreen = () => {
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalDossier) || "";
  const [moisCoupure, setMoisCoupure] = useState(moisPrecedent);

  const { data: entreprises } = useGetEntreprisesQuery();

  const {
    data: apercu,
    isLoading: loadingApercu,
    isFetching: fetchingApercu,
    error: apercuError,
  } = useGetAnalyseCaApercuQuery(
    { nomDossierDBF: selectedEntreprise, moisCoupure },
    { skip: !selectedEntreprise || !moisCoupure },
  );

  const [genererAnalyseCa, { isLoading: generating }] =
    useGenererAnalyseCaMutation();
  const [genError, setGenError] = useState(null);
  const [lastFile, setLastFile] = useState(null);

  const kpis = apercu?.kpis;
  const meta = apercu?.meta;
  const periode = meta?.periode;
  const charts = apercu?.charts;

  const trigramme = useMemo(() => {
    const e = (entreprises || []).find(
      (x) => x.nomDossierDBF === selectedEntreprise,
    );
    return e?.trigramme || "";
  }, [entreprises, selectedEntreprise]);

  const handleGenerer = async () => {
    if (!selectedEntreprise || !moisCoupure) return;
    setGenError(null);
    setLastFile(null);
    try {
      const res = await genererAnalyseCa({
        nomDossierDBF: selectedEntreprise,
        moisCoupure,
      }).unwrap();
      if (!res?.blob) throw new Error("Réponse invalide");
      const href = window.URL.createObjectURL(res.blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = res.filename || "analyse_ca.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(href);
      setLastFile(res.filename || "analyse_ca.xlsx");
    } catch (err) {
      setGenError(
        err?.data?.message || err?.message || "Échec de la génération du fichier.",
      );
    }
  };

  const apercuBusy = loadingApercu || fetchingApercu;

  return (
    <div className="aca-screen">
      <header className="aca-header">
        <h1 className="aca-title">Analyse CA</h1>
        <p className="aca-subtitle">
          Rapport Excel multi-onglets (chiffre d'affaires, marges, évolutions)
          par type de client, article, classe, rayon, fournisseur et promotions.
        </p>
      </header>

      <section className="aca-toolbar">
        <label className="aca-field">
          Mois de coupure
          <input
            type="month"
            value={moisCoupure}
            max={moisPrecedent()}
            onChange={(e) => setMoisCoupure(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="aca-btn aca-btn-primary"
          onClick={handleGenerer}
          disabled={!selectedEntreprise || !moisCoupure || generating || apercuBusy}
        >
          {generating ? "Génération…" : "Générer le fichier Excel"}
        </button>
      </section>

      {genError && <div className="aca-alert aca-alert-error">{genError}</div>}
      {lastFile && (
        <div className="aca-alert aca-alert-success">
          Fichier généré : <strong>{lastFile}</strong> (téléchargement lancé).
        </div>
      )}

      {!selectedEntreprise && (
        <div className="aca-empty">Sélectionnez une entreprise pour commencer.</div>
      )}

      {selectedEntreprise && apercuError && (
        <div className="aca-alert aca-alert-error">
          Impossible de charger l'aperçu :{" "}
          {apercuError?.data?.message || "erreur serveur."}
        </div>
      )}

      {selectedEntreprise && apercuBusy && (
        <div className="aca-loading">Chargement de l'aperçu…</div>
      )}

      {selectedEntreprise && !apercuBusy && apercu && (
        <>
          <section className="aca-periode">
            <div>
              <span className="aca-periode-label">Période N</span>
              <span className="aca-periode-value">
                {periode?.labelN || `Année ${periode?.anneeN ?? ""}`}
              </span>
            </div>
            <div>
              <span className="aca-periode-label">Comparé à N-1</span>
              <span className="aca-periode-value">
                {periode?.labelN1 || `Année ${periode?.anneeN1 ?? ""}`}
              </span>
            </div>
            <div>
              <span className="aca-periode-label">Trigramme</span>
              <span className="aca-periode-value">{trigramme || "—"}</span>
            </div>
          </section>

          <section className="aca-kpis">
            <div className="aca-kpi">
              <span className="aca-kpi-label">CA N</span>
              <span className="aca-kpi-value">{fmtXPF(kpis?.caN)}</span>
              <span
                className={`aca-kpi-evol ${
                  (kpis?.evolCaPct ?? 0) >= 0 ? "pos" : "neg"
                }`}
              >
                {fmtPct(kpis?.evolCaPct)} vs N-1
              </span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Marge N</span>
              <span className="aca-kpi-value">{fmtXPF(kpis?.margeN)}</span>
              <span className="aca-kpi-sub">
                Taux {typeof kpis?.tauxMargeN === "number" ? `${kpis.tauxMargeN.toFixed(1)} %` : "—"}
              </span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Factures N</span>
              <span className="aca-kpi-value">{fmtNb(kpis?.nbFacturesN)}</span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Clients N</span>
              <span className="aca-kpi-value">{fmtNb(kpis?.nbClientsN)}</span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Articles vendus N</span>
              <span className="aca-kpi-value">{fmtNb(kpis?.nbArticlesN)}</span>
            </div>
          </section>

          {charts && (
            <section className="aca-charts">
              {/* CA mensuel N vs N-1 + marge */}
              <div className="aca-chart-card aca-chart-wide">
                <h3 className="aca-chart-title">
                  CA mensuel N vs N-1 · marge N
                </h3>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={charts.caParMois}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                    <XAxis dataKey="moisLabel" fontSize={11} stroke="#8494a4" />
                    <YAxis
                      fontSize={11}
                      stroke="#8494a4"
                      tickFormatter={fmtCompact}
                      width={48}
                    />
                    <Tooltip content={<XpfTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar
                      dataKey="caN1"
                      name={`CA ${periode?.anneeN1 ?? "N-1"}`}
                      fill="#c9d6e3"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="caN"
                      name={`CA ${periode?.anneeN ?? "N"}`}
                      fill="#2e75b6"
                      radius={[3, 3, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="margeN"
                      name="Marge N"
                      stroke="#e65100"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Répartition CA par type de client */}
              <div className="aca-chart-card">
                <h3 className="aca-chart-title">CA par type de client (N)</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={charts.repartitionTypeClient}
                      dataKey="ca"
                      nameKey="type"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      innerRadius={45}
                      paddingAngle={2}
                    >
                      {charts.repartitionTypeClient.map((entry, i) => (
                        <Cell
                          key={entry.type}
                          fill={CHART_COLORS[i % CHART_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<XpfTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Top articles par CA */}
              <div className="aca-chart-card">
                <h3 className="aca-chart-title">Top 10 articles (CA N)</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={charts.topArticles}
                    layout="vertical"
                    margin={{ left: 8, right: 12 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" horizontal={false} />
                    <XAxis
                      type="number"
                      fontSize={10}
                      stroke="#8494a4"
                      tickFormatter={fmtCompact}
                    />
                    <YAxis
                      type="category"
                      dataKey="design"
                      width={150}
                      fontSize={10}
                      stroke="#8494a4"
                    />
                    <Tooltip content={<XpfTooltip />} />
                    <Bar dataKey="ca" name="CA N" fill="#70ad47" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Top fournisseurs par CA */}
              <div className="aca-chart-card">
                <h3 className="aca-chart-title">Top 8 fournisseurs (CA N)</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={charts.topFournisseurs}
                    layout="vertical"
                    margin={{ left: 8, right: 12 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" horizontal={false} />
                    <XAxis
                      type="number"
                      fontSize={10}
                      stroke="#8494a4"
                      tickFormatter={fmtCompact}
                    />
                    <YAxis
                      type="category"
                      dataKey="nom"
                      width={150}
                      fontSize={10}
                      stroke="#8494a4"
                    />
                    <Tooltip content={<XpfTooltip />} />
                    <Bar dataKey="ca" name="CA N" fill="#ffc000" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section className="aca-onglets">
            <h2 className="aca-section-title">
              Onglets du fichier ({meta?.onglets?.length ?? 0})
            </h2>
            <ul className="aca-onglets-list">
              {(meta?.onglets || []).map((o) => (
                <li key={o} className="aca-onglet-chip">
                  {o}
                </li>
              ))}
            </ul>

            {meta?.ongletsOmis?.length > 0 && (
              <div className="aca-alert aca-alert-info">
                Onglets omis (fichier <code>artplus.dbf</code> absent pour cette
                entreprise) : {meta.ongletsOmis.join(", ")}.
              </div>
            )}
            {meta && !meta.dictionnairePresent && (
              <div className="aca-alert aca-alert-info">
                Dictionnaire des rayons absent : l'onglet <strong>Rayons</strong>{" "}
                utilise le code GISM1 comme libellé (métrage non calculé).
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default AdminAnalyseCaScreen;