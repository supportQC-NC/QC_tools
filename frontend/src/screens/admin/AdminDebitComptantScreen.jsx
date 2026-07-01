// src/screens/admin/AdminDebitComptantScreen.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { HiRefresh, HiDownload, HiCash } from "react-icons/hi";
import {
  useGetDebitComptantQuery,
  useRefreshDebitComptantMutation,
} from "../../slices/debitComptantApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import { BASE_URL } from "../../constants";
import "./AdminDebitComptantScreen.css";

const STORAGE_KEY = "debit_comptant_entreprise";

const yesterdayYmd = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const r0 = (n) => Math.round(Number(n) || 0);
const fF = (n) => `${r0(n).toLocaleString("fr-FR")} F`;
const fQty = (n) => r0(n).toLocaleString("fr-FR");
const moneyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : fF(p.value);
const qtyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : fQty(p.value);
const pctFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : `${Number(p.value).toFixed(2)} %`;
const num = { type: "rightAligned" };

const AdminDebitComptantScreen = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState(
    () => localStorage.getItem(STORAGE_KEY) || "",
  );
  const [dateFin, setDateFin] = useState(yesterdayYmd);
  const [nbJours, setNbJours] = useState(7);
  const [tab, setTab] = useState("vendeur"); // vendeur | client | detail | groupe

  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();
  const { data, isLoading, isFetching, error } = useGetDebitComptantQuery(
    { nomDossierDBF: selectedEntreprise, dateFin, nbJours },
    { skip: !selectedEntreprise },
  );
  const [refreshDebitComptant, { isLoading: refreshing }] =
    useRefreshDebitComptantMutation();

  // Progression (lecture DBF en streaming)
  const [progress, setProgress] = useState(null);
  const pollRef = useRef(null);
  useEffect(() => {
    const active = Boolean(selectedEntreprise) && (isLoading || isFetching);
    if (!active) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setProgress(null);
      return undefined;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(
          `${BASE_URL}/api/debit-comptant/${selectedEntreprise}/progress`,
          { credentials: "include" },
        );
        if (!res.ok) return;
        const p = await res.json();
        if (!cancelled) setProgress(p);
      } catch (e) {
        /* ignore */
      }
    };
    poll();
    pollRef.current = setInterval(poll, 700);
    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [selectedEntreprise, isLoading, isFetching]);

  useEffect(() => {
    if (!selectedEntreprise && entreprises && entreprises.length > 0) {
      const qc = entreprises.find((e) => e.nomDossierDBF === "qc");
      const active = qc || entreprises.find((e) => e.isActive) || entreprises[0];
      if (active) setSelectedEntreprise(active.nomDossierDBF);
    }
  }, [entreprises, selectedEntreprise]);

  useEffect(() => {
    if (selectedEntreprise) localStorage.setItem(STORAGE_KEY, selectedEntreprise);
  }, [selectedEntreprise]);

  const handleRefresh = async () => {
    if (!selectedEntreprise) return;
    try {
      await refreshDebitComptant(selectedEntreprise).unwrap();
    } catch (e) {
      /* ignore */
    }
  };

  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      filter: "agTextColumnFilter",
      floatingFilter: true,
      resizable: true,
      minWidth: 100,
      suppressHeaderMenuButton: true,
    }),
    [],
  );

  const vendeurCols = useMemo(
    () => [
      { field: "repres", headerName: "Vendeur", minWidth: 100, cellClass: "cell-mono" },
      { field: "vendeurNom", headerName: "Nom vendeur", minWidth: 160 },
      { field: "nbFactures", headerName: "Nb factures", ...num, filter: "agNumberColumnFilter", valueFormatter: qtyFmt },
      { field: "montantTotal", headerName: "Montant total", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt, sort: "desc", cellClass: "col-montant" },
      { field: "remiseValeur", headerName: "Remise (XPF)", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt, cellClass: "col-remise" },
      { field: "remisePctMoy", headerName: "Remise % moy.", ...num, filter: "agNumberColumnFilter", valueFormatter: pctFmt },
    ],
    [],
  );

  const clientCols = useMemo(
    () => [
      { field: "tiers", headerName: "N° client", minWidth: 100, cellClass: "cell-mono" },
      { field: "nom", headerName: "Nom client", minWidth: 220 },
      { field: "nbFactures", headerName: "Nb factures", ...num, filter: "agNumberColumnFilter", valueFormatter: qtyFmt },
      { field: "montantTotal", headerName: "Montant total", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt, sort: "desc", cellClass: "col-montant" },
      { field: "remiseValeur", headerName: "Remise (XPF)", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt, cellClass: "col-remise" },
      { field: "remisePctMoy", headerName: "Remise % moy.", ...num, filter: "agNumberColumnFilter", valueFormatter: pctFmt },
    ],
    [],
  );

  const detailCols = useMemo(
    () => [
      { field: "repres", headerName: "Vendeur", minWidth: 90, cellClass: "cell-mono" },
      { field: "numfact", headerName: "N° facture", minWidth: 120, cellClass: "cell-mono" },
      { field: "date", headerName: "Date", minWidth: 100 },
      { field: "tiers", headerName: "N° client", minWidth: 90, cellClass: "cell-mono" },
      { field: "nom", headerName: "Nom client", minWidth: 200 },
      { field: "observ", headerName: "Observations", minWidth: 200 },
      { field: "montant", headerName: "Montant", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt, cellClass: "col-montant" },
      { field: "montantRemise", headerName: "Remise (XPF)", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt, cellClass: "col-remise" },
      { field: "pourcMoy", headerName: "Remise % moy.", ...num, filter: "agNumberColumnFilter", valueFormatter: pctFmt },
    ],
    [],
  );

  const groupeCols = useMemo(
    () => [
      { field: "tiers", headerName: "N° client", minWidth: 100, cellClass: "cell-mono" },
      { field: "nom", headerName: "Nom client", minWidth: 220 },
      { field: "categorie", headerName: "Catégorie", minWidth: 140 },
      { field: "observ", headerName: "Observations", minWidth: 200 },
      { field: "nbFactures", headerName: "Nb factures", ...num, filter: "agNumberColumnFilter", valueFormatter: qtyFmt },
      { field: "montantTotal", headerName: "Montant total", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt, sort: "desc", cellClass: "col-montant" },
    ],
    [],
  );

  const currentRows =
    tab === "vendeur"
      ? data?.recapVendeur || []
      : tab === "client"
      ? data?.recapClient || []
      : tab === "detail"
      ? data?.detailFactures || []
      : data?.recapGroupe || [];
  const currentCols =
    tab === "vendeur"
      ? vendeurCols
      : tab === "client"
      ? clientCols
      : tab === "detail"
      ? detailCols
      : groupeCols;

  const handleExport = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    // 1 - Récap vendeur
    const wsV = [["Vendeur", "Nom", "Nb factures", "Montant total (XPF)", "Remise (XPF)", "Remise % moy."]];
    data.recapVendeur.forEach((r) =>
      wsV.push([r.repres, r.vendeurNom, r.nbFactures, r0(r.montantTotal), r0(r.remiseValeur), r.remisePctMoy]),
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsV), "Récap vendeur");

    // 2 - Récap client
    const wsC = [["N° client", "Nom client", "Nb factures", "Montant total (XPF)", "Remise (XPF)", "Remise % moy."]];
    data.recapClient.forEach((r) =>
      wsC.push([r.tiers, r.nom, r.nbFactures, r0(r.montantTotal), r0(r.remiseValeur), r.remisePctMoy]),
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsC), "Récap client");

    // 3 - Détail par client (avec sous-totaux)
    const wsDC = [["N° facture", "Date", "Vendeur", "Observations", "Montant (XPF)", "Remise (XPF)", "Remise % moy."]];
    const byClient = new Map();
    data.detailFactures.forEach((r) => {
      const k = `${r.tiers}||${r.nom}`;
      if (!byClient.has(k)) byClient.set(k, []);
      byClient.get(k).push(r);
    });
    [...byClient.entries()]
      .sort((a, b) => (a[0].split("||")[1] < b[0].split("||")[1] ? -1 : 1))
      .forEach(([k, rows]) => {
        const [tiers, nom] = k.split("||");
        wsDC.push([`Client ${tiers} — ${nom}`, "", "", "", "", "", ""]);
        let sM = 0;
        let sR = 0;
        let sP = 0;
        rows.forEach((r) => {
          wsDC.push([r.numfact, r.date, r.repres, r.observ, r0(r.montant), r0(r.montantRemise), r.pourcMoy]);
          sM += r.montant;
          sR += r.montantRemise;
          sP += r.pourcMoy;
        });
        wsDC.push(["Sous-total", "", "", "", r0(sM), r0(sR), rows.length ? Math.round((sP / rows.length) * 100) / 100 : 0]);
        wsDC.push([]);
      });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsDC), "Détail par client");

    // 4 - Détail factures
    const wsD = [["Vendeur", "N° facture", "Date", "N° client", "Nom client", "Observations", "Montant (XPF)", "Remise (XPF)", "Remise % moy."]];
    data.detailFactures.forEach((r) =>
      wsD.push([r.repres, r.numfact, r.date, r.tiers, r.nom, r.observ, r0(r.montant), r0(r.montantRemise), r.pourcMoy]),
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsD), "Détail factures");

    // 5 - Clients GROUPE
    const wsG = [["N° client", "Nom client", "Catégorie", "Observations", "Nb factures", "Montant total (XPF)"]];
    data.recapGroupe.forEach((r) =>
      wsG.push([r.tiers, r.nom, r.categorie, r.observ, r.nbFactures, r0(r.montantTotal)]),
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsG), "Clients GROUPE");

    XLSX.writeFile(
      wb,
      `debit_comptant_${selectedEntreprise}_${data.periode.dateDebut}_${data.periode.dateFin}.xlsx`,
    );
  };

  const totaux = data?.totaux;
  const loading = isLoading || (isFetching && !data);

  return (
    <div className="admin-debit-comptant">
      <div className="dc-header">
        <h1>
          <HiCash /> Débit / Comptant
        </h1>
        <div className="dc-actions">
          <select
            className="dc-select"
            value={selectedEntreprise}
            onChange={(e) => setSelectedEntreprise(e.target.value)}
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
          <label className="dc-field">
            Fin
            <input
              type="date"
              value={dateFin}
              max={yesterdayYmd()}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </label>
          <label className="dc-field">
            Jours
            <input
              type="number"
              min="1"
              max="366"
              value={nbJours}
              onChange={(e) => setNbJours(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </label>
          <button className="dc-btn" onClick={handleRefresh} disabled={refreshing || isFetching}>
            <HiRefresh className={refreshing ? "spin" : ""} /> Rafraîchir
          </button>
          <button className="dc-btn primary" onClick={handleExport} disabled={!data}>
            <HiDownload /> Excel
          </button>
        </div>
      </div>

      {data?.periode && (
        <div className="dc-periode">
          Ventes comptant de clients « débit » (OBSERV sans COMPTANT) — factures{" "}
          {data.periode.txt}
        </div>
      )}

      {!selectedEntreprise ? (
        <div className="dc-empty">Choisissez une entreprise.</div>
      ) : loading ? (
        <div className="dc-loading">
          <Loader />
          <div className="dc-progress-msg">
            {progress?.message || "Chargement des factures et du détail…"}
          </div>
          <div className="dc-progress-bar">
            <div
              className="dc-progress-fill"
              style={{ width: `${progress?.pct || 0}%` }}
            />
          </div>
          <div className="dc-progress-pct">{progress?.pct || 0}%</div>
          <p className="dc-progress-hint">
            Le détail (~5,8 M lignes) est lu en streaming — long au 1ᵉʳ accès, puis
            mis en cache 5 min.
          </p>
        </div>
      ) : error ? (
        <div className="dc-error">{error?.data?.message || "Erreur de chargement."}</div>
      ) : data ? (
        <>
          {isFetching && <div className="dc-refreshing">Actualisation…</div>}

          {totaux && (
            <div className="dc-kpis">
              <div className="dc-kpi">
                <span className="v">{fQty(totaux.nbFactures)}</span>
                <span className="l">Factures comptant</span>
              </div>
              <div className="dc-kpi">
                <span className="v">{fF(totaux.montantTotal)}</span>
                <span className="l">Montant total</span>
              </div>
              <div className="dc-kpi">
                <span className="v">{fF(totaux.remiseTotal)}</span>
                <span className="l">Remise totale</span>
              </div>
              <div className="dc-kpi">
                <span className="v">{fQty(totaux.nbVendeurs)}</span>
                <span className="l">Vendeurs</span>
              </div>
              <div className="dc-kpi">
                <span className="v">{fQty(totaux.nbClients)}</span>
                <span className="l">Clients</span>
              </div>
              <div className="dc-kpi teal">
                <span className="v">{fQty(totaux.nbGroupe)}</span>
                <span className="l">Clients GROUPE cpt.</span>
              </div>
            </div>
          )}

          <div className="dc-tabs">
            <button className={tab === "vendeur" ? "active" : ""} onClick={() => setTab("vendeur")}>
              Récap vendeur ({data.recapVendeur.length})
            </button>
            <button className={tab === "client" ? "active" : ""} onClick={() => setTab("client")}>
              Récap client ({data.recapClient.length})
            </button>
            <button className={tab === "detail" ? "active" : ""} onClick={() => setTab("detail")}>
              Détail factures ({data.detailFactures.length})
            </button>
            <button className={`teal ${tab === "groupe" ? "active" : ""}`} onClick={() => setTab("groupe")}>
              Clients GROUPE ({data.recapGroupe.length})
            </button>
          </div>

          <div className="ag-theme-quartz-dark dc-grid">
            <AgGridReact
              rowData={currentRows}
              columnDefs={currentCols}
              defaultColDef={defaultColDef}
              animateRows={false}
              rowHeight={30}
              headerHeight={30}
              floatingFiltersHeight={32}
              suppressFieldDotNotation
              tooltipShowDelay={300}
            />
          </div>
        </>
      ) : null}
    </div>
  );
};

export default AdminDebitComptantScreen;