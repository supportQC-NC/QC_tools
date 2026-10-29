// src/screens/admin/AdminStatsCommerciauxScreen.jsx
//
// STATS COMMERCIAUX : tableau de bord des commerciaux d'une société, lu dans
// les classeurs `stats_<TRIG>.xlsx` du FTPS robot-documents (une ligne par
// client, rattachée à un commercial ; régénérés chaque soir).
//
// Quatre étages, du général au particulier :
//   1. KPI société (CA, marge, factures, clients actifs, panier moyen)
//   2. Comparaison des commerciaux (table + CA N/N-1 + parts) — « MAGASIN »
//      est un pseudo-commercial (ventes comptoir) qui écrase les vrais
//      commerciaux : il est EXCLU par défaut de cette comparaison, un
//      interrupteur le réintègre. Les KPI société, eux, l'incluent toujours.
//   3. Évolution mensuelle (CA ou marge empilés par commercial + taux de
//      marge mensuel société) et mix par catégorie de client.
//   4. Portefeuille d'un commercial : top clients, plus fortes progressions
//      et baisses, nouveaux / perdus, concentration (Pareto 80 %), tableau
//      complet filtrable et triable.
//
// La société suit la sélection GLOBALE du header. Montants : fmtMontant
// (entiers, espaces larges — préférence client du 29/10/2026).

import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  useGetStatsCommerciauxSyntheseQuery,
  useGetStatsCommerciauxClientsQuery,
} from "../../slices/statsCommerciauxApiSlice";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
} from "recharts";
import { fmtMontant, fmtNombreLarge } from "../../utils/format";
import "./AdminStatsCommerciauxScreen.css";

// ── Formats ──
const fmtXPF = (n) => (typeof n === "number" ? `${fmtMontant(n)} XPF` : "—");
const fmtNb = fmtMontant;
const fmtTaux = (n) => (typeof n === "number" ? `${n.toFixed(1)} %` : "—");
const fmtEvol = (n) =>
  typeof n === "number" ? `${n > 0 ? "+" : ""}${n.toFixed(1)} %` : "—";
const evolClass = (n) => (typeof n !== "number" ? "" : n >= 0 ? "pos" : "neg");
const fmtCompact = (n) => {
  if (typeof n !== "number") return "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)} Md`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (abs >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
};
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR") : "—";

// Couleurs des graphiques (thème sombre admin, mêmes repères que l'Analyse CA).
const CH = {
  grille: "#2a2a3a",
  axe: "#a7a7b8",
  caN: "#4da6ff",
  caN1: "#4a5570",
  marge: "#f59e0b",
  pareto: "#34d399",
};
// Une couleur stable par rang de commercial (ordre CA décroissant).
const SERIE_COLORS = [
  "#4da6ff", "#34d399", "#fbbf24", "#fb7185", "#c084fc",
  "#2dd4bf", "#a3e635", "#f472b6", "#f97316", "#818cf8",
];
const serieColor = (i) => SERIE_COLORS[i % SERIE_COLORS.length];

const MOIS_LABELS = [
  "Janv", "Févr", "Mars", "Avr", "Mai", "Juin",
  "Juil", "Août", "Sept", "Oct", "Nov", "Déc",
];

// Tooltip générique : XPF entiers, % à une décimale quand `pct`.
const StcTooltip = ({ active, payload, label, pct }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="stc-tooltip">
      {label != null && <div className="stc-tooltip-label">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="stc-tooltip-row">
          <span
            className="stc-tooltip-dot"
            style={{ background: p.color || p.stroke || p.payload?.fill }}
          />
          {p.name} :{" "}
          <strong>
            {typeof p.value !== "number"
              ? "—"
              : pct || p.unit === "pct"
                ? `${p.value.toFixed(1)} %`
                : `${fmtMontant(p.value)} XPF`}
          </strong>
        </div>
      ))}
    </div>
  );
};

// ── Portefeuille d'un commercial (section 4, composant dédié : son état de
// tri/recherche repart à zéro quand on change de commercial via `key`). ──

const COLONNES_TABLE = [
  { key: "tiers", label: "Tiers", type: "txt" },
  { key: "nom", label: "Client", type: "txt" },
  { key: "categorie", label: "Catégorie", type: "txt" },
  { key: "remisePct", label: "Remise", type: "pct0" },
  { key: "caN", label: "CA N", type: "xpf" },
  { key: "caN1", label: "CA N-1", type: "xpf" },
  { key: "evolCaPct", label: "Évol. CA", type: "evol" },
  { key: "margeN", label: "Marge N", type: "xpf" },
  { key: "tauxMargeN", label: "Taux", type: "pct" },
  { key: "pctRealisePct", label: "% réalisé", type: "pct0" },
  { key: "restant", label: "Restant", type: "xpf" },
  { key: "nbFactures", label: "Fact. N", type: "nb" },
  { key: "contributionPct", label: "Contrib.", type: "pct" },
];

const celluleTable = (type, v) => {
  if (type === "txt") return v || "—";
  if (typeof v !== "number") return "—";
  if (type === "xpf" || type === "nb") return fmtNb(v);
  if (type === "pct") return fmtTaux(v);
  if (type === "pct0") return `${Math.round(v)} %`;
  if (type === "evol") return fmtEvol(v);
  return v;
};

const PAGE_TABLE = 25;

const PortefeuilleCommercial = ({ dossier, commercial }) => {
  const { data, isFetching, error } = useGetStatsCommerciauxClientsQuery(
    { nomDossierDBF: dossier, commercial },
    { skip: !dossier },
  );

  const [recherche, setRecherche] = useState("");
  const [tri, setTri] = useState({ col: "caN", desc: true });
  const [limite, setLimite] = useState(PAGE_TABLE);

  const clients = useMemo(() => data?.clients || [], [data]);

  // ── Analyses dérivées du portefeuille ──
  const analyses = useMemo(() => {
    const actifs = clients.filter((c) => c.caN > 0);
    const topClients = actifs.slice(0, 15);

    const avecDelta = clients
      .map((c) => ({ ...c, delta: c.caN - c.caN1 }))
      .filter((c) => c.delta !== 0);
    const progressions = [...avecDelta]
      .filter((c) => c.delta > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 10);
    const baisses = [...avecDelta]
      .filter((c) => c.delta < 0)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 10);

    const nouveaux = clients
      .filter((c) => c.caN > 0 && c.caN1 === 0)
      .sort((a, b) => b.caN - a.caN);
    const perdus = clients
      .filter((c) => c.caN === 0 && c.caN1 > 0)
      .sort((a, b) => b.caN1 - a.caN1);

    // Concentration : courbe de Pareto (% CA cumulé vs % clients) sur les
    // clients à CA positif, et nombre de clients qui font 80 % du CA.
    const caTotal = actifs.reduce((s, c) => s + c.caN, 0);
    let cumul = 0;
    let clients80 = 0;
    const pas = Math.max(1, Math.floor(actifs.length / 60)); // ≤ ~60 points
    const pareto = [];
    actifs.forEach((c, i) => {
      cumul += c.caN;
      if (!clients80 && caTotal && cumul >= caTotal * 0.8) clients80 = i + 1;
      if (i % pas === 0 || i === actifs.length - 1) {
        pareto.push({
          pctClients: Math.round(((i + 1) / actifs.length) * 1000) / 10,
          pctCa: caTotal ? Math.round((cumul / caTotal) * 1000) / 10 : 0,
        });
      }
    });

    return { actifs, topClients, progressions, baisses, nouveaux, perdus, pareto, clients80 };
  }, [clients]);

  // ── Tableau : filtre + tri + pagination locale ──
  const lignesTable = useMemo(() => {
    const mots = recherche
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    let lignes = clients;
    if (mots.length) {
      lignes = lignes.filter((c) => {
        const txt = `${c.tiers} ${c.nom} ${c.categorie} ${c.profession}`.toLowerCase();
        return mots.every((m) => txt.includes(m));
      });
    }
    const { col, desc } = tri;
    const type = COLONNES_TABLE.find((c) => c.key === col)?.type;
    lignes = [...lignes].sort((a, b) => {
      const va = a[col];
      const vb = b[col];
      let cmp;
      if (type === "txt") cmp = String(va || "").localeCompare(String(vb || ""));
      else cmp = (typeof va === "number" ? va : -Infinity) - (typeof vb === "number" ? vb : -Infinity);
      return desc ? -cmp : cmp;
    });
    return lignes;
  }, [clients, recherche, tri]);

  const trier = (col) =>
    setTri((t) => ({ col, desc: t.col === col ? !t.desc : true }));

  if (error) {
    return (
      <p className="stc-erreur">
        {error?.data?.message || "Portefeuille indisponible."}
      </p>
    );
  }
  if (isFetching && !data) return <p className="stc-info">Chargement du portefeuille…</p>;
  if (!clients.length) return <p className="stc-info">Aucun client pour cette sélection.</p>;

  const { topClients, progressions, baisses, nouveaux, perdus, pareto, clients80, actifs } = analyses;

  return (
    <>
      <section className="stc-charts">
        <div className="stc-chart-card stc-chart-wide">
          <h3 className="stc-chart-title">Top 15 clients — CA N</h3>
          <ResponsiveContainer width="100%" height={Math.max(220, topClients.length * 26 + 60)}>
            <BarChart data={topClients} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
              <XAxis type="number" fontSize={10} stroke={CH.axe} tickFormatter={fmtCompact} />
              <YAxis
                type="category"
                dataKey="nom"
                width={170}
                fontSize={10}
                stroke={CH.axe}
                tickFormatter={(v) => (v.length > 24 ? `${v.slice(0, 23)}…` : v)}
              />
              <Tooltip content={<StcTooltip />} />
              <Bar dataKey="caN" name="CA N" fill={CH.caN} />
              <Bar dataKey="caN1" name="CA N-1" fill={CH.caN1} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="stc-chart-card">
          <h3 className="stc-chart-title">Concentration du portefeuille (Pareto)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={pareto}>
              <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
              <XAxis
                dataKey="pctClients"
                fontSize={10}
                stroke={CH.axe}
                tickFormatter={(v) => `${v} %`}
              />
              <YAxis fontSize={10} stroke={CH.axe} tickFormatter={(v) => `${v} %`} domain={[0, 100]} />
              <Tooltip content={<StcTooltip pct />} />
              <ReferenceLine y={80} stroke={CH.axe} strokeDasharray="4 4" />
              <Area
                type="monotone"
                dataKey="pctCa"
                name="% du CA cumulé"
                stroke={CH.pareto}
                fill={CH.pareto}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="stc-note">
            {clients80
              ? `${fmtNb(clients80)} client${clients80 > 1 ? "s" : ""} (${
                  actifs.length
                    ? Math.round((clients80 / actifs.length) * 100)
                    : 0
                } % du portefeuille actif) font 80 % du CA.`
              : "Pas assez de données pour mesurer la concentration."}
          </p>
        </div>
      </section>

      <section className="stc-charts">
        <div className="stc-chart-card">
          <h3 className="stc-chart-title">Plus fortes progressions (Δ CA vs N-1)</h3>
          <MiniListe lignes={progressions} champ="delta" vide="Aucune progression." />
        </div>
        <div className="stc-chart-card">
          <h3 className="stc-chart-title">Plus fortes baisses (Δ CA vs N-1)</h3>
          <MiniListe lignes={baisses} champ="delta" vide="Aucune baisse." />
        </div>
        <div className="stc-chart-card">
          <h3 className="stc-chart-title">
            Nouveaux clients ({fmtNb(nouveaux.length)}) · Perdus ({fmtNb(perdus.length)})
          </h3>
          <div className="stc-deux-listes">
            <MiniListe
              lignes={nouveaux.slice(0, 8)}
              champ="caN"
              vide="Aucun nouveau client."
            />
            <MiniListe
              lignes={perdus.slice(0, 8)}
              champ="caN1"
              negatif
              vide="Aucun client perdu."
            />
          </div>
        </div>
      </section>

      <section className="stc-table-card">
        <div className="stc-table-head">
          <h3 className="stc-chart-title">
            Portefeuille complet — {fmtNb(lignesTable.length)} client
            {lignesTable.length > 1 ? "s" : ""}
          </h3>
          <input
            type="search"
            className="stc-recherche"
            placeholder="Filtrer (nom, tiers, catégorie…)"
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value);
              setLimite(PAGE_TABLE);
            }}
          />
        </div>
        <div className="stc-table-wrap">
          <table className="stc-table">
            <thead>
              <tr>
                {COLONNES_TABLE.map((c) => (
                  <th
                    key={c.key}
                    className={c.type === "txt" ? "gauche" : ""}
                    onClick={() => trier(c.key)}
                    title="Trier"
                  >
                    {c.label}
                    {tri.col === c.key ? (tri.desc ? " ▾" : " ▴") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lignesTable.slice(0, limite).map((c) => (
                <tr key={`${c.tiers}-${c.nom}`}>
                  {COLONNES_TABLE.map((colDef) => (
                    <td
                      key={colDef.key}
                      className={[
                        colDef.type === "txt" ? "gauche" : "",
                        colDef.type === "evol" ? evolClass(c[colDef.key]) : "",
                        (colDef.type === "xpf" || colDef.type === "nb") &&
                        typeof c[colDef.key] === "number" &&
                        c[colDef.key] < 0
                          ? "neg"
                          : "",
                      ].join(" ")}
                    >
                      {celluleTable(colDef.type, c[colDef.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lignesTable.length > limite && (
          <button
            type="button"
            className="stc-plus"
            onClick={() => setLimite((l) => l + 100)}
          >
            Afficher plus ({fmtNb(lignesTable.length - limite)} restants)
          </button>
        )}
      </section>
    </>
  );
};

// Petite liste nom + montant (progressions, baisses, nouveaux, perdus).
const MiniListe = ({ lignes, champ, negatif = false, vide }) => {
  if (!lignes.length) return <p className="stc-info">{vide}</p>;
  return (
    <ul className="stc-mini-liste">
      {lignes.map((c) => (
        <li key={`${c.tiers}-${c.nom}`}>
          <span className="stc-mini-nom" title={`${c.nom} (${c.tiers})`}>
            {c.nom || c.tiers}
          </span>
          <span className={`stc-mini-val ${negatif || c[champ] < 0 ? "neg" : "pos"}`}>
            {c[champ] > 0 && champ === "delta" ? "+" : ""}
            {fmtNb(c[champ])}
          </span>
        </li>
      ))}
    </ul>
  );
};

// ── Écran ──

const AdminStatsCommerciauxScreen = () => {
  const globalDossier = useSelector(selectGlobalDossier) || "";

  const [inclureMagasin, setInclureMagasin] = useState(false);
  const [metriqueMois, setMetriqueMois] = useState("ca"); // ca | marge
  // Portefeuille : SÉLECTION MULTIPLE de commerciaux (vide = toute la
  // société), avec raccourci « tous sauf MAGASIN » (demande client 29/10/2026).
  const [selCommerciaux, setSelCommerciaux] = useState([]);

  const { data, isFetching, error } = useGetStatsCommerciauxSyntheseQuery(
    { nomDossierDBF: globalDossier },
    { skip: !globalDossier },
  );

  const totaux = data?.totaux;
  const commerciaux = useMemo(() => data?.commerciaux || [], [data]);

  // Comparaison : MAGASIN (ventes comptoir) exclu par défaut.
  const commerciauxVue = useMemo(
    () =>
      inclureMagasin
        ? commerciaux
        : commerciaux.filter((c) => c.nom !== "MAGASIN"),
    [commerciaux, inclureMagasin],
  );

  // Les mois sans activité en fin d'année (année en cours) sont coupés.
  const nbMois = useMemo(() => {
    if (!totaux) return 0;
    let dernier = 0;
    totaux.mois.forEach((m, i) => {
      if (m.ca !== 0 || m.marge !== 0) dernier = i + 1;
    });
    return dernier;
  }, [totaux]);

  // CA (ou marge) mensuel empilé par commercial + taux de marge société.
  const chartMois = useMemo(() => {
    if (!totaux) return [];
    return Array.from({ length: nbMois }, (_, i) => {
      const point = { mois: MOIS_LABELS[i] };
      commerciauxVue.forEach((c) => {
        point[c.nom] = metriqueMois === "ca" ? c.mois[i].ca : c.mois[i].marge;
      });
      const m = totaux.mois[i];
      point.tauxSociete = m.ca ? Math.round((m.marge / m.ca) * 1000) / 10 : null;
      return point;
    });
  }, [totaux, commerciauxVue, metriqueMois, nbMois]);

  const chartCommerciaux = useMemo(
    () =>
      commerciauxVue.map((c) => ({
        nom: c.nom,
        caN: c.caN,
        caN1: c.caN1,
      })),
    [commerciauxVue],
  );

  const donutCommerciaux = useMemo(
    () => commerciauxVue.filter((c) => c.caN > 0),
    [commerciauxVue],
  );

  const categories = useMemo(
    () => (data?.categories || []).filter((c) => c.caN !== 0),
    [data],
  );

  if (!globalDossier) {
    return (
      <div className="stc-screen">
        <h1 className="stc-titre">Stats commerciaux</h1>
        <p className="stc-info">Sélectionnez une société dans l'en-tête.</p>
      </div>
    );
  }

  return (
    <div className="stc-screen">
      <div className="stc-entete">
        <div>
          <h1 className="stc-titre">
            Stats commerciaux — {data?.source?.label || globalDossier}
          </h1>
          <p className="stc-sous-titre">
            Exercice {data?.annee || ""} · classeur {data?.fichier || "…"} généré
            le {fmtDate(data?.modifieLe)} · {fmtNb(totaux?.nbClients)} clients
          </p>
        </div>
      </div>

      {error && (
        <p className="stc-erreur">
          {error?.data?.message || "Stats commerciaux indisponibles."}
        </p>
      )}
      {isFetching && !data && <p className="stc-info">Chargement des stats…</p>}

      {totaux && (
        <>
          {/* ── 1 · KPI société ── */}
          <section className="stc-kpis">
            <div className="stc-kpi">
              <span className="stc-kpi-label">CA HT</span>
              <span className="stc-kpi-value">{fmtXPF(totaux.caN)}</span>
              <span className={`stc-kpi-sub ${evolClass(totaux.evolCaPct)}`}>
                {fmtEvol(totaux.evolCaPct)} vs N-1 ({fmtXPF(totaux.caN1)})
              </span>
            </div>
            <div className="stc-kpi">
              <span className="stc-kpi-label">Marge</span>
              <span className="stc-kpi-value">{fmtXPF(totaux.margeN)}</span>
              <span className={`stc-kpi-sub ${evolClass(totaux.evolMargePct)}`}>
                {fmtEvol(totaux.evolMargePct)} vs N-1
              </span>
            </div>
            <div className="stc-kpi">
              <span className="stc-kpi-label">Taux de marge</span>
              <span className="stc-kpi-value">{fmtTaux(totaux.tauxMargeN)}</span>
              <span className="stc-kpi-sub">N-1 : {fmtTaux(totaux.tauxMargeN1)}</span>
            </div>
            <div className="stc-kpi">
              <span className="stc-kpi-label">Factures</span>
              <span className="stc-kpi-value">{fmtNb(totaux.nbFactures)}</span>
              <span
                className={`stc-kpi-sub ${evolClass(
                  totaux.nbFacturesN1
                    ? ((totaux.nbFactures - totaux.nbFacturesN1) / totaux.nbFacturesN1) * 100
                    : null,
                )}`}
              >
                N-1 : {fmtNb(totaux.nbFacturesN1)}
              </span>
            </div>
            <div className="stc-kpi">
              <span className="stc-kpi-label">Clients actifs</span>
              <span className="stc-kpi-value">{fmtNb(totaux.clientsActifs)}</span>
              <span className="stc-kpi-sub">
                <span className="pos">+{fmtNb(totaux.nouveaux)} nouveaux</span> ·{" "}
                <span className="neg">{fmtNb(totaux.perdus)} perdus</span>
              </span>
            </div>
            <div className="stc-kpi">
              <span className="stc-kpi-label">Panier moyen / facture</span>
              <span className="stc-kpi-value">{fmtXPF(totaux.panierMoyen)}</span>
              <span className="stc-kpi-sub">
                {fmtNombreLarge(
                  totaux.nbFactures && totaux.clientsActifs
                    ? totaux.nbFactures / totaux.clientsActifs
                    : null,
                  1,
                )}{" "}
                factures / client actif
              </span>
            </div>
          </section>

          {/* ── 2 · Comparaison des commerciaux ── */}
          <div className="stc-section-head">
            <h2 className="stc-section-titre">Commerciaux</h2>
            <label className="stc-option" title="MAGASIN regroupe les ventes comptoir : il écrase les vrais commerciaux dans les comparaisons.">
              <input
                type="checkbox"
                checked={inclureMagasin}
                onChange={(e) => setInclureMagasin(e.target.checked)}
              />
              Inclure MAGASIN (comptoir)
            </label>
          </div>

          <section className="stc-table-card">
            <div className="stc-table-wrap">
              <table className="stc-table">
                <thead>
                  <tr>
                    <th className="gauche">Commercial</th>
                    <th>CA N</th>
                    <th>CA N-1</th>
                    <th>Évol.</th>
                    <th>Part CA</th>
                    <th>Marge</th>
                    <th>Taux</th>
                    <th>Factures</th>
                    <th>Panier moyen</th>
                    <th>Clients actifs</th>
                    <th>Nouveaux</th>
                    <th>Perdus</th>
                  </tr>
                </thead>
                <tbody>
                  {commerciauxVue.map((c) => (
                    <tr key={c.nom}>
                      <td className="gauche">
                        <span
                          className="stc-dot"
                          style={{ background: serieColor(commerciaux.indexOf(c)) }}
                        />
                        {c.nom}
                      </td>
                      <td>{fmtNb(c.caN)}</td>
                      <td>{fmtNb(c.caN1)}</td>
                      <td className={evolClass(c.evolCaPct)}>{fmtEvol(c.evolCaPct)}</td>
                      <td>{fmtTaux(c.partCaPct)}</td>
                      <td>{fmtNb(c.margeN)}</td>
                      <td>{fmtTaux(c.tauxMargeN)}</td>
                      <td>{fmtNb(c.nbFactures)}</td>
                      <td>{fmtNb(c.panierMoyen)}</td>
                      <td>{fmtNb(c.clientsActifs)}</td>
                      <td className="pos">{fmtNb(c.nouveaux)}</td>
                      <td className="neg">{fmtNb(c.perdus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="stc-charts">
            <div className="stc-chart-card stc-chart-wide">
              <h3 className="stc-chart-title">CA par commercial — N vs N-1</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartCommerciaux}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                  <XAxis dataKey="nom" fontSize={11} stroke={CH.axe} />
                  <YAxis fontSize={11} stroke={CH.axe} tickFormatter={fmtCompact} width={48} />
                  <Tooltip content={<StcTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar dataKey="caN1" name="CA N-1" fill={CH.caN1} />
                  <Bar dataKey="caN" name="CA N" fill={CH.caN} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="stc-chart-card">
              <h3 className="stc-chart-title">Part du CA par commercial</h3>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={donutCommerciaux}
                    dataKey="caN"
                    nameKey="nom"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    innerRadius={45}
                    paddingAngle={2}
                  >
                    {donutCommerciaux.map((c) => (
                      <Cell key={c.nom} fill={serieColor(commerciaux.indexOf(c))} />
                    ))}
                  </Pie>
                  <Tooltip content={<StcTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* ── 3 · Évolution mensuelle + catégories ── */}
          <div className="stc-section-head">
            <h2 className="stc-section-titre">Évolution mensuelle</h2>
            <div className="stc-switch">
              <button
                type="button"
                className={metriqueMois === "ca" ? "actif" : ""}
                onClick={() => setMetriqueMois("ca")}
              >
                CA HT
              </button>
              <button
                type="button"
                className={metriqueMois === "marge" ? "actif" : ""}
                onClick={() => setMetriqueMois("marge")}
              >
                Marge
              </button>
            </div>
          </div>

          <section className="stc-charts">
            <div className="stc-chart-card stc-chart-wide">
              <h3 className="stc-chart-title">
                {metriqueMois === "ca" ? "CA HT" : "Marge"} mensuel par commercial
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartMois}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                  <XAxis dataKey="mois" fontSize={11} stroke={CH.axe} />
                  <YAxis fontSize={11} stroke={CH.axe} tickFormatter={fmtCompact} width={48} />
                  <Tooltip content={<StcTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  {commerciauxVue.map((c) => (
                    <Bar
                      key={c.nom}
                      dataKey={c.nom}
                      stackId="mois"
                      name={c.nom}
                      fill={serieColor(commerciaux.indexOf(c))}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="stc-chart-card">
              <h3 className="stc-chart-title">Taux de marge mensuel (société)</h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartMois}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                  <XAxis dataKey="mois" fontSize={11} stroke={CH.axe} />
                  <YAxis
                    fontSize={11}
                    stroke={CH.axe}
                    tickFormatter={(v) => `${v} %`}
                    width={48}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip content={<StcTooltip pct />} />
                  <Line
                    type="monotone"
                    dataKey="tauxSociete"
                    name="Taux de marge"
                    stroke={CH.marge}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="stc-charts">
            <div className="stc-chart-card">
              <h3 className="stc-chart-title">CA par catégorie de client</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={categories}
                    dataKey="caN"
                    nameKey="nom"
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    innerRadius={42}
                    paddingAngle={2}
                  >
                    {categories.map((c, i) => (
                      <Cell key={c.nom} fill={serieColor(i)} />
                    ))}
                  </Pie>
                  <Tooltip content={<StcTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="stc-chart-card stc-chart-wide">
              <h3 className="stc-chart-title">Catégories — CA, évolution et marge</h3>
              <div className="stc-table-wrap" style={{ border: "none" }}>
                <table className="stc-table">
                  <thead>
                    <tr>
                      <th className="gauche">Catégorie</th>
                      <th>CA N</th>
                      <th>CA N-1</th>
                      <th>Évol.</th>
                      <th>Marge</th>
                      <th>Taux</th>
                      <th>Clients</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c, i) => {
                      const evol = c.caN1
                        ? Math.round(((c.caN - c.caN1) / Math.abs(c.caN1)) * 1000) / 10
                        : null;
                      return (
                        <tr key={c.nom}>
                          <td className="gauche">
                            <span className="stc-dot" style={{ background: serieColor(i) }} />
                            {c.nom}
                          </td>
                          <td className={c.caN < 0 ? "neg" : ""}>{fmtNb(c.caN)}</td>
                          <td>{fmtNb(c.caN1)}</td>
                          <td className={evolClass(evol)}>{fmtEvol(evol)}</td>
                          <td className={c.margeN < 0 ? "neg" : ""}>{fmtNb(c.margeN)}</td>
                          <td>{fmtTaux(c.caN ? Math.round((c.margeN / c.caN) * 1000) / 10 : null)}</td>
                          <td>{fmtNb(c.nbClients)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {/* ── 4 · Portefeuille — sélection MULTIPLE de commerciaux ── */}
          <div className="stc-section-head">
            <h2 className="stc-section-titre">Portefeuille clients</h2>
            <div className="stc-com-chips">
              <button
                type="button"
                className={`stc-com-chip ${selCommerciaux.length === 0 ? "on" : ""}`}
                onClick={() => setSelCommerciaux([])}
              >
                Toute la société
              </button>
              <button
                type="button"
                className={`stc-com-chip ${
                  selCommerciaux.length > 0 &&
                  selCommerciaux.length ===
                    commerciaux.filter((c) => c.nom !== "MAGASIN").length &&
                  !selCommerciaux.includes("MAGASIN")
                    ? "on"
                    : ""
                }`}
                onClick={() =>
                  setSelCommerciaux(
                    commerciaux.filter((c) => c.nom !== "MAGASIN").map((c) => c.nom),
                  )
                }
                title="Tous les commerciaux, ventes comptoir exclues"
              >
                Tous sauf MAGASIN
              </button>
              {commerciaux.map((c) => (
                <button
                  key={c.nom}
                  type="button"
                  className={`stc-com-chip ${selCommerciaux.includes(c.nom) ? "on" : ""}`}
                  onClick={() =>
                    setSelCommerciaux((prev) =>
                      prev.includes(c.nom)
                        ? prev.filter((n) => n !== c.nom)
                        : [...prev, c.nom],
                    )
                  }
                >
                  {c.nom}
                </button>
              ))}
            </div>
          </div>

          <PortefeuilleCommercial
            key={`${globalDossier}-${selCommerciaux.join(",") || "GLOBAL"}`}
            dossier={globalDossier}
            commercial={selCommerciaux.length ? selCommerciaux.join(",") : "GLOBAL"}
          />
        </>
      )}
    </div>
  );
};

export default AdminStatsCommerciauxScreen;
