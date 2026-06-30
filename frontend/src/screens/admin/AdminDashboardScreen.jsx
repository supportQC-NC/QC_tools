import React, { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  HiUsers,
  HiOfficeBuilding,
  HiClipboardList,
  HiRefresh,
  HiDocumentReport,
  HiArrowRight,
  HiCheckCircle,
  HiClock,
  HiTrendingUp,
  HiTruck,
  HiInboxIn,
  HiSparkles,
  HiExclamationCircle,
  HiCube,
} from "react-icons/hi";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  AreaChart,
  Area,
  Legend,
} from "recharts";
import { useGetUsersQuery } from "../../slices/userApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetGlobalDashboardQuery,
  useGetEntrepriseDashboardQuery,
} from "../../slices/dashboardApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminDashboardScreen.css";

const COLORS = {
  primary: "#4da6ff",
  success: "#22c55e",
  warning: "#f59e0b",
  danger: "#ef4444",
  purple: "#a855f7",
  cyan: "#06b6d4",
  pink: "#ec4899",
  indigo: "#6366f1",
  amber: "#f59e0b",
};

const ETAT_COLORS = {
  0: "#94a3b8",
  1: "#3b82f6",
  2: "#f59e0b",
  3: "#22c55e",
  4: "#6b7280",
};

const fmtInt = (n) =>
  (Math.trunc(Number(n) || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="chart-tooltip">
        <p className="tooltip-label">{label}</p>
        {payload.map((entry, index) => (
          <p
            key={index}
            className="tooltip-value"
            style={{ color: entry.color }}
          >
            {entry.name}: <strong>{fmtInt(entry.value)}</strong>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

const AdminDashboard = () => {
  const { data: users } = useGetUsersQuery();
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();
  const { data: global, isLoading: loadingGlobal } =
    useGetGlobalDashboardQuery();

  // Entreprise sélectionnée pour la section DBF
  const entreprisesActives = useMemo(
    () => (entreprises || []).filter((e) => e.isActive !== false),
    [entreprises],
  );
  const [dossier, setDossier] = useState("");
  useEffect(() => {
    if (!dossier && entreprisesActives.length > 0) {
      setDossier(entreprisesActives[0].nomDossierDBF);
    }
  }, [entreprisesActives, dossier]);

  const { data: entrepriseData, isFetching: loadingEntreprise } =
    useGetEntrepriseDashboardQuery(dossier, { skip: !dossier });

  const rec = global?.receptions || {};
  const activite = global?.activite || [];

  // ---- Données section entreprise ----
  const commandesParEtat = entrepriseData?.commandes?.parEtat || [];
  const topFournisseurs = entrepriseData?.commandes?.topFournisseurs || [];
  const prochainsBateaux = entrepriseData?.commandes?.prochainsBateaux || [];
  const topVentes = entrepriseData?.articles?.topVentes || [];
  const topRuptures = entrepriseData?.articles?.topRuptures || [];

  const ventesChart = useMemo(
    () =>
      topVentes.map((v) => ({
        name: (v.design || v.nart || "").slice(0, 22) || v.nart,
        ventes: v.ventes,
      })),
    [topVentes],
  );

  if (loadingGlobal || loadingEntreprises) {
    return (
      <div className="admin-dashboard">
        <div className="dashboard-loading">
          <Loader />
          <p>Chargement du tableau de bord...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <div className="dashboard-header-content">
          <h1>Tableau de bord</h1>
        </div>
        <div className="dashboard-header-date">
          {new Date().toLocaleDateString("fr-FR", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </div>
      </div>

      {/* ===================== KPI GLOBAUX (Mongo) ===================== */}
      <div className="stats-grid">
        <div className="stat-card stat-card-commandes">
          <div className="stat-card-icon">
            <HiInboxIn />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{fmtInt(rec.total || 0)}</span>
            <span className="stat-card-label">Réceptions</span>
            <div className="stat-card-details">
              <span className="stat-detail warning">
                <HiClock /> {fmtInt(rec.enCours || 0)} en cours
              </span>
              <span className="stat-detail success">
                <HiCheckCircle /> {fmtInt(rec.termine || 0)} terminées
              </span>
            </div>
          </div>
        </div>

        <div className="stat-card stat-card-entreprises">
          <div className="stat-card-icon">
            <HiCheckCircle />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">
              {rec.tauxConformite == null ? "—" : `${rec.tauxConformite}%`}
            </span>
            <span className="stat-card-label">Conformité réception</span>
            <div className="stat-card-details">
              <span className="stat-detail danger">
                <HiExclamationCircle /> {fmtInt(rec.totalEcarts || 0)} écarts
              </span>
            </div>
          </div>
        </div>

        <div className="stat-card stat-card-releves">
          <div className="stat-card-icon">
            <HiSparkles />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{fmtInt(rec.nouveautes || 0)}</span>
            <span className="stat-card-label">Nouveautés détectées</span>
            <div className="stat-card-details">
              <span className="stat-detail">en réception</span>
            </div>
          </div>
        </div>

        <div className="stat-card stat-card-users">
          <div className="stat-card-icon">
            <HiUsers />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">
              {fmtInt(users?.length || 0)}
            </span>
            <span className="stat-card-label">Utilisateurs</span>
            <div className="stat-card-details">
              <span className="stat-detail success">
                <HiCheckCircle /> {fmtInt((users || []).filter((u) => u.isActive).length)} actifs
              </span>
            </div>
          </div>
          <Link to="/admin/users" className="stat-card-link">
            <HiArrowRight />
          </Link>
        </div>

        <div className="stat-card stat-card-concurrents">
          <div className="stat-card-icon">
            <HiOfficeBuilding />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">
              {fmtInt(entreprises?.length || 0)}
            </span>
            <span className="stat-card-label">Entreprises</span>
            <div className="stat-card-details">
              <span className="stat-detail success">
                <HiCheckCircle /> {fmtInt(entreprisesActives.length)} actives
              </span>
            </div>
          </div>
          <Link to="/admin/entreprises" className="stat-card-link">
            <HiArrowRight />
          </Link>
        </div>
      </div>

      {/* ===================== Activité + sessions ===================== */}
      <div className="dashboard-main">
        <div className="dashboard-charts">
          <div className="charts-row charts-row-single">
            <div className="chart-card">
              <div className="chart-card-header">
                <h3>
                  <HiTrendingUp /> Activité réelle ({global?.nbJours || 14} derniers jours)
                </h3>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={activite}>
                    <defs>
                      <linearGradient id="gRec" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gInv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.success} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={COLORS.success} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gRel" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS.purple} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={COLORS.purple} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="jour" stroke="var(--text-muted)" fontSize={10} />
                    <YAxis stroke="var(--text-muted)" fontSize={10} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Area type="monotone" dataKey="receptions" name="Réceptions" stroke={COLORS.primary} fill="url(#gRec)" strokeWidth={2} />
                    <Area type="monotone" dataKey="inventaires" name="Inventaires" stroke={COLORS.success} fill="url(#gInv)" strokeWidth={2} />
                    <Area type="monotone" dataKey="releves" name="Relevés" stroke={COLORS.purple} fill="url(#gRel)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        <div className="dashboard-sidebar">
          <div className="top-list-card">
            <h3>
              <HiClock /> Sessions en cours
            </h3>
            <div className="top-list">
              <div className="top-list-item">
                <span className="top-list-name">Inventaires</span>
                <span className="top-list-value">{fmtInt(global?.inventaires?.enCours || 0)}</span>
              </div>
              <div className="top-list-item">
                <span className="top-list-name">Relevés de prix</span>
                <span className="top-list-value">{fmtInt(global?.releves?.enCours || 0)}</span>
              </div>
              <div className="top-list-item">
                <span className="top-list-name">Réappros</span>
                <span className="top-list-value">{fmtInt(global?.reappros?.enCours || 0)}</span>
              </div>
            </div>
          </div>

          <div className="quick-actions-card">
            <h3>Actions rapides</h3>
            <div className="quick-actions-grid">
              <Link to="/admin/commandes" className="quick-action">
                <div className="quick-action-icon" style={{ background: "rgba(245,158,11,0.15)", color: COLORS.amber }}>
                  <HiTruck />
                </div>
                <span>Commandes</span>
              </Link>
              <Link to="/admin/inventaires" className="quick-action">
                <div className="quick-action-icon" style={{ background: "rgba(6,182,212,0.15)", color: COLORS.cyan }}>
                  <HiClipboardList />
                </div>
                <span>Inventaires</span>
              </Link>
              <Link to="/admin/releves" className="quick-action">
                <div className="quick-action-icon" style={{ background: "rgba(168,85,247,0.15)", color: COLORS.purple }}>
                  <HiDocumentReport />
                </div>
                <span>Relevés</span>
              </Link>
              <Link to="/admin/reappros" className="quick-action">
                <div className="quick-action-icon" style={{ background: "rgba(236,72,153,0.15)", color: COLORS.pink }}>
                  <HiRefresh />
                </div>
                <span>Réappros</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ===================== SECTION ENTREPRISE (DBF) ===================== */}
      <div className="dashboard-section-head">
        <h2>
          <HiOfficeBuilding /> Détail par entreprise
        </h2>
        <select
          className="dashboard-ent-select"
          value={dossier}
          onChange={(e) => setDossier(e.target.value)}
        >
          {entreprisesActives.map((e) => (
            <option key={e._id} value={e.nomDossierDBF}>
              {e.nomComplet || e.nom || e.nomDossierDBF}
            </option>
          ))}
        </select>
      </div>

      {loadingEntreprise ? (
        <div className="dashboard-loading">
          <Loader />
          <p>Chargement des données de l'entreprise...</p>
        </div>
      ) : !entrepriseData ? (
        <div className="chart-empty">
          <HiOfficeBuilding />
          <p>Sélectionnez une entreprise</p>
        </div>
      ) : (
        <>
          {/* KPI mini DBF */}
          <div className="kpi-mini-grid">
            <div className="kpi-mini">
              <span className="kpi-mini-value">{fmtInt(entrepriseData.commandes.total)}</span>
              <span className="kpi-mini-label"><HiTruck /> Commandes</span>
            </div>
            <div className="kpi-mini kpi-mini-amber">
              <span className="kpi-mini-value">{fmtInt(entrepriseData.commandes.aReceptionner)}</span>
              <span className="kpi-mini-label"><HiInboxIn /> À réceptionner</span>
            </div>
            <div className="kpi-mini kpi-mini-green">
              <span className="kpi-mini-value">{fmtInt(entrepriseData.articles.nbNouveautes)}</span>
              <span className="kpi-mini-label"><HiSparkles /> Nouveautés</span>
            </div>
            <div className="kpi-mini kpi-mini-red">
              <span className="kpi-mini-value">{fmtInt(entrepriseData.articles.nbRuptures)}</span>
              <span className="kpi-mini-label"><HiExclamationCircle /> Ruptures</span>
            </div>
            <div className="kpi-mini">
              <span className="kpi-mini-value">{fmtInt(entrepriseData.articles.totalArticles)}</span>
              <span className="kpi-mini-label"><HiCube /> Articles</span>
            </div>
          </div>

          <div className="charts-row">
            {/* Commandes par état */}
            <div className="chart-card">
              <div className="chart-card-header">
                <h3><HiTruck /> Commandes par état</h3>
                <Link to="/admin/commandes" className="chart-card-link">
                  Voir tout <HiArrowRight />
                </Link>
              </div>
              <div className="chart-container">
                {commandesParEtat.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={commandesParEtat}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={10} />
                      <YAxis stroke="var(--text-muted)" fontSize={10} allowDecimals={false} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="count" name="Commandes" radius={[4, 4, 0, 0]}>
                        {commandesParEtat.map((entry, index) => (
                          <Cell key={`c-${index}`} fill={ETAT_COLORS[entry.etat] || COLORS.primary} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty"><HiTruck /><p>Aucune commande</p></div>
                )}
              </div>
            </div>

            {/* Top ventes */}
            <div className="chart-card">
              <div className="chart-card-header">
                <h3><HiTrendingUp /> Meilleures ventes (12 mois)</h3>
              </div>
              <div className="chart-container">
                {ventesChart.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={ventesChart} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis type="number" stroke="var(--text-muted)" fontSize={10} allowDecimals={false} />
                      <YAxis dataKey="name" type="category" stroke="var(--text-muted)" fontSize={9} width={130} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="ventes" name="Ventes" fill={COLORS.cyan} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty"><HiTrendingUp /><p>Aucune vente</p></div>
                )}
              </div>
            </div>
          </div>

          <div className="charts-row">
            {/* Top fournisseurs */}
            <div className="top-list-card">
              <h3><HiTruck /> Top fournisseurs (commandes)</h3>
              {topFournisseurs.length > 0 ? (
                <div className="top-list">
                  {topFournisseurs.map((f, i) => (
                    <div key={f.code} className="top-list-item">
                      <span className="top-list-rank">{i + 1}</span>
                      <span className="top-list-name">{f.nom}</span>
                      <span className="top-list-value">{fmtInt(f.count)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="top-list-empty"><p>Aucun fournisseur</p></div>
              )}
            </div>

            {/* Prochains bateaux */}
            <div className="top-list-card">
              <h3><HiInboxIn /> Prochaines arrivées (bateaux)</h3>
              {prochainsBateaux.length > 0 ? (
                <div className="top-list">
                  {prochainsBateaux.map((b, i) => (
                    <div key={i} className="top-list-item">
                      <span className="top-list-name">
                        {b.bateau || "—"}
                        <span className="top-list-sub"> · {fmtDate(b.arrivee)}</span>
                      </span>
                      <span className="top-list-value">{fmtInt(b.count)} cmd</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="top-list-empty"><p>Aucune arrivée à venir</p></div>
              )}
            </div>

            {/* Top ruptures */}
            <div className="top-list-card">
              <h3><HiExclamationCircle /> Ruptures (vendeurs à 0)</h3>
              {topRuptures.length > 0 ? (
                <div className="top-list">
                  {topRuptures.map((r, i) => (
                    <div key={r.nart || i} className="top-list-item">
                      <span className="top-list-name">
                        {(r.design || r.nart || "").slice(0, 28)}
                        <span className="top-list-sub"> · {r.nart}</span>
                      </span>
                      <span className="top-list-value danger">{fmtInt(r.ventes)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="top-list-empty"><p>Aucune rupture</p></div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminDashboard;