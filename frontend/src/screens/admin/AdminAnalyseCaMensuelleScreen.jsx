// src/screens/admin/AdminAnalyseCaMensuelleScreen.jsx
//
// ANALYSE CA MENSUELLE : restitue INTÉGRALEMENT les classeurs Excel déposés
// chaque mois sur le Rcommun (STOCK/doc_temp/CA_MENSUELLE), un par société —
// un onglet d'écran par feuille du classeur (Types de client, Clients,
// Fournisseurs, Classes, Sous-classes, Locates, Groupes, Familles,
// Sous-familles, Rayons, Clients internes). Les feuilles sont volumineuses
// (4 000+ lignes côté Clients chez QC) : recherche, tri par colonne et
// pagination, lignes TOTAL épinglées en bas.
//
// La société suit la sélection GLOBALE du header ; les pourcentages arrivent
// déjà normalisés en 0–100 par le backend.

import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  useGetAnalyseCaMensuelleSourcesQuery,
  useGetAnalyseCaMensuelleClasseurQuery,
  useResoudreNartsMensuelleQuery,
} from "../../slices/analyseCaMensuelleApiSlice";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  PieChart,
  Pie,
} from "recharts";
import { fmtNombreLarge } from "../../utils/format";
import { BASE_URL } from "../../constants";
import "./AdminAnalyseCaMensuelleScreen.css";

const PAGE_SIZE = 100;

// Libellés d'onglet plus lisibles que les noms de feuille Excel.
const LABELS_FEUILLES = {
  TYPES_CLIENT: "Types de client",
  Client: "Clients",
  Fournisseurs: "Fournisseurs",
  Classes: "Classes",
  Sous_Classes: "Sous-classes",
  Locates: "Locates",
  Groupes: "Groupes",
  Familles: "Familles",
  Sous_Familles: "Sous-familles",
  Rayons: "Rayons",
  Client_Interne: "Clients internes",
  Promos: "Promos",
  Detail_Promos: "Détail promos",
};

// Ligne « en pour-cent » d'une feuille à métriques en lignes : TYPES_CLIENT
// (métrique en colonne 2, valeurs en RATIO normalisées par le backend) et
// Promos (métrique en colonne 1, valeurs DÉJÀ en pour-cent).
const estLignePct = (feuille, l) => {
  if (feuille.nom === "TYPES_CLIENT") return /%/.test(String(l[1] ?? ""));
  if (feuille.nom === "Promos") return /%|taux/i.test(String(l[0] ?? ""));
  return false;
};

// Ligne de SECTION (« ▌ INDICATEURS… ») : seule la 1re cellule est remplie.
const estLigneSection = (l) =>
  typeof l[0] === "string" &&
  l[0].startsWith("▌") &&
  l.slice(1).every((v) => v === null || v === "");

// ── Couleurs des graphiques (thème sombre de l'admin) ──
const CH = {
  grille: "#2a2a3a",
  axe: "#a7a7b8",
  caN: "#4da6ff",
  caN1: "#4a5570",
  hausse: "#10b981",
  baisse: "#ef4444",
  depreciation: "#f59e0b",
};

// Couleur FIXE par type de client (jamais réaffectée selon le rang).
const TYPE_COLORS = {
  PARTICULIER: "#4da6ff",
  FIDELITE: "#34d399",
  "PRO COMPTANT": "#fbbf24",
  "PRO DEBIT": "#fb7185",
  REVENDEUR: "#2dd4bf",
  GROUPE: "#c084fc",
  ADMINISTRATION: "#94a3b8",
  AGRICULTEUR: "#a3e635",
  EMPLOYE: "#f97316",
  AUTRE: "#f472b6",
};
const PALETTE_SECOURS = ["#60a5fa", "#fb923c", "#818cf8", "#e879f9", "#4ade80"];
const typeColor = (nom, i) =>
  TYPE_COLORS[nom] || PALETTE_SECOURS[i % PALETTE_SECOURS.length];

// ── Formats ──
// Milliers séparés par une espace LARGE et montants XPF toujours entiers
// (dec=0 par défaut) — lisibilité des tableaux, demande client du 29/10/2026.
const fmtNb = (n, dec = 0) => fmtNombreLarge(n, dec);
const fmtPct = (n) => `${fmtNb(n, 1)} %`;
const fmtEvol = (n) =>
  typeof n === "number" ? `${n > 0 ? "+" : ""}${fmtNb(n, 1)} %` : "—";
const evolClass = (n) => (typeof n !== "number" ? "" : n >= 0 ? "pos" : "neg");
const fmtCompact = (n) => {
  if (typeof n !== "number") return "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)} Md`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (abs >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
};
const tronque = (s, n = 24) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// Tooltip recharts en XPF complet.
const XpfTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="acm-tooltip">
      {label != null && <div className="acm-tooltip-label">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="acm-tooltip-row">
          <span className="acm-tooltip-dot" style={{ background: p.color || p.payload?.fill }} />
          {p.name} :{" "}
          <strong>
            {typeof p.value === "number" ? `${fmtNb(p.value)} XPF` : p.value}
          </strong>
        </div>
      ))}
    </div>
  );
};

const sansAccents = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// "2026-09" -> "Septembre 2026"
const MOIS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const labelPeriode = (p) => {
  const [a, m] = String(p).split("-");
  return `${MOIS_FR[Number(m) - 1] || m} ${a}`;
};

// Une ligne TOTAL ? Se reconnaît à sa PREMIÈRE colonne : les lignes de données
// y portent un numéro (#/Rang) — un client « TOTAL ENERGIES… » (colonne 2)
// n'est PAS un total. Cas Detail_Promos : 1re colonne VIDE et « TOTAL » en
// colonne 2 — accepté uniquement quand la 1re colonne est vide.
const estLigneTotal = (l) =>
  (typeof l[0] === "string" && /^TOTAL/i.test(l[0].trim())) ||
  ((l[0] === null || l[0] === "") &&
    typeof l[1] === "string" &&
    /^TOTAL/i.test(l[1].trim()));

// Formatage d'une cellule selon la colonne (et la ligne pour TYPES_CLIENT).
// Un pourcentage d'ÉVOLUTION (Évol., R/H) se colore vert/rouge ; un taux ou
// une part reste neutre.
function Cellule({ valeur, colonne, pct, colore }) {
  if (valeur === null || valeur === undefined || valeur === "") {
    return <>—</>;
  }
  if (typeof valeur !== "number") return <>{String(valeur)}</>;

  if (colonne.format === "pct" || pct) {
    const colorer = colore || /evol|r\/h/.test(sansAccents(colonne.label));
    return colorer ? (
      <span className={valeur < 0 ? "neg" : "pos"}>{fmtPct(valeur)}</span>
    ) : (
      <>{fmtPct(valeur)}</>
    );
  }
  if (/\(XPF\)/i.test(colonne.label)) {
    return <span className={valeur < 0 ? "neg" : ""}>{fmtNb(valeur)}</span>;
  }
  // Nombre générique : 2 décimales maxi (NUC, prix moyens…).
  return <>{fmtNb(valeur, 2)}</>;
}

