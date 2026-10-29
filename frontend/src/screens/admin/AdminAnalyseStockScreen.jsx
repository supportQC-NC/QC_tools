// src/screens/admin/AdminAnalyseStockScreen.jsx
//
// ANALYSE STOCK : tableau de bord mensuel du stock d'une société, lu dans les
// classeurs `analyse_stock_<trig>_<MM>_<AAAA>.xlsx` du FTPS robot-documents
// (un par société et par mois ; le cache serveur accumule l'historique, d'où
// le sélecteur de période).
//
// Cinq étages, du général au particulier :
//   1. KPI (valeur du stock, surstock, dépréciation, en commande, dormant,
//      couverture globale en mois)
//   2. Répartition par code filtre (donut + table, chiffres du récap du
//      classeur) et évolution 12 mois des 5 indicateurs du robot
//   3. Rotation (tranches de couverture) et ancienneté de la dernière vente
//      — les deux en valeur immobilisée + nombre d'articles
//   4. Tops fournisseurs (valeur saine vs surstock) / groupes / articles
//      (valeur, surstock, dormants, dépréciations), NART cliquable vers la
//      page données article
//   5. Explorateur : tous les articles du classeur, filtre/tri/pagination
//      CÔTÉ SERVEUR (46 000 lignes chez QC)
//
// La société suit la sélection GLOBALE du header. Montants : fmtMontant
// (entiers, espaces larges — préférence client du 29/10/2026).

import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import {
  useGetAnalyseStockSyntheseQuery,
  useGetAnalyseStockArticlesQuery,
} from "../../slices/analyseStockApiSlice";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { fmtMontant, fmtNombreLarge } from "../../utils/format";
import { BASE_URL } from "../../constants";
import "./AdminAnalyseStockScreen.css";

// ── Formats ──
const fmtXPF = (n) => (typeof n === "number" ? `${fmtMontant(n)} XPF` : "—");
const fmtNb = fmtMontant;
const fmtPct = (n) => (typeof n === "number" ? `${n.toFixed(1)} %` : "—");
// Les stocks peuvent être décimaux (vente au mètre) : une décimale au besoin.
const fmtQte = (n) =>
  typeof n !== "number" ? "—" : fmtNombreLarge(n, Number.isInteger(n) ? 0 : 1);
const fmtMois = (n) => (typeof n === "number" ? fmtNombreLarge(n, 1) : "—");
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR") : "—";
const fmtCompact = (n) => {
  if (typeof n !== "number") return "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1)} Md`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (abs >= 1e3) return `${Math.round(n / 1e3)} k`;
  return String(n);
};

// « 2026-09 » → « septembre 2026 » (sélecteur de période).
const MOIS_LONGS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const labelPeriode = (p) => {
  const [a, m] = String(p).split("-");
  return `${MOIS_LONGS[Number(m) - 1] || m} ${a}`;
};
// « septembre 2026 » (libellés du récap) → « sept. 26 » (axe du graphique).
const labelMoisCourt = (l) => {
  const m = /^(\S+)\s+(\d{4})$/.exec(String(l).trim());
  if (!m) return l;
  return `${m[1].slice(0, 4)}. ${m[2].slice(2)}`;
};

// Couleurs des graphiques (thème sombre admin, mêmes repères que les autres
// écrans d'analyse).
const CH = {
  grille: "#2a2a3a",
  axe: "#a7a7b8",
  valeur: "#4da6ff",
  sain: "#4da6ff",
  surstock: "#fb7185",
  deprec: "#c084fc",
  commande: "#fbbf24",
  destockage: "#34d399",
  nb: "#a7a7b8",
};
// Une couleur stable par code filtre (ordre du classeur).
const COULEURS_CODES = {
  A: "#34d399",
  B: "#4da6ff",
  C: "#fbbf24",
  N: "#c084fc",
  Z: "#fb7185",
  S: "#2dd4bf",
  Autre: "#818cf8",
};
const couleurCode = (c) => COULEURS_CODES[c] || "#818cf8";
// Les 5 indicateurs de l'évolution, repérés par mot-clé du libellé.
const couleurIndicateur = (label) => {
  const l = label.toLowerCase();
  if (l.includes("surstock")) return CH.surstock;
  if (l.includes("commande")) return CH.commande;
  if (l.includes("dépréc") || l.includes("deprec")) return CH.deprec;
  if (l.includes("déstock") || l.includes("destock")) return CH.destockage;
  return CH.valeur; // valeur totale du stock
};

// Tooltip générique : XPF entiers (ou nombre brut quand `unit="nb"`).
const AstTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="ast-tooltip">
      {label != null && <div className="ast-tooltip-label">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey || p.name} className="ast-tooltip-row">
          <span
            className="ast-tooltip-dot"
            style={{ background: p.color || p.stroke || p.payload?.fill }}
          />
          {p.name} :{" "}
          <strong>
            {typeof p.value !== "number"
              ? "—"
              : p.unit === "nb"
                ? `${fmtNb(p.value)} art.`
                : `${fmtMontant(p.value)} XPF`}
          </strong>
        </div>
      ))}
    </div>
  );
};

// Ouvre la PAGE « données article » dans une autre fenêtre.
const ouvrirFiche = (dossier, nart) =>
  window.open(
    `${BASE_URL}/admin/articles/${dossier}/${encodeURIComponent(nart)}`,
    "_blank",
  );

// ── Table « top articles » réutilisée 4 fois (valeur, surstock, dormants,
// dépréciations) : NART cliquable, montant principal paramétrable. ──
const TopArticles = ({ titre, lignes, champ, libelleChamp, dossier }) => (
  <div className="ast-chart-card">
    <h3 className="ast-chart-title">{titre}</h3>
    {!lignes?.length ? (
      <p className="ast-info">Aucun article.</p>
    ) : (
      <div className="ast-table-wrap">
        <table className="ast-table">
          <thead>
            <tr>
              <th className="gauche fixe">NART</th>
              <th className="gauche fixe">Désignation</th>
              <th className="gauche fixe">Fournisseur</th>
              <th className="fixe">{libelleChamp}</th>
              <th className="fixe">Couv.</th>
              <th className="fixe">Dern. vente</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((a) => (
              <tr key={a.nart}>
                <td className="gauche">
                  <button
                    type="button"
                    className="ast-nart"
                    onClick={() => ouvrirFiche(dossier, a.nart)}
                    title="Ouvrir la page données article"
                  >
                    {a.nart}
                  </button>
                </td>
                <td className="gauche design" title={a.design}>
                  {a.design || "—"}
                </td>
                <td className="gauche design" title={a.fournisseur}>
                  {a.fournisseur || "—"}
                </td>
                <td>{fmtNb(a[champ])}</td>
                <td>{fmtMois(a.moisStock)}</td>
                <td>{fmtDate(a.dateVte)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

// ── Explorateur d'articles (section 5) : tout est côté serveur. ──

const COLONNES_EXPLORATEUR = [
  { key: "nart", label: "NART", type: "nart" },
  { key: "design", label: "Désignation", type: "txt" },
  { key: "fournisseur", label: "Fournisseur", type: "txt" },
  { key: "groupe", label: "Groupe", type: "txt" },
  { key: "codeFiltre", label: "Code", type: "code", fixe: true },
  { key: "stock", label: "Stock", type: "qte" },
  { key: "valeurStock", label: "Valeur stock", type: "xpf" },
  { key: "surstock", label: "Surstock", type: "xpf-neg" },
  { key: "valeurDeprec", label: "Déprécié", type: "xpf-neg" },
  { key: "moisStock", label: "Couv. (mois)", type: "mois" },
  { key: "vteAn", label: "Vte an", type: "qte" },
  { key: "caAn", label: "CA an", type: "xpf" },
  { key: "tauxMargePct", label: "Marge", type: "pct" },
  { key: "dateVte", label: "Dern. vente", type: "date" },
  { key: "dateArrive", label: "Dern. arrivée", type: "date" },
];

const FLAGS_EXPLORATEUR = [
  { cle: "", label: "Tous" },
  { cle: "stock", label: "En stock" },
  { cle: "surstock", label: "En surstock" },
  { cle: "dormants", label: "Dormants" },
  { cle: "deprecies", label: "Dépréciés" },
  { cle: "commande", label: "En commande" },
];

const celluleExplorateur = (type, v) => {
  if (type === "txt") return v || "—";
  if (type === "code") return v || "—";
  if (type === "date") return fmtDate(v);
  if (typeof v !== "number") return "—";
  if (type === "qte") return fmtQte(v);
  if (type === "xpf" || type === "xpf-neg") return fmtNb(v);
  if (type === "mois") return fmtMois(v);
  if (type === "pct") return fmtPct(v);
  return v;
};

const ExplorateurArticles = ({ dossier, periode, filtres }) => {
  const [recherche, setRecherche] = useState("");
  const [rechercheDebounce, setRechercheDebounce] = useState("");
  const [codeFiltre, setCodeFiltre] = useState("");
  const [fournisseur, setFournisseur] = useState("");
  const [groupe, setGroupe] = useState("");
  const [flag, setFlag] = useState("");
  const [tri, setTri] = useState({ col: "valeurStock", desc: true });
  const [page, setPage] = useState(1);

  // Débounce de la recherche (400 ms) pour ne pas mitrailler le serveur.
  useEffect(() => {
    const t = setTimeout(() => setRechercheDebounce(recherche), 400);
    return () => clearTimeout(t);
  }, [recherche]);

  // Tout changement de filtre ramène en page 1.
  useEffect(() => {
    setPage(1);
  }, [rechercheDebounce, codeFiltre, fournisseur, groupe, flag, tri, periode]);

  const { data, isFetching, error } = useGetAnalyseStockArticlesQuery(
    {
      nomDossierDBF: dossier,
      periode,
      q: rechercheDebounce,
      codeFiltre,
      fournisseur,
      groupe,
      flag,
      tri: tri.col,
      dir: tri.desc ? "desc" : "asc",
      page,
      taille: 50,
    },
    { skip: !dossier || !periode },
  );

  const trier = (col) =>
    setTri((t) => ({ col, desc: t.col === col ? !t.desc : true }));

  const total = data?.total ?? 0;
  const taille = data?.taille ?? 50;
  const nbPages = Math.max(1, Math.ceil(total / taille));

  return (
    <section className="ast-table-card">
      <div className="ast-table-head">
        <h3 className="ast-chart-title">
          Explorateur — {fmtNb(total)} article{total > 1 ? "s" : ""}
        </h3>
        <div className="ast-filtres">
          <input
            type="search"
            className="ast-recherche"
            placeholder="Filtrer (NART, désignation, gencode, réf…)"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
          <select
            className="ast-select"
            value={codeFiltre}
            onChange={(e) => setCodeFiltre(e.target.value)}
            title="Code filtre (1re lettre du CODTAR)"
          >
            <option value="">Tous codes</option>
            {(filtres?.codesFiltre || []).map((c) => (
              <option key={c} value={c}>
                Code {c}
              </option>
            ))}
          </select>
          <select
            className="ast-select"
            value={fournisseur}
            onChange={(e) => setFournisseur(e.target.value)}
          >
            <option value="">Tous fournisseurs</option>
            {(filtres?.fournisseurs || []).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select
            className="ast-select"
            value={groupe}
            onChange={(e) => setGroupe(e.target.value)}
          >
            <option value="">Tous groupes</option>
            {(filtres?.groupes || []).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="ast-filtres" style={{ marginBottom: "0.6rem" }}>
        {FLAGS_EXPLORATEUR.map((f) => (
          <button
            key={f.cle || "tous"}
            type="button"
            className={`ast-chip ${flag === f.cle ? "on" : ""}`}
            onClick={() => setFlag(f.cle)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p className="ast-erreur">
          {error?.data?.message || "Articles indisponibles."}
        </p>
      )}

      <div className="ast-table-wrap">
        <table className="ast-table">
          <thead>
            <tr>
              {COLONNES_EXPLORATEUR.map((c) => (
                <th
                  key={c.key}
                  className={[
                    c.type === "txt" || c.type === "nart" ? "gauche" : "",
                    c.fixe ? "fixe" : "",
                  ].join(" ")}
                  onClick={c.fixe ? undefined : () => trier(c.key)}
                  title={c.fixe ? undefined : "Trier"}
                >
                  {c.label}
                  {tri.col === c.key ? (tri.desc ? " ▾" : " ▴") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.articles || []).map((a) => (
              <tr key={a.nart}>
                {COLONNES_EXPLORATEUR.map((c) => (
                  <td
                    key={c.key}
                    className={[
                      c.type === "txt" || c.type === "nart" ? "gauche" : "",
                      c.key === "design" || c.key === "fournisseur" ? "design" : "",
                      c.type === "xpf-neg" && a[c.key] > 0 ? "warn" : "",
                    ].join(" ")}
                    title={c.type === "txt" ? a[c.key] : undefined}
                  >
                    {c.type === "nart" ? (
                      <button
                        type="button"
                        className="ast-nart"
                        onClick={() => ouvrirFiche(dossier, a.nart)}
                        title="Ouvrir la page données article"
                      >
                        {a.nart}
                      </button>
                    ) : (
                      celluleExplorateur(c.type, a[c.key])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ast-pagination">
        <button
          type="button"
          disabled={page <= 1 || isFetching}
          onClick={() => setPage((p) => p - 1)}
        >
          ← Précédent
        </button>
        <span>
          Page {page} / {fmtNb(nbPages)}
          {isFetching ? " · chargement…" : ""}
        </span>
        <button
          type="button"
          disabled={page >= nbPages || isFetching}
          onClick={() => setPage((p) => p + 1)}
        >
          Suivant →
        </button>
      </div>
    </section>
  );
};

// ── Écran ──

const AdminAnalyseStockScreen = () => {
  const globalDossier = useSelector(selectGlobalDossier) || "";
  const [periode, setPeriode] = useState("");

  // Changer de société repart sur la période la plus récente.
  useEffect(() => {
    setPeriode("");
  }, [globalDossier]);

  const { data, isFetching, error } = useGetAnalyseStockSyntheseQuery(
    { nomDossierDBF: globalDossier, periode: periode || undefined },
    { skip: !globalDossier },
  );

  const totaux = data?.totaux;
  const recap = data?.recap;

  // Donut : répartition de la VALEUR par code filtre (récap du classeur,
  // ligne Total écartée, codes à valeur nulle masqués).
  const donutCodes = useMemo(
    () =>
      (recap?.codes || []).filter(
        (c) => c.code !== "Total" && c.valeur > 0,
      ),
    [recap],
  );
  const totalRecap = useMemo(
    () => (recap?.codes || []).find((c) => c.code === "Total"),
    [recap],
  );

  // Évolution 12 mois : une clé par indicateur, ordre chronologique.
  const evolution = recap?.evolution;
  const chartEvolution = useMemo(() => {
    if (!evolution) return [];
    return evolution.mois.map((m, i) => {
      const point = { mois: labelMoisCourt(m) };
      for (const ind of evolution.indicateurs) {
        point[ind.label] = ind.valeurs[i];
      }
      return point;
    });
  }, [evolution]);
  const nbMoisReleves = useMemo(() => {
    if (!evolution) return 0;
    const ref = evolution.indicateurs[0];
    return ref ? ref.valeurs.filter((v) => v !== null).length : 0;
  }, [evolution]);

  // Top fournisseurs : barres empilées valeur saine + surstock.
  const chartFournisseurs = useMemo(
    () =>
      (data?.topFournisseurs || []).map((f) => ({
        nom: f.nom,
        sain: Math.max(0, f.valeur - f.surstock),
        surstock: f.surstock,
        valeur: f.valeur,
        nbArticles: f.nbArticles,
      })),
    [data],
  );

  if (!globalDossier) {
    return (
      <div className="ast-screen">
        <h1 className="ast-titre">Analyse stock</h1>
        <p className="ast-info">Sélectionnez une société dans l'en-tête.</p>
      </div>
    );
  }

  return (
    <div className="ast-screen">
      <div className="ast-entete">
        <div>
          <h1 className="ast-titre">
            Analyse stock — {data?.source?.label || globalDossier}
          </h1>
          <p className="ast-sous-titre">
            {recap?.arreteA || ""}
            {data?.fichier ? ` · classeur ${data.fichier}` : ""}
            {data?.modifieLe ? ` généré le ${fmtDate(data.modifieLe)}` : ""}
          </p>
        </div>
        {(data?.source?.periodes?.length || 0) > 0 && (
          <select
            className="ast-select"
            value={data.source.periode}
            onChange={(e) => setPeriode(e.target.value)}
            title="Mois d'arrêté du classeur"
          >
            {data.source.periodes.map((p) => (
              <option key={p} value={p}>
                {labelPeriode(p)}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <p className="ast-erreur">
          {error?.data?.message || "Analyse stock indisponible."}
        </p>
      )}
      {isFetching && !data && (
        <p className="ast-info">
          Chargement de l'analyse… (la première lecture d'un gros classeur peut
          prendre quelques secondes)
        </p>
      )}

      {totaux && (
        <>
          {/* ── 1 · KPI ── */}
          <section className="ast-kpis">
            <div className="ast-kpi">
              <span className="ast-kpi-label">Valeur du stock</span>
              <span className="ast-kpi-value">{fmtXPF(totaux.valeurStock)}</span>
              <span className="ast-kpi-sub">
                {fmtNb(totaux.nbEnStock)} articles en stock /{" "}
                {fmtNb(totaux.nbArticles)} référencés
              </span>
            </div>
            <div className="ast-kpi">
              <span className="ast-kpi-label">Surstock</span>
              <span className="ast-kpi-value warn">
                {fmtXPF(totaux.valeurSurstock)}
              </span>
              <span className="ast-kpi-sub">
                {fmtPct(totaux.pctSurstock)} du stock ·{" "}
                {fmtNb(totaux.nbSurstock)} articles
              </span>
            </div>
            <div className="ast-kpi">
              <span className="ast-kpi-label">Dépréciation</span>
              <span className="ast-kpi-value neg">
                {fmtXPF(totaux.valeurDeprec)}
              </span>
              <span className="ast-kpi-sub">
                {fmtPct(totaux.pctDeprec)} du stock · {fmtNb(totaux.nbDeprec)}{" "}
                articles
              </span>
            </div>
            <div className="ast-kpi">
              <span className="ast-kpi-label">Stock dormant</span>
              <span className="ast-kpi-value neg">
                {fmtXPF(totaux.valeurDormants)}
              </span>
              <span className="ast-kpi-sub">
                {fmtNb(totaux.nbDormants)} articles sans vente sur l'année (
                {fmtPct(totaux.pctDormants)} du stock)
              </span>
            </div>
            <div className="ast-kpi">
              <span className="ast-kpi-label">En commande</span>
              <span className="ast-kpi-value">
                {fmtXPF(totaux.valeurCommande)}
              </span>
              <span className="ast-kpi-sub">
                {fmtNb(totaux.nbEnCommande)} articles attendus
              </span>
            </div>
            <div className="ast-kpi">
              <span className="ast-kpi-label">Couverture globale</span>
              <span className="ast-kpi-value">
                {totaux.couvertureMois != null
                  ? `${fmtNombreLarge(totaux.couvertureMois, 1)} mois`
                  : "—"}
              </span>
              <span className="ast-kpi-sub">
                stock / coût des ventes mensuel moyen · CA an :{" "}
                {fmtXPF(totaux.caAn)}
              </span>
            </div>
          </section>

          {/* ── 2 · Répartition + évolution ── */}
          <section className="ast-charts">
            <div className="ast-chart-card">
              <h3 className="ast-chart-title">
                Valeur du stock par code filtre
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={donutCodes}
                    dataKey="valeur"
                    nameKey="code"
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    innerRadius={42}
                    paddingAngle={2}
                  >
                    {donutCodes.map((c) => (
                      <Cell key={c.code} fill={couleurCode(c.code)} />
                    ))}
                  </Pie>
                  <Tooltip content={<AstTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="ast-chart-card ast-chart-wide">
              <h3 className="ast-chart-title">
                Répartition par code filtre (récap du classeur)
              </h3>
              <div className="ast-table-wrap">
                <table className="ast-table">
                  <thead>
                    <tr>
                      <th className="gauche fixe">Code</th>
                      <th className="fixe">Articles</th>
                      <th className="fixe">%</th>
                      <th className="fixe">Valeur en stock</th>
                      <th className="fixe">%</th>
                      <th className="fixe">Art. dépréciés</th>
                      <th className="fixe">Valeur dépréciée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recap?.codes || [])
                      .filter((c) => c.code !== "Total")
                      .map((c) => (
                        <tr key={c.code}>
                          <td className="gauche">
                            <span
                              className="ast-dot"
                              style={{ background: couleurCode(c.code) }}
                            />
                            {c.code}
                          </td>
                          <td>{fmtNb(c.nbArticles)}</td>
                          <td>{fmtPct(c.pctArticles)}</td>
                          <td>{fmtNb(c.valeur)}</td>
                          <td>{fmtPct(c.pctValeur)}</td>
                          <td>{fmtNb(c.nbDeprec)}</td>
                          <td className={c.valeurDeprec > 0 ? "neg" : ""}>
                            {fmtNb(c.valeurDeprec)}
                          </td>
                        </tr>
                      ))}
                    {totalRecap && (
                      <tr>
                        <td className="gauche">
                          <strong>Total</strong>
                        </td>
                        <td>
                          <strong>{fmtNb(totalRecap.nbArticles)}</strong>
                        </td>
                        <td />
                        <td>
                          <strong>{fmtNb(totalRecap.valeur)}</strong>
                        </td>
                        <td />
                        <td>
                          <strong>{fmtNb(totalRecap.nbDeprec)}</strong>
                        </td>
                        <td className="neg">
                          <strong>{fmtNb(totalRecap.valeurDeprec)}</strong>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {evolution && (
            <section className="ast-charts">
              <div className="ast-chart-card ast-chart-wide">
                <h3 className="ast-chart-title">
                  Évolution sur 12 mois glissants
                </h3>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartEvolution}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                    <XAxis dataKey="mois" fontSize={10} stroke={CH.axe} />
                    <YAxis
                      fontSize={10}
                      stroke={CH.axe}
                      tickFormatter={fmtCompact}
                      width={52}
                    />
                    <Tooltip content={<AstTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    {evolution.indicateurs.map((ind) => (
                      <Line
                        key={ind.label}
                        type="monotone"
                        dataKey={ind.label}
                        name={ind.label}
                        stroke={couleurIndicateur(ind.label)}
                        strokeWidth={2}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                <p className="ast-note">
                  {nbMoisReleves} mois relevé{nbMoisReleves > 1 ? "s" : ""} sur
                  12 — l'historique se remplit au fil des générations
                  mensuelles du robot.
                </p>
              </div>
            </section>
          )}

          {/* ── 3 · Rotation + ancienneté des ventes ── */}
          <section className="ast-charts">
            <div className="ast-chart-card">
              <h3 className="ast-chart-title">
                Rotation — valeur immobilisée par couverture
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={data.rotation}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                  <XAxis dataKey="label" fontSize={10} stroke={CH.axe} />
                  <YAxis
                    yAxisId="v"
                    fontSize={10}
                    stroke={CH.axe}
                    tickFormatter={fmtCompact}
                    width={48}
                  />
                  <YAxis
                    yAxisId="n"
                    orientation="right"
                    fontSize={10}
                    stroke={CH.nb}
                    tickFormatter={fmtCompact}
                    width={40}
                  />
                  <Tooltip content={<AstTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar
                    yAxisId="v"
                    dataKey="valeur"
                    name="Valeur en stock"
                    fill={CH.valeur}
                  />
                  <Line
                    yAxisId="n"
                    type="monotone"
                    dataKey="nbArticles"
                    name="Nb articles"
                    stroke={CH.commande}
                    strokeWidth={2}
                    unit="nb"
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="ast-note">
                Couverture = stock ÷ ventes mensuelles moyennes de l'article.
                « Sans vente » : aucune vente sur l'année, couverture
                incalculable.
              </p>
            </div>

            <div className="ast-chart-card">
              <h3 className="ast-chart-title">
                Ancienneté de la dernière vente (valeur en stock)
              </h3>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={data.anciennete}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                  <XAxis dataKey="label" fontSize={10} stroke={CH.axe} />
                  <YAxis
                    yAxisId="v"
                    fontSize={10}
                    stroke={CH.axe}
                    tickFormatter={fmtCompact}
                    width={48}
                  />
                  <YAxis
                    yAxisId="n"
                    orientation="right"
                    fontSize={10}
                    stroke={CH.nb}
                    tickFormatter={fmtCompact}
                    width={40}
                  />
                  <Tooltip content={<AstTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar
                    yAxisId="v"
                    dataKey="valeur"
                    name="Valeur en stock"
                    fill={CH.destockage}
                  />
                  <Line
                    yAxisId="n"
                    type="monotone"
                    dataKey="nbArticles"
                    name="Nb articles"
                    stroke={CH.commande}
                    strokeWidth={2}
                    unit="nb"
                  />
                </ComposedChart>
              </ResponsiveContainer>
              <p className="ast-note">
                Plus la dernière vente est ancienne, plus la valeur immobilisée
                est à risque (candidats au déstockage).
              </p>
            </div>
          </section>

          {/* ── 4 · Tops fournisseurs / groupes / articles ── */}
          <div className="ast-section-head">
            <h2 className="ast-section-titre">Où est la valeur ?</h2>
          </div>

          <section className="ast-charts">
            <div className="ast-chart-card ast-chart-wide">
              <h3 className="ast-chart-title">
                Top 15 fournisseurs — valeur en stock (dont surstock) ·{" "}
                {fmtNb(data.nbFournisseurs)} fournisseurs au total
              </h3>
              <ResponsiveContainer
                width="100%"
                height={Math.max(220, chartFournisseurs.length * 26 + 60)}
              >
                <BarChart
                  data={chartFournisseurs}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={CH.grille} />
                  <XAxis
                    type="number"
                    fontSize={10}
                    stroke={CH.axe}
                    tickFormatter={fmtCompact}
                  />
                  <YAxis
                    type="category"
                    dataKey="nom"
                    width={170}
                    fontSize={10}
                    stroke={CH.axe}
                    tickFormatter={(v) =>
                      v.length > 24 ? `${v.slice(0, 23)}…` : v
                    }
                  />
                  <Tooltip content={<AstTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "11px" }} />
                  <Bar
                    dataKey="sain"
                    stackId="v"
                    name="Stock hors surstock"
                    fill={CH.sain}
                  />
                  <Bar
                    dataKey="surstock"
                    stackId="v"
                    name="Surstock"
                    fill={CH.surstock}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="ast-chart-card">
              <h3 className="ast-chart-title">
                Top groupes — valeur en stock ·{" "}
                {fmtNb(data.nbGroupes)} groupes au total
              </h3>
              <div className="ast-table-wrap">
                <table className="ast-table">
                  <thead>
                    <tr>
                      <th className="gauche fixe">Groupe</th>
                      <th className="fixe">Articles</th>
                      <th className="fixe">Valeur</th>
                      <th className="fixe">Surstock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.topGroupes || []).map((g) => (
                      <tr key={g.nom}>
                        <td className="gauche">{g.nom}</td>
                        <td>{fmtNb(g.nbArticles)}</td>
                        <td>{fmtNb(g.valeur)}</td>
                        <td className={g.surstock > 0 ? "warn" : ""}>
                          {fmtNb(g.surstock)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="ast-charts">
            <TopArticles
              titre="Top valeur en stock"
              lignes={data.topValeur}
              champ="valeurStock"
              libelleChamp="Valeur stock"
              dossier={globalDossier}
            />
            <TopArticles
              titre="Top surstock"
              lignes={data.topSurstock}
              champ="surstock"
              libelleChamp="Surstock"
              dossier={globalDossier}
            />
          </section>
          <section className="ast-charts">
            <TopArticles
              titre="Dormants les plus chers (aucune vente sur l'année)"
              lignes={data.topDormants}
              champ="valeurStock"
              libelleChamp="Valeur stock"
              dossier={globalDossier}
            />
            <TopArticles
              titre="Top dépréciations"
              lignes={data.topDeprec}
              champ="valeurDeprec"
              libelleChamp="Valeur dépréciée"
              dossier={globalDossier}
            />
          </section>

          {/* ── 5 · Explorateur ── */}
          <div className="ast-section-head">
            <h2 className="ast-section-titre">Tous les articles</h2>
          </div>
          <ExplorateurArticles
            dossier={globalDossier}
            periode={data.source.periode}
            filtres={data.filtres}
          />
        </>
      )}
    </div>
  );
};

export default AdminAnalyseStockScreen;
