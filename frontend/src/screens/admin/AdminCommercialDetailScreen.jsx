// src/screens/admin/AdminCommercialDetailScreen.jsx
import React, { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
} from "recharts";
import {
  HiArrowLeft,
  HiDownload,
  HiArrowSmUp,
  HiArrowSmDown,
  HiMinusSm,
  HiUsers,
  HiDocumentText,
  HiCurrencyDollar,
} from "react-icons/hi";
import { useGetCommercialDetailQuery } from "../../slices/commerciauxApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminCommercialDetailScreen.css";

const formatF = (n) => `${Math.round(Number(n) || 0).toLocaleString("fr-FR")} F`;
const formatPct = (n) => `${(Number(n) || 0).toFixed(1)} %`;

// Valeurs avec repli si l'analyse en cache (5 min) ne contient pas encore les
// nouveaux champs calculés côté serveur.
const panierMoyen = (c) =>
  c.panierMoyen ?? (c.nbFactures ? c.caN / c.nbFactures : 0);
const caMoyenClient = (c) =>
  c.caMoyenParClient ?? (c.nbClients ? c.caN / c.nbClients : 0);
const pctMargeN1 = (c) =>
  c.pctMargeN1 ?? (c.caN1 !== 0 ? (c.margeN1 / c.caN1) * 100 : 0);

const COLOR_SELF = "#6366f1";
const COLOR_OTHER = "#f59e0b";
const CAT_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#ec4899",
  "#8b5cf6",
  "#84cc16",
  "#f97316",
  "#14b8a6",
];

const Evol = ({ value }) => {
  const v = Number(value) || 0;
  if (v > 0.5)
    return (
      <span className="cd-evol up">
        <HiArrowSmUp />
        {v.toFixed(0)}%
      </span>
    );
  if (v < -0.5)
    return (
      <span className="cd-evol down">
        <HiArrowSmDown />
        {Math.abs(v).toFixed(0)}%
      </span>
    );
  return (
    <span className="cd-evol flat">
      <HiMinusSm />
      0%
    </span>
  );
};

const buildRows = (clients, mois) =>
  clients.map((c) => {
    const row = {
      Tiers: c.tiers,
      Nom: c.nomTiers,
      Catégorie: c.categorie,
      Profession: c.profes,
      "Remise %": Math.round(c.remise || 0),
      "CA HT N": Math.round(c.caN),
      "CA HT N-1": Math.round(c.caN1),
      "Évol CA %": Math.round(c.evolCA),
      "Marge N": Math.round(c.margeN),
      "Marge N-1": Math.round(c.margeN1),
      "Évol Marge %": Math.round(c.evolMarge),
      "% Marge": Number(c.pctMarge.toFixed(2)),
      "Nb factures": c.nbFacture,
      "Évol Nb %": Math.round(c.evolNbFact),
      "Taux facturation %": Number(c.tauxFacturation.toFixed(2)),
      "Taux contribution %": Number(c.tauxContribution.toFixed(2)),
    };
    (mois || []).forEach((m, i) => {
      row[m] = Math.round((c.mois && c.mois[i]) || 0);
    });
    return row;
  });

const AdminCommercialDetailScreen = () => {
  const { nomDossierDBF, code } = useParams();
  const { data, isLoading, error } = useGetCommercialDetailQuery(
    { nomDossierDBF, code },
    { skip: !nomDossierDBF || code === undefined },
  );

  const com = data?.commercial;

  const monthlyData = useMemo(() => {
    if (!com || !data) return [];
    return (data.mois || []).map((m, i) => ({
      mois: m.slice(0, 3),
      caN: Math.round((com.moisN && com.moisN[i]) || 0),
      caN1: Math.round((com.moisN1 && com.moisN1[i]) || 0),
    }));
  }, [com, data]);

  // CA cumulé mois par mois (N vs N-1 borné à date)
  const cumulData = useMemo(() => {
    let cn = 0;
    let cn1 = 0;
    return monthlyData.map((d) => {
      cn += d.caN;
      cn1 += d.caN1;
      return { mois: d.mois, cumulN: cn, cumulN1: cn1 };
    });
  }, [monthlyData]);

  const splitData = useMemo(() => {
    if (!com) return [];
    return [
      { name: "Réalisé par lui", value: Math.max(0, Math.round(com.caParSoiN)) },
      {
        name: "Capté par d'autres",
        value: Math.max(0, Math.round(com.caAutresN)),
      },
    ];
  }, [com]);

  const topClients = useMemo(() => {
    if (!com) return [];
    return com.clients
      .slice(0, 10)
      .map((c) => ({
        nom: (c.nomTiers || c.tiers || "").slice(0, 18),
        CA: Math.round(c.caN),
      }));
  }, [com]);

  const categoryData = useMemo(() => {
    if (!com) return [];
    const map = new Map();
    com.clients.forEach((c) => {
      const k = c.categorie || "—";
      map.set(k, (map.get(k) || 0) + c.caN);
    });
    return [...map.entries()]
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [com]);

  const handleExport = () => {
    if (!com || !data) return;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(buildRows(com.clients, data.mois));
    XLSX.utils.book_append_sheet(
      wb,
      ws,
      (com.nom || "commercial").replace(/[:\\/?*[\]]/g, " ").slice(0, 31),
    );
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `commercial_${com.nom}_${nomDossierDBF}_${today}.xlsx`);
  };

  if (isLoading) return <Loader />;
  if (error || !com)
    return (
      <div className="commercial-detail">
        <Link to={`/admin/commerciaux/${nomDossierDBF}`} className="cd-back">
          <HiArrowLeft /> Retour
        </Link>
        <div className="cd-error">Commercial introuvable ou erreur de chargement.</div>
      </div>
    );

  const partSoi = com.caN !== 0 ? (com.caParSoiN / com.caN) * 100 : 0;

  return (
    <div className="commercial-detail">
      <div className="cd-topbar">
        <Link to={`/admin/commerciaux/${nomDossierDBF}`} className="cd-back">
          <HiArrowLeft /> Retour aux commerciaux
        </Link>
        <button className="cd-export" onClick={handleExport}>
          <HiDownload /> Export Excel
        </button>
      </div>

      <div className="cd-head">
        <h1>{com.nom}</h1>
        <span className="cd-sub">
          Portefeuille · {data.anneeN} vs {data.anneeN1}
          {data.dateArret ? ` · N-1 arrêté au ${data.dateArret}` : ""}
        </span>
      </div>

      {/* KPIs */}
      <div className="cd-kpis">
        <div className="cd-kpi">
          <span className="cd-kpi-label">CA HT {data.anneeN}</span>
          <span className="cd-kpi-value">{formatF(com.caN)}</span>
          <Evol value={com.evolCA} />
        </div>
        <div className="cd-kpi">
          <span className="cd-kpi-label">
            CA HT {data.anneeN1}
            {data.dateArret ? ` (au ${data.dateArret})` : ""}
          </span>
          <span className="cd-kpi-value">{formatF(com.caN1)}</span>
        </div>
        <div className="cd-kpi">
          <span className="cd-kpi-label">Marge {data.anneeN}</span>
          <span className="cd-kpi-value">{formatF(com.margeN)}</span>
          <span className="cd-kpi-mini">{formatPct(com.pctMarge)} de marge</span>
          <Evol value={com.evolMarge} />
        </div>
        <div className="cd-kpi">
          <span className="cd-kpi-label">
            Marge {data.anneeN1}
            {data.dateArret ? ` (au ${data.dateArret})` : ""}
          </span>
          <span className="cd-kpi-value">{formatF(com.margeN1)}</span>
          <span className="cd-kpi-mini">
            {formatPct(pctMargeN1(com))} de marge
          </span>
        </div>
        <div className="cd-kpi">
          <span className="cd-kpi-label">Panier moyen</span>
          <span className="cd-kpi-value">{formatF(panierMoyen(com))}</span>
          <span className="cd-kpi-mini">CA / facture</span>
        </div>
        <div className="cd-kpi">
          <span className="cd-kpi-label">CA moyen / client</span>
          <span className="cd-kpi-value">{formatF(caMoyenClient(com))}</span>
        </div>
        <div className="cd-kpi">
          <span className="cd-kpi-label">Clients actifs</span>
          <span className="cd-kpi-value">{com.nbClients}</span>
          <span className="cd-kpi-mini">
            {com.nbClientsCroissance ?? 0} en hausse ·{" "}
            {com.nbClientsBaisse ?? 0} en baisse
          </span>
        </div>
        <div className="cd-kpi">
          <span className="cd-kpi-label">Nouveaux clients</span>
          <span className="cd-kpi-value">{com.nbClientsNouveaux ?? 0}</span>
          <span className="cd-kpi-mini">
            {com.nbClientsPerdus ?? 0} perdus (sans CA {data.anneeN})
          </span>
        </div>
        <div className="cd-kpi">
          <span className="cd-kpi-label">Factures {data.anneeN}</span>
          <span className="cd-kpi-value">{com.nbFactures}</span>
          <span className="cd-kpi-mini">
            vs {com.nbFacturesN1 ?? 0} en N-1
          </span>
          <Evol value={com.evolNbFactures ?? 0} />
        </div>
        <div className="cd-kpi">
          <span className="cd-kpi-label">Taux de facturation</span>
          <span className="cd-kpi-value">
            {formatPct(com.tauxFacturation)}
          </span>
          <span className="cd-kpi-mini">
            de son portefeuille facturé par lui
          </span>
        </div>
      </div>

      {/* Comparaison portefeuille (le cœur) */}
      <div className="cd-cards">
        <div className="cd-card highlight">
          <h3>Mon portefeuille : qui facture ?</h3>
          <div className="cd-split-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={splitData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  <Cell fill={COLOR_SELF} />
                  <Cell fill={COLOR_OTHER} />
                </Pie>
                <Tooltip formatter={(v) => formatF(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="cd-split-stats">
            <div>
              <i className="dot" style={{ background: COLOR_SELF }} />
              Réalisé par {com.nom} :{" "}
              <strong>{formatF(com.caParSoiN)}</strong> ({formatPct(partSoi)})
            </div>
            <div>
              <i className="dot" style={{ background: COLOR_OTHER }} />
              Capté par d'autres représentants :{" "}
              <strong>{formatF(com.caAutresN)}</strong> (
              {formatPct(100 - partSoi)})
            </div>
            <div className="cd-extra">
              <HiCurrencyDollar /> Ventes faites <em>hors</em> de son
              portefeuille : <strong>{formatF(com.caHorsPortefeuilleN)}</strong>
            </div>
          </div>
        </div>

        <div className="cd-card">
          <h3>
            CA mensuel {data.anneeN} vs {data.anneeN1}
          </h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis dataKey="mois" stroke="#a0a0b0" fontSize={12} />
              <YAxis
                stroke="#a0a0b0"
                fontSize={11}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
              />
              <Tooltip
                formatter={(v) => formatF(v)}
                contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a" }}
              />
              <Legend />
              <Bar
                name={`${data.anneeN}`}
                dataKey="caN"
                fill={COLOR_SELF}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                name={`${data.anneeN1}`}
                dataKey="caN1"
                fill={COLOR_OTHER}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Trajectoire annuelle : CA cumulé N vs N-1 (à date) */}
      <div className="cd-cards">
        <div className="cd-card full">
          <h3>
            CA cumulé {data.anneeN} vs {data.anneeN1}
            {data.dateArret ? ` (N-1 au ${data.dateArret})` : ""}
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={cumulData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis dataKey="mois" stroke="#a0a0b0" fontSize={12} />
              <YAxis
                stroke="#a0a0b0"
                fontSize={11}
                tickFormatter={(v) => `${(v / 1000000).toFixed(0)}M`}
              />
              <Tooltip
                formatter={(v) => formatF(v)}
                contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a" }}
              />
              <Legend />
              <Line
                name={`${data.anneeN} cumulé`}
                type="monotone"
                dataKey="cumulN"
                stroke={COLOR_SELF}
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                name={`${data.anneeN1} cumulé`}
                type="monotone"
                dataKey="cumulN1"
                stroke={COLOR_OTHER}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="cd-cards">
        <div className="cd-card">
          <h3>Top 10 clients ({data.anneeN})</h3>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={topClients} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis
                type="number"
                stroke="#a0a0b0"
                fontSize={11}
                tickFormatter={(v) => `${Math.round(v / 1000)}k`}
              />
              <YAxis
                type="category"
                dataKey="nom"
                stroke="#a0a0b0"
                fontSize={11}
                width={120}
              />
              <Tooltip
                formatter={(v) => formatF(v)}
                contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a" }}
              />
              <Bar dataKey="CA" fill="#10b981" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="cd-card">
          <h3>Répartition par catégorie</h3>
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie
                data={categoryData}
                dataKey="value"
                nameKey="name"
                outerRadius={110}
                label={(e) => e.name}
              >
                {categoryData.map((entry, i) => (
                  <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatF(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tableau clients */}
      <div className="cd-table-card">
        <h3>
          <HiUsers /> Clients du portefeuille ({com.nbClients})
        </h3>
        <div className="cd-table-wrap">
          <table className="cd-table">
            <thead>
              <tr>
                <th>Tiers</th>
                <th>Nom</th>
                <th>Catégorie</th>
                <th className="r">CA {data.anneeN}</th>
                <th className="r">CA {data.anneeN1}</th>
                <th className="c">Évol</th>
                <th className="r">Marge</th>
                <th className="c">% Marge</th>
                <th className="c">Nb fact.</th>
                <th className="c">Taux fact.</th>
                <th className="c">Contrib.</th>
              </tr>
            </thead>
            <tbody>
              {com.clients.map((c) => (
                <tr key={c.tiers}>
                  <td>{c.tiers}</td>
                  <td className="nom">{c.nomTiers}</td>
                  <td>{c.categorie || "—"}</td>
                  <td className="r">{formatF(c.caN)}</td>
                  <td className="r muted">{formatF(c.caN1)}</td>
                  <td className="c">
                    <Evol value={c.evolCA} />
                  </td>
                  <td className="r">{formatF(c.margeN)}</td>
                  <td className="c">{formatPct(c.pctMarge)}</td>
                  <td className="c">{c.nbFacture}</td>
                  <td className="c">
                    <span
                      className={`taux ${
                        c.tauxFacturation >= 80
                          ? "good"
                          : c.tauxFacturation >= 40
                          ? "mid"
                          : "low"
                      }`}
                    >
                      {formatPct(c.tauxFacturation)}
                    </span>
                  </td>
                  <td className="c">{formatPct(c.tauxContribution)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminCommercialDetailScreen;