// src/screens/admin/AdminReapproLocalScreen.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { HiRefresh, HiDownload, HiTruck } from "react-icons/hi";
import {
  useGetReapproLocalQuery,
  useRefreshReapproLocalMutation,
} from "../../slices/reapproLocalApiSlice";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import { BASE_URL } from "../../constants";
import "./AdminReapproLocalScreen.css";

const STORAGE_KEY = "reappro_local_entreprise";

const r0 = (n) => Math.round(Number(n) || 0);
const fF = (n) => `${r0(n).toLocaleString("fr-FR")} F`;
const fQty = (n) => r0(n).toLocaleString("fr-FR");
const moneyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : fF(p.value);
const qtyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : fQty(p.value);
const num = { type: "rightAligned" };

const AdminReapproLocalScreen = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState(
    () => localStorage.getItem(STORAGE_KEY) || "",
  );
  const [tab, setTab] = useState("groupe"); // groupe | autres | corrections

  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();
  const { data, isLoading, isFetching, error, refetch } =
    useGetReapproLocalQuery(selectedEntreprise, { skip: !selectedEntreprise });
  const [refreshReapproLocal, { isLoading: refreshing }] =
    useRefreshReapproLocalMutation();

  useEffect(() => {
    if (!selectedEntreprise && entreprises && entreprises.length > 0) {
      const active = entreprises.find((e) => e.isActive) || entreprises[0];
      if (active) setSelectedEntreprise(active.nomDossierDBF);
    }
  }, [entreprises, selectedEntreprise]);

  useEffect(() => {
    if (selectedEntreprise) localStorage.setItem(STORAGE_KEY, selectedEntreprise);
  }, [selectedEntreprise]);

  // Progression
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
          `${BASE_URL}/api/reappro-local/${selectedEntreprise}/progress`,
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

  const handleRefresh = async () => {
    if (!selectedEntreprise) return;
    try {
      await refreshReapproLocal(selectedEntreprise).unwrap();
    } catch (e) {
      /* ignore */
    }
    refetch();
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

  // Colonnes communes (article)
  const baseCols = [
    { field: "nart", headerName: "NART", pinned: "left", minWidth: 110, cellClass: "cell-mono" },
    { field: "design", headerName: "Désignation", minWidth: 240, tooltipField: "design" },
    { field: "pvte", headerName: "PVTE", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt },
    { field: "groupeArt", headerName: "Groupe", minWidth: 90 },
    { field: "codtar", headerName: "Cod. tarif", minWidth: 90 },
    { field: "vteMoyMois", headerName: "VTE moy/mois", ...num, filter: "agNumberColumnFilter" },
    { field: "venteAnnuelle", headerName: "VTE an", ...num, filter: "agNumberColumnFilter", valueFormatter: qtyFmt },
    { field: "caMois", headerName: "CA/mois", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt },
    { field: "caJour", headerName: "CA/jour", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt },
    { field: "stock", headerName: "Stock", ...num, filter: "agNumberColumnFilter", valueFormatter: qtyFmt },
    { field: "encde", headerName: "En cde", ...num, filter: "agNumberColumnFilter", valueFormatter: qtyFmt },
    { field: "fourLocal", headerName: "Four. local", minWidth: 160 },
  ];

  const groupeCols = useMemo(
    () => [
      ...baseCols,
      { field: "nartFour", headerName: "NART four.", minWidth: 110, cellClass: "cell-mono" },
      { field: "stockFour", headerName: "Stock four.", ...num, filter: "agNumberColumnFilter", valueFormatter: qtyFmt },
      { field: "encdeFour", headerName: "En cde four.", ...num, filter: "agNumberColumnFilter", valueFormatter: qtyFmt },
      {
        field: "stopFour",
        headerName: "Stop four.",
        minWidth: 100,
        cellClassRules: { "stop-supprimer": (p) => p.value === "A SUPPRIMER" },
      },
      { field: "reappro", headerName: "REAPPRO", ...num, filter: "agNumberColumnFilter", cellClass: "col-reappro" },
      { field: "caPerdu", headerName: "CA PERDU", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt, cellClass: "col-caperdu" },
      { field: "aCommander", headerName: "À CMD FOUR", ...num, filter: "agNumberColumnFilter", cellClass: "col-cmd" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const autresCols = useMemo(
    () => [
      ...baseCols,
      { field: "reappro", headerName: "REAPPRO", ...num, filter: "agNumberColumnFilter", cellClass: "col-reappro" },
      { field: "caPerdu", headerName: "CA PERDU", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt, cellClass: "col-caperdu" },
      { field: "aCommander", headerName: "À CMD FOUR", ...num, filter: "agNumberColumnFilter", cellClass: "col-cmd" },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const correctionsCols = useMemo(
    () => [
      { field: "nart", headerName: "NART", minWidth: 110, cellClass: "cell-mono" },
      { field: "design", headerName: "Désignation", minWidth: 240 },
      { field: "ad1", headerName: "AD1 (trigramme)", minWidth: 120 },
      { field: "fourLocal", headerName: "Fournisseur", minWidth: 160 },
      { field: "refer", headerName: "REFER actuelle", minWidth: 130, cellClass: "cell-mono" },
      { field: "probleme", headerName: "Problème", minWidth: 220, cellClass: "col-pb" },
      { field: "action", headerName: "Action à effectuer", minWidth: 320 },
    ],
    [],
  );

  const currentRows =
    tab === "groupe"
      ? data?.groupe || []
      : tab === "autres"
      ? data?.autres || []
      : data?.corrections || [];
  const currentCols =
    tab === "groupe" ? groupeCols : tab === "autres" ? autresCols : correctionsCols;

  // Export Excel (3 feuilles)
  const handleExport = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    const sheetArticles = (rows, withFour) => {
      const headers = [
        "NART",
        "DESIGN",
        "PVTE",
        "GROUPE",
        "CODTAR",
        "VTE_MOY_MOIS",
        "VTE_AN",
        "CA_MOIS",
        "CA_JOUR",
        "STOCK",
        "ENCDE",
        "FOUR LOCAL",
      ];
      if (withFour)
        headers.push("NART FOUR", "STOCK FOUR", "ENCDE FOUR", "STOP FOUR");
      headers.push("REAPPRO", "CA PERDU", "A COMMANDER FOUR");
      const aoa = [headers];
      rows.forEach((r) => {
        const line = [
          r.nart,
          r.design,
          r0(r.pvte),
          r.groupeArt,
          r.codtar,
          r.vteMoyMois,
          r0(r.venteAnnuelle),
          r0(r.caMois),
          r0(r.caJour),
          r0(r.stock),
          r0(r.encde),
          r.fourLocal,
        ];
        if (withFour)
          line.push(
            r.nartFour,
            r.stockFour === "" ? "" : r0(r.stockFour),
            r.encdeFour === "" ? "" : r0(r.encdeFour),
            r.stopFour,
          );
        line.push(r0(r.reappro), r0(r.caPerdu), r0(r.aCommander));
        aoa.push(line);
      });
      return XLSX.utils.aoa_to_sheet(aoa);
    };

    XLSX.utils.book_append_sheet(wb, sheetArticles(data.groupe, true), "GROUPE");
    XLSX.utils.book_append_sheet(
      wb,
      sheetArticles(data.autres, false),
      "AUTRES FOUR LOCAUX",
    );

    const corrAoa = [
      ["NART", "DESIGN", "AD1", "FOURNISSEUR", "REFER", "PROBLEME", "ACTION"],
    ];
    data.corrections.forEach((c) =>
      corrAoa.push([
        c.nart,
        c.design,
        c.ad1,
        c.fourLocal,
        c.refer,
        c.probleme,
        c.action,
      ]),
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(corrAoa),
      "CORRECTIONS BDD",
    );

    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `reappro_local_${selectedEntreprise}_${today}.xlsx`);
  };

  const totaux = data?.totaux;

  return (
    <div className="admin-reappro-local">
      <div className="rl-header">
        <h1>
          <HiTruck /> Reappro Local
        </h1>
        <div className="rl-actions">
          <select
            className="rl-select"
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
          <button
            className="rl-btn"
            onClick={handleRefresh}
            disabled={!selectedEntreprise || refreshing || isFetching}
          >
            <HiRefresh className={refreshing ? "spin" : ""} /> Rafraîchir
          </button>
          <button
            className="rl-btn primary"
            onClick={handleExport}
            disabled={!data}
          >
            <HiDownload /> Excel
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="rl-empty">Choisissez une entreprise.</div>
      ) : isLoading ? (
        <div className="rl-progress">
          <Loader />
          <div className="rl-progress-msg">
            {progress?.message || "Préparation…"}
          </div>
          <div className="rl-progress-bar">
            <div
              className="rl-progress-fill"
              style={{ width: `${progress?.pct || 0}%` }}
            />
          </div>
          <div className="rl-progress-pct">{progress?.pct || 0}%</div>
          <p className="rl-progress-hint">
            Calcul du réappro + croisement avec les bases fournisseurs du groupe —
            long la 1ᵉʳ fois, puis mis en cache 10 min.
          </p>
        </div>
      ) : error ? (
        <div className="rl-error">
          {error?.data?.message || "Erreur de chargement."}
        </div>
      ) : data ? (
        <>
          {isFetching && (
            <div className="rl-refreshing">
              {progress?.message || "Recalcul…"}
              {progress?.pct ? ` (${progress.pct}%)` : ""}
            </div>
          )}

          {totaux && (
            <div className="rl-kpis">
              <div className="rl-kpi">
                <span className="v">{fQty(totaux.aCommanderGroupe)}</span>
                <span className="l">À commander (groupe)</span>
              </div>
              <div className="rl-kpi">
                <span className="v">{fF(totaux.caPerduGroupe)}</span>
                <span className="l">CA perdu (groupe)</span>
              </div>
              <div className="rl-kpi">
                <span className="v">{fQty(totaux.nbGroupe)}</span>
                <span className="l">Articles GROUPE</span>
              </div>
              <div className="rl-kpi">
                <span className="v">{fQty(totaux.nbAutres)}</span>
                <span className="l">Articles AUTRES</span>
              </div>
              <div className="rl-kpi warn">
                <span className="v">{fQty(totaux.nbCorrections)}</span>
                <span className="l">Corrections BDD</span>
              </div>
            </div>
          )}

          <div className="rl-tabs">
            <button
              className={tab === "groupe" ? "active" : ""}
              onClick={() => setTab("groupe")}
            >
              GROUPE ({data.groupe.length})
            </button>
            <button
              className={tab === "autres" ? "active" : ""}
              onClick={() => setTab("autres")}
            >
              AUTRES FOUR LOCAUX ({data.autres.length})
            </button>
            <button
              className={`corr ${tab === "corrections" ? "active" : ""}`}
              onClick={() => setTab("corrections")}
            >
              CORRECTIONS BDD ({data.corrections.length})
            </button>
          </div>

          <div className="ag-theme-quartz-dark rl-grid">
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

export default AdminReapproLocalScreen;