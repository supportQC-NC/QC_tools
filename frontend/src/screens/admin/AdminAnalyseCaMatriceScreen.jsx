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
  useGetAnalyseCaMatriceComparaisonQuery,
} from "../../slices/analyseCaMatriceApiSlice";
import { useGenererAnalyseCaMutation } from "../../slices/analyseCaApiSlice";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
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
import { fmtMontant } from "../../utils/format";
import "./AdminAnalyseCaMatriceScreen.css";

// Couleur FIXE par catégorie de client (jamais réaffectée selon le rang,
// pour que PART reste bleu d'un mois et d'une société à l'autre).
// Palette calibrée pour le THÈME SOMBRE de l'admin.
const CAT_COLORS = {
  PART: "#4da6ff",
  FIDELITE: "#34d399",
  "PRO CPT": "#fbbf24",
  "PRO DEBIT": "#fb7185",
  GROUPE: "#c084fc",
  ADMIN: "#94a3b8",
  REVEND: "#2dd4bf",
  AGRI: "#a3e635",
  AUTRE: "#f472b6",
};
const catColor = (nom, i) =>
  CAT_COLORS[nom] || ["#60a5fa", "#fb923c", "#818cf8"][i % 3];

// Couleurs partagées des graphiques (thème sombre).
const CH = {
  grille: "#2a2a3a",
  axe: "#a7a7b8",
  caN: "#4da6ff",
  caN1: "#4a5570",
  marge: "#f59e0b",
  clientsN: "#10b981",
  clientsN1: "#3d5c50",
};

// Palette des courbes du comparateur multi-sociétés (une couleur par source,
// dans l'ordre de sélection).
const COMP_COLORS = [
  "#4da6ff", "#34d399", "#fbbf24", "#fb7185",
  "#c084fc", "#2dd4bf", "#a3e635", "#f472b6",
  "#f97316", "#94a3b8", "#818cf8", "#e879f9",
];

// ── Métriques commutables : les KPI sont CLIQUABLES et pilotent tous les
// graphiques (évolution mensuelle, quotidien, comparateur). ──
const METRIQUES = {
  ca: {
    label: "CA HT",
    unite: "xpf",
    moisN: (m) => m.caN || null,
    moisN1: (m) => m.caN1 || null,
    jourN: (j) => j.caN || null,
    jourN1: (j) => j.caN1 || null,
  },
  marge: {
    label: "Marge HT",
    unite: "xpf",
    moisN: (m) => (m.caN ? m.margeN : null),
    moisN1: (m) => (m.caN1 ? m.margeN1 : null),
    jourN: (j) => (j.caN ? j.margeN : null),
    jourN1: (j) => (j.caN1 ? j.margeN1 : null),
  },
  taux: {
    label: "Taux de marge",
    unite: "pct",
    moisN: (m) => (m.caN ? Math.round((m.margeN / m.caN) * 1000) / 10 : null),
    moisN1: (m) => (m.caN1 ? Math.round((m.margeN1 / m.caN1) * 1000) / 10 : null),
    jourN: (j) => (j.caN ? j.tauxMargeN : null),
    jourN1: (j) => (j.caN1 ? j.tauxMargeN1 : null),
  },
  clients: {
    label: "Clients",
    unite: "nb",
    moisN: (m) => m.clientsN || null,
    moisN1: (m) => m.clientsN1 || null,
    jourN: (j) => j.clientsN || null,
    jourN1: (j) => j.clientsN1 || null,
  },
  pm: {
    label: "Panier moyen",
    unite: "xpf",
    moisN: (m) => (m.clientsN ? Math.round(m.caN / m.clientsN) : null),
    moisN1: (m) => (m.clientsN1 ? Math.round(m.caN1 / m.clientsN1) : null),
    jourN: (j) => (j.clientsN ? Math.round(j.caN / j.clientsN) : null),
    jourN1: (j) => (j.clientsN1 ? Math.round(j.caN1 / j.clientsN1) : null),
  },
};

