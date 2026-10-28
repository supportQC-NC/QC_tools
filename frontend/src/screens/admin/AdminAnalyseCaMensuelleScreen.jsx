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
};

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
const fmtNb = (n, dec = 0) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: dec }).format(n);
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
// n'est PAS un total.
const estLigneTotal = (l) =>
  typeof l[0] === "string" && /^TOTAL/i.test(l[0].trim());

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
    const iCaN = idxCol(feuille, /^ca n \(xpf\)/);
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

const AdminAnalyseCaMensuelleScreen = () => {
  const globalDossier = useSelector(selectGlobalDossier) || "";

  const [periode, setPeriode] = useState(null); // null = plus récente
  const [ongletActif, setOngletActif] = useState(null);
  const [filtre, setFiltre] = useState("");
  const [tri, setTri] = useState(null); // { index, dir: 1|-1 }
  const [page, setPage] = useState(0);

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
  };

  // TYPES_CLIENT : les lignes « % » se repèrent à la MÉTRIQUE (2e colonne).
  const estTypesClient = feuille?.nom === "TYPES_CLIENT";
  const indexMetrique = 1;

  // Filtre + tri + pagination, lignes TOTAL épinglées hors pagination.
  const { lignesPage, totaux, nbFiltre, nbPages } = useMemo(() => {
    if (!feuille) return { lignesPage: [], totaux: [], nbFiltre: 0, nbPages: 0 };

    const totaux = feuille.lignes.filter(estLigneTotal);
    let donnees = feuille.lignes.filter((l) => !estLigneTotal(l));

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
  }, [feuille, filtre, tri, page]);

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

          {/* key = nom de feuille : les contrôles (métrique, tri, top)
              repartent à zéro quand on change d'onglet */}
          {feuille && <GraphiquesFeuille key={feuille.nom} feuille={feuille} />}

          {feuille && (
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
                      // Séparation visuelle des blocs TYPES_CLIENT.
                      const nouveauGroupe =
                        estTypesClient &&
                        li > 0 &&
                        l[0] !== lignesPage[li - 1][0];
                      const metrique = estTypesClient
                        ? String(l[indexMetrique] ?? "")
                        : "";
                      const pctLigne = /%/.test(metrique);
                      const coloreLigne = /r\/h/i.test(metrique);
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
                                pct={pctLigne && ci > indexMetrique}
                                colore={coloreLigne && ci > indexMetrique}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {totaux.map((l, li) => {
                      const metrique = estTypesClient
                        ? String(l[indexMetrique] ?? "")
                        : "";
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
                                pct={/%/.test(metrique) && ci > indexMetrique}
                                colore={
                                  /r\/h/i.test(metrique) && ci > indexMetrique
                                }
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
