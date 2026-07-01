// src/screens/admin/AdminFilialesScreen.jsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { HiOfficeBuilding, HiRefresh, HiDownload, HiSearch } from "react-icons/hi";
import {
  useGetReseauxQuery,
  useGetReseauQuery,
  useRefreshReseauMutation,
} from "../../slices/filialesApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import { BASE_URL } from "../../constants";
import "./AdminFilialesScreen.css";

const STORAGE_KEY = "filiales_reseau";

const r0 = (n) => Math.round(Number(n) || 0);
const fF = (n) => `${r0(n).toLocaleString("fr-FR")} F`;
const fQty = (n) => r0(n).toLocaleString("fr-FR");

// Formatters AG Grid
const moneyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : fF(p.value);
const qtyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : fQty(p.value);
const pctFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : `${p.value}%`;

const AdminFilialesScreen = () => {
  const [selectedReseau, setSelectedReseau] = useState(
    () => localStorage.getItem(STORAGE_KEY) || "",
  );
  const [search, setSearch] = useState("");
  const [filtreMode, setFiltreMode] = useState("TOUS"); // TOUS | O | N
  const [hiddenEntities, setHiddenEntities] = useState(() => new Set());
  const gridApiRef = useRef(null);

  const { data: reseaux } = useGetReseauxQuery();
  const { data, isLoading, isFetching, error, refetch } = useGetReseauQuery(
    selectedReseau,
    { skip: !selectedReseau },
  );
  const [refreshReseau, { isLoading: refreshing }] = useRefreshReseauMutation();

  useEffect(() => {
    if (!selectedReseau && reseaux && reseaux.length > 0) {
      setSelectedReseau(reseaux[0].code);
    }
  }, [reseaux, selectedReseau]);

  useEffect(() => {
    if (selectedReseau) localStorage.setItem(STORAGE_KEY, selectedReseau);
  }, [selectedReseau]);

  // Réinitialise le masquage des filiales quand on change de réseau
  useEffect(() => {
    setHiddenEntities(new Set());
  }, [selectedReseau]);

  // Progression
  const [progress, setProgress] = useState(null);
  const pollRef = useRef(null);
  useEffect(() => {
    const active = Boolean(selectedReseau) && (isLoading || isFetching);
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
          `${BASE_URL}/api/filiales/${selectedReseau}/progress`,
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
  }, [selectedReseau, isLoading, isFetching]);

  const handleRefresh = async () => {
    if (!selectedReseau) return;
    try {
      await refreshReseau(selectedReseau).unwrap();
    } catch (e) {
      /* ignore */
    }
    refetch();
  };

  // --- Données à plat pour AG Grid ---
  const allRows = useMemo(() => {
    if (!data) return [];
    return data.rows.map((r) => {
      const o = {
        gisement: r.gisement,
        nart: r.nart,
        design: r.design,
        nomFour: r.nomFour,
        stock: r.stock,
        pvte: r.pvte,
        vteAn: r.vteAn,
        caAn: r.caAn,
        vteHorsReseau: r.vteHorsReseau,
        pctReseau: r.pctReseau === null ? null : Math.round(r.pctReseau * 100),
        filtre: r.filtre,
      };
      data.filiales.forEach((f) => {
        const c = r.filiales[f.code];
        o[`${f.code}_nart`] = c ? c.NART : null;
        o[`${f.code}_stock`] = c ? c.STOCK : null;
        o[`${f.code}_pvte`] = c ? c.PVTE : null;
        o[`${f.code}_vteAn`] = c ? c.VTE_AN : null;
        o[`${f.code}_caAn`] = c ? c.CA_AN : null;
      });
      return o;
    });
  }, [data]);

  const rowData = useMemo(() => {
    if (filtreMode === "TOUS") return allRows;
    return allRows.filter((r) => r.filtre === filtreMode);
  }, [allRows, filtreMode]);

  // --- Définition des colonnes (groupes mère / RÉSEAU / filiales) ---
  const columnDefs = useMemo(() => {
    if (!data) return [];
    const num = { type: "rightAligned" };
    const cols = [
      {
        headerName: `${data.mere} (maison-mère)`,
        headerClass: "grp grp-mere",
        children: [
          {
            field: "nart",
            headerName: "NART",
            pinned: "left",
            minWidth: 110,
            cellClass: "cell-mono",
          },
          {
            field: "design",
            headerName: "Désignation",
            minWidth: 240,
            tooltipField: "design",
          },
          { field: "nomFour", headerName: "Fournisseur", minWidth: 160 },
          { field: "gisement", headerName: "Gisement", minWidth: 90 },
          {
            field: "stock",
            headerName: "Stock",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: qtyFmt,
          },
          {
            field: "pvte",
            headerName: "PVTE",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: moneyFmt,
          },
          {
            field: "vteAn",
            headerName: "VTE AN",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: qtyFmt,
          },
          {
            field: "caAn",
            headerName: "CA AN",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: moneyFmt,
            sort: "desc",
          },
        ],
      },
      {
        headerName: "RÉSEAU",
        headerClass: "grp grp-reseau",
        children: [
          {
            field: "vteHorsReseau",
            headerName: "VTE hors rés.",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: qtyFmt,
          },
          {
            field: "pctReseau",
            headerName: "% rés.",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: pctFmt,
          },
          {
            field: "filtre",
            headerName: "Filtre",
            minWidth: 90,
            cellClassRules: {
              "filtre-o": (p) => p.value === "O",
              "filtre-n": (p) => p.value === "N",
            },
            cellStyle: { textAlign: "center", fontWeight: 700 },
          },
        ],
      },
    ];

    data.filiales.forEach((f) => {
      const suffix = f.error ? " (erreur)" : !f.present ? " (absente)" : "";
      cols.push({
        headerName: `${f.label}${suffix}`,
        headerClass: "grp grp-fil",
        groupId: `grp_${f.code}`,
        openByDefault: false,
        children: [
          {
            field: `${f.code}_nart`,
            headerName: "NART",
            minWidth: 100,
            cellClass: "cell-mono",
            columnGroupShow: "open",
          },
          {
            field: `${f.code}_stock`,
            headerName: "Stock",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: qtyFmt,
            columnGroupShow: "open",
          },
          {
            field: `${f.code}_pvte`,
            headerName: "PVTE",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: moneyFmt,
            columnGroupShow: "open",
          },
          {
            // colonne représentative visible même groupe replié
            field: `${f.code}_vteAn`,
            headerName: "VTE AN",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: qtyFmt,
          },
          {
            field: `${f.code}_caAn`,
            headerName: "CA AN",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: moneyFmt,
            columnGroupShow: "open",
          },
        ],
      });
    });
    return cols;
  }, [data]);

  const defaultColDef = useMemo(
    () => ({
      sortable: true,
      filter: "agTextColumnFilter",
      floatingFilter: true,
      resizable: true,
      minWidth: 110,
      suppressHeaderMenuButton: true,
    }),
    [],
  );

  const onGridReady = useCallback((params) => {
    gridApiRef.current = params.api;
  }, []);

  // Masquer / afficher toutes les colonnes d'une filiale
  const entityColIds = (code) => [
    `${code}_nart`,
    `${code}_stock`,
    `${code}_pvte`,
    `${code}_vteAn`,
    `${code}_caAn`,
  ];
  const toggleEntity = (code) => {
    setHiddenEntities((prev) => {
      const next = new Set(prev);
      const willHide = !next.has(code);
      if (willHide) next.add(code);
      else next.delete(code);
      if (gridApiRef.current) {
        gridApiRef.current.setColumnsVisible(entityColIds(code), !willHide);
      }
      return next;
    });
  };

  // --- Export Excel (respecte les filtres/tri de la grille) ---
  const handleExport = () => {
    if (!data) return;
    const headers = [
      "GISEMENT",
      `NART ${data.mere}`,
      `DESIGN ${data.mere}`,
      "NOM FOUR",
      `STOCK ${data.mere}`,
      `PVTE ${data.mere}`,
      `VTE AN ${data.mere}`,
      `CA AN ${data.mere}`,
      "VTE HORS RESEAU",
      "% RESEAU",
      "FILTRE RESEAU",
    ];
    data.filiales.forEach((f) => {
      headers.push(
        `NART ${f.label}`,
        `STOCK ${f.label}`,
        `PVTE ${f.label}`,
        `VTE AN ${f.label}`,
        `CA AN ${f.label}`,
      );
    });

    const aoa = [headers];
    const pushRow = (r) => {
      const line = [
        r.gisement,
        r.nart,
        r.design,
        r.nomFour,
        r0(r.stock),
        r0(r.pvte),
        r0(r.vteAn),
        r0(r.caAn),
        r0(r.vteHorsReseau),
        r.pctReseau === null ? "" : r.pctReseau,
        r.filtre,
      ];
      data.filiales.forEach((f) => {
        const nartV = r[`${f.code}_nart`];
        if (nartV) {
          line.push(
            nartV,
            r0(r[`${f.code}_stock`]),
            r0(r[`${f.code}_pvte`]),
            r0(r[`${f.code}_vteAn`]),
            r0(r[`${f.code}_caAn`]),
          );
        } else {
          line.push("", "", "", "", "");
        }
      });
      aoa.push(line);
    };

    if (gridApiRef.current) {
      gridApiRef.current.forEachNodeAfterFilterAndSort((node) =>
        pushRow(node.data),
      );
    } else {
      rowData.forEach(pushRow);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Analyse Filiales");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Analyse_Filiales_${data.reseau}_${today}.xlsx`);
  };

  const totaux = data?.totaux;

  return (
    <div className="admin-filiales">
      <div className="af-header">
        <h1>
          <HiOfficeBuilding /> Analyse Filiales
        </h1>
        <div className="af-actions">
          <button
            className="af-btn"
            onClick={handleRefresh}
            disabled={!selectedReseau || refreshing || isFetching}
          >
            <HiRefresh className={refreshing ? "spin" : ""} /> Rafraîchir
          </button>
          <button
            className="af-btn primary"
            onClick={handleExport}
            disabled={!data || !rowData.length}
          >
            <HiDownload /> Excel
          </button>
        </div>
      </div>

      <div className="af-reseaux">
        {(reseaux || []).map((rez) => (
          <button
            key={rez.code}
            className={`af-reseau-tab ${
              selectedReseau === rez.code ? "active" : ""
            }`}
            onClick={() => setSelectedReseau(rez.code)}
          >
            Réseau {rez.code}
            <span className="af-reseau-sub">
              {rez.mere} + {rez.filiales.length} filiales
            </span>
          </button>
        ))}
      </div>

      {!selectedReseau ? (
        <div className="af-empty">Choisissez un réseau.</div>
      ) : isLoading ? (
        <div className="af-progress">
          <Loader />
          <div className="af-progress-msg">
            {progress?.message || "Préparation…"}
          </div>
          <div className="af-progress-bar">
            <div
              className="af-progress-fill"
              style={{ width: `${progress?.pct || 0}%` }}
            />
          </div>
          <div className="af-progress-pct">{progress?.pct || 0}%</div>
          <p className="af-progress-hint">
            Le 1ᵉʳ calcul charge les articles de toutes les entités du réseau —
            c'est long, puis mis en cache 10 min.
          </p>
        </div>
      ) : error ? (
        <div className="af-error">
          {error?.data?.message ||
            "Erreur de chargement (une entité du réseau est peut-être introuvable)."}
        </div>
      ) : data ? (
        <>
          {isFetching && (
            <div className="af-refreshing">
              {progress?.message || "Recalcul…"}
              {progress?.pct ? ` (${progress.pct}%)` : ""}
            </div>
          )}

          {data.warnings && data.warnings.length > 0 && (
            <div className="af-warnings">
              <strong>⚠ Certaines entités ont été ignorées :</strong>
              <ul>
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {totaux && (
            <div className="af-kpis">
              <div className="af-kpi">
                <span className="v">{fQty(totaux.nbArticles)}</span>
                <span className="l">Articles {data.mere}</span>
              </div>
              <div className="af-kpi">
                <span className="v">{fQty(totaux.nbDansReseau)}</span>
                <span className="l">Dans le réseau (O)</span>
              </div>
              <div className="af-kpi">
                <span className="v">{fF(totaux.caMere)}</span>
                <span className="l">CA HT {data.mere}</span>
              </div>
              <div className="af-kpi">
                <span className="v">{fQty(totaux.vteHorsReseau)}</span>
                <span className="l">Ventes hors réseau</span>
              </div>
            </div>
          )}

          <div className="af-filters">
            <div className="af-search">
              <HiSearch />
              <input
                type="text"
                placeholder="Recherche rapide (toutes colonnes)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="af-filtre-toggle">
              {["TOUS", "O", "N"].map((m) => (
                <button
                  key={m}
                  className={filtreMode === m ? "active" : ""}
                  onClick={() => setFiltreMode(m)}
                >
                  {m === "TOUS" ? "Tous" : m === "O" ? "Réseau" : "Hors réseau"}
                </button>
              ))}
            </div>
            <span className="af-count">
              {rowData.length.toLocaleString("fr-FR")} lignes
            </span>
          </div>

          <div className="af-entities">
            <span className="af-entities-label">Filiales :</span>
            {data.filiales.map((f) => (
              <button
                key={f.code}
                className={`af-chip ${hiddenEntities.has(f.code) ? "off" : ""}`}
                style={{ "--chip-color": `#${f.color}` }}
                onClick={() => toggleEntity(f.code)}
                title={
                  hiddenEntities.has(f.code)
                    ? `Afficher ${f.label}`
                    : `Masquer ${f.label}`
                }
              >
                <i className="dot" />
                {f.label}
              </button>
            ))}
            <span className="af-entities-hint">
              (clic = masquer/afficher · flèche sur l'en-tête d'un groupe =
              replier)
            </span>
          </div>

          <div className="ag-theme-quartz-dark af-grid">
            <AgGridReact
              rowData={rowData}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              quickFilterText={search}
              onGridReady={onGridReady}
              animateRows={false}
              rowHeight={30}
              headerHeight={30}
              floatingFiltersHeight={32}
              groupHeaderHeight={30}
              suppressFieldDotNotation
              tooltipShowDelay={300}
            />
          </div>
        </>
      ) : null}
    </div>
  );
};

export default AdminFilialesScreen;