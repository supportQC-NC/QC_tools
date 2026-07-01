// src/screens/admin/AdminPerformanceDockScreen.jsx
import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { HiRefresh, HiDownload, HiChartBar } from "react-icons/hi";
import {
  useGetPerformanceDockQuery,
  useRefreshPerformanceDockMutation,
} from "../../slices/performanceDockApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminPerformanceDockScreen.css";

const GREEN = "#20b264";
const RED = "#dc3545";
const AVG_COLOR = "#e05252";

const fNum = (n) => Math.round(Number(n) || 0).toLocaleString("fr-FR");

const CustomTooltip = ({ active, payload, label, moyenne }) => {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0].value;
  const diff = Math.round(v - moyenne);
  const sign = diff >= 0 ? "+" : "";
  return (
    <div className="pd-tooltip">
      <div className="pd-tt-date">{label}</div>
      <div className="pd-tt-val">{fNum(v)} lignes</div>
      <div className={`pd-tt-diff ${diff >= 0 ? "pos" : "neg"}`}>
        {sign}
        {fNum(diff)} vs moyenne
      </div>
    </div>
  );
};

const AdminPerformanceDockScreen = () => {
  const { data, isLoading, isFetching, error } = useGetPerformanceDockQuery();
  const [refreshPerformanceDock, { isLoading: refreshing }] =
    useRefreshPerformanceDockMutation();

  const [search] = useState("");

  const rows = data?.rows || [];
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

  const chartData = useMemo(() => rows, [rows]);
  const loading = isLoading || (isFetching && !data);

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
        Onglet <strong>DONNEES</strong> · Filtre : GISEMENT ≠ vide / STOP · Société QC
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
        <div className="pd-error">{data.message}</div>
      ) : rows.length === 0 ? (
        <div className="pd-empty">{data?.message || "Aucune donnée."}</div>
      ) : (
        <>
          {isFetching && <div className="pd-refreshing">Actualisation…</div>}

          <div className="pd-kpis">
            <div className="pd-kpi">
              <span className="v">{fNum(stats.nbFichiers)}</span>
              <span className="l">Fichiers analysés</span>
            </div>
            <div className="pd-kpi avg">
              <span className="v">{fNum(stats.moyenneArrondie)}</span>
              <span className="l">Moyenne (ligne rouge)</span>
            </div>
            <div className="pd-kpi best">
              <span className="v">{fNum(stats.max)}</span>
              <span className="l">Maximum</span>
            </div>
            <div className="pd-kpi low">
              <span className="v">{fNum(stats.min)}</span>
              <span className="l">Minimum</span>
            </div>
          </div>

          <div className="pd-chart-wrap">
            <ResponsiveContainer width="100%" height={440}>
              <BarChart data={chartData} margin={{ top: 20, right: 20, left: 0, bottom: 40 }}>
                <CartesianGrid stroke="#21262d" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "#8b949e", fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "#8b949e", fontSize: 11 }}
                  tickFormatter={(v) => v.toLocaleString("fr-FR")}
                  width={60}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  content={<CustomTooltip moyenne={moyenne} />}
                />
                <ReferenceLine
                  y={moyenne}
                  stroke={AVG_COLOR}
                  strokeWidth={2.5}
                  strokeDasharray="7 4"
                  label={{
                    value: `Moyenne ${fNum(moyenne)}`,
                    position: "right",
                    fill: AVG_COLOR,
                    fontSize: 11,
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {chartData.map((r, i) => (
                    <Cell key={i} fill={r.count < moyenne ? RED : GREEN} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div className="pd-legend">
              <span>
                <i className="dot" style={{ background: GREEN }} /> Au‑dessus de la moyenne
              </span>
              <span>
                <i className="dot" style={{ background: RED }} /> En‑dessous de la moyenne
              </span>
              <span>
                <i className="line-dot" /> Moyenne ({fNum(moyenne)} lignes)
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminPerformanceDockScreen;