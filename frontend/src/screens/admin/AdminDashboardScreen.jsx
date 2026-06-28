import React from "react";
import { Link } from "react-router-dom";
import {
  HiUsers,
  HiOfficeBuilding,
  HiUserGroup,
  HiClipboardList,
  HiRefresh,
  HiDocumentReport,
  HiArrowRight,
  HiCheckCircle,
  HiXCircle,
  HiClock,
  HiTrendingUp,
  HiTruck,
} from "react-icons/hi";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  Legend,
} from "recharts";
import { useGetUsersQuery } from "../../slices/userApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { useGetConcurrentsQuery } from "../../slices/concurrentApiSLice";
import { useGetRelevesStatsQuery } from "../../slices/releveApiSlice";
import { useGetCommandesQuery } from "../../slices/commandeApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminDashboardScreen.css";

// Couleurs pour les graphiques
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

const AdminDashboard = () => {
  // Récupération des données
  const { data: users, isLoading: loadingUsers } = useGetUsersQuery();
  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();
  const { data: concurrents, isLoading: loadingConcurrents } =
    useGetConcurrentsQuery({});
  const { data: relevesStats, isLoading: loadingReleves } =
    useGetRelevesStatsQuery();
  const { data: commandesData, isLoading: loadingCommandes } =
    useGetCommandesQuery(
      {
        // On charge la première entreprise active pour avoir des stats globales
        nomDossierDBF: entreprises?.[0]?.nomDossierDBF,
        page: 1,
        limit: 1,
      },
      {
        skip: !entreprises?.[0]?.nomDossierDBF,
      },
    );

  // Charger aussi les commandes en cours (ETAT=1)
  const { data: commandesEnCoursData } = useGetCommandesQuery(
    {
      nomDossierDBF: entreprises?.[0]?.nomDossierDBF,
      page: 1,
      limit: 1,
      etat: 1,
    },
    {
      skip: !entreprises?.[0]?.nomDossierDBF,
    },
  );

  // Charger les commandes clôturées (ETAT=4)
  const { data: commandesClotuData } = useGetCommandesQuery(
    {
      nomDossierDBF: entreprises?.[0]?.nomDossierDBF,
      page: 1,
      limit: 1,
      etat: 4,
    },
    {
      skip: !entreprises?.[0]?.nomDossierDBF,
    },
  );

  const isLoading =
    loadingUsers ||
    loadingEntreprises ||
    loadingConcurrents ||
    loadingReleves;

  // Calcul des statistiques
  const stats = {
    users: {
      total: users?.length || 0,
      active: users?.filter((u) => u.isActive).length || 0,
      admins: users?.filter((u) => u.role === "admin").length || 0,
      inactive: users?.filter((u) => !u.isActive).length || 0,
    },
    entreprises: {
      total: entreprises?.length || 0,
      active: entreprises?.filter((e) => e.isActive).length || 0,
      inactive: entreprises?.filter((e) => !e.isActive).length || 0,
    },
    concurrents: {
      total: concurrents?.length || 0,
      active: concurrents?.filter((c) => c.isActive).length || 0,
      inactive: concurrents?.filter((c) => !c.isActive).length || 0,
    },
    releves: {
      total: relevesStats?.totalReleves || 0,
      enCours: relevesStats?.relevesEnCours || 0,
      exportes: relevesStats?.relevesExportes || 0,
    },
    commandes: {
      total: commandesData?.pagination?.totalRecords || 0,
      enCours: commandesEnCoursData?.pagination?.totalRecords || 0,
      cloturees: commandesClotuData?.pagination?.totalRecords || 0,
    },
  };

  // Données pour le graphique des utilisateurs par rôle
  const usersByRole = [
    { name: "Admins", value: stats.users.admins, color: COLORS.danger },
    {
      name: "Utilisateurs",
      value: stats.users.total - stats.users.admins,
      color: COLORS.primary,
    },
  ];

  // Données pour le graphique des statuts
  const statusData = [
    {
      name: "Utilisateurs",
      actifs: stats.users.active,
      inactifs: stats.users.inactive,
    },
    {
      name: "Entreprises",
      actifs: stats.entreprises.active,
      inactifs: stats.entreprises.inactive,
    },
    {
      name: "Concurrents",
      actifs: stats.concurrents.active,
      inactifs: stats.concurrents.inactive,
    },
  ];

  // Données pour les relevés par entreprise
  const relevesByEntreprise = relevesStats?.parEntreprise?.slice(0, 6) || [];

  // Données pour les concurrents les plus utilisés
  const topConcurrents = relevesStats?.parConcurrent?.slice(0, 5) || [];

  // Données pour commandes par état (construites depuis les queries)
  const commandesByEtat = [
    {
      label: "En cours",
      etat: 1,
      count: stats.commandes.enCours,
    },
    {
      label: "Autres",
      etat: 0,
      count: Math.max(
        0,
        stats.commandes.total - stats.commandes.enCours - stats.commandes.cloturees,
      ),
    },
    {
      label: "Clôturées",
      etat: 4,
      count: stats.commandes.cloturees,
    },
  ].filter((e) => e.count > 0);

  // Données simulées pour l'activité récente
  const activityData = [
    { jour: "Lun", releves: 12, inventaires: 5 },
    { jour: "Mar", releves: 19, inventaires: 8 },
    { jour: "Mer", releves: 15, inventaires: 12 },
    { jour: "Jeu", releves: 22, inventaires: 7 },
    { jour: "Ven", releves: 28, inventaires: 15 },
    { jour: "Sam", releves: 8, inventaires: 3 },
    { jour: "Dim", releves: 5, inventaires: 2 },
  ];

  // Custom tooltip pour les graphiques
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
              {entry.name}: <strong>{entry.value}</strong>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Labels des états commande
  const ETAT_LABELS = {
    0: "Brouillon",
    1: "En cours",
    2: "Expédiée",
    3: "Réceptionnée",
    4: "Clôturée",
  };
  const ETAT_COLORS = {
    0: "#94a3b8",
    1: "#3b82f6",
    2: "#f59e0b",
    3: "#22c55e",
    4: "#6b7280",
  };

  if (isLoading) {
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

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card stat-card-users">
          <div className="stat-card-icon">
            <HiUsers />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{stats.users.total}</span>
            <span className="stat-card-label">Utilisateurs</span>
            <div className="stat-card-details">
              <span className="stat-detail success">
                <HiCheckCircle /> {stats.users.active} actifs
              </span>
              <span className="stat-detail danger">
                <HiXCircle /> {stats.users.inactive} inactifs
              </span>
            </div>
          </div>
          <Link to="/admin/users" className="stat-card-link">
            <HiArrowRight />
          </Link>
        </div>

        <div className="stat-card stat-card-entreprises">
          <div className="stat-card-icon">
            <HiOfficeBuilding />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{stats.entreprises.total}</span>
            <span className="stat-card-label">Entreprises</span>
            <div className="stat-card-details">
              <span className="stat-detail success">
                <HiCheckCircle /> {stats.entreprises.active} actives
              </span>
            </div>
          </div>
          <Link to="/admin/entreprises" className="stat-card-link">
            <HiArrowRight />
          </Link>
        </div>

        <div className="stat-card stat-card-commandes">
          <div className="stat-card-icon">
            <HiTruck />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{stats.commandes.total}</span>
            <span className="stat-card-label">Commandes</span>
            <div className="stat-card-details">
              <span className="stat-detail warning">
                <HiClock /> {stats.commandes.enCours} en cours
              </span>
              <span className="stat-detail success">
                <HiCheckCircle /> {stats.commandes.cloturees} clôturées
              </span>
            </div>
          </div>
          <Link to="/admin/commandes" className="stat-card-link">
            <HiArrowRight />
          </Link>
        </div>

        <div className="stat-card stat-card-concurrents">
          <div className="stat-card-icon">
            <HiUserGroup />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{stats.concurrents.total}</span>
            <span className="stat-card-label">Concurrents</span>
            <div className="stat-card-details">
              <span className="stat-detail success">
                <HiCheckCircle /> {stats.concurrents.active} actifs
              </span>
            </div>
          </div>
          <Link to="/admin/concurrents" className="stat-card-link">
            <HiArrowRight />
          </Link>
        </div>

        <div className="stat-card stat-card-releves">
          <div className="stat-card-icon">
            <HiDocumentReport />
          </div>
          <div className="stat-card-content">
            <span className="stat-card-value">{stats.releves.total}</span>
            <span className="stat-card-label">Relevés de prix</span>
            <div className="stat-card-details">
              <span className="stat-detail warning">
                <HiClock /> {stats.releves.enCours} en cours
              </span>
              <span className="stat-detail success">
                <HiCheckCircle /> {stats.releves.exportes} exportés
              </span>
            </div>
          </div>
          <Link to="/admin/releves" className="stat-card-link">
            <HiArrowRight />
          </Link>
        </div>
      </div>

      {/* Main Content: Charts à gauche + Sidebar à droite */}
      <div className="dashboard-main">
        {/* Colonne des graphiques */}
        <div className="dashboard-charts">
          {/* Row 1: Activité + Pie */}
          <div className="charts-row">
            {/* Activité de la semaine */}
            <div className="chart-card">
              <div className="chart-card-header">
                <h3>
                  <HiTrendingUp /> Activité de la semaine
                </h3>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={activityData}>
                    <defs>
                      <linearGradient
                        id="colorReleves"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={COLORS.primary}
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor={COLORS.primary}
                          stopOpacity={0}
                        />
                      </linearGradient>
                      <linearGradient
                        id="colorInventaires"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor={COLORS.success}
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor={COLORS.success}
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                    />
                    <XAxis
                      dataKey="jour"
                      stroke="var(--text-muted)"
                      fontSize={10}
                    />
                    <YAxis stroke="var(--text-muted)" fontSize={10} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                    <Area
                      type="monotone"
                      dataKey="releves"
                      name="Relevés"
                      stroke={COLORS.primary}
                      fillOpacity={1}
                      fill="url(#colorReleves)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="inventaires"
                      name="Inventaires"
                      stroke={COLORS.success}
                      fillOpacity={1}
                      fill="url(#colorInventaires)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Répartition des utilisateurs */}
            <div className="chart-card">
              <div className="chart-card-header">
                <h3>
                  <HiUsers /> Utilisateurs par rôle
                </h3>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={usersByRole}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {usersByRole.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Row 2: Statuts + Relevés par entreprise */}
          <div className="charts-row">
            {/* Statuts actifs/inactifs */}
            <div className="chart-card">
              <div className="chart-card-header">
                <h3>
                  <HiCheckCircle /> Statuts par catégorie
                </h3>
              </div>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={statusData} layout="vertical">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                    />
                    <XAxis
                      type="number"
                      stroke="var(--text-muted)"
                      fontSize={10}
                    />
                    <YAxis
                      dataKey="name"
                      type="category"
                      stroke="var(--text-muted)"
                      fontSize={10}
                      width={70}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                    <Bar
                      dataKey="actifs"
                      name="Actifs"
                      fill={COLORS.success}
                      radius={[0, 4, 4, 0]}
                    />
                    <Bar
                      dataKey="inactifs"
                      name="Inactifs"
                      fill={COLORS.danger}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Relevés par entreprise */}
            <div className="chart-card">
              <div className="chart-card-header">
                <h3>
                  <HiOfficeBuilding /> Relevés par entreprise
                </h3>
              </div>
              <div className="chart-container">
                {relevesByEntreprise.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={relevesByEntreprise}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                      />
                      <XAxis
                        dataKey="trigramme"
                        stroke="var(--text-muted)"
                        fontSize={10}
                      />
                      <YAxis stroke="var(--text-muted)" fontSize={10} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar
                        dataKey="count"
                        name="Relevés"
                        fill={COLORS.purple}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">
                    <HiDocumentReport />
                    <p>Aucune donnée disponible</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Row 3: Commandes par état */}
          <div className="charts-row charts-row-single">
            <div className="chart-card">
              <div className="chart-card-header">
                <h3>
                  <HiTruck /> Commandes par état
                </h3>
                <Link to="/admin/commandes" className="chart-card-link">
                  Voir tout <HiArrowRight />
                </Link>
              </div>
              <div className="chart-container">
                {commandesByEtat.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={commandesByEtat}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--border)"
                      />
                      <XAxis
                        dataKey="label"
                        stroke="var(--text-muted)"
                        fontSize={10}
                      />
                      <YAxis stroke="var(--text-muted)" fontSize={10} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="count" name="Commandes" radius={[4, 4, 0, 0]}>
                        {commandesByEtat.map((entry, index) => (
                          <Cell
                            key={`cell-etat-${index}`}
                            fill={ETAT_COLORS[entry.etat] || COLORS.primary}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="chart-empty">
                    <HiTruck />
                    <p>Aucune donnée de commande disponible</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar droite */}
        <div className="dashboard-sidebar">
          {/* Actions rapides */}
          <div className="quick-actions-card">
            <h3>Actions rapides</h3>
            <div className="quick-actions-grid">
              <Link to="/admin/users" className="quick-action">
                <div
                  className="quick-action-icon"
                  style={{
                    background: "rgba(77, 166, 255, 0.15)",
                    color: COLORS.primary,
                  }}
                >
                  <HiUsers />
                </div>
                <span>Utilisateurs</span>
              </Link>
              <Link to="/admin/entreprises" className="quick-action">
                <div
                  className="quick-action-icon"
                  style={{
                    background: "rgba(34, 197, 94, 0.15)",
                    color: COLORS.success,
                  }}
                >
                  <HiOfficeBuilding />
                </div>
                <span>Entreprises</span>
              </Link>
              <Link to="/admin/commandes" className="quick-action">
                <div
                  className="quick-action-icon"
                  style={{
                    background: "rgba(245, 158, 11, 0.15)",
                    color: COLORS.amber,
                  }}
                >
                  <HiTruck />
                </div>
                <span>Commandes</span>
              </Link>
              <Link to="/admin/concurrents" className="quick-action">
                <div
                  className="quick-action-icon"
                  style={{
                    background: "rgba(168, 85, 247, 0.15)",
                    color: COLORS.purple,
                  }}
                >
                  <HiUserGroup />
                </div>
                <span>Concurrents</span>
              </Link>
              <Link to="/admin/releves" className="quick-action">
                <div
                  className="quick-action-icon"
                  style={{
                    background: "rgba(245, 158, 11, 0.15)",
                    color: COLORS.warning,
                  }}
                >
                  <HiDocumentReport />
                </div>
                <span>Relevés</span>
              </Link>
              <Link to="/admin/inventaires" className="quick-action">
                <div
                  className="quick-action-icon"
                  style={{
                    background: "rgba(6, 182, 212, 0.15)",
                    color: COLORS.cyan,
                  }}
                >
                  <HiClipboardList />
                </div>
                <span>Inventaires</span>
              </Link>
              <Link to="/admin/reappros" className="quick-action">
                <div
                  className="quick-action-icon"
                  style={{
                    background: "rgba(236, 72, 153, 0.15)",
                    color: COLORS.pink,
                  }}
                >
                  <HiRefresh />
                </div>
                <span>Réappros</span>
              </Link>
            </div>
          </div>

          {/* Top concurrents */}
          <div className="top-list-card">
            <h3>
              <HiUserGroup /> Top concurrents
            </h3>
            {topConcurrents.length > 0 ? (
              <div className="top-list">
                {topConcurrents.map((concurrent, index) => (
                  <div key={concurrent._id} className="top-list-item">
                    <span className="top-list-rank">{index + 1}</span>
                    <span className="top-list-name">{concurrent.nom}</span>
                    <span className="top-list-value">
                      {concurrent.nombreReleves}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="top-list-empty">
                <p>Aucun relevé enregistré</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;