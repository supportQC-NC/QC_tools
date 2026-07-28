// src/components/Admin/MailAutomationStats.jsx
//
// Statistiques d'une automatisation : KPIs (inscrits, en cours, terminés, emails
// envoyés) + courbe des inscriptions dans le temps.
import React from "react";
import { HiArrowLeft, HiUserAdd, HiClock, HiCheckCircle, HiMail } from "react-icons/hi";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { useGetAutomationStatsQuery } from "../../slices/mailingApiSlice";
import "./MailStats.css";

const fmtDay = (d) => {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  return m ? `${m[3]}/${m[2]}` : d;
};

const Kpi = ({ icon, label, value, accent }) => (
  <div className="mst-kpi">
    <div className="mst-kpi-ico" style={{ background: accent }}>{icon}</div>
    <div className="mst-kpi-body">
      <div className="mst-kpi-val">{value}</div>
      <div className="mst-kpi-lbl">{label}</div>
    </div>
  </div>
);

const MailAutomationStats = ({ automation, onClose }) => {
  const { data, isLoading } = useGetAutomationStatsQuery(automation._id, { pollingInterval: 30000 });
  const timeline = (data?.timeline || []).map((t) => ({ name: fmtDay(t.day), Inscriptions: t.inscrits }));

  return (
    <div className="mst">
      <div className="ml-head">
        <button className="ml-back" onClick={onClose}><HiArrowLeft /> Automatisations</button>
        <div className="mst-title">Statistiques — {automation.nom}</div>
      </div>

      {isLoading ? (
        <div className="ml-muted">Chargement…</div>
      ) : (
        <>
          <div className="mst-kpis">
            <Kpi icon={<HiUserAdd />} accent="linear-gradient(135deg,#4da6ff,#3d7fd9)" value={data.enrolledCount} label="Contacts inscrits" />
            <Kpi icon={<HiClock />} accent="linear-gradient(135deg,#fbbf24,#f59e0b)" value={data.inProgress} label="En cours de parcours" />
            <Kpi icon={<HiCheckCircle />} accent="linear-gradient(135deg,#34d399,#10b981)" value={data.completed} label="Parcours terminés" />
            <Kpi icon={<HiMail />} accent="linear-gradient(135deg,#c084fc,#8b5cf6)" value={data.sentCount} label="Emails envoyés" />
          </div>

          <div className="mst-card">
            <div className="mst-card-title">Inscriptions dans le temps</div>
            {timeline.length ? (
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={timeline} margin={{ top: 10, right: 20, left: -6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gEnr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4da6ff" stopOpacity={0.5} />
                      <stop offset="95%" stopColor="#4da6ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="name" tick={{ fill: "#9aa0a6", fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fill: "#9aa0a6", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#1e212c", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, color: "#fff" }} />
                  <Area type="monotone" dataKey="Inscriptions" stroke="#4da6ff" fill="url(#gEnr)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="ml-muted">Aucune inscription pour l'instant. Les contacts s'inscrivent automatiquement (nouveaux clients détectés) ou via l'import de liste.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MailAutomationStats;
