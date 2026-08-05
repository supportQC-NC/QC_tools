// src/screens/admin/AdminGencodDoublonsScreen.jsx
import React, { useMemo, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { HiRefresh, HiDownload, HiDuplicate, HiSearch } from "react-icons/hi";
import { useSelector } from "react-redux";
import {
  useGetGencodDoublonsQuery,
  useRefreshGencodDoublonsMutation,
} from "../../slices/gencodDoublonsApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import Loader from "../../components/Shared/Loader/Loader";
import { roundInt, fmtFranc, fmtQty } from "../../utils/format";
import "./AdminGencodDoublonsScreen.css";
const moneyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : fmtFranc(p.value);
const qtyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : fmtQty(p.value);
const num = { type: "rightAligned" };

const AdminGencodDoublonsScreen = () => {
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalDossier) || "";
  const [search, setSearch] = useState("");

  const { data, isLoading, isFetching, error } = useGetGencodDoublonsQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );
  const [refreshGencodDoublons, { isLoading: refreshing }] =
    useRefreshGencodDoublonsMutation();

  const handleRefresh = async () => {
    if (!selectedEntreprise) return;
    try {
      await refreshGencodDoublons(selectedEntreprise).unwrap();
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

  const columnDefs = useMemo(
    () => [
      { field: "gencod", headerName: "GENCODE", pinned: "left", minWidth: 150, cellClass: "cell-mono gencod-cell" },
      { field: "nbDoublons", headerName: "Nb", ...num, filter: "agNumberColumnFilter", maxWidth: 80, cellClass: "col-nb" },
      { field: "nart", headerName: "NART", minWidth: 100, cellClass: "cell-mono" },
      { field: "design", headerName: "Désignation", minWidth: 260, tooltipField: "design" },
      { field: "design2", headerName: "Désignation 2", minWidth: 180 },
      { field: "refer", headerName: "Réf. fourn.", minWidth: 130, cellClass: "cell-mono" },
      { field: "fourn", headerName: "Four.", minWidth: 80 },
      { field: "fournNom", headerName: "Fournisseur", minWidth: 170 },
      { field: "stock", headerName: "Stock", ...num, filter: "agNumberColumnFilter", valueFormatter: qtyFmt, minWidth: 90 },
      { field: "pvte", headerName: "PVTE", ...num, filter: "agNumberColumnFilter", valueFormatter: moneyFmt, minWidth: 110 },
    ],
    [],
  );

  // Couleur alternée par GENCODE (groupe de doublons)
  const getRowClass = useCallback((params) => {
    if (!params.data) return "";
    return params.data.groupIndex % 2 === 0 ? "grp-a" : "grp-b";
  }, []);

  const handleExport = () => {
    if (!data) return;
    const headers = [
      "GENCODE",
      "NB DOUBLONS",
      "NART",
      "DESIGNATION",
      "DESIGNATION 2",
      "REFERENCE",
      "FOURN",
      "FOURNISSEUR",
      "STOCK",
      "PVTE",
    ];
    const aoa = [headers];
    (data.rows || []).forEach((r) =>
      aoa.push([
        r.gencod,
        r.nbDoublons,
        r.nart,
        r.design,
        r.design2,
        r.refer,
        r.fourn,
        r.fournNom,
        roundInt(r.stock),
        roundInt(r.pvte),
      ]),
    );
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Doublons GENCODE");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `doublons_gencode_${selectedEntreprise}_${today}.xlsx`);
  };

  const totaux = data?.totaux;
  const loading = isLoading || (isFetching && !data);

  return (
    <div className="admin-gencod-doublons">
      <div className="gd-header">
        <h1>
          <HiDuplicate /> Doublons GENCODE
        </h1>
        <div className="gd-actions">
          <button
            className="gd-btn"
            onClick={handleRefresh}
            disabled={!selectedEntreprise || refreshing || isFetching}
          >
            <HiRefresh className={refreshing ? "spin" : ""} /> Rafraîchir
          </button>
          <button
            className="gd-btn primary"
            onClick={handleExport}
            disabled={!data || !data.rows.length}
          >
            <HiDownload /> Excel
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="gd-empty">Choisissez une entreprise.</div>
      ) : loading ? (
        <div className="gd-loading">
          <Loader />
          <p>Analyse de la base article…</p>
        </div>
      ) : error ? (
        <div className="gd-error">{error?.data?.message || "Erreur de chargement."}</div>
      ) : data ? (
        <>
          {isFetching && <div className="gd-refreshing">Actualisation…</div>}

          {totaux && (
            <div className="gd-kpis">
              <div className="gd-kpi warn">
                <span className="v">{fmtQty(totaux.nbGencodsDoublons)}</span>
                <span className="l">GENCODE en double</span>
              </div>
              <div className="gd-kpi">
                <span className="v">{fmtQty(totaux.nbArticlesConcernes)}</span>
                <span className="l">Articles concernés</span>
              </div>
              <div className="gd-kpi">
                <span className="v">{fmtQty(totaux.nbArticles)}</span>
                <span className="l">Articles au total</span>
              </div>
            </div>
          )}

          {data.rows.length === 0 ? (
            <div className="gd-empty">Aucun GENCODE en double 🎉</div>
          ) : (
            <>
              <div className="gd-filters">
                <div className="gd-search">
                  <HiSearch />
                  <input
                    type="text"
                    placeholder="Recherche rapide (GENCODE, NART, désignation…)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <span className="gd-hint">
                  Les lignes de même couleur = même GENCODE
                </span>
                <span className="gd-count">
                  {data.rows.length.toLocaleString("fr-FR")} lignes
                </span>
              </div>

              <div className="ag-theme-quartz-dark gd-grid">
                <AgGridReact
                  rowData={data.rows}
                  columnDefs={columnDefs}
                  defaultColDef={defaultColDef}
                  quickFilterText={search}
                  getRowClass={getRowClass}
                  animateRows={false}
                  rowHeight={30}
                  headerHeight={30}
                  floatingFiltersHeight={32}
                  suppressFieldDotNotation
                  tooltipShowDelay={300}
                />
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  );
};

export default AdminGencodDoublonsScreen;