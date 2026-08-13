// src/screens/admin/AdminFrequentationScreen.jsx
//
// Module « Fréquentation magasin » : l'utilisateur saisit une plage de dates,
// lance l'analyse, et obtient les plages de fréquentation du magasin déduites
// des factures éditées (date + heure), en graphiques + export Excel.
//
// L'analyse balaie facture.dbf en streaming côté serveur : elle est donc
// DÉCLENCHÉE MANUELLEMENT (bouton), jamais au fil de la frappe.
import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiChartBar,
  HiOfficeBuilding,
  HiExclamationCircle,
  HiDownload,
  HiPlay,
  HiClock,
  HiCalendar,
} from "react-icons/hi";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  LineChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import {
  selectGlobalDossier,
  selectGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import { useLazyGetFrequentationQuery } from "../../slices/frequentationApiSlice";
import OngletVacances from "../../components/frequentation/OngletVacances";
import OngletEvenements from "../../components/frequentation/OngletEvenements";
import OngletMeteo from "../../components/frequentation/OngletMeteo";
import { BASE_URL } from "../../constants";
import "./AdminFrequentationScreen.css";

// Jours de la semaine (index serveur : 0 = lundi … 6 = dimanche).
const JOURS = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

const ONGLETS = [
  { cle: "analyse", label: "Analyse" },
  { cle: "vacances", label: "Vacances scolaires" },
  { cle: "evenements", label: "Événements spéciaux" },
  { cle: "meteo", label: "Météo" },
];

const COULEUR_METEO = { beau: "#f59e0b", mitige: "#94a3b8", pluvieux: "#3b82f6" };

const AXE = "#8b8b9e";
const GRILLE = "#2a2a3a";
const ACCENT = "#2563eb";
const ACCENT_2 = "#f59e0b";

const iso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

const ilYaJours = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

const fmt = (v) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return Math.round(Number(v)).toLocaleString("fr-FR").replace(/[\s,]/g, " ");
};
const fmtDec = (v) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? "—"
    : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const frDate = (isoStr) => {
  if (!isoStr) return "—";
  const [y, m, d] = String(isoStr).split("-");
  return `${d}/${m}/${y}`;
};

// Infobulle sombre commune aux graphiques.
const tooltipStyle = {
  contentStyle: {
    background: "#12121a",
    border: "1px solid #2a2a3a",
    borderRadius: 8,
    color: "#f0f0f5",
    fontSize: 12,
  },
  labelStyle: { color: "#a7a7b8" },
};

const AdminFrequentationScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  const [onglet, setOnglet] = useState("analyse");
  const [du, setDu] = useState(ilYaJours(30));
  const [au, setAu] = useState(iso(new Date()));
  const [pas, setPas] = useState(60);
  const [jour, setJour] = useState(""); // "" = tous les jours de la semaine
  const [error, setError] = useState("");
  const [excelLoading, setExcelLoading] = useState(false);

  const [lancer, { data, isFetching, isError, error: queryError }] =
    useLazyGetFrequentationQuery();

  // Paramètres de la DERNIÈRE analyse lancée (l'export doit correspondre au
  // graphique affiché, pas aux champs éventuellement modifiés depuis).
  const [analysee, setAnalysee] = useState(null);

  const tranches = useMemo(() => data?.tranches || [], [data]);
  const joursSemaine = useMemo(() => data?.joursSemaine || [], [data]);
  const jours = useMemo(() => data?.jours || [], [data]);
  const heat = useMemo(() => data?.heat || [], [data]);
  const kpi = data?.kpi;

  // Intensité max de la carte de chaleur (pour la coloration relative).
  const heatMax = useMemo(
    () => heat.reduce((max, h) => Math.max(max, h.nb), 0),
    [heat],
  );
  const heatParJour = useMemo(() => {
    const map = new Map();
    heat.forEach((h) => {
      if (!map.has(h.jourLabel)) map.set(h.jourLabel, []);
      map.get(h.jourLabel).push(h);
    });
    return map;
  }, [heat]);

  const lancerAnalyse = async () => {
    setError("");
    if (!nomDossierDBF) {
      setError("Sélectionnez une société dans l'en-tête.");
      return;
    }
    if (du > au) {
      setError("La date de début doit précéder la date de fin.");
      return;
    }
    const params = { nomDossierDBF, du, au, pas, jour: jour === "" ? null : Number(jour) };
    setAnalysee(params);
    try {
      await lancer(params).unwrap();
    } catch (e) {
      setError(e?.data?.message || "Erreur lors de l'analyse.");
    }
  };

  const exporterExcel = async () => {
    if (!analysee) return;
    setError("");
    setExcelLoading(true);
    try {
      const suffixe = analysee.jour === null ? "" : `&jour=${analysee.jour}`;
      const res = await fetch(
        `${BASE_URL}/api/frequentation/${analysee.nomDossierDBF}/excel?du=${analysee.du}&au=${analysee.au}&pas=${analysee.pas}${suffixe}`,
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
      a.download = `frequentation_${analysee.nomDossierDBF}_${analysee.du}_${analysee.au}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (e) {
      setError(e.message || "Erreur lors de l'export Excel.");
    } finally {
      setExcelLoading(false);
    }
  };

  const appliquerPreset = (preset) => {
    const now = new Date();
    if (preset === "7j") {
      setDu(ilYaJours(7));
      setAu(iso(now));
    } else if (preset === "30j") {
      setDu(ilYaJours(30));
      setAu(iso(now));
    } else if (preset === "moisDernier") {
      const debut = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const fin = new Date(now.getFullYear(), now.getMonth(), 0);
      setDu(iso(debut));
      setAu(iso(fin));
    } else if (preset === "annee") {
      setDu(iso(new Date(now.getFullYear(), 0, 1)));
      setAu(iso(now));
    }
  };

  if (!nomDossierDBF) {
    return (
      <div className="fq-page">
        <div className="fq-empty">
          <HiExclamationCircle className="fq-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>Choisissez une société dans l'en-tête pour lancer l'analyse.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fq-page">
      <header className="fq-header">
        <div className="fq-header-left">
          <div className="fq-header-icon">
            <HiChartBar />
          </div>
          <div>
            <h1>Fréquentation du magasin</h1>
            <p className="fq-header-subtitle">
              Plages de fréquentation reconstituées à partir des factures
              éditées (date &amp; heure de caisse).
            </p>
          </div>
        </div>
        {entreprise && (
          <div className="fq-entreprise-badge">
            <HiOfficeBuilding />
            <span>{entreprise.nomComplet || entreprise.nom || nomDossierDBF}</span>
          </div>
        )}
      </header>

      <nav className="fq-tabs">
        {ONGLETS.map((o) => (
          <button
            key={o.cle}
            type="button"
            className={`fq-tab ${onglet === o.cle ? "fq-tab-actif" : ""}`}
            onClick={() => setOnglet(o.cle)}
          >
            {o.label}
          </button>
        ))}
      </nav>

      {onglet === "vacances" && <OngletVacances />}
      {onglet === "evenements" && <OngletEvenements />}
      {onglet === "meteo" && <OngletMeteo />}

      {onglet === "analyse" && (
      <>
      <div className="fq-toolbar">
        <div className="fq-toolbar-left">
          <div className="fq-field">
            <label htmlFor="fq-du">Du</label>
            <input
              id="fq-du"
              type="date"
              value={du}
              max={au}
              onChange={(e) => setDu(e.target.value)}
            />
          </div>
          <div className="fq-field">
            <label htmlFor="fq-au">Au</label>
            <input
              id="fq-au"
              type="date"
              value={au}
              min={du}
              onChange={(e) => setAu(e.target.value)}
            />
          </div>
          <div className="fq-field">
            <label htmlFor="fq-pas">Tranche</label>
            <select
              id="fq-pas"
              value={pas}
              onChange={(e) => setPas(parseInt(e.target.value, 10))}
            >
              <option value={60}>1 heure</option>
              <option value={30}>30 minutes</option>
              <option value={15}>15 minutes</option>
            </select>
          </div>
          <div className="fq-field">
            <label htmlFor="fq-jour">Jour de la semaine</label>
            <select
              id="fq-jour"
              value={jour}
              onChange={(e) => setJour(e.target.value)}
              title="Analyser un seul jour pour suivre son évolution sur la période"
            >
              <option value="">Tous les jours</option>
              {JOURS.map((j, i) => (
                <option key={j} value={i}>
                  {j}
                </option>
              ))}
            </select>
          </div>
          <div className="fq-presets">
            <button type="button" onClick={() => appliquerPreset("7j")}>
              7 jours
            </button>
            <button type="button" onClick={() => appliquerPreset("30j")}>
              30 jours
            </button>
            <button type="button" onClick={() => appliquerPreset("moisDernier")}>
              Mois dernier
            </button>
            <button type="button" onClick={() => appliquerPreset("annee")}>
              Année
            </button>
          </div>
        </div>

        <div className="fq-actions">
          <button
            type="button"
            className="fq-btn fq-btn-primary"
            onClick={lancerAnalyse}
            disabled={isFetching}
          >
            <HiPlay />
            {isFetching ? "Analyse en cours…" : "Lancer l'analyse"}
          </button>
          <button
            type="button"
            className="fq-btn fq-btn-excel"
            onClick={exporterExcel}
            disabled={!data || isFetching || excelLoading}
          >
            <HiDownload />
            {excelLoading ? "Excel…" : "Export Excel"}
          </button>
        </div>
      </div>

      {error && <div className="fq-alert fq-alert-err">{error}</div>}
      {isError && !error && (
        <div className="fq-alert fq-alert-err">
          {queryError?.data?.message || "Erreur lors de l'analyse."}
        </div>
      )}

      {isFetching && (
        <div className="fq-loading">
          <span className="fq-spinner" />
          Lecture des factures en cours — cette analyse balaie l'historique
          complet, comptez quelques secondes.
        </div>
      )}

      {!data && !isFetching && (
        <div className="fq-empty">
          <HiClock className="fq-empty-icon" />
          <h2>Aucune analyse lancée</h2>
          <p>
            Choisissez une plage de dates puis cliquez sur « Lancer l'analyse ».
          </p>
        </div>
      )}

      {data && !isFetching && (
        <>
          <div className="fq-kpis">
            <div className="fq-kpi fq-kpi-primary">
              <span className="fq-kpi-value">{fmt(kpi.nbFactures)}</span>
              <span className="fq-kpi-label">Passages (factures)</span>
            </div>
            <div className="fq-kpi">
              <span className="fq-kpi-value">{kpi.heurePointe || "—"}</span>
              <span className="fq-kpi-label">
                Heure de pointe ({fmt(kpi.heurePointeNb)} tickets)
              </span>
            </div>
            <div className="fq-kpi">
              <span className="fq-kpi-value">{kpi.jourSemainePointe || "—"}</span>
              <span className="fq-kpi-label">Jour le plus fréquenté</span>
            </div>
            <div className="fq-kpi">
              <span className="fq-kpi-value">{kpi.amplitude || "—"}</span>
              <span className="fq-kpi-label">Amplitude de fréquentation</span>
            </div>
            <div className="fq-kpi">
              <span className="fq-kpi-value">
                {fmtDec(kpi.moyenneParJourOuvert)}
              </span>
              <span className="fq-kpi-label">
                Tickets / jour ({fmt(kpi.nbJoursOuverts)} jours ouverts)
              </span>
            </div>
            <div className="fq-kpi">
              <span className="fq-kpi-value">{fmt(kpi.caTotal)}</span>
              <span className="fq-kpi-label">CA de la période (XPF)</span>
            </div>
            <div className="fq-kpi">
              <span className="fq-kpi-value">{fmt(kpi.panierMoyen)}</span>
              <span className="fq-kpi-label">Panier moyen (XPF)</span>
            </div>
            <div className="fq-kpi">
              <span className="fq-kpi-value">{fmt(kpi.nbAvoirs)}</span>
              <span className="fq-kpi-label">Avoirs (hors passages)</span>
            </div>
            <div className="fq-kpi">
              <span className="fq-kpi-value">{fmt(kpi.comptesInternes)}</span>
              <span className="fq-kpi-label">
                Écartées : comptes internes (&gt; {kpi.tiersMax})
              </span>
            </div>
          </div>

          {kpi.ticketsExclus > 0 && (
            <div className="fq-alert fq-alert-info">
              {fmt(kpi.ticketsExclus)} vente(s) retirée(s) des moyennes sur{" "}
              {kpi.nbPeriodesExclues} période(s) d'événement marquée(s)
              « exclure de l'analyse » — elles restent comptées dans le
              récapitulatif des événements ci-dessous.
            </div>
          )}

          {kpi.sansHeure > 0 && (
            <div className="fq-alert fq-alert-warn">
              {fmt(kpi.sansHeure)} facture(s) sans heure exploitable : comptées
              dans les totaux et les jours, mais absentes des tranches horaires.
            </div>
          )}

          {/* ── Fréquentation par tranche horaire ── */}
          <section className="fq-card">
            <header className="fq-card-header">
              <h2>
                <HiClock /> Fréquentation par tranche horaire
              </h2>
              <span className="fq-card-note">
                Tickets par tranche de {data.periode.pas} min · CA en courbe
              </span>
            </header>
            <div className="fq-chart">
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={tranches}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} />
                  <XAxis dataKey="label" stroke={AXE} fontSize={11} />
                  <YAxis yAxisId="left" stroke={AXE} fontSize={11} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke={ACCENT_2}
                    fontSize={11}
                    tickFormatter={(v) => fmt(v)}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value, name) => [fmt(value), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    yAxisId="left"
                    dataKey="nb"
                    name="Tickets"
                    fill={ACCENT}
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="ca"
                    name="CA (XPF)"
                    stroke={ACCENT_2}
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ── Carte de chaleur jour × heure ── */}
          <section className="fq-card">
            <header className="fq-card-header">
              <h2>
                <HiCalendar /> Carte de chaleur (jour × tranche horaire)
              </h2>
              <span className="fq-card-note">
                Nombre de tickets — plus la case est foncée, plus le magasin est
                fréquenté
              </span>
            </header>
            <div className="fq-heat-wrap">
              <table className="fq-heat">
                <thead>
                  <tr>
                    <th />
                    {tranches.map((t) => (
                      <th key={t.label}>{t.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...heatParJour.entries()].map(([jour, cases]) => (
                    <tr key={jour}>
                      <th>{jour}</th>
                      {cases.map((c) => {
                        const ratio = heatMax ? c.nb / heatMax : 0;
                        return (
                          <td
                            key={`${jour}-${c.tranche}`}
                            style={{
                              background: `rgba(37, 99, 235, ${
                                ratio ? 0.12 + ratio * 0.8 : 0
                              })`,
                            }}
                            title={`${jour} ${c.tranche} — ${c.nb} tickets (moy. ${c.moyenne}/jour)`}
                          >
                            {c.nb || ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Par jour de la semaine ── */}
          <section className="fq-card">
            <header className="fq-card-header">
              <h2>Fréquentation par jour de la semaine</h2>
              <span className="fq-card-note">
                Total sur la période et moyenne par jour d'ouverture
              </span>
            </header>
            <div className="fq-chart">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={joursSemaine}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} />
                  <XAxis dataKey="label" stroke={AXE} fontSize={11} />
                  <YAxis yAxisId="left" stroke={AXE} fontSize={11} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#10b981"
                    fontSize={11}
                  />
                  <Tooltip
                    {...tooltipStyle}
                    formatter={(value, name) => [fmt(value), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    yAxisId="left"
                    dataKey="nb"
                    name="Tickets"
                    fill={ACCENT}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    yAxisId="right"
                    dataKey="moyenneParJour"
                    name="Moyenne / jour"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ── Évolution jour par jour ── */}
          <section className="fq-card">
            <header className="fq-card-header">
              <h2>Évolution jour par jour</h2>
              <span className="fq-card-note">
                {frDate(data.periode.du)} → {frDate(data.periode.au)} ·{" "}
                {fmt(jours.length)} jours avec activité
              </span>
            </header>
            <div className="fq-chart">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={jours}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} />
                  <XAxis
                    dataKey="date"
                    stroke={AXE}
                    fontSize={11}
                    tickFormatter={frDate}
                    minTickGap={24}
                  />
                  <YAxis stroke={AXE} fontSize={11} />
                  <Tooltip
                    {...tooltipStyle}
                    labelFormatter={frDate}
                    formatter={(value, name) => [fmt(value), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    dataKey="nb"
                    name="Tickets"
                    stroke={ACCENT}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ── Impact de la météo ── */}
          <section className="fq-card">
            <header className="fq-card-header">
              <h2>Impact de la météo</h2>
              <span className="fq-card-note">
                Moyenne de tickets par jour selon le temps à{" "}
                {data.periode.lieuMeteo}
                {data.joursSansMeteo
                  ? ` · ${data.joursSansMeteo} jour(s) sans relevé`
                  : ""}
              </span>
            </header>
            <div className="fq-split">
              <div className="fq-chart fq-chart-half">
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={data.parMeteo || []}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRILLE} />
                    <XAxis dataKey="label" stroke={AXE} fontSize={11} />
                    <YAxis stroke={AXE} fontSize={11} />
                    <Tooltip
                      {...tooltipStyle}
                      formatter={(value, name) => [fmtDec(value), name]}
                    />
                    <Bar
                      dataKey="moyenneTickets"
                      name="Tickets / jour"
                      radius={[4, 4, 0, 0]}
                    >
                      {(data.parMeteo || []).map((m) => (
                        <Cell key={m.categorie} fill={COULEUR_METEO[m.categorie]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="fq-mini-table">
                <table className="fq-table">
                  <thead>
                    <tr>
                      <th>Temps</th>
                      <th className="fq-num">Jours</th>
                      <th className="fq-num">Tickets / jour</th>
                      <th className="fq-num">vs beau temps</th>
                      <th className="fq-num">Panier moyen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.parMeteo || []).map((m) => (
                      <tr key={m.categorie}>
                        <td>
                          <span className={`fq-chip fq-chip-${m.categorie}`}>
                            {m.label}
                          </span>
                        </td>
                        <td className="fq-num">{m.nbJours}</td>
                        <td className="fq-num fq-strong">{fmtDec(m.moyenneTickets)}</td>
                        <td
                          className={`fq-num ${
                            m.ecartVsBeau < 0 ? "fq-neg" : m.ecartVsBeau > 0 ? "fq-pos" : ""
                          }`}
                        >
                          {m.ecartVsBeau === null || m.categorie === "beau"
                            ? "—"
                            : `${m.ecartVsBeau > 0 ? "+" : ""}${m.ecartVsBeau} %`}
                        </td>
                        <td className="fq-num">{fmt(m.panierMoyen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── Impact des vacances scolaires ── */}
          <section className="fq-card">
            <header className="fq-card-header">
              <h2>Impact des vacances scolaires</h2>
              <span className="fq-card-note">
                Périodes saisies dans l'onglet « Vacances scolaires »
              </span>
            </header>
            {data.vacances?.pendant?.nbJours === 0 &&
            data.vacances?.periodes?.length === 0 ? (
              <p className="fq-vide">
                Aucune période de vacances ne recoupe la plage analysée. Saisissez
                le calendrier dans l'onglet « Vacances scolaires ».
              </p>
            ) : (
              <div className="fq-split">
                <div className="fq-compare">
                  <div className="fq-compare-bloc">
                    <span className="fq-compare-value">
                      {fmtDec(data.vacances.pendant.moyenneTickets)}
                    </span>
                    <span className="fq-compare-label">
                      tickets / jour pendant les vacances
                      <br />
                      <em>{data.vacances.pendant.nbJours} jour(s)</em>
                    </span>
                  </div>
                  <div className="fq-compare-bloc">
                    <span className="fq-compare-value">
                      {fmtDec(data.vacances.hors.moyenneTickets)}
                    </span>
                    <span className="fq-compare-label">
                      tickets / jour hors vacances
                      <br />
                      <em>{data.vacances.hors.nbJours} jour(s)</em>
                    </span>
                  </div>
                  <div
                    className={`fq-compare-bloc fq-compare-ecart ${
                      data.vacances.ecart < 0 ? "fq-neg" : "fq-pos"
                    }`}
                  >
                    <span className="fq-compare-value">
                      {data.vacances.ecart === null
                        ? "—"
                        : `${data.vacances.ecart > 0 ? "+" : ""}${data.vacances.ecart} %`}
                    </span>
                    <span className="fq-compare-label">écart</span>
                  </div>
                </div>
                <div className="fq-mini-table">
                  <table className="fq-table">
                    <thead>
                      <tr>
                        <th>Période</th>
                        <th className="fq-num">Jours</th>
                        <th className="fq-num">Tickets / jour</th>
                        <th className="fq-num">Panier moyen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.vacances.periodes || []).map((p) => (
                        <tr key={p._id}>
                          <td>
                            {p.libelle}
                            <span className="fq-sub">
                              {frDate(p.dateDebut)} → {frDate(p.dateFin)}
                            </span>
                          </td>
                          <td className="fq-num">{p.nbJours}</td>
                          <td className="fq-num fq-strong">{fmtDec(p.moyenneTickets)}</td>
                          <td className="fq-num">{fmt(p.panierMoyen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* ── Impact des événements spéciaux ── */}
          <section className="fq-card">
            <header className="fq-card-header">
              <h2>Événements spéciaux</h2>
              <span className="fq-card-note">
                « Attendu » = moyenne du même jour de semaine, hors événement
              </span>
            </header>
            {(data.evenements || []).length === 0 ? (
              <p className="fq-vide">
                Aucun événement enregistré sur cette période. Saisissez grèves,
                blocages, cyclones ou jours fériés dans l'onglet « Événements
                spéciaux ».
              </p>
            ) : (
              <div className="fq-table-wrap">
                <table className="fq-table">
                  <thead>
                    <tr>
                      <th>Événement</th>
                      <th>Type</th>
                      <th>Période</th>
                      <th className="fq-num">Jours</th>
                      <th className="fq-num">Tickets constatés</th>
                      <th className="fq-num">Attendus</th>
                      <th className="fq-num">Écart</th>
                      <th>Analyse</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.evenements.map((e) => (
                      <tr key={e._id}>
                        <td className="fq-strong">{e.libelle}</td>
                        <td>
                          <span className={`fq-chip fq-chip-${e.type}`}>{e.type}</span>
                        </td>
                        <td>
                          {frDate(e.dateDebut)}
                          {e.dateFin !== e.dateDebut ? ` → ${frDate(e.dateFin)}` : ""}
                          {(e.heureDebut || e.heureFin) && (
                            <span className="fq-sub">
                              {e.heureDebut || "00:00"} → {e.heureFin || "23:59"}
                            </span>
                          )}
                        </td>
                        <td className="fq-num">{e.nbJours}</td>
                        <td className="fq-num">{fmt(e.ticketsConstates)}</td>
                        <td className="fq-num fq-muted">{fmt(e.ticketsAttendus)}</td>
                        <td
                          className={`fq-num fq-strong ${
                            e.ecart < 0 ? "fq-neg" : e.ecart > 0 ? "fq-pos" : ""
                          }`}
                        >
                          {e.ecart === null ? "—" : `${e.ecart > 0 ? "+" : ""}${e.ecart} %`}
                        </td>
                        <td>
                          {e.exclure ? (
                            <span
                              className="fq-chip fq-chip-exclu"
                              title={`${fmt(e.ticketsExclus)} vente(s) retirée(s) des moyennes`}
                            >
                              exclu
                            </span>
                          ) : (
                            <span className="fq-muted">inclus</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <p className="fq-footnote">
            Source : facture.dbf (TYPFACT « F » = ventes ; les avoirs, RESA et
            transferts ne comptent pas comme passages). Les comptes internes
            (TIERS &gt; {kpi.tiersMax}) sont exclus. Analyse calculée en{" "}
            {data._queryTime}
            {data._cache ? " (résultat en cache)" : ""}.
          </p>
        </>
      )}
      </>
      )}
    </div>
  );
};

export default AdminFrequentationScreen;
