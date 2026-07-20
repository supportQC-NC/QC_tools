// src/screens/admin/AdminTopArticlesScreen.jsx
import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  HiDownload,
  HiTrendingUp,
  HiCurrencyDollar,
  HiCube,
  HiCollection,
  HiDocumentText,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { useGetTopArticlesQuery } from "../../slices/topArticlesApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminTopArticlesScreen.css";

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const startOfYear = () => ymd(new Date(new Date().getFullYear(), 0, 1));
const today = () => ymd(new Date());

const r0 = (n) => Math.round(Number(n) || 0);
const fF = (n) => `${r0(n).toLocaleString("fr-FR")} F`;
const fNum = (n) => (Number(n) || 0).toLocaleString("fr-FR");
const fPct = (n) => `${(Number(n) || 0).toFixed(2)} %`;
const num = { type: "rightAligned" };

const TOOLTIP_STYLE = { background: "#12121a", border: "1px solid #2a2a3a" };

const AdminTopArticlesScreen = () => {
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalDossier) || "";
  const [dateDebut, setDateDebut] = useState(startOfYear);
  const [dateFin, setDateFin] = useState(today);
  const [mode, setMode] = useState("ca"); // "ca" | "qte"

  const { data, isLoading, isFetching, error } = useGetTopArticlesQuery(
    { nomDossierDBF: selectedEntreprise, dateDebut, dateFin },
    { skip: !selectedEntreprise || !dateDebut || !dateFin },
  );

  const totaux = data?.totaux;
  const loading = isLoading || (isFetching && !data);

  // Liste courante selon le mode
  const articles = useMemo(
    () => (mode === "ca" ? data?.topCa : data?.topQte) || [],
    [data, mode],
  );

  // Top 15 pour le graphique en barres horizontales
  const chartData = useMemo(
    () =>
      articles.slice(0, 15).map((a) => ({
        nom: `${a.nart} — ${(a.design || "").slice(0, 28)}`,
        valeur: mode === "ca" ? Math.round(a.ca) : Math.round(a.qte),
      })),
    [articles, mode],
  );

  const columns = useMemo(
    () => [
      {
        field: "rang", headerName: "#", minWidth: 70, maxWidth: 80,
        ...num, cellClass: "cell-rang",
      },
      { field: "nart", headerName: "Code article", minWidth: 110, cellClass: "cell-mono" },
      { field: "design", headerName: "Désignation", minWidth: 280, flex: 1 },
      {
        field: "qte", headerName: "Qté vendue", ...num, minWidth: 120,
        filter: "agNumberColumnFilter",
        valueFormatter: (p) => fNum(p.value),
        cellClass: mode === "qte" ? "col-strong" : "",
      },
      {
        field: "ca", headerName: "CA HT", ...num, minWidth: 140,
        filter: "agNumberColumnFilter",
        valueFormatter: (p) => fF(p.value),
        cellClass: mode === "ca" ? "col-strong" : "",
      },
      {
        field: "prixMoyen", headerName: "Prix moyen HT", ...num, minWidth: 130,
        filter: "agNumberColumnFilter",
        valueFormatter: (p) => fF(p.value),
      },
      {
        field: mode === "ca" ? "partCa" : "partQte",
        headerName: mode === "ca" ? "% du CA" : "% des qtés",
        ...num, minWidth: 110,
        filter: "agNumberColumnFilter",
        valueFormatter: (p) => fPct(p.value),
      },
      {
        field: "nbFactures", headerName: "Nb factures", ...num, minWidth: 115,
        filter: "agNumberColumnFilter",
        valueFormatter: (p) => fNum(p.value),
      },
    ],
    [mode],
  );

  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      resizable: true,
      filter: true,
      suppressHeaderMenuButton: true,
    }),
    [],
  );

  const handleExport = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    const enTetes = [
      "Rang", "Code article", "Désignation", "Qté vendue", "CA HT (XPF)",
      "Prix moyen HT (XPF)", "% du CA", "% des qtés", "Nb factures",
    ];
    const ligne = (a) => [
      a.rang, a.nart, a.design, r0(a.qte), r0(a.ca), r0(a.prixMoyen),
      Number(a.partCa.toFixed(2)), Number(a.partQte.toFixed(2)), a.nbFactures,
    ];

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([enTetes, ...(data.topCa || []).map(ligne)]),
      "Top 100 CA HT",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([enTetes, ...(data.topQte || []).map(ligne)]),
      "Top 100 Quantité",
    );

    XLSX.writeFile(
      wb,
      `top_articles_${selectedEntreprise}_${data.dateDebut}_${data.dateFin}.xlsx`,
    );
  };

  return (
    <div className="admin-top-articles">
      <div className="ta-header">
        <h1>
          <HiTrendingUp /> Top Articles
        </h1>
        <div className="ta-actions">
          <label className="ta-field">
            Du
            <input
              type="date"
              value={dateDebut}
              max={dateFin}
              onChange={(e) => setDateDebut(e.target.value)}
            />
          </label>
          <label className="ta-field">
            Au
            <input
              type="date"
              value={dateFin}
              min={dateDebut}
              max={today()}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </label>
          <button className="ta-btn primary" onClick={handleExport} disabled={!data}>
            <HiDownload /> Excel
          </button>
        </div>
      </div>

      <div className="ta-note">
        Top 100 des articles vendus — CA HT = <strong>Qté × PVTE</strong>,
        factures <strong>F</strong> avec avoirs <strong>A déduits</strong>. Le
        cache ne conserve que l'année en cours et l'année précédente.
      </div>

      {!selectedEntreprise ? (
        <div className="ta-empty">
          Sélectionnez une société dans l'en-tête et une période.
        </div>
      ) : loading ? (
        <div className="ta-loading">
          <Loader />
          <p className="ta-hint">
            Lecture des factures et du détail — long au 1ᵉʳ accès, puis mis en
            cache 5 min.
          </p>
        </div>
      ) : error ? (
        <div className="ta-error">
          {error?.data?.message || "Erreur de chargement."}
        </div>
      ) : data ? (
        <>
          {/* ===== KPI ===== */}
          <div className="ta-kpis">
            <div className="ta-kpi">
              <div className="ta-kpi-icon"><HiCurrencyDollar /></div>
              <div>
                <span className="ta-kpi-value">{fF(totaux.caTotal)}</span>
                <span className="ta-kpi-label">CA HT total (F − avoirs)</span>
              </div>
            </div>
            <div className="ta-kpi">
              <div className="ta-kpi-icon"><HiCube /></div>
              <div>
                <span className="ta-kpi-value">{fNum(totaux.qteTotale)}</span>
                <span className="ta-kpi-label">Quantité totale vendue</span>
              </div>
            </div>
            <div className="ta-kpi">
              <div className="ta-kpi-icon"><HiCollection /></div>
              <div>
                <span className="ta-kpi-value">
                  {fNum(totaux.nbArticlesDistincts)}
                </span>
                <span className="ta-kpi-label">Articles distincts</span>
              </div>
            </div>
            <div className="ta-kpi">
              <div className="ta-kpi-icon"><HiDocumentText /></div>
              <div>
                <span className="ta-kpi-value">
                  {fNum(totaux.nbFacturesAnalysees)}
                </span>
                <span className="ta-kpi-label">Factures analysées (F + A)</span>
              </div>
            </div>
          </div>

          {/* ===== Toggle CA / Quantité ===== */}
          <div className="ta-toggle">
            <button
              type="button"
              className={mode === "ca" ? "active" : ""}
              onClick={() => setMode("ca")}
            >
              CA HT
            </button>
            <button
              type="button"
              className={mode === "qte" ? "active" : ""}
              onClick={() => setMode("qte")}
            >
              Quantité
            </button>
          </div>

          {/* ===== Top 15 en barres ===== */}
          <div className="ta-card">
            <h3>
              Top 15 par {mode === "ca" ? "CA HT" : "quantité vendue"}
            </h3>
            <ResponsiveContainer
              width="100%"
              height={Math.max(280, chartData.length * 30)}
            >
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                <XAxis
                  type="number"
                  stroke="#9aa0b5"
                  fontSize={11}
                  tickFormatter={(v) =>
                    mode === "ca" ? `${Math.round(v / 1000)}k` : fNum(v)
                  }
                />
                <YAxis
                  type="category"
                  dataKey="nom"
                  stroke="#9aa0b5"
                  fontSize={11}
                  width={280}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v) => (mode === "ca" ? fF(v) : fNum(v))}
                />
                <Bar
                  dataKey="valeur"
                  name={mode === "ca" ? "CA HT" : "Quantité"}
                  fill={mode === "ca" ? "#6366f1" : "#22c55e"}
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ===== Top 100 en tableau ===== */}
          <div className="ta-table-title">
            Top 100 par {mode === "ca" ? "CA HT" : "quantité vendue"}
          </div>
          <div className="ag-theme-quartz ta-grid">
            <AgGridReact
              rowData={articles}
              columnDefs={columns}
              defaultColDef={defaultColDef}
              animateRows
              suppressCellFocus
            />
          </div>
        </>
      ) : null}
    </div>
  );
};

export default AdminTopArticlesScreen;