// src/screens/admin/AdminFactureAnalyseScreen.jsx
import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  HiDownload,
  HiDocumentText,
  HiCurrencyDollar,
  HiCollection,
  HiExclamation,
  HiUsers,
} from "react-icons/hi";
import { useGetFactureAnalyseQuery } from "../../slices/factureAnalyseApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminFactureAnalyseScreen.css";

const STORAGE_KEY = "facture_analyse_entreprise";

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const startOfYear = () => ymd(new Date(new Date().getFullYear(), 0, 1));
const today = () => ymd(new Date());

const r0 = (n) => Math.round(Number(n) || 0);
const fF = (n) => `${r0(n).toLocaleString("fr-FR")} F`;
const fNum = (n) => (Number(n) || 0).toLocaleString("fr-FR");
const fPct = (n) => `${(Number(n) || 0).toFixed(1)} %`;
const num = { type: "rightAligned" };

// Palette des graphiques (donut vendeurs, barres)
const COLORS = [
  "#6366f1", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4",
  "#a855f7", "#ef4444", "#84cc16", "#f97316", "#14b8a6",
];
const GRID = "#2a2a3a";
const AXIS = "#9aa0b5";
const TOOLTIP_STYLE = { background: "#12121a", border: "1px solid #2a2a3a" };

const AdminFactureAnalyseScreen = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState(
    () => localStorage.getItem(STORAGE_KEY) || "",
  );
  const [dateDebut, setDateDebut] = useState(startOfYear);
  const [dateFin, setDateFin] = useState(today);
  const [selectedVendeur, setSelectedVendeur] = useState("");

  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();

  const { data, isLoading, isFetching, error } = useGetFactureAnalyseQuery(
    { nomDossierDBF: selectedEntreprise, dateDebut, dateFin },
    { skip: !selectedEntreprise || !dateDebut || !dateFin },
  );

  const onEntreprise = (val) => {
    setSelectedEntreprise(val);
    setSelectedVendeur("");
    localStorage.setItem(STORAGE_KEY, val);
  };

  const totaux = data?.totaux;
  const vendeurs = useMemo(() => data?.vendeurs || [], [data]);
  const parMois = data?.parMois || [];
  const loading = isLoading || (isFetching && !data);

  // Vendeur sélectionné dans le menu déroulant
  const vendeur = useMemo(
    () => vendeurs.find((v) => v.code === selectedVendeur) || null,
    [vendeurs, selectedVendeur],
  );

  // Donut : répartition du montant par vendeur (top 8 + Autres)
  const donutData = useMemo(() => {
    const actifs = vendeurs.filter((v) => v.montant > 0);
    const top = actifs.slice(0, 8).map((v) => ({
      name: `${v.nom} (${v.code})`,
      value: Math.round(v.montant),
    }));
    const reste = actifs.slice(8).reduce((s, v) => s + v.montant, 0);
    if (reste > 0) top.push({ name: "Autres", value: Math.round(reste) });
    return top;
  }, [vendeurs]);

  const columns = useMemo(
    () => [
      { field: "code", headerName: "Code", minWidth: 80, cellClass: "cell-mono" },
      { field: "nom", headerName: "Vendeur", minWidth: 200, flex: 1 },
      {
        field: "nbFactures", headerName: "Nb factures", ...num, minWidth: 120,
        filter: "agNumberColumnFilter", sort: "desc",
        valueFormatter: (p) => fNum(p.value), cellClass: "col-strong",
      },
      {
        field: "montant", headerName: "Montant facturé", ...num, minWidth: 150,
        filter: "agNumberColumnFilter", valueFormatter: (p) => fF(p.value),
      },
      {
        field: "partMontant", headerName: "Part", ...num, minWidth: 90,
        filter: "agNumberColumnFilter", valueFormatter: (p) => fPct(p.value),
      },
      {
        field: "montantMoyenParFacture", headerName: "Montant moy./fact.", ...num,
        minWidth: 150, filter: "agNumberColumnFilter",
        valueFormatter: (p) => fF(p.value),
      },
      {
        field: "moyenneArticlesParFacture", headerName: "Articles/fact. (moy.)",
        ...num, minWidth: 160, filter: "agNumberColumnFilter",
        valueFormatter: (p) => (Number(p.value) || 0).toFixed(2),
      },
      {
        field: "nbFacturesZero", headerName: "Factures à 0", ...num, minWidth: 120,
        filter: "agNumberColumnFilter", valueFormatter: (p) => fNum(p.value),
        cellClass: (p) => (p.value > 0 ? "col-warn" : ""),
      },
    ],
    [],
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

    const wsK = [
      ["Analyse factures type F"],
      ["Entreprise", selectedEntreprise],
      ["Du", data.dateDebut, "au", data.dateFin],
      [],
      ["Nombre de factures", totaux.nbFactures],
      ["Montant total facturé (XPF)", r0(totaux.montantTotal)],
      ["Montant moyen / facture (XPF)", r0(totaux.montantMoyenParFacture)],
      ["Moyenne d'articles / facture", Number(totaux.moyenneArticlesParFacture.toFixed(2))],
      ["Factures à 0", totaux.nbFacturesZero],
      [],
      ["Mois", "Nb factures", "Montant (XPF)"],
      ...parMois.map((m) => [m.mois, m.nbFactures, r0(m.montant)]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsK), "Synthèse");

    const wsV = [[
      "Code", "Vendeur", "Nb factures", "Montant facturé (XPF)", "Part (%)",
      "Montant moy./facture (XPF)", "Articles/facture (moy.)", "Factures à 0",
    ]];
    vendeurs.forEach((v) =>
      wsV.push([
        v.code, v.nom, v.nbFactures, r0(v.montant),
        Number(v.partMontant.toFixed(1)),
        r0(v.montantMoyenParFacture),
        Number(v.moyenneArticlesParFacture.toFixed(2)),
        v.nbFacturesZero,
      ]),
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsV), "Par vendeur");

    XLSX.writeFile(
      wb,
      `factures_typeF_${selectedEntreprise}_${data.dateDebut}_${data.dateFin}.xlsx`,
    );
  };

  return (
    <div className="admin-facture-analyse">
      <div className="fa-header">
        <h1>
          <HiDocumentText /> Analyse Factures
        </h1>
        <div className="fa-actions">
          <select
            className="fa-select"
            value={selectedEntreprise}
            onChange={(e) => onEntreprise(e.target.value)}
            disabled={loadingEntreprises}
          >
            <option value="">— Entreprise —</option>
            {(entreprises || []).map((e) => (
              <option key={e._id} value={e.nomDossierDBF}>
                {e.trigramme ? `${e.trigramme} - ` : ""}
                {e.nomComplet || e.nom || e.nomDossierDBF}
              </option>
            ))}
          </select>
          <label className="fa-field">
            Du
            <input
              type="date"
              value={dateDebut}
              max={dateFin}
              onChange={(e) => setDateDebut(e.target.value)}
            />
          </label>
          <label className="fa-field">
            Au
            <input
              type="date"
              value={dateFin}
              min={dateDebut}
              max={today()}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </label>
          <button className="fa-btn primary" onClick={handleExport} disabled={!data}>
            <HiDownload /> Excel
          </button>
        </div>
      </div>

      <div className="fa-note">
        Factures de type <strong>« F »</strong> uniquement. Le cache ne conserve
        que l'année en cours et l'année précédente : une plage plus ancienne ne
        remontera aucune facture.
      </div>

      {!selectedEntreprise ? (
        <div className="fa-empty">Choisissez une entreprise et une période.</div>
      ) : loading ? (
        <div className="fa-loading">
          <Loader />
          <p className="fa-hint">
            Lecture des factures et du détail — long au 1ᵉʳ accès, puis mis en
            cache 5 min.
          </p>
        </div>
      ) : error ? (
        <div className="fa-error">
          {error?.data?.message || "Erreur de chargement."}
        </div>
      ) : data ? (
        <>
          {/* ===== KPI globaux ===== */}
          <div className="fa-kpis">
            <div className="fa-kpi">
              <div className="fa-kpi-icon"><HiDocumentText /></div>
              <div>
                <span className="fa-kpi-value">{fNum(totaux.nbFactures)}</span>
                <span className="fa-kpi-label">Factures (type F)</span>
              </div>
            </div>
            <div className="fa-kpi">
              <div className="fa-kpi-icon"><HiCurrencyDollar /></div>
              <div>
                <span className="fa-kpi-value">{fF(totaux.montantTotal)}</span>
                <span className="fa-kpi-label">Montant total facturé</span>
                <span className="fa-kpi-mini">
                  {fF(totaux.montantMoyenParFacture)} / facture
                </span>
              </div>
            </div>
            <div className="fa-kpi">
              <div className="fa-kpi-icon"><HiCollection /></div>
              <div>
                <span className="fa-kpi-value">
                  {totaux.moyenneArticlesParFacture.toFixed(2)}
                </span>
                <span className="fa-kpi-label">Articles / facture (moy.)</span>
                <span className="fa-kpi-mini">
                  {fNum(totaux.totalLignesArticle)} lignes au total
                </span>
              </div>
            </div>
            <div className="fa-kpi">
              <div className="fa-kpi-icon warn"><HiExclamation /></div>
              <div>
                <span className="fa-kpi-value">{fNum(totaux.nbFacturesZero)}</span>
                <span className="fa-kpi-label">Factures à 0</span>
              </div>
            </div>
            <div className="fa-kpi">
              <div className="fa-kpi-icon"><HiUsers /></div>
              <div>
                <span className="fa-kpi-value">{fNum(vendeurs.length)}</span>
                <span className="fa-kpi-label">Vendeurs</span>
              </div>
            </div>
          </div>

          {/* ===== Graphiques globaux ===== */}
          <div className="fa-charts">
            <div className="fa-card wide">
              <h3>Montant facturé & nb factures par mois</h3>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={parMois}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                  <XAxis dataKey="mois" stroke={AXIS} fontSize={12} />
                  <YAxis
                    yAxisId="m"
                    stroke={AXIS}
                    fontSize={11}
                    tickFormatter={(v) => `${Math.round(v / 1000000)}M`}
                  />
                  <YAxis yAxisId="n" orientation="right" stroke={AXIS} fontSize={11} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(v, name) =>
                      name === "Montant" ? fF(v) : fNum(v)
                    }
                  />
                  <Legend />
                  <Bar
                    yAxisId="m"
                    name="Montant"
                    dataKey="montant"
                    fill="#6366f1"
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="n"
                    name="Nb factures"
                    type="monotone"
                    dataKey="nbFactures"
                    stroke="#22c55e"
                    strokeWidth={2.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="fa-card">
              <h3>Répartition du montant par vendeur</h3>
              {donutData.length === 0 ? (
                <div className="fa-empty small">Aucun montant vendeur.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={95}
                      paddingAngle={2}
                    >
                      {donutData.map((entry, i) => (
                        <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => fF(v)} />
                    <Legend
                      layout="vertical"
                      align="right"
                      verticalAlign="middle"
                      wrapperStyle={{ fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* ===== Détail par vendeur (menu déroulant) ===== */}
          <div className="fa-vendeur-section">
            <div className="fa-vendeur-header">
              <h2>Détail par vendeur</h2>
              <select
                className="fa-select"
                value={selectedVendeur}
                onChange={(e) => setSelectedVendeur(e.target.value)}
              >
                <option value="">— Choisir un vendeur —</option>
                {vendeurs.map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.nom} ({v.code}) — {fNum(v.nbFactures)} factures
                  </option>
                ))}
              </select>
            </div>

            {vendeur ? (
              <>
                <div className="fa-kpis">
                  <div className="fa-kpi">
                    <div className="fa-kpi-icon"><HiDocumentText /></div>
                    <div>
                      <span className="fa-kpi-value">{fNum(vendeur.nbFactures)}</span>
                      <span className="fa-kpi-label">Factures</span>
                      <span className="fa-kpi-mini">
                        {fPct(vendeur.partMontant)} du montant total
                      </span>
                    </div>
                  </div>
                  <div className="fa-kpi">
                    <div className="fa-kpi-icon"><HiCurrencyDollar /></div>
                    <div>
                      <span className="fa-kpi-value">{fF(vendeur.montant)}</span>
                      <span className="fa-kpi-label">Montant facturé</span>
                      <span className="fa-kpi-mini">
                        {fF(vendeur.montantMoyenParFacture)} / facture
                      </span>
                    </div>
                  </div>
                  <div className="fa-kpi">
                    <div className="fa-kpi-icon"><HiCollection /></div>
                    <div>
                      <span className="fa-kpi-value">
                        {vendeur.moyenneArticlesParFacture.toFixed(2)}
                      </span>
                      <span className="fa-kpi-label">Articles / facture (moy.)</span>
                      <span className="fa-kpi-mini">
                        {fNum(vendeur.totalLignesArticle)} lignes au total
                      </span>
                    </div>
                  </div>
                  <div className="fa-kpi">
                    <div className="fa-kpi-icon warn"><HiExclamation /></div>
                    <div>
                      <span className="fa-kpi-value">
                        {fNum(vendeur.nbFacturesZero)}
                      </span>
                      <span className="fa-kpi-label">Factures à 0</span>
                    </div>
                  </div>
                </div>

                <div className="fa-card wide">
                  <h3>
                    {vendeur.nom} — montant & nb factures par mois
                  </h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <ComposedChart data={vendeur.parMois}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="mois" stroke={AXIS} fontSize={12} />
                      <YAxis
                        yAxisId="m"
                        stroke={AXIS}
                        fontSize={11}
                        tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                      />
                      <YAxis yAxisId="n" orientation="right" stroke={AXIS} fontSize={11} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        formatter={(v, name) =>
                          name === "Montant" ? fF(v) : fNum(v)
                        }
                      />
                      <Legend />
                      <Bar
                        yAxisId="m"
                        name="Montant"
                        dataKey="montant"
                        fill="#22c55e"
                        radius={[4, 4, 0, 0]}
                      />
                      <Line
                        yAxisId="n"
                        name="Nb factures"
                        type="monotone"
                        dataKey="nbFactures"
                        stroke="#6366f1"
                        strokeWidth={2.5}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </>
            ) : (
              <div className="fa-empty small">
                Sélectionne un vendeur pour voir ses KPI et son évolution mensuelle.
              </div>
            )}
          </div>

          {/* ===== Tableau (conservé) ===== */}
          <div className="fa-table-title">
            Récapitulatif par vendeur
            <small> (vendeurs uniquement — clique une ligne pour le détail)</small>
          </div>
          <div className="ag-theme-quartz fa-grid">
            <AgGridReact
              rowData={vendeurs}
              columnDefs={columns}
              defaultColDef={defaultColDef}
              animateRows
              suppressCellFocus
              onRowClicked={(e) => setSelectedVendeur(e.data.code)}
            />
          </div>
        </>
      ) : null}
    </div>
  );
};

export default AdminFactureAnalyseScreen;