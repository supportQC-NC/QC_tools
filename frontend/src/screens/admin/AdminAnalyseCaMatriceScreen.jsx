// src/screens/admin/AdminAnalyseCaMatriceScreen.jsx
//
// Analyse CA : KPI et graphiques lus dans les MATRICES Excel du Rcommun
// (\\192.168.0.250\Rcommun\STOCK\doc_temp\CA), régénérées chaque jour — elles
// remplacent l'aperçu calculé depuis le DBF. La société suit la sélection
// GLOBALE du header ; un admin peut basculer sur une vue GROUPE consolidée.
// Le bouton « Rapport Excel détaillé » conserve la génération 13 onglets
// historique (elle, toujours calculée depuis le DBF).

import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  useGetAnalyseCaMatriceSourcesQuery,
  useGetAnalyseCaMatriceSocieteQuery,
  useGetAnalyseCaMatriceGroupeQuery,
} from "../../slices/analyseCaMatriceApiSlice";
import { useGenererAnalyseCaMutation } from "../../slices/analyseCaApiSlice";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  ComposedChart,
  LineChart,
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
import "./AdminAnalyseCaMatriceScreen.css";

// Couleur FIXE par catégorie de client (jamais réaffectée selon le rang,
// pour que PART reste bleu d'un mois et d'une société à l'autre).
const CAT_COLORS = {
  PART: "#2e75b6",
  FIDELITE: "#70ad47",
  "PRO CPT": "#ffc000",
  "PRO DEBIT": "#c55a11",
  GROUPE: "#9966cc",
  ADMIN: "#a5a5a5",
  REVEND: "#5b9bd5",
  AGRI: "#548235",
  AUTRE: "#7f7f7f",
};
const catColor = (nom, i) =>
  CAT_COLORS[nom] || ["#1f4e79", "#ed7d31", "#8db4e2"][i % 3];

// ── Formats ──
const fmtXPF = (n) =>
  typeof n === "number"
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) +
      " XPF"
    : "—";
const fmtNb = (n) =>
  typeof n === "number" ? new Intl.NumberFormat("fr-FR").format(n) : "—";
const fmtEvol = (n) =>
  typeof n === "number" ? `${n > 0 ? "+" : ""}${n.toFixed(1)} %` : "—";
const fmtTaux = (n) => (typeof n === "number" ? `${n.toFixed(1)} %` : "—");
const fmtCompact = (n) => {
  if (typeof n !== "number") return "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)} Md`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (abs >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
};

const evolClass = (n) => (typeof n !== "number" ? "" : n >= 0 ? "pos" : "neg");

// Tooltip recharts en XPF complet.
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

// Tooltip en nombre simple (clients).
const NbTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="aca-tooltip">
      {label != null && <div className="aca-tooltip-label">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="aca-tooltip-row">
          <span className="aca-tooltip-dot" style={{ background: p.color }} />
          {p.name} : <strong>{fmtNb(p.value)}</strong>
        </div>
      ))}
    </div>
  );
};

// Mois précédent (YYYY-MM), défaut du rapport Excel détaillé.
function moisPrecedent() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
}

const AdminAnalyseCaMatriceScreen = () => {
  const globalDossier = useSelector(selectGlobalDossier) || "";

  const [groupeId, setGroupeId] = useState(""); // "" = suivre la société globale
  const [annee, setAnnee] = useState(null); // null = plus récente
  const [moisSel, setMoisSel] = useState(null); // null = dernier mois disponible

  const { data: sources } = useGetAnalyseCaMatriceSourcesQuery();

  const vueGroupe = Boolean(groupeId);
  const {
    data: dataSociete,
    isFetching: fetchSociete,
    error: errSociete,
  } = useGetAnalyseCaMatriceSocieteQuery(
    { nomDossierDBF: globalDossier, annee },
    { skip: vueGroupe || !globalDossier },
  );
  const {
    data: dataGroupe,
    isFetching: fetchGroupe,
    error: errGroupe,
  } = useGetAnalyseCaMatriceGroupeQuery(
    { groupeId, annee },
    { skip: !vueGroupe },
  );

  const data = vueGroupe ? dataGroupe : dataSociete;
  const busy = vueGroupe ? fetchGroupe : fetchSociete;
  const error = vueGroupe ? errGroupe : errSociete;

  // ── Rapport Excel détaillé (13 onglets, DBF) — conservé de l'ancien module ──
  const [moisCoupure, setMoisCoupure] = useState(moisPrecedent);
  const [genererAnalyseCa, { isLoading: generating }] =
    useGenererAnalyseCaMutation();
  const [genMessage, setGenMessage] = useState(null);

  const handleGenerer = async () => {
    if (!globalDossier || vueGroupe) return;
    setGenMessage(null);
    try {
      const res = await genererAnalyseCa({
        nomDossierDBF: globalDossier,
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
      setGenMessage({ ok: true, text: `Fichier généré : ${res.filename}` });
    } catch (err) {
      setGenMessage({
        ok: false,
        text: err?.data?.message || err?.message || "Échec de la génération.",
      });
    }
  };

  // ── Dérivés ──
  const kpis = data?.kpis;
  const moisDispo = data?.moisDetail || [];
  const dernierMois = moisDispo.length ? moisDispo[moisDispo.length - 1].mois : null;
  const moisActif = moisSel ?? dernierMois;
  const detail = moisDispo.find((m) => m.mois === moisActif) || null;

  // Panier moyen cumulé (absent du bloc KPI du fichier : recalculé).
  const pmN = kpis && kpis.clientsN ? kpis.caN / kpis.clientsN : null;
  const pmN1 = kpis && kpis.clientsN1 ? kpis.caN1 / kpis.clientsN1 : null;
  const evolPm = pmN && pmN1 ? ((pmN - pmN1) / pmN1) * 100 : null;

  const chartMois = useMemo(
    () =>
      (data?.mois || []).map((m) => ({
        ...m,
        label: m.periode,
      })),
    [data],
  );

  const chartJours = useMemo(
    () =>
      (detail?.jours || []).map((j) => ({
        ...j,
        label: j.date,
      })),
    [detail],
  );

  // Donut catégories : seules les parts POSITIVES sont représentables ; les
  // montants négatifs (avoirs GROUPE…) restent visibles dans le tableau.
  const donutCategories = useMemo(
    () => (detail?.cumul?.categories || []).filter((c) => c.ca > 0),
    [detail],
  );

  const sourceCourante = data?.source;
  const anneesDispo = sourceCourante?.annees || [];

  return (
    <div className="aca-screen">
      <header className="aca-header">
        <h1 className="aca-title">Analyse CA</h1>
        <p className="aca-subtitle">
          Chiffre d'affaires, marge et fréquentation, comparés à N-1, lus dans
          les matrices CA du Rcommun (mises à jour quotidiennes) — par société
          ou consolidés par groupe.
        </p>
      </header>

      <section className="aca-toolbar">
        {(sources?.groupes?.length || 0) > 0 && (
          <label className="aca-field">
            Vue
            <select
              value={groupeId}
              onChange={(e) => {
                setGroupeId(e.target.value);
                setMoisSel(null);
              }}
            >
              <option value="">Société (sélection globale)</option>
              {sources.groupes.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label} (consolidé)
                </option>
              ))}
            </select>
          </label>
        )}

        {anneesDispo.length > 1 && (
          <label className="aca-field">
            Année
            <select
              value={annee ?? sourceCourante?.annee ?? ""}
              onChange={(e) => {
                setAnnee(Number(e.target.value));
                setMoisSel(null);
              }}
            >
              {anneesDispo.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        )}

        {!vueGroupe && (
          <>
            <label className="aca-field">
              Mois de coupure (rapport détaillé)
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
              disabled={!globalDossier || generating}
              title="Classeur Excel 13 onglets calculé depuis l'ERP (clients, articles, rayons, fournisseurs, promos…)"
            >
              {generating ? "Génération…" : "Rapport Excel détaillé"}
            </button>
          </>
        )}
      </section>

      {genMessage && (
        <div
          className={`aca-alert ${genMessage.ok ? "aca-alert-success" : "aca-alert-error"}`}
        >
          {genMessage.text}
        </div>
      )}

      {sources && !sources.accessible && (
        <div className="aca-alert aca-alert-error">
          Le dossier des matrices CA est inaccessible (<code>{sources.dossier}</code>).
          Vérifier le partage réseau (Rcommun\STOCK\doc_temp\CA).
        </div>
      )}

      {!vueGroupe && !globalDossier && (
        <div className="aca-empty">
          Sélectionnez une société (en haut de page) pour commencer.
        </div>
      )}

      {error && (
        <div className="aca-alert aca-alert-error">
          {error?.data?.message || "Impossible de charger la matrice CA."}
        </div>
      )}

      {busy && <div className="aca-loading">Chargement de la matrice…</div>}

      {!busy && data && (
        <>
          <section className="aca-periode">
            <div>
              <span className="aca-periode-label">Source</span>
              <span className="aca-periode-value">
                {sourceCourante?.label}
                {vueGroupe ? " (consolidé)" : ""}
              </span>
            </div>
            <div>
              <span className="aca-periode-label">Exercice</span>
              <span className="aca-periode-value">{sourceCourante?.annee}</span>
            </div>
            <div>
              <span className="aca-periode-label">Dernière génération</span>
              <span className="aca-periode-value">
                {(data.genereLe || "").replace(/^Rapport genere le\s*/i, "").split("|")[0].trim() || "—"}
              </span>
            </div>
          </section>

          {/* ── KPI cumulés (à date) ── */}
          <section className="aca-kpis">
            <div className="aca-kpi">
              <span className="aca-kpi-label">CA HT cumulé</span>
              <span className="aca-kpi-value">{fmtXPF(kpis?.caN)}</span>
              <span className={`aca-kpi-evol ${evolClass(kpis?.evolCaPct)}`}>
                {fmtEvol(kpis?.evolCaPct)} vs N-1 ({fmtXPF(kpis?.caN1)})
              </span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Marge HT cumulée</span>
              <span className="aca-kpi-value">{fmtXPF(kpis?.margeN)}</span>
              <span className={`aca-kpi-evol ${evolClass(kpis?.evolMargePct)}`}>
                {fmtEvol(kpis?.evolMargePct)} vs N-1
              </span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Taux de marge</span>
              <span className="aca-kpi-value">{fmtTaux(kpis?.tauxMargeN)}</span>
              <span className="aca-kpi-sub">
                N-1 : {fmtTaux(kpis?.tauxMargeN1)}
              </span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Clients</span>
              <span className="aca-kpi-value">{fmtNb(kpis?.clientsN)}</span>
              <span className={`aca-kpi-evol ${evolClass(kpis?.evolClientsPct)}`}>
                {fmtEvol(kpis?.evolClientsPct)} vs N-1
              </span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Panier moyen</span>
              <span className="aca-kpi-value">
                {pmN != null ? fmtXPF(Math.round(pmN)) : "—"}
              </span>
              <span className={`aca-kpi-evol ${evolClass(evolPm)}`}>
                {fmtEvol(evolPm)} vs N-1
              </span>
            </div>
          </section>

          {/* ── Graphiques annuels ── */}
          <section className="aca-charts">
            <div className="aca-chart-card aca-chart-wide">
              <h3 className="aca-chart-title">CA HT mensuel N vs N-1 · marge N</h3>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartMois}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                  <XAxis dataKey="label" fontSize={11} stroke="#8494a4" />
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
                    name="CA N-1"
                    fill="#c9d6e3"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="caN"
                    name="CA N"
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

            <div className="aca-chart-card aca-chart-wide">
              <h3 className="aca-chart-title">Clients par mois N vs N-1</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartMois}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                  <XAxis dataKey="label" fontSize={11} stroke="#8494a4" />
                  <YAxis
                    fontSize={11}
                    stroke="#8494a4"
                    tickFormatter={fmtCompact}
                    width={48}
                  />
                  <Tooltip content={<NbTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar
                    dataKey="clientsN1"
                    name="Clients N-1"
                    fill="#d9e4d2"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="clientsN"
                    name="Clients N"
                    fill="#70ad47"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ── Tableau mensuel ── */}
          <h2 className="aca-section-title">Détail mensuel (N vs N-1)</h2>
          <div className="aca-table-wrap">
            <table className="aca-table">
              <thead>
                <tr>
                  <th>Mois</th>
                  <th>CA HT N</th>
                  <th>CA HT N-1</th>
                  <th>R/H CA</th>
                  <th>Marge N</th>
                  <th>R/H Marge</th>
                  <th>Clients N</th>
                  <th>R/H Clients</th>
                  <th>PM N</th>
                  <th>R/H PM</th>
                </tr>
              </thead>
              <tbody>
                {(data.mois || []).map((m) => {
                  const sansDonnees = !m.caN;
                  return (
                    <tr key={m.periode}>
                      <td>{m.periode}</td>
                      <td>{sansDonnees ? "—" : fmtNb(m.caN)}</td>
                      <td>{fmtNb(m.caN1)}</td>
                      <td className={sansDonnees ? "muted" : evolClass(m.rhCaPct)}>
                        {sansDonnees ? "—" : fmtEvol(m.rhCaPct)}
                      </td>
                      <td>{sansDonnees ? "—" : fmtNb(m.margeN)}</td>
                      <td className={sansDonnees ? "muted" : evolClass(m.rhMargePct)}>
                        {sansDonnees ? "—" : fmtEvol(m.rhMargePct)}
                      </td>
                      <td>{sansDonnees ? "—" : fmtNb(m.clientsN)}</td>
                      <td className={sansDonnees ? "muted" : evolClass(m.rhClientsPct)}>
                        {sansDonnees ? "—" : fmtEvol(m.rhClientsPct)}
                      </td>
                      <td>{sansDonnees ? "—" : fmtNb(Math.round(m.pmN))}</td>
                      <td className={sansDonnees ? "muted" : evolClass(m.rhPmPct)}>
                        {sansDonnees ? "—" : fmtEvol(m.rhPmPct)}
                      </td>
                    </tr>
                  );
                })}
                {data.total && (
                  <tr className="aca-row-total">
                    <td>TOTAL</td>
                    <td>{fmtNb(data.total.caN)}</td>
                    <td>{fmtNb(data.total.caN1)}</td>
                    <td className={evolClass(data.total.rhCaPct)}>
                      {fmtEvol(data.total.rhCaPct)}
                    </td>
                    <td>{fmtNb(data.total.margeN)}</td>
                    <td className={evolClass(data.total.rhMargePct)}>
                      {fmtEvol(data.total.rhMargePct)}
                    </td>
                    <td>{fmtNb(data.total.clientsN)}</td>
                    <td className={evolClass(data.total.rhClientsPct)}>
                      {fmtEvol(data.total.rhClientsPct)}
                    </td>
                    <td>{fmtNb(Math.round(data.total.pmN))}</td>
                    <td className={evolClass(data.total.rhPmPct)}>
                      {fmtEvol(data.total.rhPmPct)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Détail d'un mois ── */}
          {moisDispo.length > 0 && (
            <>
              <div className="aca-mois-header">
                <h2 className="aca-section-title" style={{ margin: 0 }}>
                  Détail du mois
                </h2>
                <label className="aca-field">
                  Mois
                  <select
                    value={moisActif ?? ""}
                    onChange={(e) => setMoisSel(Number(e.target.value))}
                  >
                    {moisDispo.map((m) => (
                      <option key={m.mois} value={m.mois}>
                        {m.label} {m.annee}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {detail?.cumul && (
                <div className="aca-mois-kpis">
                  <span>
                    CA : <strong>{fmtXPF(detail.cumul.caN)}</strong>{" "}
                    <span className={evolClass(detail.cumul.rhCaPct)}>
                      ({fmtEvol(detail.cumul.rhCaPct)})
                    </span>
                  </span>
                  <span>
                    Marge : <strong>{fmtXPF(detail.cumul.margeN)}</strong> ·
                    taux {fmtTaux(detail.cumul.tauxMargeN)} (N-1{" "}
                    {fmtTaux(detail.cumul.tauxMargeN1)})
                  </span>
                  <span>
                    Clients : <strong>{fmtNb(detail.cumul.clientsN)}</strong>{" "}
                    (N-1 {fmtNb(detail.cumul.clientsN1)})
                  </span>
                  {detail.pm && (
                    <span>
                      Panier moyen :{" "}
                      <strong>{fmtXPF(Math.round(detail.pm.pmN))}</strong> (N-1{" "}
                      {fmtXPF(Math.round(detail.pm.pmN1))})
                    </span>
                  )}
                </div>
              )}

              <section className="aca-charts">
                <div className="aca-chart-card aca-chart-wide">
                  <h3 className="aca-chart-title">
                    CA HT quotidien — {detail?.label} N vs N-1
                  </h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartJours}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                      <XAxis dataKey="label" fontSize={10} stroke="#8494a4" />
                      <YAxis
                        fontSize={11}
                        stroke="#8494a4"
                        tickFormatter={fmtCompact}
                        width={48}
                      />
                      <Tooltip content={<XpfTooltip />} />
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      <Line
                        type="monotone"
                        dataKey="caN1"
                        name="CA N-1"
                        stroke="#c9d6e3"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="caN"
                        name="CA N"
                        stroke="#2e75b6"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="aca-chart-card">
                  <h3 className="aca-chart-title">
                    CA par catégorie de client — {detail?.label}
                  </h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={donutCategories}
                        dataKey="ca"
                        nameKey="nom"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        innerRadius={45}
                        paddingAngle={2}
                      >
                        {donutCategories.map((c, i) => (
                          <Cell key={c.nom} fill={catColor(c.nom, i)} />
                        ))}
                      </Pie>
                      <Tooltip content={<XpfTooltip />} />
                      <Legend wrapperStyle={{ fontSize: "10px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="aca-chart-card">
                  <h3 className="aca-chart-title">
                    Catégories — CA, marge et parts du mois
                  </h3>
                  <div className="aca-table-wrap" style={{ border: "none", marginBottom: 0 }}>
                    <table className="aca-table">
                      <thead>
                        <tr>
                          <th>Catégorie</th>
                          <th>CA HT</th>
                          <th>Part CA</th>
                          <th>Marge</th>
                          <th>Taux</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail?.cumul?.categories || []).map((c, i) => (
                          <tr key={c.nom}>
                            <td>
                              <span
                                className="aca-cat-dot"
                                style={{ background: catColor(c.nom, i) }}
                              />
                              {c.nom}
                            </td>
                            <td className={c.ca < 0 ? "neg" : ""}>{fmtNb(c.ca)}</td>
                            <td>{fmtTaux(c.partPct)}</td>
                            <td className={c.marge < 0 ? "neg" : ""}>
                              {fmtNb(c.marge)}
                            </td>
                            <td>{fmtTaux(c.tauxMargePct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {/* Tableau quotidien */}
              <h2 className="aca-section-title">
                Jours de {detail?.label?.toLowerCase()} {detail?.annee}
              </h2>
              <div className="aca-table-wrap">
                <table className="aca-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>CA HT</th>
                      <th>Marge</th>
                      <th>Taux</th>
                      <th>Clients</th>
                      <th>Date N-1</th>
                      <th>CA HT N-1</th>
                      <th>Clients N-1</th>
                      <th>R/H CA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.jours || []).map((j) => (
                      <tr key={j.date}>
                        <td>{j.date}</td>
                        <td>{j.caN ? fmtNb(j.caN) : "—"}</td>
                        <td>{j.caN ? fmtNb(j.margeN) : "—"}</td>
                        <td>{j.caN ? fmtTaux(j.tauxMargeN) : "—"}</td>
                        <td>{j.caN ? fmtNb(j.clientsN) : "—"}</td>
                        <td>{j.dateN1 || "—"}</td>
                        <td>{j.caN1 ? fmtNb(j.caN1) : "—"}</td>
                        <td>{j.caN1 ? fmtNb(j.clientsN1) : "—"}</td>
                        <td className={evolClass(j.rhCaPct)}>
                          {j.rhCaPct == null ? "—" : fmtEvol(j.rhCaPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <p className="aca-source-note">
            Source : <code>{data.fichier}</code> — {data.genereLe || "date de génération inconnue"}.
          </p>
        </>
      )}
    </div>
  );
};

export default AdminAnalyseCaMatriceScreen;
