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
import { roundInt, fmtFranc, fmtQty } from "../../utils/format";
import "./AdminFilialesScreen.css";

const STORAGE_KEY = "filiales_reseau";

// Formatters AG Grid
const moneyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : fmtFranc(p.value);
const qtyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : fmtQty(p.value);
const pctFmt = (p) =>
  p.value === null || p.value === undefined || p.value === "" ? "" : `${p.value}%`;

const AdminFilialesScreen = () => {
  const [selectedReseau, setSelectedReseau] = useState(
    () => localStorage.getItem(STORAGE_KEY) || "",
  );
  const [search, setSearch] = useState("");
  const [filtreMode, setFiltreMode] = useState("TOUS"); // TOUS | O | N
  // Vue affichée : le tableau de consolidation, ou le diagnostic du
  // rapprochement. Un onglet séparé plutôt qu'un bloc de plus sous le tableau :
  // les deux ne se lisent pas au même moment.
  const [vue, setVue] = useState("conso"); // conso | diag
  const [hiddenEntities, setHiddenEntities] = useState(() => new Set());
  const gridApiRef = useRef(null);

  const { data: reseaux } = useGetReseauxQuery();
  const { data, isLoading, isFetching, error, refetch } = useGetReseauQuery(
    selectedReseau,
    { skip: !selectedReseau },
  );
  const [refreshReseau, { isLoading: refreshing }] = useRefreshReseauMutation();

  useEffect(() => {
    if (reseaux && reseaux.length > 0) {
      const codes = reseaux.map((r) => r.code);
      // Aucun réseau choisi, ou réseau mémorisé non/plus autorisé -> bascule
      // sur le premier réseau AUTORISÉ (évite un 403 sur un réseau interdit).
      if (!selectedReseau || !codes.includes(selectedReseau)) {
        setSelectedReseau(reseaux[0].code);
      }
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

  // Répartition des rapprochements par ORIGINE de la clé. Le serveur ne
  // l'agrège pas : l'information est portée par chaque cellule (`rang`), et les
  // lignes sont déjà en mémoire — inutile de la redemander.
  const origines = useMemo(() => {
    const acc = {};
    (data?.rows || []).forEach((r) => {
      Object.values(r.filiales || {}).forEach((c) => {
        if (!c) return;
        const k = c.rang === 3 ? "gencod" : c.rang === 2 ? "refer" : "design2";
        acc[k] = (acc[k] || 0) + 1;
      });
    });
    return acc;
  }, [data]);
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
        // ⚠️ Le service renvoie GISEMENT en majuscules (nom du champ DBF).
        gisement: r.GISEMENT,
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
        origine: r.origine,
      };
      data.filiales.forEach((f) => {
        // ⚠️ Les cellules sont indexées par LIBELLÉ (WELDOM, SITEC), pas par
        // code : chercher par code laissait ces deux filiales vides.
        const c = r.filiales[f.label];
        o[`${f.code}_nart`] = c ? c.NART : null;
        o[`${f.code}_stock`] = c ? c.STOCK : null;
        o[`${f.code}_pvte`] = c ? c.PVTE : null;
        o[`${f.code}_vteAn`] = c ? c.VTE_AN : null;
        o[`${f.code}_caAn`] = c ? c.CA_AN : null;
        o[`${f.code}_enCde`] = c ? c.EN_COMMANDE : null;
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
          // Ordre repris du classeur de référence, pour que l'écran et le
          // fichier Excel se lisent de la même façon.
          { field: "gisement", headerName: "Gisement", minWidth: 90 },
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
          {
            // Par quelle passe le rapprochement a abouti. C'est la colonne que
            // l'on vient lire quand on doute d'une ligne.
            field: "origine",
            headerName: "Origine",
            minWidth: 150,
            cellClass: (p) =>
              !p.value
                ? ""
                : p.value.includes("GENCODE-HORS")
                  ? "orig-hors"
                  : p.value.includes("GENCODE")
                    ? "orig-gencode"
                    : "orig-nart",
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
          {
            field: `${f.code}_enCde`,
            headerName: "En cde",
            ...num,
            filter: "agNumberColumnFilter",
            valueFormatter: qtyFmt,
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

  // --- Export Excel « de référence » -------------------------------------
  // Le classeur produit par le serveur est le portage fidèle du script Python
  // qui fait foi : même feuille, mêmes colonnes, mêmes couleurs. Il exporte
  // TOUT le réseau, sans tenir compte des filtres de l'écran — c'est le
  // document que l'on s'échange entre sociétés.
  const handleExportReference = () => {
    if (!selectedReseau) return;
    // Requête de navigation : le fichier est écrit en flux par le serveur.
    window.open(`/api/filiales/${selectedReseau}/export`, "_blank");
  };

  // --- Export Excel : EXACTEMENT ce qui est affiché à l'écran ---
  // Colonnes = colonnes réellement visibles de la grille (filiales masquées,
  // colonnes cachées et ordre respectés) ; lignes = après filtres + recherche +
  // filtreMode + tri ; valeurs = telles qu'affichées (valueFormatter appliqué).
  const handleExport = () => {
    if (!data) return;
    const api = gridApiRef.current;

    let aoa = null;

    if (api && typeof api.getAllDisplayedColumns === "function") {
      // Uniquement les colonnes-données affichées (on ignore les colonnes vides
      // sans champ et celles masquées par l'utilisateur).
      const cols = api
        .getAllDisplayedColumns()
        .filter((c) => c.getColDef && c.getColDef()?.field);

      // En-tête : "Groupe Libellé" (ex. "QC NART", "AVB STOCK") si groupé.
      const headerOf = (c) => {
        const cd = c.getColDef();
        const leaf = cd.headerName ?? cd.field;
        const grp = c.getParent && c.getParent();
        const grpName =
          grp && grp.getColGroupDef ? grp.getColGroupDef()?.headerName : "";
        return grpName ? `${grpName} ${leaf}` : leaf;
      };
      // Valeur affichée : on applique le valueFormatter de la colonne si présent.
      const valueOf = (c, node) => {
        const cd = c.getColDef();
        let v = node.data ? node.data[cd.field] : "";
        if (typeof cd.valueFormatter === "function") {
          try {
            v = cd.valueFormatter({
              value: v,
              data: node.data,
              node,
              colDef: cd,
              column: c,
              api,
            });
          } catch {
            /* garde la valeur brute */
          }
        }
        return v === null || v === undefined ? "" : v;
      };

      aoa = [cols.map(headerOf)];
      api.forEachNodeAfterFilterAndSort((node) => {
        aoa.push(cols.map((c) => valueOf(c, node)));
      });
    } else {
      // Repli (grille non initialisée) : export complet.
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
        "ORIGINE",
      ];
      data.filiales.forEach((f) => {
        headers.push(
          `NART ${f.label}`,
          `STOCK ${f.label}`,
          `PVTE ${f.label}`,
          `VTE AN ${f.label}`,
          `CA AN ${f.label}`,
          `EN COMMANDE ${f.label}`,
        );
      });
      aoa = [headers];
      rowData.forEach((r) => {
        const line = [
          r.gisement,
          r.nart,
          r.design,
          r.nomFour,
          roundInt(r.stock),
          roundInt(r.pvte),
          roundInt(r.vteAn),
          roundInt(r.caAn),
          roundInt(r.vteHorsReseau),
          r.pctReseau === null ? "" : r.pctReseau,
          r.filtre,
          r.origine,
        ];
        data.filiales.forEach((f) => {
          const nartV = r[`${f.code}_nart`];
          if (nartV) {
            line.push(
              nartV,
              roundInt(r[`${f.code}_stock`]),
              roundInt(r[`${f.code}_pvte`]),
              roundInt(r[`${f.code}_vteAn`]),
              roundInt(r[`${f.code}_caAn`]),
              roundInt(r[`${f.code}_enCde`]),
            );
          } else {
            line.push("", "", "", "", "", "");
          }
        });
        aoa.push(line);
      });
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
            className="af-btn"
            onClick={handleExport}
            disabled={!data || !rowData.length}
            title="Le tableau tel qu'il est affiché : filtres, tri et colonnes masquées compris."
          >
            <HiDownload /> Excel (vue écran)
          </button>
          <button
            className="af-btn primary"
            onClick={handleExportReference}
            disabled={!selectedReseau || isFetching}
            title="Le classeur complet du réseau, mis en forme comme le rapport de référence."
          >
            <HiDownload /> Classeur de référence
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

      {selectedReseau && data ? (
        <div className="af-vues">
          <button
            className={vue === "conso" ? "active" : ""}
            onClick={() => setVue("conso")}
          >
            Consolidation
          </button>
          <button
            className={vue === "diag" ? "active" : ""}
            onClick={() => setVue("diag")}
          >
            Diagnostic du rapprochement
          </button>
        </div>
      ) : null}

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
                <span className="v">{fmtQty(totaux.nbArticles)}</span>
                <span className="l">Articles {data.mere}</span>
              </div>
              <div className="af-kpi">
                <span className="v">{fmtQty(totaux.nbDansReseau)}</span>
                <span className="l">Dans le réseau (O)</span>
              </div>
              <div className="af-kpi">
                <span className="v">{fmtFranc(totaux.caMere)}</span>
                <span className="l">CA HT {data.mere}</span>
              </div>
              <div className="af-kpi">
                <span className="v">{fmtQty(totaux.vteHorsReseau)}</span>
                <span className="l">Ventes hors réseau</span>
              </div>
            </div>
          )}

          {vue === "conso" && (
          <>
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
          )}

          {/* ── Diagnostic du rapprochement ────────────────────────────────
              Répond à « pourquoi cet article n'apparaît-il pas ? ». La
              consolidation ne montre que ce qui a réussi : sans ce panneau,
              les articles écartés sont invisibles et passent pour un oubli. */}
          {vue === "diag" && (
            <div className="af-diag">
              <p className="af-diag-intro">
                Le rapprochement part des articles de <b>{data.mere}</b> et
                cherche leur équivalent dans chaque filiale. Deux clés
                seulement sont retenues, parce que ce sont les seules fiables :
              </p>

              <div className="af-diag-regles">
                <div className="af-diag-regle">
                  <span className="af-diag-rang">1</span>
                  <div>
                    <b>Référence fournisseur</b> d'un article acheté à la
                    maison-mère (<code>REFER</code> ou <code>DESIGN2</code>).
                    La mère étant le fournisseur, la filiale y a enregistré le
                    code article de la mère. Fiabilité mesurée : <b>96,7 %</b>.
                  </div>
                </div>
                <div className="af-diag-regle">
                  <span className="af-diag-rang">2</span>
                  <div>
                    <b>Code-barres</b> — le seul identifiant commun à toutes
                    les sociétés, c'est le même produit physique. Fiabilité
                    mesurée : <b>85,8 %</b>.
                  </div>
                </div>
                <div className="af-diag-regle af-diag-exclu">
                  <span className="af-diag-rang">✕</span>
                  <div>
                    <b>Le NART n'est PAS une clé.</b> C'est une référence
                    interne à chaque société : sur 16 569 codes communs à QC et
                    MQ, <b>3,7 %</b> seulement désignent le même produit.
                    S'en servir fabriquerait des dizaines de milliers de faux
                    rapprochements.
                  </div>
                </div>
              </div>

              {Object.keys(origines).length > 0 && (
                <div className="af-diag-origines">
                  <span className="af-diag-titre">
                    Origine des rapprochements
                  </span>
                  <div className="af-diag-chips">
                    <span className="af-diag-chip c-refer">
                      Réf. fournisseur <b>{fmtQty(origines.refer || 0)}</b>
                    </span>
                    <span className="af-diag-chip c-gencod">
                      Code-barres <b>{fmtQty(origines.gencod || 0)}</b>
                    </span>
                    {origines.design2 ? (
                      <span className="af-diag-chip c-d2">
                        DESIGN2 <b>{fmtQty(origines.design2)}</b>
                      </span>
                    ) : null}
                  </div>
                </div>
              )}

              <span className="af-diag-titre">Par filiale</span>
              <table className="af-diag-table">
                <thead>
                  <tr>
                    <th>Filiale</th>
                    <th className="n">Articles lus</th>
                    <th className="n">Achetés à {data.mere}</th>
                    <th className="n">Rapprochés</th>
                    <th className="n">Orphelins</th>
                    <th className="n">Taux</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.diagnostic || []).map((d) => {
                    const taux = d.articles
                      ? Math.round((d.rapproches / d.articles) * 1000) / 10
                      : 0;
                    return (
                      <tr key={d.code}>
                        <td className="af-diag-fil">{d.label}</td>
                        <td className="n">{fmtQty(d.articles)}</td>
                        <td className="n">{fmtQty(d.marquesReseau)}</td>
                        <td className="n ok">{fmtQty(d.rapproches)}</td>
                        <td className="n dim">{fmtQty(d.orphelins)}</td>
                        <td className="n">
                          <span className="af-diag-taux">
                            <i style={{ width: `${taux}%` }} />
                          </span>
                          {taux} %
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <p className="af-diag-note">
                <b>Achetés à {data.mere}</b> : articles dont le fournisseur
                porte le trigramme de la mère dans son champ adresse
                (<code>AD1</code>) — c'est ce marquage qui rend la référence
                fournisseur exploitable. <b>Orphelins</b> : articles de la
                filiale sans équivalent chez la mère. Une partie l'est
                légitimement — chaque société a son propre assortiment — le
                reste signale un marquage <code>AD1</code> manquant ou un
                code-barres absent.
              </p>

            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

export default AdminFilialesScreen;