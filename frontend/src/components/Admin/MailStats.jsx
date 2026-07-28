// src/components/Admin/MailStats.jsx
//
// Tableau de bord d'une campagne : KPIs (envoyés, taux d'ouverture, taux de clic,
// CTR) + courbe ouvertures/clics dans le temps + top des liens cliqués. Données
// via GET /api/mailing/campaigns/:id/stats (recharts pour les graphiques).
import React from "react";
import {
  HiArrowLeft,
  HiMail,
  HiEye,
  HiCursorClick,
  HiTrendingUp,
} from "react-icons/hi";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { useGetCampaignStatsQuery } from "../../slices/mailingApiSlice";
import "./MailStats.css";

const pct = (v) => `${Math.round((v || 0) * 100)}%`;

// "2026-07-28 14:00" → "28/07 14h"
const fmtBucket = (b) => {
  const m = /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):/.exec(b || "");
  return m ? `${m[3]}/${m[2]} ${m[4]}h` : b;
};

const shortUrl = (u) => {
  try {
    const x = new URL(u);
    const p = (x.pathname + x.search).replace(/\/$/, "");
    return (x.host + p).slice(0, 42) + (x.host.length + p.length > 42 ? "…" : "");
  } catch {
    return String(u || "").slice(0, 42);
  }
};

const Kpi = ({ icon, label, value, sub, accent }) => (
  <div className="mst-kpi">
    <div className="mst-kpi-ico" style={{ background: accent }}>{icon}</div>
    <div className="mst-kpi-body">
      <div className="mst-kpi-val">{value}</div>
      <div className="mst-kpi-lbl">{label}</div>
      {sub != null && <div className="mst-kpi-sub">{sub}</div>}
    </div>
  </div>
);

const MailStats = ({ campaign, onClose }) => {
  const { data, isLoading } = useGetCampaignStatsQuery(campaign._id, {
    pollingInterval: 30000,
  });

  const timeline = (data?.timeline || []).map((t) => ({
    name: fmtBucket(t.bucket),
    Ouvertures: t.open || 0,
    Clics: t.click || 0,
  }));
  const topLinks = (data?.topLinks || []).map((l) => ({
    name: shortUrl(l.url),
    url: l.url,
    Clics: l.n,
  }));

  return (
    <div className="mst">
      <div className="ml-head">
        <button className="ml-back" onClick={onClose}><HiArrowLeft /> Campagnes</button>
        <div className="mst-title">Statistiques — {campaign.nom}</div>
      </div>

      {isLoading ? (
        <div className="ml-muted">Chargement des statistiques…</div>
      ) : (
        <>
          <div className="mst-kpis">
            <Kpi icon={<HiMail />} accent="linear-gradient(135deg,#4da6ff,#3d7fd9)"
              value={`${data.sent}/${data.total}`} label="Emails envoyés"
              sub={data.failed ? `${data.failed} échec(s)` : " "} />
            <Kpi icon={<HiEye />} accent="linear-gradient(135deg,#34d399,#10b981)"
              value={pct(data.openRate)} label="Taux d'ouverture"
              sub={`${data.uniqueOpens} personne(s) · ${data.totalOpens} ouverture(s)`} />
            <Kpi icon={<HiCursorClick />} accent="linear-gradient(135deg,#c084fc,#8b5cf6)"
              value={pct(data.clickRate)} label="Taux de clic"
              sub={`${data.uniqueClicks} clic(s) sur le bouton · ${data.totalClicks} au total`} />
            <Kpi icon={<HiTrendingUp />} accent="linear-gradient(135deg,#fbbf24,#f59e0b)"
              value={pct(data.ctr)} label="Clics / ouvertures (CTR)"
              sub={"parmi ceux qui ont ouvert"} />
          </div>

          <div className="mst-card">
            <div className="mst-card-title">Ouvertures & clics dans le temps</div>
            {timeline.length ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={timeline} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gOpen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gClick" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="name" tick={{ fill: "#9aa0a6", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "#9aa0a6", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#1e212c", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "#fff" }} />
                  <Area type="monotone" dataKey="Ouvertures" stroke="#10b981" fill="url(#gOpen)" strokeWidth={2} />
                  <Area type="monotone" dataKey="Clics" stroke="#8b5cf6" fill="url(#gClick)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="ml-muted">Aucune activité pour l'instant. Les ouvertures apparaissent dès que les clients consultent l'email.</div>
            )}
          </div>

          <div className="mst-card">
            <div className="mst-card-title">Liens les plus cliqués</div>
            {topLinks.length ? (
              <ResponsiveContainer width="100%" height={Math.max(120, topLinks.length * 42)}>
                <BarChart data={topLinks} layout="vertical" margin={{ top: 0, right: 16, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fill: "#9aa0a6", fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={220} tick={{ fill: "#cbd2e0", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#1e212c", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "#fff" }} />
                  <Bar dataKey="Clics" fill="#4da6ff" radius={[0, 6, 6, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="ml-muted">Aucun clic enregistré pour l'instant.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MailStats;
