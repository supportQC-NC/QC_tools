// src/screens/admin/AdminPerformanceDockScreen.jsx
import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Area,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import { HiRefresh, HiDownload, HiChartBar } from "react-icons/hi";
import {
  useGetPerformanceDockQuery,
  useRefreshPerformanceDockMutation,
} from "../../slices/performanceDockApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminPerformanceDockScreen.css";

// Palette validée sur la surface sombre de l'admin (#12121a) :
//  - volume = UNE seule teinte (série unique -> pas de couleur catégorielle) ;
//  - écart  = paire divergente vert/rouge, dont le SIGNE est porté par la
//    position (au-dessus / en-dessous de zéro) et pas seulement par la couleur
//    — vert et rouge sont proches en vision deutan (ΔE 7,1).
const SERIE = "#3987e5"; // bleu, volume
const AU_DESSUS = "#0ca30c"; // vert, écart positif
const EN_DESSOUS = "#e66767"; // rouge, écart négatif
const MOYENNE = "#c9a227"; // repère moyenne, distinct des deux pôles
const GRILLE = "#24242e";
const AXE = "#8b949e";

const fNum = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR");
const fSigne = (n) => (n >= 0 ? `+${fNum(n)}` : fNum(n));

const MOIS_COURT = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];
const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

// Les dates viennent du nom de fichier (yyyy-mm-dd) ; si le nom ne suit pas la
// convention le service renvoie le nom brut — on l'affiche alors tel quel.
const enDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
const fmtJour = (s) => {
  const d = enDate(s);
  return d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}` : s;
};
const fmtJourLong = (s) => {
  const d = enDate(s);
  return d
    ? `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS_COURT[d.getMonth()]} ${d.getFullYear()}`
    : s;
};

// Échelle « zoomée » : avec des volumes qui tournent tous autour de 1 700, un axe
// qui part de 0 écrase les écarts et toutes les journées se ressemblent. On ne le
// fait QUE sur la courbe (une aire lit une position, pas une longueur) ; les
// barres d'écart, elles, restent ancrées à zéro.
const pasJoli = (amplitude) => {
  const base = Math.pow(10, Math.floor(Math.log10(Math.max(amplitude, 1))));
  const n = Math.max(amplitude, 1) / base;
  const mult = n <= 1.5 ? 1 : n <= 3 ? 2 : n <= 7 ? 5 : 10;
  return Math.max(1, (base * mult) / 2);
};
const domaineZoome = (valeurs) => {
  if (!valeurs.length) return [0, "auto"];
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  const amplitude = max - min || Math.max(1, max * 0.1);
  const pas = pasJoli(amplitude);
  return [
    Math.max(0, Math.floor((min - amplitude * 0.4) / pas) * pas),
    Math.ceil((max + amplitude * 0.3) / pas) * pas,
  ];
};

// Barre d'écart : coin arrondi du côté opposé à la ligne de zéro uniquement.
const BarreEcart = ({ x, y, width, height, fill }) => {
  const w = Math.max(width, 1);
  const h = Math.abs(height);
  const r = Math.min(4, w / 2, h);
  const haut = height >= 0; // recharts : hauteur négative = barre sous le zéro
  const t = haut ? y : y + height;
  const chemin = haut
    ? `M${x},${t + h} L${x},${t + r} Q${x},${t} ${x + r},${t} L${x + w - r},${t} Q${x + w},${t} ${x + w},${t + r} L${x + w},${t + h} Z`
    : `M${x},${t} L${x},${t + h - r} Q${x},${t + h} ${x + r},${t + h} L${x + w - r},${t + h} Q${x + w},${t + h} ${x + w},${t + h - r} L${x + w},${t} Z`;
  return <path d={chemin} fill={fill} />;
};

const InfoBulle = ({ active, payload, label, moyenne }) => {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  const ecart = Math.round(p.count - moyenne);
  const pct = moyenne ? (ecart / moyenne) * 100 : 0;
  return (
    <div className="pd-tooltip">
      <div className="pd-tt-date">{fmtJourLong(label)}</div>
      <div className="pd-tt-val">{fNum(p.count)} lignes</div>
      <div className={`pd-tt-diff ${ecart >= 0 ? "pos" : "neg"}`}>
        {fSigne(ecart)} vs moyenne ({pct >= 0 ? "+" : ""}
        {pct.toFixed(1)} %)
      </div>
    </div>
  );
};

const VUES = [
  { cle: "volume", libelle: "Volume" },
  { cle: "ecart", libelle: "Écart vs moyenne" },
  { cle: "table", libelle: "Tableau" },
];

const AdminPerformanceDockScreen = () => {
  const { data, isLoading, isFetching, error } = useGetPerformanceDockQuery();
  const [refreshPerformanceDock, { isLoading: refreshing }] =
    useRefreshPerformanceDockMutation();

  const [vue, setVue] = useState("volume");

  const rows = useMemo(() => data?.rows || [], [data]);
  const stats = data?.stats;
  const moyenne = stats?.moyenne || 0;

  const handleRefresh = async () => {
    try {
      await refreshPerformanceDock().unwrap();
    } catch (e) {
      /* ignore */
    }
  };

  const handleExport = () => {
    if (!rows.length) return;
    const aoa = [["DATE", "LIGNES VALIDES", "ECART VS MOYENNE"]];
    rows.forEach((r) =>
      aoa.push([r.date, r.count, Math.round(r.count - moyenne)]),
    );
    aoa.push([]);
    aoa.push(["MOYENNE", stats.moyenneArrondie]);
    aoa.push(["MAXIMUM", stats.max]);
    aoa.push(["MINIMUM", stats.min]);
    aoa.push(["FICHIERS", stats.nbFichiers]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Performance Dock");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `performance_dock_${today}.xlsx`);
  };

  // Données dérivées : écart par jour + repères max / min / dernier jour.
  const { chartData, domaine, reperes, dernier } = useMemo(() => {
    const d = rows.map((r) => ({ ...r, ecart: Math.round(r.count - moyenne) }));
    const valeurs = d.map((r) => r.count);
    let iMax = -1;
    let iMin = -1;
    d.forEach((r, i) => {
      if (iMax < 0 || r.count > d[iMax].count) iMax = i;
      if (iMin < 0 || r.count < d[iMin].count) iMin = i;
    });
    return {
      chartData: d,
      domaine: domaineZoome(valeurs),
      reperes: { max: d[iMax] || null, min: d[iMin] || null },
      dernier: d.length ? d[d.length - 1] : null,
    };
  }, [rows, moyenne]);

  // Au-delà d'un mois de données, une étiquette sur deux suffit.
  const pasEtiquettes = chartData.length > 31 ? Math.ceil(chartData.length / 20) : 0;
  const loading = isLoading || (isFetching && !data);

  const axeX = (
    <XAxis
      dataKey="date"
      tickFormatter={fmtJour}
      tick={{ fill: AXE, fontSize: 11 }}
      tickLine={false}
      axisLine={{ stroke: GRILLE }}
      interval={pasEtiquettes || "preserveStartEnd"}
      minTickGap={8}
      height={28}
    />
  );

  return (
    <div className="admin-performance-dock">
      <div className="pd-header">
        <h1>
          <HiChartBar /> Performance Dock
        </h1>
        <div className="pd-actions">
          <button className="pd-btn" onClick={handleRefresh} disabled={refreshing || isFetching}>
            <HiRefresh className={refreshing ? "spin" : ""} /> Rafraîchir
          </button>
          <button className="pd-btn primary" onClick={handleExport} disabled={!rows.length}>
            <HiDownload /> Excel
          </button>
        </div>
      </div>

      <p className="pd-subtitle">
        Lignes réappro préparées par jour · onglet <strong>DONNEES</strong> · filtre
        GISEMENT ≠ vide / STOP · société QC
      </p>

      {loading ? (
        <div className="pd-loading">
          <Loader />
          <p>Lecture des fichiers reapro_mag…</p>
        </div>
      ) : error ? (
        <div className="pd-error">
          {error?.data?.message || "Erreur de chargement."}
        </div>
      ) : data && !data.dossierExiste ? (
        <div className="pd-error">
          <p>{data.message}</p>
          {/* Détail des chemins tentés : sans lui, « dossier introuvable »
              laisse croire à un bug alors que le dossier est simplement sur
              une AUTRE machine que le serveur. */}
          {Array.isArray(data.candidats) && data.candidats.length > 0 && (
            <ul className="pd-candidats">
              {data.candidats.map((c) => (
                <li key={c.chemin}>
                  <code>{c.chemin}</code> <em>({c.origine})</em> → {c.etat}
                </li>
              ))}
            </ul>
          )}
          {/* Ce que le serveur voit autour : dit si c'est le montage qui manque
              ou seulement le dernier dossier. */}
          {Array.isArray(data.sondages) && data.sondages.length > 0 && (
            <ul className="pd-candidats">
              {data.sondages.map((s) => (
                <li key={s.ancetre}>
                  <code>{s.ancetre}</code> contient :{" "}
                  {s.erreur
                    ? `lecture refusée (${s.erreur})`
                    : s.entrees.join(", ") || "(vide)"}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="pd-empty">{data?.message || "Aucune donnée."}</div>
      ) : (
        <>
          {isFetching && <div className="pd-refreshing">Actualisation…</div>}

          <div className="pd-kpis">
            <div className="pd-kpi avg">
              <span className="v">{fNum(stats.moyenneArrondie)}</span>
              <span className="l">Moyenne / jour</span>
            </div>
            {dernier && (
              <div className="pd-kpi">
                <span className="v">{fNum(dernier.count)}</span>
                <span className="l">
                  Dernier jour ({fmtJour(dernier.date)}){" "}
                  <b className={dernier.ecart >= 0 ? "pos" : "neg"}>
                    {fSigne(dernier.ecart)}
                  </b>
                </span>
              </div>
            )}
            <div className="pd-kpi best">
              <span className="v">{fNum(stats.max)}</span>
              <span className="l">
                Maximum {reperes.max ? `(${fmtJour(reperes.max.date)})` : ""}
              </span>
            </div>
            <div className="pd-kpi low">
              <span className="v">{fNum(stats.min)}</span>
              <span className="l">
                Minimum {reperes.min ? `(${fmtJour(reperes.min.date)})` : ""}
              </span>
            </div>
            <div className="pd-kpi">
              <span className="v">{fNum(stats.nbFichiers)}</span>
              <span className="l">Jours analysés</span>
            </div>
          </div>

          <div className="pd-vues" role="tablist" aria-label="Affichage">
            {VUES.map((v) => (
              <button
                key={v.cle}
                role="tab"
                aria-selected={vue === v.cle}
                className={`pd-vue ${vue === v.cle ? "active" : ""}`}
                onClick={() => setVue(v.cle)}
              >
                {v.libelle}
              </button>
            ))}
          </div>

          <div className="pd-chart-wrap">
            {vue === "volume" && (
              <>
                <ResponsiveContainer width="100%" height={420}>
                  <ComposedChart
                    data={chartData}
                    margin={{ top: 24, right: 28, left: 0, bottom: 4 }}
                    accessibilityLayer
                  >
                    <defs>
                      <linearGradient id="pdAire" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={SERIE} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={SERIE} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={GRILLE} vertical={false} />
                    {axeX}
                    <YAxis
                      domain={domaine}
                      tick={{ fill: AXE, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => v.toLocaleString("fr-FR")}
                      width={58}
                    />
                    <Tooltip
                      cursor={{ stroke: AXE, strokeWidth: 1 }}
                      content={<InfoBulle moyenne={moyenne} />}
                    />
                    <ReferenceLine
                      y={moyenne}
                      stroke={MOYENNE}
                      strokeWidth={1.5}
                      strokeDasharray="6 4"
                      label={{
                        value: `Moyenne ${fNum(moyenne)}`,
                        position: "insideTopRight",
                        fill: MOYENNE,
                        fontSize: 11,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      stroke={SERIE}
                      strokeWidth={2}
                      fill="url(#pdAire)"
                      dot={{ r: 3, fill: SERIE, stroke: "none" }}
                      activeDot={{ r: 5, stroke: "#12121a", strokeWidth: 2 }}
                    />
                    {/* Étiquettes directes sur les deux journées qui comptent,
                        plutôt qu'un nombre sur chaque point. */}
                    {reperes.max && (
                      <ReferenceDot
                        x={reperes.max.date}
                        y={reperes.max.count}
                        r={5}
                        fill={AU_DESSUS}
                        stroke="#12121a"
                        strokeWidth={2}
                        label={{
                          value: `▲ ${fNum(reperes.max.count)}`,
                          position: "top",
                          fill: AU_DESSUS,
                          fontSize: 11,
                        }}
                      />
                    )}
                    {reperes.min && (
                      <ReferenceDot
                        x={reperes.min.date}
                        y={reperes.min.count}
                        r={5}
                        fill={EN_DESSOUS}
                        stroke="#12121a"
                        strokeWidth={2}
                        label={{
                          value: `▼ ${fNum(reperes.min.count)}`,
                          position: "bottom",
                          fill: EN_DESSOUS,
                          fontSize: 11,
                        }}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                <p className="pd-note">
                  Échelle resserrée autour des valeurs pour rendre les écarts
                  lisibles — l'axe ne part pas de zéro. Pour comparer en valeur
                  absolue, voir l'onglet « Écart vs moyenne ».
                </p>
              </>
            )}

            {vue === "ecart" && (
              <>
                <ResponsiveContainer width="100%" height={420}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 24, right: 28, left: 0, bottom: 4 }}
                    barCategoryGap="22%"
                    accessibilityLayer
                  >
                    <CartesianGrid stroke={GRILLE} vertical={false} />
                    {axeX}
                    <YAxis
                      tick={{ fill: AXE, fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => fSigne(v)}
                      width={58}
                    />
                    <Tooltip
                      cursor={{ fill: "rgba(255,255,255,0.04)" }}
                      content={<InfoBulle moyenne={moyenne} />}
                    />
                    <ReferenceLine
                      y={0}
                      stroke={MOYENNE}
                      strokeWidth={1.5}
                      label={{
                        value: `Moyenne ${fNum(moyenne)}`,
                        position: "insideTopRight",
                        fill: MOYENNE,
                        fontSize: 11,
                      }}
                    />
                    <Bar dataKey="ecart" shape={<BarreEcart />} maxBarSize={44}>
                      {chartData.map((r) => (
                        <Cell
                          key={r.date}
                          fill={r.ecart >= 0 ? AU_DESSUS : EN_DESSOUS}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="pd-legend">
                  <span>
                    <i className="dot" style={{ background: AU_DESSUS }} /> Au‑dessus de
                    la moyenne
                  </span>
                  <span>
                    <i className="dot" style={{ background: EN_DESSOUS }} /> En‑dessous
                    de la moyenne
                  </span>
                </div>
              </>
            )}

            {vue === "table" && (
              <div className="pd-table-wrap">
                <table className="pd-table">
                  <thead>
                    <tr>
                      <th>Jour</th>
                      <th className="num">Lignes valides</th>
                      <th className="num">Écart vs moyenne</th>
                      <th className="num">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartData.map((r) => (
                      <tr key={r.date}>
                        <td>{fmtJourLong(r.date)}</td>
                        <td className="num">{fNum(r.count)}</td>
                        <td className={`num ${r.ecart >= 0 ? "pos" : "neg"}`}>
                          {fSigne(r.ecart)}
                        </td>
                        <td className={`num ${r.ecart >= 0 ? "pos" : "neg"}`}>
                          {moyenne
                            ? `${r.ecart >= 0 ? "+" : ""}${((r.ecart / moyenne) * 100).toFixed(1)} %`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Moyenne · {fNum(stats.nbFichiers)} jours</td>
                      <td className="num">{fNum(stats.moyenneArrondie)}</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminPerformanceDockScreen;
