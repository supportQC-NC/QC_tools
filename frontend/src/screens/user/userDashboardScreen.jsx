// src/pages/Admin/AdminDashboard/AdminDashboard.jsx
import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  HiSearch,
  HiClipboardList,
  HiRefresh,
  HiDocumentReport,
  HiDocumentText,
  HiShieldCheck,
  HiLockClosed,
  HiCube,
  HiUsers,
  HiOfficeBuilding,
  HiUserGroup,
  HiTruck,
  HiChartBar,
  HiCollection,
  HiCurrencyDollar,
  HiUserCircle,
  HiFolder,
} from "react-icons/hi";
import {
  HiClipboardCheck,
  HiExclamationCircle,
  HiTrendingUp,
  HiInboxIn,
  HiClock,
  HiCheckCircle,
} from "react-icons/hi";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import MesTachesWidget from "../../components/user/MesTachesWidget";
import { useGetMyDashboardQuery } from "../../slices/dashboardApiSlice";
import { hasModuleAccess } from "../../config/adminModules";
import "./UserdashboardScreen.css";

// ─── Config des modules USER (clé permission → label, route, icône, couleur) ──
const USER_MODULES = [
  {
    key: "stock",
    label: "Recherche Article",
    route: "/articles",
    icon: HiSearch,
    color: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.12)",
  },
  {
    key: "inventaire",
    label: "Inventaire",
    route: "/inventaire",
    icon: HiClipboardList,
    color: "#06b6d4",
    bg: "rgba(6, 182, 212, 0.12)",
  },
  {
    key: "reapro",
    label: "Réappro",
    route: "/reappro",
    icon: HiRefresh,
    color: "#22c55e",
    bg: "rgba(34, 197, 94, 0.12)",
  },
  {
    key: "proforma",
    label: "Proformas",
    route: "/proformas",
    icon: HiDocumentText,
    color: "#a855f7",
    bg: "rgba(168, 85, 247, 0.12)",
  },
  {
    key: "ctr_commande",
    label: "CTRL Commandes",
    route: "/controle-commandes",
    icon: HiShieldCheck,
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.12)",
  },
  {
    key: "prep_commande",
    label: "PRÉPA Commandes",
    route: "/preparation-commandes",
    icon: HiCube,
    color: "#ec4899",
    bg: "rgba(236, 72, 153, 0.12)",
  },
  {
    key: "releve",
    label: "Relevés de Prix",
    route: "/releve",
    icon: HiDocumentReport,
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.12)",
  },
];

// ─── Config des modules ADMIN ──
const ADMIN_MODULES = [
  {
    key: "dashboard",
    label: "Tableau de bord",
    route: "/admin",
    icon: HiChartBar,
    color: "#6366f1",
    bg: "rgba(99, 102, 241, 0.12)",
  },
  {
    key: "users",
    label: "Utilisateurs",
    route: "/admin/users",
    icon: HiUsers,
    color: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.12)",
  },
  {
    key: "entreprises",
    label: "Entreprises",
    route: "/admin/entreprises",
    icon: HiOfficeBuilding,
    color: "#22c55e",
    bg: "rgba(34, 197, 94, 0.12)",
  },
  {
    key: "articles",
    label: "Articles",
    route: "/admin/articles",
    icon: HiCollection,
    color: "#06b6d4",
    bg: "rgba(6, 182, 212, 0.12)",
  },
  {
    key: "concurrents",
    label: "Concurrents",
    route: "/admin/concurrents",
    icon: HiUserGroup,
    color: "#a855f7",
    bg: "rgba(168, 85, 247, 0.12)",
  },
  {
    key: "commandes",
    label: "Commandes",
    route: "/admin/commandes",
    icon: HiTruck,
    color: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.12)",
  },
  {
    key: "proformas",
    label: "Proformas",
    route: "/admin/proformas",
    icon: HiDocumentText,
    color: "#ec4899",
    bg: "rgba(236, 72, 153, 0.12)",
  },
  {
    key: "factures",
    label: "Factures",
    route: "/admin/factures",
    icon: HiCurrencyDollar,
    color: "#10b981",
    bg: "rgba(16, 185, 129, 0.12)",
  },
  {
    key: "clients",
    label: "Clients",
    route: "/admin/clients",
    icon: HiUserCircle,
    color: "#8b5cf6",
    bg: "rgba(139, 92, 246, 0.12)",
  },
  {
    key: "fournisseurs",
    label: "Fournisseurs",
    route: "/admin/fournisseurs",
    icon: HiFolder,
    color: "#0ea5e9",
    bg: "rgba(14, 165, 233, 0.12)",
  },
  {
    key: "releves",
    label: "Relevés",
    route: "/admin/releves",
    icon: HiDocumentReport,
    color: "#ef4444",
    bg: "rgba(239, 68, 68, 0.12)",
  },
  {
    key: "inventaires",
    label: "Inventaires",
    route: "/admin/inventaires",
    icon: HiClipboardList,
    color: "#14b8a6",
    bg: "rgba(20, 184, 166, 0.12)",
  },
  {
    key: "reappros",
    label: "Réappros",
    route: "/admin/reappros",
    icon: HiRefresh,
    color: "#f97316",
    bg: "rgba(249, 115, 22, 0.12)",
  },
  {
    key: "meilleures-ventes",
    label: "Meilleures Ventes",
    route: "/admin/meilleures-ventes",
    icon: HiChartBar,
    color: "#eab308",
    bg: "rgba(234, 179, 8, 0.12)",
  },
];