// Format d'une valeur selon l'unité de la métrique.
// Montants et nombres : entiers, milliers séparés par une espace LARGE
// (`fmtMontant`) — lisibilité des tableaux, demande client du 29/10/2026.
const fmtUnite = (unite, v) => {
  if (typeof v !== "number") return "—";
  if (unite === "pct") return `${v.toFixed(1)} %`;
  if (unite === "xpf") return `${fmtMontant(v)} XPF`;
  return fmtMontant(v);
};

// ── Formats ──
const fmtXPF = (n) => (typeof n === "number" ? `${fmtMontant(n)} XPF` : "—");
const fmtNb = fmtMontant;
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
            {typeof p.value === "number" ? `${fmtMontant(p.value)} XPF` : p.value}
          </strong>
        </div>
      ))}
    </div>
  );
};

// Tooltip générique selon l'unité de la métrique active.
const MetriqueTooltip = ({ active, payload, label, unite }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="aca-tooltip">
      {label != null && <div className="aca-tooltip-label">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="aca-tooltip-row">
          <span className="aca-tooltip-dot" style={{ background: p.color || p.stroke }} />
          {p.name}
          {/* Date N-1 réelle du point (utile quand N-1 est recalé sur le jour de semaine). */}
          {p.dataKey === "valN1" && p.payload?.dateN1 ? ` (${p.payload.dateN1})` : ""}
          {" : "}
          <strong>{fmtUnite(unite, p.value)}</strong>
        </div>
      ))}
    </div>
  );
};

// Jour de semaine d'un libellé de date de la matrice ("jeu. 01" → 4).
const JOURS_SEMAINE = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
const jourSemaine = (lib) =>
  JOURS_SEMAINE[String(lib || "").trim().slice(0, 3).toLowerCase()] ?? null;

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
  const [metrique, setMetrique] = useState("ca"); // KPI actif (pilote les graphiques)
  const [alignerN1, setAlignerN1] = useState(true); // N-1 calé sur le jour de semaine (graphique quotidien)
  const [compareIds, setCompareIds] = useState([]); // sources du comparateur

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

  const M = METRIQUES[metrique];

  // Évolution mensuelle de la MÉTRIQUE ACTIVE (N vs N-1).
  const chartMois = useMemo(
    () =>
      (data?.mois || []).map((m) => ({
        label: m.periode,
        valN: M.moisN(m),
        valN1: M.moisN1(m),
      })),
    [data, M],
  );

  // Quotidien du mois sélectionné, métrique active.
  // La matrice apparie le jour J de N avec le MÊME jour calendaire de N-1,
  // donc un jour de semaine de décalage (dim. 04/2026 en face du sam. 04/2025) :
  // les creux du dimanche ne tombent pas au même endroit sur les deux courbes.
  // `alignerN1` recale N-1 sur le même jour de semaine, POUR LE GRAPHIQUE
  // SEULEMENT — KPI, cumuls et tableaux restent appariés par date.
  const chartJours = useMemo(() => {
    const jours = detail?.jours || [];
    return jours.map((j, i) => {
      let src = j;
      if (alignerN1) {
        const wN = jourSemaine(j.date);
        const wN1 = jourSemaine(j.dateN1);
        if (wN != null && wN1 != null) {
          let off = (wN - wN1 + 7) % 7;
          if (off > 3) off -= 7; // toujours le plus petit décalage (±1 ou ±2)
          src = jours[i + off] || null; // fin de mois : pas de contrepartie → trou
        }
      }
      return {
        label: j.date,
        valN: M.jourN(j),
        valN1: src ? M.jourN1(src) : null,
        dateN1: src ? src.dateN1 : null,
      };
    });
  }, [detail, M, alignerN1]);

  // ── Comparateur multi-sources ──
  const sourcesDispo = useMemo(
    () => [...(sources?.societes || []), ...(sources?.groupes || [])],
    [sources],
  );
  const compareTri = useMemo(() => [...compareIds].sort(), [compareIds]);
  const { data: comparaison, isFetching: busyComparaison } =
    useGetAnalyseCaMatriceComparaisonQuery(
      { sources: compareTri, annee },
      { skip: compareTri.length < 2 },
    );

  const basculerComparaison = (id) =>
    setCompareIds((ids) =>
      ids.includes(id)
        ? ids.filter((x) => x !== id)
        : ids.length >= 12
          ? ids
          : [...ids, id],
    );

  // Courbes mensuelles du comparateur (métrique active, année N).
  const chartComparaison = useMemo(() => {
    const srcs = comparaison?.sources || [];
    if (!srcs.length) return [];
    return (srcs[0].mois || []).map((m0, i) => {
      const point = { label: m0.periode };
      srcs.forEach((s) => {
        point[s.label] = s.mois?.[i] ? M.moisN(s.mois[i]) : null;
      });
      return point;
    });
  }, [comparaison, M]);

  // Donut catégories : seules les parts POSITIVES sont représentables ; les
  // montants négatifs (avoirs GROUPE…) restent visibles dans le tableau.
  const donutCategories = useMemo(
    () => (detail?.cumul?.categories || []).filter((c) => c.ca > 0),
    [detail],
  );

  // ── Catégories client à l'échelle de l'ANNÉE (comme les feuilles Excel) ──
  // Noms dans l'ordre du fichier (PART, FIDELITE, PRO CPT…).
  const nomsCategories = useMemo(() => {
    for (const m of moisDispo) if (m.categories?.length) return m.categories;
    return [];
  }, [moisDispo]);

  // CA par catégorie et par mois (barres empilées).
  const chartMoisCategories = useMemo(
    () =>
      moisDispo
        .filter((m) => m.cumul)
        .map((m) => ({
          label: m.label.slice(0, 4),
          ...Object.fromEntries(m.cumul.categories.map((c) => [c.nom, c.ca])),
        })),
    [moisDispo],
  );

  // Totaux annuels par catégorie (CA, part, marge, part marge, taux recalculé).
  const totauxCategories = useMemo(() => {
    const parNom = new Map();
    for (const m of moisDispo) {
      for (const c of m.cumul?.categories || []) {
        const t = parNom.get(c.nom) || { nom: c.nom, ca: 0, marge: 0 };
        t.ca += c.ca;
        t.marge += c.marge || 0;
        parNom.set(c.nom, t);
      }
    }
    const lignes = nomsCategories.map((nom) => parNom.get(nom)).filter(Boolean);
    const totalCa = lignes.reduce((s, l) => s + l.ca, 0);
    const totalMarge = lignes.reduce((s, l) => s + l.marge, 0);
    return lignes.map((l) => ({
      ...l,
      partPct: totalCa ? (l.ca / totalCa) * 100 : 0,
      partMargePct: totalMarge ? (l.marge / totalMarge) * 100 : 0,
      tauxMargePct: l.ca ? (l.marge / l.ca) * 100 : 0,
    }));
  }, [moisDispo, nomsCategories]);

  // CA par catégorie et par JOUR du mois sélectionné (barres empilées).
  const chartJoursCategories = useMemo(
    () =>
      (detail?.jours || []).map((j) => ({
        label: j.date,
        ...Object.fromEntries((j.categories || []).map((c) => [c.nom, c.ca])),
      })),
    [detail],
  );

  const sourceCourante = data?.source;
  const anneesDispo = sourceCourante?.annees || [];

  return (
    <div className="aca-screen">
      <header className="aca-header">
        <h1 className="aca-title">Analyse CA</h1>
        <p className="aca-subtitle">
          Chiffre d'affaires, marge et fréquentation, comparés à N-1 — par
          société ou consolidés par groupe. Matrices régénérées chaque soir
          (19h30, lun-sam) et récupérées automatiquement depuis le serveur
          documentaire.
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
          Les matrices CA sont inaccessibles (<code>{sources.dossier}</code>).
          Vérifier le serveur FTP robot-documents (dossier analyse_CA_jour).
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

          {/* ── KPI cumulés (à date) — CLIQUABLES : le KPI actif pilote tous
              les graphiques (mensuel, quotidien, comparateur) ── */}
          <section className="aca-kpis">
            <button
              type="button"
              className={`aca-kpi aca-kpi-btn ${metrique === "ca" ? "actif" : ""}`}
              onClick={() => setMetrique("ca")}
            >
              <span className="aca-kpi-label">CA HT cumulé</span>
              <span className="aca-kpi-value">{fmtXPF(kpis?.caN)}</span>
              <span className={`aca-kpi-evol ${evolClass(kpis?.evolCaPct)}`}>
                {fmtEvol(kpis?.evolCaPct)} vs N-1 ({fmtXPF(kpis?.caN1)})
              </span>
            </button>
            <button
              type="button"
              className={`aca-kpi aca-kpi-btn ${metrique === "marge" ? "actif" : ""}`}
              onClick={() => setMetrique("marge")}
            >
              <span className="aca-kpi-label">Marge HT cumulée</span>
              <span className="aca-kpi-value">{fmtXPF(kpis?.margeN)}</span>
              <span className={`aca-kpi-evol ${evolClass(kpis?.evolMargePct)}`}>
                {fmtEvol(kpis?.evolMargePct)} vs N-1
              </span>
            </button>
            <button
              type="button"
              className={`aca-kpi aca-kpi-btn ${metrique === "taux" ? "actif" : ""}`}
              onClick={() => setMetrique("taux")}
            >
              <span className="aca-kpi-label">Taux de marge</span>
              <span className="aca-kpi-value">{fmtTaux(kpis?.tauxMargeN)}</span>
              <span className="aca-kpi-sub">
                N-1 : {fmtTaux(kpis?.tauxMargeN1)}
              </span>
            </button>
            <button
              type="button"
              className={`aca-kpi aca-kpi-btn ${metrique === "clients" ? "actif" : ""}`}
              onClick={() => setMetrique("clients")}
            >
              <span className="aca-kpi-label">Clients</span>
              <span className="aca-kpi-value">{fmtNb(kpis?.clientsN)}</span>
              <span className={`aca-kpi-evol ${evolClass(kpis?.evolClientsPct)}`}>
                {fmtEvol(kpis?.evolClientsPct)} vs N-1
              </span>
            </button>
            <button
              type="button"
              className={`aca-kpi aca-kpi-btn ${metrique === "pm" ? "actif" : ""}`}
              onClick={() => setMetrique("pm")}
            >
              <span className="aca-kpi-label">Panier moyen</span>
              <span className="aca-kpi-value">
                {pmN != null ? fmtXPF(Math.round(pmN)) : "—"}
              </span>
              <span className={`aca-kpi-evol ${evolClass(evolPm)}`}>
                {fmtEvol(evolPm)} vs N-1
              </span>
            </button>
          </section>

          {/* ── Évolution mensuelle de la métrique active ── */}
          <section className="aca-charts">
            <div className="aca-chart-card aca-chart-wide">
              <h3 className="aca-chart-title">
                {M.label} par mois — N vs N-1
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartMois}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                  <XAxis dataKey="label" fontSize={11} stroke={CH.axe} />
                  <YAxis
                    fontSize={11}
                    stroke={CH.axe}
                    tickFormatter={M.unite === "pct" ? (v) => `${v} %` : fmtCompact}
                    width={M.unite === "pct" ? 56 : 48}
                    domain={M.unite === "pct" ? [0, "auto"] : undefined}
                  />
                  <Tooltip content={<MetriqueTooltip unite={M.unite} />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar
                    dataKey="valN1"
                    name={`${M.label} N-1`}
                    fill={CH.caN1}
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="valN"
                    name={`${M.label} N`}
                    fill={CH.caN}
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

          {/* ── Catégories de clients sur l'année (détail des feuilles Excel) ── */}
          {totauxCategories.length > 0 && (
            <>
              <h2 className="aca-section-title">
                CA par catégorie de client — année {sourceCourante?.annee}
              </h2>
              <section className="aca-charts">
                <div className="aca-chart-card aca-chart-wide">
                  <h3 className="aca-chart-title">
                    CA HT mensuel empilé par catégorie
                  </h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={chartMoisCategories}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                      <XAxis dataKey="label" fontSize={11} stroke={CH.axe} />
                      <YAxis
                        fontSize={11}
                        stroke={CH.axe}
                        tickFormatter={fmtCompact}
                        width={48}
                      />
                      <Tooltip content={<XpfTooltip />} />
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      {nomsCategories.map((nom, i) => (
                        <Bar
                          key={nom}
                          dataKey={nom}
                          stackId="categories"
                          name={nom}
                          fill={catColor(nom, i)}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <div className="aca-table-wrap">
                <table className="aca-table">
                  <thead>
                    <tr>
                      <th>Catégorie</th>
                      <th>CA HT cumulé</th>
                      <th>Part CA</th>
                      <th>Marge cumulée</th>
                      <th>Part marge</th>
                      <th>Taux de marge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {totauxCategories.map((c, i) => (
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
                        <td>{fmtTaux(c.partMargePct)}</td>
                        <td>{fmtTaux(c.tauxMargePct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

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
                  <div className="aca-chart-head">
                    <h3 className="aca-chart-title">
                      {M.label} quotidien — {detail?.label} N vs N-1
                    </h3>
                    <label
                      className="aca-chart-option"
                      title="Compare chaque jour au même jour de semaine de N-1 (dimanche en face de dimanche) au lieu de la même date. Les derniers jours du mois peuvent rester sans valeur N-1."
                    >
                      <input
                        type="checkbox"
                        checked={alignerN1}
                        onChange={(e) => setAlignerN1(e.target.checked)}
                      />
                      N-1 calé sur le jour de semaine
                    </label>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={chartJours}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                      <XAxis dataKey="label" fontSize={10} stroke={CH.axe} />
                      <YAxis
                        fontSize={11}
                        stroke={CH.axe}
                        tickFormatter={
                          M.unite === "pct" ? (v) => `${v} %` : fmtCompact
                        }
                        width={M.unite === "pct" ? 56 : 48}
                      />
                      <Tooltip content={<MetriqueTooltip unite={M.unite} />} />
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      <Line
                        type="monotone"
                        dataKey="valN1"
                        name={`${M.label} N-1`}
                        stroke="#6b7694"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="valN"
                        name={`${M.label} N`}
                        stroke={CH.caN}
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

                <div className="aca-chart-card aca-chart-wide">
                  <h3 className="aca-chart-title">
                    CA HT quotidien empilé par catégorie — {detail?.label}
                  </h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartJoursCategories}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                      <XAxis dataKey="label" fontSize={10} stroke={CH.axe} />
                      <YAxis
                        fontSize={11}
                        stroke={CH.axe}
                        tickFormatter={fmtCompact}
                        width={48}
                      />
                      <Tooltip content={<XpfTooltip />} />
                      <Legend wrapperStyle={{ fontSize: "11px" }} />
                      {(detail?.categories || []).map((nom, i) => (
                        <Bar
                          key={nom}
                          dataKey={nom}
                          stackId="categories"
                          name={nom}
                          fill={catColor(nom, i)}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
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
                      <th>Marge N-1</th>
                      <th>Taux N-1</th>
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
                        <td>{j.caN1 ? fmtNb(j.margeN1) : "—"}</td>
                        <td>{j.caN1 ? fmtTaux(j.tauxMargeN1) : "—"}</td>
                        <td>{j.caN1 ? fmtNb(j.clientsN1) : "—"}</td>
                        <td className={evolClass(j.rhCaPct)}>
                          {j.rhCaPct == null ? "—" : fmtEvol(j.rhCaPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Catégories par jour (montant + part, comme le bloc de droite
                  des feuilles mensuelles Excel) */}
              <h2 className="aca-section-title">
                Catégories de clients par jour — {detail?.label?.toLowerCase()}{" "}
                {detail?.annee}
              </h2>
              <div className="aca-table-wrap">
                <table className="aca-table aca-table-sticky">
                  <thead>
                    <tr>
                      <th>Date</th>
                      {(detail?.categories || []).map((nom, i) => (
                        <th key={nom}>
                          <span
                            className="aca-cat-dot"
                            style={{ background: catColor(nom, i) }}
                          />
                          {nom}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(detail?.jours || []).map((j) => (
                      <tr key={j.date}>
                        <td>{j.date}</td>
                        {(j.categories || []).map((c) => (
                          <td key={c.nom} className={c.ca < 0 ? "neg" : ""}>
                            {j.caN ? fmtNb(c.ca) : "—"}
                            {j.caN ? (
                              <span className="aca-cell-sub">
                                {fmtTaux(c.partPct)}
                              </span>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {detail?.cumul && (
                      <tr className="aca-row-total">
                        <td>CUMUL</td>
                        {detail.cumul.categories.map((c) => (
                          <td key={c.nom} className={c.ca < 0 ? "neg" : ""}>
                            {fmtNb(c.ca)}
                            <span className="aca-cell-sub">
                              {fmtTaux(c.partPct)}
                            </span>
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Comparateur multi-sociétés (suit la métrique active) ── */}
          {sourcesDispo.length > 1 && (
            <>
              <h2 className="aca-section-title">
                Comparer — {M.label} {sourceCourante?.annee}
              </h2>
              <div className="aca-chips">
                {sourcesDispo.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`aca-chip ${compareIds.includes(s.id) ? "actif" : ""}`}
                    onClick={() => basculerComparaison(s.id)}
                  >
                    {s.label}
                    {s.type === "groupe" ? " (groupe)" : ""}
                  </button>
                ))}
              </div>

              {compareTri.length < 2 && (
                <p className="aca-source-note">
                  Sélectionnez au moins deux sources pour les comparer sur la
                  métrique active (cliquez un KPI pour en changer).
                </p>
              )}

              {busyComparaison && (
                <div className="aca-loading">Chargement de la comparaison…</div>
              )}

              {compareTri.length >= 2 &&
                !busyComparaison &&
                (comparaison?.sources?.length ?? 0) >= 2 && (
                  <>
                    <section className="aca-charts">
                      <div className="aca-chart-card aca-chart-wide">
                        <h3 className="aca-chart-title">
                          {M.label} par mois (année N) — comparaison
                        </h3>
                        <ResponsiveContainer width="100%" height={320}>
                          <LineChart data={chartComparaison}>
                            <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                            <XAxis dataKey="label" fontSize={11} stroke={CH.axe} />
                            <YAxis
                              fontSize={11}
                              stroke={CH.axe}
                              tickFormatter={
                                M.unite === "pct" ? (v) => `${v} %` : fmtCompact
                              }
                              width={M.unite === "pct" ? 56 : 48}
                            />
                            <Tooltip
                              content={<MetriqueTooltip unite={M.unite} />}
                            />
                            <Legend wrapperStyle={{ fontSize: "11px" }} />
                            {comparaison.sources.map((s, i) => (
                              <Line
                                key={s.id}
                                type="monotone"
                                dataKey={s.label}
                                name={s.label}
                                stroke={COMP_COLORS[i % COMP_COLORS.length]}
                                strokeWidth={2}
                                dot={false}
                                connectNulls
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </section>

                    <div className="aca-table-wrap">
                      <table className="aca-table">
                        <thead>
                          <tr>
                            <th>Source</th>
                            <th>CA HT cumulé</th>
                            <th>Évol. CA</th>
                            <th>Marge cumulée</th>
                            <th>Évol. marge</th>
                            <th>Taux de marge</th>
                            <th>Clients</th>
                            <th>Évol. clients</th>
                            <th>Panier moyen</th>
                          </tr>
                        </thead>
                        <tbody>
                          {comparaison.sources.map((s, i) => (
                            <tr key={s.id}>
                              <td>
                                <span
                                  className="aca-cat-dot"
                                  style={{
                                    background:
                                      COMP_COLORS[i % COMP_COLORS.length],
                                  }}
                                />
                                {s.label}
                                {s.type === "groupe" ? " (groupe)" : ""}
                              </td>
                              <td>{fmtNb(s.kpis?.caN)}</td>
                              <td className={evolClass(s.kpis?.evolCaPct)}>
                                {fmtEvol(s.kpis?.evolCaPct)}
                              </td>
                              <td>{fmtNb(s.kpis?.margeN)}</td>
                              <td className={evolClass(s.kpis?.evolMargePct)}>
                                {fmtEvol(s.kpis?.evolMargePct)}
                              </td>
                              <td>{fmtTaux(s.kpis?.tauxMargeN)}</td>
                              <td>{fmtNb(s.kpis?.clientsN)}</td>
                              <td className={evolClass(s.kpis?.evolClientsPct)}>
                                {fmtEvol(s.kpis?.evolClientsPct)}
                              </td>
                              <td>
                                {s.kpis?.clientsN
                                  ? fmtNb(Math.round(s.kpis.caN / s.kpis.clientsN))
                                  : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
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