// ── Graphiques par feuille ──────────────────────────────────────────────────

// Index de la colonne dont l'en-tête (normalisé sans accents) satisfait le motif.
const idxCol = (feuille, motif) =>
  feuille.colonnes.findIndex((c) => motif.test(sansAccents(c.label)));

// Feuilles « classement » (une ligne par entité, CA N / CA N-1) et l'index de
// leur colonne libellé.
const FEUILLES_CLASSEES = {
  Client: 1,
  Fournisseurs: 1,
  Classes: 2,
  Sous_Classes: 2,
  Locates: 2,
  Groupes: 1,
  Familles: 1,
  Sous_Familles: 1,
  Detail_Promos: 1, // articles en promotion du mois (pas de N-1)
};

const donneesFeuille = (feuille) =>
  feuille.lignes.filter((l) => !estLigneTotal(l));

// Unité d'affichage d'une métrique TYPES_CLIENT.
const uniteMetriqueTC = (m) =>
  /%/.test(m) ? "pct" : /panier|^ca$|^marge$/i.test(m) ? "xpf" : "nb";

// Les métriques qui s'EMPILENT (des volumes) ; les autres (taux, moyennes)
// se tracent en courbes — empiler des paniers moyens n'a aucun sens.
const METRIQUES_EMPILABLES = new Set(["CA", "Marge", "NB Factures"]);

// Prépare les jeux de données des graphiques de la feuille active.
// opts : { metriqueTC, iTri, topN } — les CONTRÔLES dynamiques de l'écran.
function construireGraphes(feuille, opts = {}) {
  const lignes = donneesFeuille(feuille);
  if (lignes.length < 2) return null;

  // TYPES_CLIENT : métrique COMMUTABLE (CA, Marge, Marge %, NB Factures,
  // Panier Moyen, NUC, R/H…) × type de client, par mois + cumul.
  if (feuille.nom === "TYPES_CLIENT") {
    const iCumul = idxCol(feuille, /^cumul$/);
    if (iCumul === -1) return null;
    const metriques = [...new Set(lignes.map((l) => l[1]).filter(Boolean))];
    const metrique = metriques.includes(opts.metriqueTC)
      ? opts.metriqueTC
      : "CA";
    const lignesM = lignes.filter((l) => l[1] === metrique);
    const types = lignesM.map((l) => l[0]);
    const serie = feuille.colonnes
      .map((c, i) => ({ label: c.label, i }))
      .filter(({ i }) => i >= 2 && i !== iCumul)
      .map(({ label, i }) => {
        const point = { mois: label };
        lignesM.forEach((l) => {
          point[l[0]] = typeof l[i] === "number" ? l[i] : 0;
        });
        return point;
      })
      .filter((p) => types.some((t) => p[t]));
    const cumulParType = lignesM.map((l) => ({
      nom: l[0],
      valeur: typeof l[iCumul] === "number" ? l[iCumul] : 0,
    }));
    const donut = cumulParType.filter((d) => d.valeur > 0);
    return {
      type: "typesClient",
      metrique,
      metriques,
      unite: uniteMetriqueTC(metrique),
      empilable: METRIQUES_EMPILABLES.has(metrique),
      serie,
      types,
      cumulParType,
      donut,
    };
  }

  // Feuilles de classement : Top N selon la colonne CHOISIE + plus fortes
  // variations de CA (Δ N vs N-1).
  if (feuille.nom in FEUILLES_CLASSEES) {
    const iLabel = FEUILLES_CLASSEES[feuille.nom];
    // "CA N (XPF)" sur les feuilles historiques, "CA (XPF)" sur Detail_Promos.
    const iCaN = idxCol(feuille, /^ca (n )?\(xpf\)/);
    const iCaN1 = idxCol(feuille, /^ca n-1 \(xpf\)/);
    if (iCaN === -1) return null;

    // Colonnes numériques proposées au classement (hors rangs et codes).
    const colonnesTri = feuille.colonnes
      .map((c, i) => ({ ...c, i }))
      .filter(
        ({ label, i }) =>
          i !== iLabel &&
          !/^(#|rang|code|four\b)/.test(sansAccents(label)) &&
          lignes.some((l) => typeof l[i] === "number"),
      );
    const iTri =
      colonnesTri.some((c) => c.i === opts.iTri) ? opts.iTri : iCaN;
    const colTri = feuille.colonnes[iTri];
    const topN = opts.topN || 15;

    const valides = lignes.filter((l) => typeof l[iTri] === "number");
    const top = [...valides]
      .sort((a, b) => b[iTri] - a[iTri])
      .slice(0, topN)
      .map((l) => ({
        nom: tronque(l[iLabel]),
        valeur: l[iTri],
        caN1:
          iTri === iCaN && iCaN1 !== -1 && typeof l[iCaN1] === "number"
            ? l[iCaN1]
            : null,
      }));

    let deltas = [];
    if (iCaN1 !== -1) {
      const tries = lignes
        .filter(
          (l) => typeof l[iCaN] === "number" && typeof l[iCaN1] === "number",
        )
        .map((l) => ({ nom: tronque(l[iLabel]), delta: l[iCaN] - l[iCaN1] }))
        .sort((a, b) => b.delta - a.delta);
      const moitie = Math.min(Math.ceil(topN / 2), 10);
      // plus fortes hausses + plus fortes baisses (sans doublon si peu de lignes).
      deltas = [...tries.slice(0, moitie), ...tries.slice(-moitie)].filter(
        (d, i, arr) => arr.findIndex((x) => x.nom === d.nom) === i,
      );
    }
    return {
      type: "classement",
      top,
      deltas,
      colonnesTri,
      iTri,
      topN,
      colTri,
      avecN1: iTri === iCaN && iCaN1 !== -1,
    };
  }

  // Promos : métriques en LIGNES (libellés colonne A), mois en colonnes.
  // Les lignes % sont DÉJÀ en pour-cent dans le fichier.
  if (feuille.nom === "Promos") {
    // ⚠️ les libellés du fichier ont des espaces de tête ("  CA réalisé…").
    const chercher = (re) =>
      lignes.find((l) => re.test(sansAccents(String(l[0] ?? "").trim())));
    const ca = chercher(/^ca realise promo/);
    const marge = chercher(/^marge promo/);
    const pctMarge = chercher(/^% marge promo/);
    const partCa = chercher(/^% ca promo/);
    const nbArticles = chercher(/^nb articles en promo/);
    const nbUnites = chercher(/^nb unites vendues/);
    if (!ca) return null;
    const mois = feuille.colonnes
      .map((c, i) => ({ colLabel: c.label, i }))
      .filter(({ colLabel, i }) => i > 0 && !/^total$/i.test(colLabel))
      .map(({ colLabel, i }) => ({
        label: colLabel.slice(0, 4),
        ca: typeof ca[i] === "number" ? ca[i] : 0,
        marge: typeof marge?.[i] === "number" ? marge[i] : 0,
        pctMarge: typeof pctMarge?.[i] === "number" ? pctMarge[i] : null,
        partCa: typeof partCa?.[i] === "number" ? partCa[i] : null,
        nbArticles: typeof nbArticles?.[i] === "number" ? nbArticles[i] : 0,
        nbUnites: typeof nbUnites?.[i] === "number" ? nbUnites[i] : 0,
      }));
    return { type: "promos", mois };
  }

  // Rayons : top CA + plus fortes valeurs de dépréciation.
  if (feuille.nom === "Rayons") {
    const iCa = idxCol(feuille, /^ca$/);
    const iDeprec = idxCol(feuille, /^valeur_deprec$/);
    if (iCa === -1) return null;
    const avecCa = lignes.filter((l) => typeof l[iCa] === "number");
    const top = [...avecCa]
      .sort((a, b) => b[iCa] - a[iCa])
      .slice(0, 15)
      .map((l) => ({ nom: tronque(l[0]), ca: l[iCa] }));
    const deprec =
      iDeprec === -1
        ? []
        : [...avecCa]
            .filter((l) => typeof l[iDeprec] === "number" && l[iDeprec] > 0)
            .sort((a, b) => b[iDeprec] - a[iDeprec])
            .slice(0, 10)
            .map((l) => ({ nom: tronque(l[0]), valeur: l[iDeprec] }));
    return { type: "rayons", top, deprec };
  }

  // Clients internes : CA N vs N-1 par compte.
  if (feuille.nom === "Client_Interne") {
    const iCaN = idxCol(feuille, /^ca n \(xpf\)/);
    const iCaN1 = idxCol(feuille, /^ca n-1 \(xpf\)/);
    if (iCaN === -1) return null;
    const comptes = lignes
      .filter((l) => typeof l[iCaN] === "number")
      .map((l) => ({
        nom: tronque(l[2], 18),
        caN: l[iCaN],
        caN1: iCaN1 !== -1 && typeof l[iCaN1] === "number" ? l[iCaN1] : 0,
      }));
    return { type: "interne", comptes };
  }

  return null;
}

// Hauteur d'un graphique à barres horizontales selon le nombre de lignes.
const hBarres = (n) => Math.max(180, n * 28 + 70);

// Tooltip selon l'unité de la métrique affichée.
const fmtUnite = (unite, v) => {
  if (typeof v !== "number") return "—";
  if (unite === "pct") return fmtPct(v);
  if (unite === "xpf") return `${fmtNb(v)} XPF`;
  return fmtNb(v, 2);
};
const ValTooltip = ({ active, payload, label, unite = "xpf" }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="acm-tooltip">
      {label != null && <div className="acm-tooltip-label">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="acm-tooltip-row">
          <span
            className="acm-tooltip-dot"
            style={{ background: p.color || p.stroke || p.payload?.fill }}
          />
          {p.name} : <strong>{fmtUnite(unite, p.value)}</strong>
        </div>
      ))}
    </div>
  );
};

// Les graphiques de la feuille active, au-dessus du tableau — avec des
// CONTRÔLES dynamiques : métrique commutable (Types de client), colonne de
// classement + taille du Top (feuilles de classement). L'état est local au
// composant et repart à zéro quand on change d'onglet (prop `key`).
const GraphiquesFeuille = ({ feuille }) => {
  const [metriqueTC, setMetriqueTC] = useState("CA");
  const [iTri, setITri] = useState(null);
  const [topN, setTopN] = useState(15);

  const g = useMemo(
    () => construireGraphes(feuille, { metriqueTC, iTri, topN }),
    [feuille, metriqueTC, iTri, topN],
  );
  if (!g) return null;

  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
    </>
  );

  if (g.type === "typesClient") {
    return (
      <>
        {/* Sélecteur de métrique : pilote les trois graphiques. */}
        <div className="acm-chips">
          {g.metriques.map((m) => (
            <button
              key={m}
              type="button"
              className={`acm-chip ${g.metrique === m ? "actif" : ""}`}
              onClick={() => setMetriqueTC(m)}
            >
              {m}
            </button>
          ))}
        </div>

        <section className="acm-charts">
          <div className="acm-chart-card acm-chart-wide">
            <h3 className="acm-chart-title">
              {g.metrique} par type de client — mensuel
              {g.empilable ? " (empilé)" : ""}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              {g.empilable ? (
                <BarChart data={g.serie}>
                  {axes}
                  <XAxis dataKey="mois" fontSize={11} stroke={CH.axe} />
                  <YAxis
                    fontSize={11}
                    stroke={CH.axe}
                    tickFormatter={fmtCompact}
                    width={52}
                  />
                  <Tooltip content={<ValTooltip unite={g.unite} />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  {g.types.map((t, i) => (
                    <Bar
                      key={t}
                      dataKey={t}
                      stackId="types"
                      name={t}
                      fill={typeColor(t, i)}
                    />
                  ))}
                </BarChart>
              ) : (
                <LineChart data={g.serie}>
                  {axes}
                  <XAxis dataKey="mois" fontSize={11} stroke={CH.axe} />
                  <YAxis
                    fontSize={11}
                    stroke={CH.axe}
                    tickFormatter={
                      g.unite === "pct" ? (v) => `${v} %` : fmtCompact
                    }
                    width={g.unite === "pct" ? 56 : 52}
                  />
                  <Tooltip content={<ValTooltip unite={g.unite} />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  {g.types.map((t, i) => (
                    <Line
                      key={t}
                      type="monotone"
                      dataKey={t}
                      name={t}
                      stroke={typeColor(t, i)}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>

          {g.empilable && g.donut.length > 0 && (
            <div className="acm-chart-card">
              <h3 className="acm-chart-title">
                Répartition — {g.metrique} cumulé
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={g.donut}
                    dataKey="valeur"
                    nameKey="nom"
                    cx="50%"
                    cy="50%"
                    outerRadius={95}
                    innerRadius={48}
                    paddingAngle={2}
                  >
                    {g.donut.map((d, i) => (
                      <Cell key={d.nom} fill={typeColor(d.nom, i)} />
                    ))}
                  </Pie>
                  <Tooltip content={<ValTooltip unite={g.unite} />} />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="acm-chart-card">
            <h3 className="acm-chart-title">
              {g.metrique} cumulé par type
            </h3>
            <ResponsiveContainer
              width="100%"
              height={hBarres(g.cumulParType.length)}
            >
              <BarChart
                data={g.cumulParType}
                layout="vertical"
                margin={{ left: 8, right: 16 }}
              >
                {axes}
                <XAxis
                  type="number"
                  fontSize={10}
                  stroke={CH.axe}
                  tickFormatter={
                    g.unite === "pct" ? (v) => `${v} %` : fmtCompact
                  }
                />
                <YAxis
                  type="category"
                  dataKey="nom"
                  width={130}
                  fontSize={10}
                  stroke={CH.axe}
                />
                <Tooltip content={<ValTooltip unite={g.unite} />} />
                <Bar dataKey="valeur" name={g.metrique} radius={[0, 3, 3, 0]}>
                  {g.cumulParType.map((d, i) => (
                    <Cell key={d.nom} fill={typeColor(d.nom, i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </>
    );
  }

  if (g.type === "classement") {
    const uniteTri = g.colTri?.format === "pct"
      ? "pct"
      : /\(xpf\)/.test(sansAccents(g.colTri?.label || ""))
        ? "xpf"
        : "nb";
    const tickTri = uniteTri === "pct" ? (v) => `${v} %` : fmtCompact;
    return (
      <>
        {/* Contrôles dynamiques : colonne de classement + taille du Top. */}
        <div className="acm-chart-controls">
          <label className="acm-field">
            Classer par
            <select
              value={g.iTri}
              onChange={(e) => setITri(Number(e.target.value))}
            >
              {g.colonnesTri.map((c) => (
                <option key={c.i} value={c.i}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="acm-field">
            Top
            <select value={g.topN} onChange={(e) => setTopN(Number(e.target.value))}>
              {[10, 15, 25, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="acm-charts">
          <div className={`acm-chart-card ${g.deltas.length ? "" : "acm-chart-wide"}`}>
            <h3 className="acm-chart-title">
              Top {g.topN} — {g.colTri?.label}
              {g.avecN1 ? " (N vs N-1)" : ""}
            </h3>
            <ResponsiveContainer width="100%" height={hBarres(g.top.length)}>
              <BarChart data={g.top} layout="vertical" margin={{ left: 8, right: 16 }}>
                {axes}
                <XAxis type="number" fontSize={10} stroke={CH.axe} tickFormatter={tickTri} />
                <YAxis type="category" dataKey="nom" width={170} fontSize={10} stroke={CH.axe} />
                <Tooltip content={<ValTooltip unite={uniteTri} />} />
                {g.avecN1 && <Legend wrapperStyle={{ fontSize: "11px" }} />}
                {g.avecN1 && (
                  <Bar dataKey="caN1" name="CA N-1" fill={CH.caN1} radius={[0, 3, 3, 0]} />
                )}
                <Bar
                  dataKey="valeur"
                  name={g.colTri?.label}
                  fill={CH.caN}
                  radius={[0, 3, 3, 0]}
                >
                  {!g.avecN1 &&
                    uniteTri === "pct" &&
                    g.top.map((d) => (
                      <Cell
                        key={d.nom}
                        fill={d.valeur >= 0 ? CH.hausse : CH.baisse}
                      />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {g.deltas.length > 0 && (
            <div className="acm-chart-card">
              <h3 className="acm-chart-title">Plus fortes variations de CA (Δ N vs N-1)</h3>
              <ResponsiveContainer width="100%" height={hBarres(g.deltas.length)}>
                <BarChart data={g.deltas} layout="vertical" margin={{ left: 8, right: 16 }}>
                  {axes}
                  <XAxis type="number" fontSize={10} stroke={CH.axe} tickFormatter={fmtCompact} />
                  <YAxis type="category" dataKey="nom" width={170} fontSize={10} stroke={CH.axe} />
                  <ReferenceLine x={0} stroke={CH.axe} />
                  <Tooltip content={<XpfTooltip />} />
                  <Bar dataKey="delta" name="Δ CA" radius={[0, 3, 3, 0]}>
                    {g.deltas.map((d) => (
                      <Cell key={d.nom} fill={d.delta >= 0 ? CH.hausse : CH.baisse} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </>
    );
  }

  if (g.type === "promos") {
    return (
      <section className="acm-charts">
        <div className="acm-chart-card acm-chart-wide">
          <h3 className="acm-chart-title">CA et marge des promotions par mois</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={g.mois}>
              {axes}
              <XAxis dataKey="label" fontSize={11} stroke={CH.axe} />
              <YAxis fontSize={11} stroke={CH.axe} tickFormatter={fmtCompact} width={52} />
              <Tooltip content={<ValTooltip unite="xpf" />} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <Bar dataKey="ca" name="CA promo" fill={CH.caN} radius={[3, 3, 0, 0]} />
              <Bar dataKey="marge" name="Marge promo" fill={CH.hausse} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="acm-chart-card">
          <h3 className="acm-chart-title">% marge promo · part du CA total</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={g.mois}>
              {axes}
              <XAxis dataKey="label" fontSize={10} stroke={CH.axe} />
              <YAxis fontSize={10} stroke={CH.axe} tickFormatter={(v) => `${v} %`} width={52} />
              <Tooltip content={<ValTooltip unite="pct" />} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <Line type="monotone" dataKey="pctMarge" name="% marge promo" stroke={CH.depreciation} strokeWidth={2} dot={false} connectNulls />
              <Line type="monotone" dataKey="partCa" name="% CA promo / CA total" stroke={CH.caN} strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="acm-chart-card">
          <h3 className="acm-chart-title">Volumes promo (articles · unités vendues)</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={g.mois}>
              {axes}
              <XAxis dataKey="label" fontSize={10} stroke={CH.axe} />
              <YAxis fontSize={10} stroke={CH.axe} tickFormatter={fmtCompact} width={48} />
              <Tooltip content={<ValTooltip unite="nb" />} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <Bar dataKey="nbArticles" name="Articles en promo" fill={CH.caN1} radius={[3, 3, 0, 0]} />
              <Bar dataKey="nbUnites" name="Unités vendues" fill="#c084fc" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    );
  }

  if (g.type === "rayons") {
    return (
      <section className="acm-charts">
        <div className={`acm-chart-card ${g.deprec.length ? "" : "acm-chart-wide"}`}>
          <h3 className="acm-chart-title">Top 15 rayons par CA HT</h3>
          <ResponsiveContainer width="100%" height={hBarres(g.top.length)}>
            <BarChart data={g.top} layout="vertical" margin={{ left: 8, right: 16 }}>
              {axes}
              <XAxis type="number" fontSize={10} stroke={CH.axe} tickFormatter={fmtCompact} />
              <YAxis type="category" dataKey="nom" width={170} fontSize={10} stroke={CH.axe} />
              <Tooltip content={<XpfTooltip />} />
              <Bar dataKey="ca" name="CA" fill={CH.caN} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {g.deprec.length > 0 && (
          <div className="acm-chart-card">
            <h3 className="acm-chart-title">Top 10 valeur de dépréciation</h3>
            <ResponsiveContainer width="100%" height={hBarres(g.deprec.length)}>
              <BarChart data={g.deprec} layout="vertical" margin={{ left: 8, right: 16 }}>
                {axes}
                <XAxis type="number" fontSize={10} stroke={CH.axe} tickFormatter={fmtCompact} />
                <YAxis type="category" dataKey="nom" width={170} fontSize={10} stroke={CH.axe} />
                <Tooltip content={<XpfTooltip />} />
                <Bar dataKey="valeur" name="Dépréciation" fill={CH.depreciation} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    );
  }

  if (g.type === "interne") {
    return (
      <section className="acm-charts">
        <div className="acm-chart-card acm-chart-wide">
          <h3 className="acm-chart-title">Comptes internes — CA N vs N-1</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={g.comptes}>
              {axes}
              <XAxis dataKey="nom" fontSize={10} stroke={CH.axe} interval={0} angle={-20} textAnchor="end" height={70} />
              <YAxis fontSize={11} stroke={CH.axe} tickFormatter={fmtCompact} width={52} />
              <Tooltip content={<XpfTooltip />} />
              <Legend wrapperStyle={{ fontSize: "11px" }} />
              <Bar dataKey="caN1" name="CA N-1" fill={CH.caN1} radius={[3, 3, 0, 0]} />
              <Bar dataKey="caN" name="CA N" fill={CH.caN} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    );
  }

  return null;
};

// ── Vue dédiée de l'onglet PROMOS ───────────────────────────────────────────
// Le rendu générique (14 colonnes de tableur, métriques en vrac) est illisible :
// on recompose la feuille en KPI annuels + tableau d'indicateurs formaté par
// ligne (XPF / % / nb) + top 3 articles PAR MOIS.

// "27/08/2026" -> Date (ou null).
const dateFr = (s) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s ?? "").trim());
  return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
};

// Déstockage = plage début→fin strictement supérieure à 2 mois.
const estDestockage = (debut, fin) => {
  const d = dateFr(debut);
  const f = dateFr(fin);
  if (!d || !f) return false;
  const limite = new Date(d);
  limite.setMonth(limite.getMonth() + 2);
  return f > limite;
};

const PromosVue = ({ feuille, nomDossierDBF }) => {
  const donnees = useMemo(() => {
    const lignes = donneesFeuille(feuille).filter((l) => !estLigneSection(l));
    // ⚠️ les libellés du fichier ont des espaces de tête ("  CA réalisé…").
    const chercher = (re) =>
      lignes.find((l) => re.test(sansAccents(String(l[0] ?? "").trim())));

    const iTotal = feuille.colonnes.findIndex((c) => /^total$/i.test(c.label));
    const mois = feuille.colonnes
      .map((c, i) => ({ label: c.label, i }))
      .filter(({ label, i }) => i > 0 && i !== iTotal && label);

    const indicateurs = [
      { label: "CA promo", unite: "xpf", l: chercher(/^ca realise promo/) },
      { label: "Marge promo", unite: "xpf", l: chercher(/^marge promo/) },
      { label: "% marge promo", unite: "pct", l: chercher(/^% marge promo/) },
      { label: "Part du CA total", unite: "pct", l: chercher(/^% ca promo/) },
      { label: "Taux de transformation", unite: "pct", l: chercher(/^taux de transfo/) },
      { label: "Panier moyen promo", unite: "xpf", l: chercher(/^panier moyen promo/) },
      { label: "Articles en promo", unite: "nb", l: chercher(/^nb articles en promo/) },
      { label: "Unités vendues", unite: "nb", l: chercher(/^nb unites vendues/) },
    ].filter((m) => m.l);

    // Top 3 par rang : lignes "#k Article" / "#k CA (XPF)" / "#k Qté vendue".
    const top3 = [1, 2, 3]
      .map((k) => ({
        article: chercher(new RegExp(`^#${k}\\s+article`)),
        ca: chercher(new RegExp(`^#${k}\\s+ca`)),
        qte: chercher(new RegExp(`^#${k}\\s+qte`)),
      }))
      .filter((t) => t.article);

    const kpi = (re, defaut = null) => {
      const l = chercher(re);
      const v = l && iTotal !== -1 ? l[iTotal] : null;
      return typeof v === "number" ? v : defaut;
    };

    return {
      mois,
      iTotal,
      indicateurs,
      top3,
      kpis: {
        ca: kpi(/^ca realise promo/),
        marge: kpi(/^marge promo/),
        pctMarge: kpi(/^% marge promo/),
        unites: kpi(/^nb unites vendues/),
        panier: kpi(/^panier moyen promo/),
      },
    };
  }, [feuille]);

  const { mois, iTotal, indicateurs, top3, kpis } = donnees;
  const fmtCell = (unite, v) =>
    typeof v !== "number" || v === 0 ? "—" : fmtUnite(unite, v);

  // NART des articles du Top 3 (le classeur ne porte que les désignations) :
  // résolus en un lot côté serveur, pour rendre chaque article CLIQUABLE vers
  // sa fiche article (ouverte dans une autre fenêtre).
  const designationsTop3 = useMemo(() => {
    const set = new Set();
    for (const t of top3) {
      for (const v of t.article || []) {
        const nom = String(v ?? "").trim();
        if (nom && nom !== "—") set.add(nom);
      }
    }
    return [...set].sort();
  }, [top3]);
  const { data: nartsData } = useResoudreNartsMensuelleQuery(
    { nomDossierDBF, designations: designationsTop3 },
    { skip: !nomDossierDBF || designationsTop3.length === 0 },
  );
  const nartDe = (nom) => nartsData?.narts?.[nom] || "";
  // Ouvre la PAGE « données article » de l'application (pas le PDF fiche
  // article, qui se téléchargeait) dans une autre fenêtre.
  const ouvrirFiche = (nart) =>
    window.open(
      `${BASE_URL}/admin/articles/${nomDossierDBF}/${encodeURIComponent(nart)}`,
      "_blank",
    );

  return (
    <>
      {/* KPI annuels des promotions */}
      <section className="acm-kpis">
        <div className="acm-kpi">
          <span className="acm-kpi-label">CA promo (année)</span>
          <span className="acm-kpi-value">
            {kpis.ca != null ? `${fmtNb(kpis.ca)} XPF` : "—"}
          </span>
        </div>
        <div className="acm-kpi">
          <span className="acm-kpi-label">Marge promo (année)</span>
          <span className="acm-kpi-value">
            {kpis.marge != null ? `${fmtNb(kpis.marge)} XPF` : "—"}
          </span>
        </div>
        <div className="acm-kpi">
          <span className="acm-kpi-label">% marge promo</span>
          <span className="acm-kpi-value">
            {kpis.pctMarge != null ? fmtPct(kpis.pctMarge) : "—"}
          </span>
        </div>
        <div className="acm-kpi">
          <span className="acm-kpi-label">Unités vendues</span>
          <span className="acm-kpi-value">
            {kpis.unites != null ? fmtNb(kpis.unites) : "—"}
          </span>
        </div>
        <div className="acm-kpi">
          <span className="acm-kpi-label">Panier moyen promo</span>
          <span className="acm-kpi-value">
            {kpis.panier != null ? `${fmtNb(kpis.panier)} XPF` : "—"}
          </span>
        </div>
      </section>

      {/* Indicateurs × mois, formatés par ligne */}
      <h2 className="acm-sheet-title" style={{ marginBottom: "0.6rem" }}>
        Indicateurs mensuels
      </h2>
      <div className="acm-table-wrap">
        <table className="acm-table acm-table-sticky">
          <thead>
            <tr>
              <th className="gauche">Indicateur</th>
              {mois.map((m) => (
                <th key={m.i}>{m.label.slice(0, 4)}</th>
              ))}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {indicateurs.map((ind) => (
              <tr key={ind.label}>
                <td className="gauche">{ind.label}</td>
                {mois.map((m) => (
                  <td key={m.i}>{fmtCell(ind.unite, ind.l[m.i])}</td>
                ))}
                <td className="acm-cell-total">
                  {fmtCell(ind.unite, iTotal !== -1 ? ind.l[iTotal] : null)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top 3 articles PAR MOIS (bien plus lisible que 9 lignes × 14 colonnes) */}
      {top3.length > 0 && (
        <>
          <h2 className="acm-sheet-title" style={{ margin: "0 0 0.6rem" }}>
            Top 3 articles promo par mois
          </h2>
          <div className="acm-table-wrap">
            <table className="acm-table acm-table-sticky">
              <thead>
                <tr>
                  <th className="gauche">Mois</th>
                  {top3.map((_, k) => (
                    <th key={k} className="gauche">
                      Top {k + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mois
                  .filter(({ i }) =>
                    top3.some(
                      (t) =>
                        typeof t.article?.[i] === "string" &&
                        t.article[i].trim() &&
                        t.article[i].trim() !== "—",
                    ),
                  )
                  .map(({ label, i }) => (
                    <tr key={i}>
                      <td className="gauche">{label}</td>
                      {top3.map((t, k) => {
                        const nom = String(t.article?.[i] ?? "").trim();
                        if (!nom || nom === "—") {
                          return <td key={k} className="gauche">—</td>;
                        }
                        const ca = t.ca?.[i];
                        const qte = t.qte?.[i];
                        const nart = nartDe(nom);
                        return (
                          <td key={k} className="gauche" title={nom}>
                            {nart && (
                              <button
                                type="button"
                                className="acm-nart-lien"
                                onClick={() => ouvrirFiche(nart)}
                                title={`Ouvrir la fiche article ${nart} (nouvelle fenêtre)`}
                              >
                                {nart}
                              </button>
                            )}
                            {tronque(nom, 34)}
                            <span className="acm-cell-sub">
                              {typeof ca === "number" ? `${fmtNb(ca)} XPF` : "—"}
                              {typeof qte === "number" ? ` · ${fmtNb(qte)} u.` : ""}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
};

const AdminAnalyseCaMensuelleScreen = () => {
  const globalDossier = useSelector(selectGlobalDossier) || "";

  const [periode, setPeriode] = useState(null); // null = plus récente
  const [ongletActif, setOngletActif] = useState(null);
  const [filtre, setFiltre] = useState("");
  const [tri, setTri] = useState(null); // { index, dir: 1|-1 }
  const [page, setPage] = useState(0);
  // Détail promos : tout | promo (≤ 2 mois) | destockage (> 2 mois).
  const [filtreDuree, setFiltreDuree] = useState("tout");

  const { data: sources } = useGetAnalyseCaMensuelleSourcesQuery();
  const sourceGlobale = (sources?.societes || []).find(
    (s) => s.nomDossierDBF === globalDossier,
  );

  const {
    data,
    isFetching: busy,
    error,
  } = useGetAnalyseCaMensuelleClasseurQuery(
    { nomDossierDBF: globalDossier, periode },
    { skip: !globalDossier },
  );

  const feuilles = useMemo(
    () => (data?.feuilles || []).filter((f) => f.lignes.length > 0),
    [data],
  );
  const feuille =
    feuilles.find((f) => f.nom === ongletActif) || feuilles[0] || null;

  // KPI du mois : bloc TOTAL MENSUEL (colonne CUMUL) de la feuille TYPES_CLIENT.
  const kpis = useMemo(() => {
    const tc = (data?.feuilles || []).find((f) => f.nom === "TYPES_CLIENT");
    if (!tc) return null;
    const iCumul = tc.colonnes.findIndex((c) =>
      /^cumul$/.test(sansAccents(c.label)),
    );
    if (iCumul === -1) return null;
    const totales = tc.lignes.filter(estLigneTotal);
    const v = (metrique) => {
      const l = totales.find((x) => x[1] === metrique);
      return l && typeof l[iCumul] === "number" ? l[iCumul] : null;
    };
    return {
      ca: v("CA"),
      marge: v("Marge"),
      margePct: v("Marge %"),
      caRh: v("CA R/H %"),
      margeRh: v("Marge R/H %"),
      nbFactures: v("NB Factures"),
      pm: v("Panier Moyen"),
    };
  }, [data]);

  const changerOnglet = (nom) => {
    setOngletActif(nom);
    setFiltre("");
    setTri(null);
    setPage(0);
    setFiltreDuree("tout");
  };

  // ── Filtre promo / déstockage (onglet Détail promos — INTERFACE seulement,
  // le fichier n'est pas retouché) : une plage début→fin > 2 mois n'est plus
  // une promotion mais du DÉSTOCKAGE. ──
  const estDetailPromos = feuille?.nom === "Detail_Promos";
  const detailPromos = useMemo(() => {
    if (!estDetailPromos) return null;
    const iDebut = idxCol(feuille, /^debut promo/);
    const iFin = idxCol(feuille, /^fin promo/);
    const iCa = idxCol(feuille, /^ca (n )?\(xpf\)/);
    const iMarge = idxCol(feuille, /^marge \(xpf\)/);
    const iQte = idxCol(feuille, /^qte vendue/);
    const iFact = idxCol(feuille, /^nb factures/);

    const donnees = feuille.lignes.filter((l) => !estLigneTotal(l));
    const dest =
      iDebut !== -1 && iFin !== -1
        ? new Set(donnees.filter((l) => estDestockage(l[iDebut], l[iFin])))
        : new Set();
    const promo = donnees.filter((l) => !dest.has(l));
    const retenues =
      filtreDuree === "promo"
        ? promo
        : filtreDuree === "destockage"
          ? [...dest]
          : donnees;

    const somme = (i) =>
      i === -1
        ? null
        : retenues.reduce(
            (s, l) => s + (typeof l[i] === "number" ? l[i] : 0),
            0,
          );
    const ca = somme(iCa);
    const marge = somme(iMarge);
    return {
      comptes: {
        tout: donnees.length,
        promo: promo.length,
        destockage: dest.size,
      },
      kpis: {
        nb: retenues.length,
        ca,
        marge,
        taux: ca ? (marge / ca) * 100 : null,
        qte: somme(iQte),
        factures: somme(iFact),
      },
      lignes: retenues,
    };
  }, [feuille, estDetailPromos, filtreDuree]);

  // Feuille réellement affichée (tableau + graphiques) : filtrée côté interface
  // pour Détail promos — la ligne TOTAL du fichier est retirée dès qu'on filtre
  // (elle ne correspondrait plus aux lignes affichées).
  const feuilleAffichee = useMemo(() => {
    if (!estDetailPromos || !detailPromos || filtreDuree === "tout") {
      return feuille;
    }
    return { ...feuille, lignes: detailPromos.lignes };
  }, [feuille, estDetailPromos, detailPromos, filtreDuree]);

  // TYPES_CLIENT : les lignes « % » se repèrent à la MÉTRIQUE (2e colonne).
  const estTypesClient = feuille?.nom === "TYPES_CLIENT";
  const indexMetrique = 1;

  // Filtre + tri + pagination, lignes TOTAL épinglées hors pagination.
  const { lignesPage, totaux, nbFiltre, nbPages } = useMemo(() => {
    if (!feuilleAffichee)
      return { lignesPage: [], totaux: [], nbFiltre: 0, nbPages: 0 };

    const totaux = feuilleAffichee.lignes.filter(estLigneTotal);
    let donnees = feuilleAffichee.lignes.filter((l) => !estLigneTotal(l));

    if (filtre.trim()) {
      const mots = sansAccents(filtre).split(/\s+/).filter(Boolean);
      donnees = donnees.filter((l) => {
        const texte = sansAccents(
          l.filter((v) => typeof v === "string").join(" "),
        );
        return mots.every((m) => texte.includes(m));
      });
    }

    if (tri) {
      const { index, dir } = tri;
      donnees = [...donnees].sort((a, b) => {
        const va = a[index];
        const vb = b[index];
        if (va === null || va === undefined || va === "") return 1;
        if (vb === null || vb === undefined || vb === "") return -1;
        if (typeof va === "number" && typeof vb === "number") {
          return (va - vb) * dir;
        }
        return String(va).localeCompare(String(vb), "fr") * dir;
      });
    }

    const nbPages = Math.max(1, Math.ceil(donnees.length / PAGE_SIZE));
    const p = Math.min(page, nbPages - 1);
    return {
      lignesPage: donnees.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE),
      totaux,
      nbFiltre: donnees.length,
      nbPages,
    };
  }, [feuilleAffichee, filtre, tri, page]);

  const pageCourante = Math.min(page, Math.max(0, nbPages - 1));

  const trierPar = (index) => {
    setPage(0);
    setTri((t) =>
      t && t.index === index
        ? t.dir === 1
          ? { index, dir: -1 }
          : null
        : { index, dir: 1 },
    );
  };

  const periodes = data?.source?.periodes || sourceGlobale?.periodes || [];

  return (
    <div className="acm-screen">
      <header className="acm-header">
        <h1 className="acm-title">Analyse CA mensuelle</h1>
        <p className="acm-subtitle">
          Restitution complète du classeur d'analyse mensuel de la société :
          types de client, clients, fournisseurs, classes et sous-classes,
          locates, groupes, familles et sous-familles, rayons, clients internes.
        </p>
      </header>

      <section className="acm-toolbar">
        {periodes.length > 0 && (
          <label className="acm-field">
            Période
            <select
              value={periode ?? data?.source?.periode ?? ""}
              onChange={(e) => {
                setPeriode(e.target.value);
                setPage(0);
              }}
            >
              {periodes.map((p) => (
                <option key={p} value={p}>
                  {labelPeriode(p)}
                </option>
              ))}
            </select>
          </label>
        )}
        {data && (
          <span className="acm-meta">
            Source : <code>{data.fichier}</code> —{" "}
            {data.source?.label} ({data.source?.trigramme})
          </span>
        )}
      </section>

      {sources && !sources.accessible && (
        <div className="acm-alert acm-alert-error">
          Les analyses mensuelles sont inaccessibles (
          <code>{sources.dossier}</code>). Vérifier le serveur FTP
          robot-documents (dossier analyse_CA_mensuelle).
        </div>
      )}

      {!globalDossier && (
        <div className="acm-empty">
          Sélectionnez une société (en haut de page) pour commencer.
        </div>
      )}

      {error && (
        <div className="acm-alert acm-alert-error">
          {error?.data?.message || "Impossible de charger l'analyse mensuelle."}
        </div>
      )}

      {busy && <div className="acm-loading">Chargement du classeur…</div>}

      {!busy && data && feuilles.length > 0 && (
        <>
          {/* KPI du mois (cumuls à date, bloc TOTAL MENSUEL de TYPES_CLIENT) */}
          {kpis && (
            <section className="acm-kpis">
              <div className="acm-kpi">
                <span className="acm-kpi-label">CA HT cumulé</span>
                <span className="acm-kpi-value">
                  {kpis.ca != null ? `${fmtNb(kpis.ca)} XPF` : "—"}
                </span>
                <span className={`acm-kpi-evol ${evolClass(kpis.caRh)}`}>
                  {fmtEvol(kpis.caRh)} vs N-1
                </span>
              </div>
              <div className="acm-kpi">
                <span className="acm-kpi-label">Marge HT cumulée</span>
                <span className="acm-kpi-value">
                  {kpis.marge != null ? `${fmtNb(kpis.marge)} XPF` : "—"}
                </span>
                <span className={`acm-kpi-evol ${evolClass(kpis.margeRh)}`}>
                  {fmtEvol(kpis.margeRh)} vs N-1
                </span>
              </div>
              <div className="acm-kpi">
                <span className="acm-kpi-label">Taux de marge</span>
                <span className="acm-kpi-value">
                  {kpis.margePct != null ? fmtPct(kpis.margePct) : "—"}
                </span>
                <span className="acm-kpi-sub">cumul à date</span>
              </div>
              <div className="acm-kpi">
                <span className="acm-kpi-label">Factures</span>
                <span className="acm-kpi-value">
                  {kpis.nbFactures != null ? fmtNb(kpis.nbFactures) : "—"}
                </span>
                <span className="acm-kpi-sub">cumul à date</span>
              </div>
              <div className="acm-kpi">
                <span className="acm-kpi-label">Panier moyen</span>
                <span className="acm-kpi-value">
                  {kpis.pm != null ? `${fmtNb(kpis.pm)} XPF` : "—"}
                </span>
                <span className="acm-kpi-sub">cumul à date</span>
              </div>
            </section>
          )}

          <nav className="acm-tabs">
            {feuilles.map((f) => (
              <button
                key={f.nom}
                type="button"
                className={`acm-tab ${feuille?.nom === f.nom ? "actif" : ""}`}
                onClick={() => changerOnglet(f.nom)}
              >
                {LABELS_FEUILLES[f.nom] || f.nom}
                <span className="acm-tab-count">
                  {fmtNb(f.lignes.filter((l) => !estLigneTotal(l)).length)}
                </span>
              </button>
            ))}
          </nav>

          {/* Détail promos : filtre promo / déstockage (règle : plage début→fin
              > 2 mois = déstockage) + KPI de la sélection. */}
          {estDetailPromos && detailPromos && (
            <>
              <div className="acm-chips">
                <button
                  type="button"
                  className={`acm-chip ${filtreDuree === "tout" ? "actif" : ""}`}
                  onClick={() => {
                    setFiltreDuree("tout");
                    setPage(0);
                  }}
                >
                  Tout ({fmtNb(detailPromos.comptes.tout)})
                </button>
                <button
                  type="button"
                  className={`acm-chip ${filtreDuree === "promo" ? "actif" : ""}`}
                  onClick={() => {
                    setFiltreDuree("promo");
                    setPage(0);
                  }}
                >
                  Promos ≤ 2 mois ({fmtNb(detailPromos.comptes.promo)})
                </button>
                <button
                  type="button"
                  className={`acm-chip ${filtreDuree === "destockage" ? "actif" : ""}`}
                  onClick={() => {
                    setFiltreDuree("destockage");
                    setPage(0);
                  }}
                >
                  Déstockage &gt; 2 mois ({fmtNb(detailPromos.comptes.destockage)})
                </button>
              </div>

              <section className="acm-kpis">
                <div className="acm-kpi">
                  <span className="acm-kpi-label">Articles</span>
                  <span className="acm-kpi-value">
                    {fmtNb(detailPromos.kpis.nb)}
                  </span>
                </div>
                <div className="acm-kpi">
                  <span className="acm-kpi-label">CA HT</span>
                  <span className="acm-kpi-value">
                    {detailPromos.kpis.ca != null
                      ? `${fmtNb(detailPromos.kpis.ca)} XPF`
                      : "—"}
                  </span>
                </div>
                <div className="acm-kpi">
                  <span className="acm-kpi-label">Marge</span>
                  <span className="acm-kpi-value">
                    {detailPromos.kpis.marge != null
                      ? `${fmtNb(detailPromos.kpis.marge)} XPF`
                      : "—"}
                  </span>
                </div>
                <div className="acm-kpi">
                  <span className="acm-kpi-label">Taux de marge</span>
                  <span className="acm-kpi-value">
                    {detailPromos.kpis.taux != null
                      ? fmtPct(detailPromos.kpis.taux)
                      : "—"}
                  </span>
                </div>
                <div className="acm-kpi">
                  <span className="acm-kpi-label">Qté vendue</span>
                  <span className="acm-kpi-value">
                    {detailPromos.kpis.qte != null
                      ? fmtNb(detailPromos.kpis.qte)
                      : "—"}
                  </span>
                </div>
              </section>
            </>
          )}

          {/* key = nom de feuille : les contrôles (métrique, tri, top)
              repartent à zéro quand on change d'onglet */}
          {feuille && (
            <GraphiquesFeuille key={feuille.nom} feuille={feuilleAffichee} />
          )}

          {/* Promos : vue dédiée (le rendu tableur générique est illisible). */}
          {feuille?.nom === "Promos" && (
            <PromosVue feuille={feuille} nomDossierDBF={globalDossier} />
          )}

          {feuille && feuille.nom !== "Promos" && (
            <>
              <div className="acm-sheetbar">
                <h2 className="acm-sheet-title">{feuille.titre || feuille.nom}</h2>
                <input
                  type="search"
                  className="acm-search"
                  placeholder="Rechercher…"
                  value={filtre}
                  onChange={(e) => {
                    setFiltre(e.target.value);
                    setPage(0);
                  }}
                />
                <div className="acm-pager">
                  <span>
                    {fmtNb(nbFiltre)} ligne{nbFiltre > 1 ? "s" : ""}
                  </span>
                  {nbPages > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(0, p - 1))}
                        disabled={pageCourante === 0}
                      >
                        ←
                      </button>
                      <span>
                        {pageCourante + 1} / {nbPages}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPage((p) => Math.min(nbPages - 1, p + 1))
                        }
                        disabled={pageCourante >= nbPages - 1}
                      >
                        →
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="acm-table-wrap">
                <table className="acm-table">
                  <thead>
                    <tr>
                      {feuille.colonnes.map((c, i) => (
                        <th
                          key={`${c.label}-${i}`}
                          onClick={() => trierPar(i)}
                          title="Trier"
                        >
                          {c.label}
                          {tri?.index === i && (
                            <span className="acm-sort">
                              {tri.dir === 1 ? "▲" : "▼"}
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {lignesPage.map((l, li) => {
                      // Ligne de section fusionnée (« ▌ … », onglet Promos).
                      if (estLigneSection(l)) {
                        return (
                          <tr key={li} className="acm-row-section">
                            <td colSpan={feuille.colonnes.length} className="gauche">
                              {String(l[0]).replace(/^▌\s*/, "")}
                            </td>
                          </tr>
                        );
                      }
                      // Séparation visuelle des blocs TYPES_CLIENT.
                      const nouveauGroupe =
                        estTypesClient &&
                        li > 0 &&
                        l[0] !== lignesPage[li - 1][0];
                      const pctLigne = estLignePct(feuille, l);
                      const coloreLigne =
                        estTypesClient &&
                        /r\/h/i.test(String(l[indexMetrique] ?? ""));
                      const debutValeurs = estTypesClient ? 2 : 1;
                      return (
                        <tr
                          key={li}
                          className={nouveauGroupe ? "acm-row-groupe" : ""}
                        >
                          {l.map((v, ci) => (
                            <td
                              key={ci}
                              className={
                                typeof v === "string" ? "gauche" : undefined
                              }
                            >
                              <Cellule
                                valeur={v}
                                colonne={feuille.colonnes[ci]}
                                pct={pctLigne && ci >= debutValeurs}
                                colore={coloreLigne && ci >= debutValeurs}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {totaux.map((l, li) => {
                      const pctLigne = estLignePct(feuille, l);
                      const coloreLigne =
                        estTypesClient &&
                        /r\/h/i.test(String(l[indexMetrique] ?? ""));
                      const debutValeurs = estTypesClient ? 2 : 1;
                      return (
                        <tr
                          key={`total-${li}`}
                          className={`acm-row-total${li === 0 ? " acm-row-total-debut" : ""}`}
                        >
                          {l.map((v, ci) => (
                            <td
                              key={ci}
                              className={
                                typeof v === "string" ? "gauche" : undefined
                              }
                            >
                              <Cellule
                                valeur={v}
                                colonne={feuille.colonnes[ci]}
                                pct={pctLigne && ci >= debutValeurs}
                                colore={coloreLigne && ci >= debutValeurs}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {!busy && data && feuilles.length === 0 && (
        <div className="acm-empty">Le classeur ne contient aucune donnée.</div>
      )}
    </div>
  );
};

export default AdminAnalyseCaMensuelleScreen;