const UserDashboard = () => {
  const { userInfo } = useSelector((state) => state.auth);
  const [now, setNow] = useState(new Date());

  // Mise à jour de l'heure toutes les secondes
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const isAdmin = userInfo?.role === "admin";

  // Filtrer les modules user selon les permissions
  const getUserModules = () => {
    const permissions = userInfo?.permissions;
    if (!permissions) return [];

    // Si allModules → tous les modules user
    if (permissions.allModules) return USER_MODULES;

    // Sinon, filtrer selon les modules où read=true
    return USER_MODULES.filter((mod) => {
      const perm = permissions.modules?.[mod.key];
      return perm?.read === true;
    });
  };

  const modules = isAdmin ? ADMIN_MODULES : getUserModules();

  // ── Données personnalisées (KPI + activité) ──
  const { data: dash } = useGetMyDashboardQuery();
  const has = (key) => hasModuleAccess(userInfo, key, "read");
  const t = dash?.taches || {};
  const s = dash?.sessions || {};

  // Tuiles KPI selon les accès de l'utilisateur.
  const kpis = [
    {
      key: "taches",
      label: "Mes tâches actives",
      value: t.total ?? 0,
      sub: `${t.aFaire ?? 0} à faire`,
      alert: t.enRetard > 0 ? `${t.enRetard} en retard` : null,
      icon: HiClipboardCheck,
      color: "#6366f1",
      bg: "rgba(99,102,241,.14)",
      route: "/mes-taches",
    },
  ];
  if (has("inventaire"))
    kpis.push({
      key: "inv",
      label: "Inventaires en cours",
      value: s.inventaires ?? 0,
      icon: HiClipboardList,
      color: "#06b6d4",
      bg: "rgba(6,182,212,.14)",
      route: "/inventaire",
    });
  if (has("releve"))
    kpis.push({
      key: "rel",
      label: "Relevés en cours",
      value: s.releves ?? 0,
      icon: HiDocumentReport,
      color: "#a855f7",
      bg: "rgba(168,85,247,.14)",
      route: "/releve",
    });
  if (has("reapro"))
    kpis.push({
      key: "rea",
      label: "Réappros en cours",
      value: s.reappros ?? 0,
      icon: HiRefresh,
      color: "#22c55e",
      bg: "rgba(34,197,94,.14)",
      route: "/reappro",
    });

  const showActivity =
    has("inventaire") || has("releve") || has("reception") || has("allModules");
  const activite = dash?.activite || [];

  const dateStr = now.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const timeStr = now.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="user-dashboard">
      {/* Header */}
      <div className="ud-header">
        <div className="ud-header-left">
          <h1 className="ud-title">Tableau de bord</h1>
          <p className="ud-welcome">
            Bonjour, <strong>{userInfo?.prenom || "Utilisateur"}</strong>
          </p>
        </div>
        <div className="ud-header-right">
          <span className="ud-date">{dateStr}</span>
          <span className="ud-time">{timeStr}</span>
        </div>
      </div>

      {/* KPI personnalisés */}
      {kpis.length > 0 && (
        <div className="ud-kpis">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <Link to={k.route} key={k.key} className="ud-kpi">
                <div
                  className="ud-kpi-icon"
                  style={{ background: k.bg, color: k.color }}
                >
                  <Icon />
                </div>
                <div className="ud-kpi-body">
                  <span className="ud-kpi-value">{k.value}</span>
                  <span className="ud-kpi-label">{k.label}</span>
                  <span className="ud-kpi-sub">
                    {k.sub || " "}
                    {k.alert && <span className="ud-kpi-alert"> · {k.alert}</span>}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Panneaux : activité + tâches par statut */}
      <div className="ud-panels">
        {showActivity && (
          <div className="ud-panel ud-panel-chart">
            <h3>
              <HiTrendingUp /> Mon activité (14 jours)
            </h3>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={activite}>
                <defs>
                  <linearGradient id="udInv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="udRel" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="udRec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4da6ff" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#4da6ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="jour" stroke="var(--text-muted)" fontSize={10} />
                <YAxis stroke="var(--text-muted)" fontSize={10} allowDecimals={false} />
                <Tooltip />
                <Area type="monotone" dataKey="inventaires" name="Inventaires" stroke="#06b6d4" fill="url(#udInv)" strokeWidth={2} />
                <Area type="monotone" dataKey="releves" name="Relevés" stroke="#a855f7" fill="url(#udRel)" strokeWidth={2} />
                <Area type="monotone" dataKey="receptions" name="Réceptions" stroke="#4da6ff" fill="url(#udRec)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="ud-panel ud-tasks-panel">
          <h3>
            <HiClipboardCheck /> Mes tâches
          </h3>
          <div className="ud-task-stat">
            <span className="ud-dot ud-dot-blue" /> À faire <b>{t.aFaire ?? 0}</b>
          </div>
          <div className="ud-task-stat">
            <span className="ud-dot ud-dot-amber" /> En cours <b>{t.enCours ?? 0}</b>
          </div>
          <div className="ud-task-stat">
            <span className="ud-dot ud-dot-gray" /> Bloquées <b>{t.bloque ?? 0}</b>
          </div>
          <div className="ud-task-stat ud-task-late">
            <HiExclamationCircle /> En retard <b>{t.enRetard ?? 0}</b>
          </div>
          <div className="ud-task-stat ud-task-done">
            <HiCheckCircle /> Terminées (7 j) <b>{t.termine7j ?? 0}</b>
          </div>
          <Link to="/mes-taches" className="ud-task-link">
            Voir mes tâches →
          </Link>
        </div>
      </div>

      {/* Accès rapides */}
      {modules.length > 0 && (
        <h2 className="ud-section-title">Accès rapides</h2>
      )}
      {modules.length > 0 ? (
        <div className="ud-grid">
          {modules.map((mod) => {
            const Icon = mod.icon;
            return (
              <Link to={mod.route} key={mod.key} className="ud-card">
                <div
                  className="ud-card-icon"
                  style={{ backgroundColor: mod.bg, color: mod.color }}
                >
                  <Icon />
                </div>
                <span className="ud-card-label">{mod.label}</span>
                <div className="ud-card-arrow" style={{ color: mod.color }}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 12l4-4-4-4" />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="ud-empty">
          <HiShieldCheck />
          <p>Aucun module accessible</p>
          <span>Contactez votre administrateur pour obtenir des accès.</span>
        </div>
      )}

      {/* Widget « Mes tâches » */}
      <MesTachesWidget />

      {/* Bandeau sécurité */}
      <div className="ud-notice">
        <HiLockClosed className="ud-notice-icon" />
        <p>
          <strong>Pensez à vous déconnecter après chaque utilisation.</strong>{" "}
          Chaque compte est personnel et toutes les actions sont tracées. Si un
          autre utilisateur utilise votre session, ses actions seront
          enregistrées à votre nom.
        </p>
      </div>
    </div>
  );
};

export default UserDashboard;