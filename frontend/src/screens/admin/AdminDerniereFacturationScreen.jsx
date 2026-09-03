// src/screens/admin/AdminDerniereFacturationScreen.jsx
// -----------------------------------------------------------------------------
// DERNIÈRE FACTURATION — clients de la société active et date de leur dernière
// facture. Tri par défaut : la date la PLUS ANCIENNE en tête (l'écran sert à
// repérer les clients qui ne sont plus venus).
//
// Les clients jamais facturés n'ont pas de date : ils sont toujours renvoyés en
// FIN de tri (dans les deux sens) et se retrouvent par le filtre « Jamais ».
// -----------------------------------------------------------------------------
import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import { HiRefresh, HiDownload, HiCalendar, HiSearch } from "react-icons/hi";
import { useSelector } from "react-redux";
import {
  useGetDerniereFacturationQuery,
  useRefreshDerniereFacturationMutation,
} from "../../slices/derniereFacturationApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import Loader from "../../components/Shared/Loader/Loader";
import { fmtFranc, fmtQty, fmtDate, roundInt } from "../../utils/format";
import "./AdminDerniereFacturationScreen.css";

const num = { type: "rightAligned" };

const STATUTS = {
  recent: { label: "≤ 3 mois", classe: "st-recent" },
  veille: { label: "3 à 12 mois", classe: "st-veille" },
  dormant: { label: "> 12 mois", classe: "st-dormant" },
  jamais: { label: "Jamais facturé", classe: "st-jamais" },
};

const FILTRES = [
  { cle: "tous", label: "Tous" },
  { cle: "dormant", label: "> 12 mois" },
  { cle: "veille", label: "3 à 12 mois" },
  { cle: "recent", label: "≤ 3 mois" },
  { cle: "jamais", label: "Jamais facturé" },
];

// Les clients sans facture restent en bas quel que soit le sens du tri : une
// absence de date n'est ni « très ancienne » ni « très récente ».
const comparateurDate = (a, b, nodeA, nodeB, isDescending) => {
  const va = nodeA?.data?.ymd || 0;
  const vb = nodeB?.data?.ymd || 0;
  if (va === 0 && vb === 0) return 0;
  if (va === 0) return isDescending ? -1 : 1;
  if (vb === 0) return isDescending ? 1 : -1;
  return va - vb;
};

const dateFmt = (p) => (p.value ? fmtDate(p.value) : "—");
const joursFmt = (p) =>
  p.value === null || p.value === undefined ? "—" : fmtQty(p.value);
const moneyFmt = (p) =>
  p.value === null || p.value === undefined || p.value === ""
    ? "—"
    : fmtFranc(p.value);

const AdminDerniereFacturationScreen = () => {
  // Société active : sélection GLOBALE (Header).
  const dossier = useSelector(selectGlobalDossier) || "";
  const [search, setSearch] = useState("");
  const [filtre, setFiltre] = useState("tous");

  const { data, isLoading, isFetching, error, refetch } =
    useGetDerniereFacturationQuery(dossier, { skip: !dossier });
  const [refreshIndex, { isLoading: refreshing }] =
    useRefreshDerniereFacturationMutation();

  // Rafraîchir = purger l'index facture côté serveur PUIS recharger : le scan
  // complet de facture.dbf reprend, ce qui peut durer plusieurs dizaines de
  // secondes. D'où le bouton dédié plutôt qu'une invalidation automatique.
  const handleRefresh = async () => {
    if (!dossier) return;
    try {
      await refreshIndex(dossier).unwrap();
      refetch();
    } catch (e) {
      /* l'erreur est déjà rendue par le bloc `error` */
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
      {
        field: "tiers",
        headerName: "Code",
        pinned: "left",
        maxWidth: 95,
        cellClass: "cell-mono",
      },
      {
        field: "nom",
        headerName: "Client",
        pinned: "left",
        minWidth: 230,
        tooltipField: "nom",
      },
      {
        field: "derniereFacture",
        headerName: "Dernière facture",
        minWidth: 150,
        sort: "asc", // tri demandé : du plus ancien au plus récent
        filter: "agDateColumnFilter",
        comparator: comparateurDate,
        valueFormatter: dateFmt,
        cellClass: "col-date",
      },
      {
        field: "joursDepuis",
        headerName: "Jours",
        ...num,
        filter: "agNumberColumnFilter",
        maxWidth: 110,
        valueFormatter: joursFmt,
      },
      {
        field: "statut",
        headerName: "Ancienneté",
        minWidth: 140,
        valueFormatter: (p) => STATUTS[p.value]?.label || "—",
        cellClass: (p) => `badge-cell ${STATUTS[p.value]?.classe || ""}`,
      },
      {
        field: "numfact",
        headerName: "N° facture",
        minWidth: 120,
        cellClass: "cell-mono",
      },
      {
        field: "montant",
        headerName: "Montant",
        ...num,
        filter: "agNumberColumnFilter",
        minWidth: 120,
        valueFormatter: moneyFmt,
      },
      {
        field: "nbFactures",
        headerName: "Nb fact.",
        ...num,
        filter: "agNumberColumnFilter",
        maxWidth: 110,
      },
      {
        field: "premiereFacture",
        headerName: "1re facture",
        minWidth: 130,
        filter: "agDateColumnFilter",
        valueFormatter: dateFmt,
      },
      { field: "vendeur", headerName: "Vendeur", minWidth: 150 },
      {
        field: "repres",
        headerName: "Code vend.",
        maxWidth: 110,
        cellClass: "cell-mono",
      },
      { field: "categorie", headerName: "Catégorie", minWidth: 120 },
      { field: "type", headerName: "Type", maxWidth: 100 },
      { field: "tel", headerName: "Téléphone", minWidth: 120 },
      { field: "mail", headerName: "Email", minWidth: 190 },
      {
        field: "adresse",
        headerName: "Adresse",
        minWidth: 200,
        tooltipField: "adresse",
      },
    ],
    [],
  );

  const rows = useMemo(() => {
    const all = data?.rows || [];
    if (filtre === "tous") return all;
    return all.filter((r) => r.statut === filtre);
  }, [data, filtre]);

  const handleExport = () => {
    if (!rows.length) return;
    const aoa = [
      [
        "CODE",
        "CLIENT",
        "DERNIERE FACTURE",
        "JOURS",
        "ANCIENNETE",
        "N FACTURE",
        "MONTANT",
        "NB FACTURES",
        "PREMIERE FACTURE",
        "VENDEUR",
        "CODE VENDEUR",
        "CATEGORIE",
        "TYPE",
        "TELEPHONE",
        "EMAIL",
        "ADRESSE",
      ],
    ];
    rows.forEach((r) =>
      aoa.push([
        r.tiers,
        r.nom,
        r.derniereFacture ? fmtDate(r.derniereFacture) : "",
        r.joursDepuis === null ? "" : r.joursDepuis,
        STATUTS[r.statut]?.label || "",
        r.numfact,
        r.montant === null ? "" : roundInt(r.montant),
        r.nbFactures,
        r.premiereFacture ? fmtDate(r.premiereFacture) : "",
        r.vendeur,
        r.repres,
        r.categorie,
        r.type,
        r.tel,
        r.mail,
        r.adresse,
      ]),
    );
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Derniere facturation");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `derniere_facturation_${dossier}_${today}.xlsx`);
  };

  const t = data?.totaux;
  const loading = isLoading || (isFetching && !data);

  return (
    <div className="admin-derniere-facturation">
      <div className="df-header">
        <h1>
          <HiCalendar /> Dernière facturation
        </h1>
        <div className="df-actions">
          <button
            className="df-btn"
            onClick={handleRefresh}
            disabled={!dossier || refreshing || isFetching}
          >
            <HiRefresh className={refreshing || isFetching ? "spin" : ""} />{" "}
            Rafraîchir
          </button>
          <button
            className="df-btn primary"
            onClick={handleExport}
            disabled={!rows.length}
          >
            <HiDownload /> Excel
          </button>
        </div>
      </div>

      {!dossier ? (
        <div className="df-empty">Choisissez une société dans l'en-tête.</div>
      ) : loading ? (
        <div className="df-loading">
          <Loader />
          <p>
            Lecture des factures de la société… (le premier chargement peut
            prendre plusieurs dizaines de secondes)
          </p>
        </div>
      ) : error ? (
        <div className="df-error">
          {error?.data?.message || "Erreur de chargement."}
        </div>
      ) : data ? (
        <>
          {isFetching && <div className="df-refreshing">Actualisation…</div>}

          {t && (
            <div className="df-kpis">
              <div className="df-kpi">
                <span className="v">{fmtQty(t.nbClients)}</span>
                <span className="l">Clients</span>
              </div>
              <div className="df-kpi danger">
                <span className="v">{fmtQty(t.nbDormant)}</span>
                <span className="l">Sans facture depuis + de 12 mois</span>
              </div>
              <div className="df-kpi warn">
                <span className="v">{fmtQty(t.nbVeille)}</span>
                <span className="l">Entre 3 et 12 mois</span>
              </div>
              <div className="df-kpi ok">
                <span className="v">{fmtQty(t.nbRecent)}</span>
                <span className="l">Facturés dans les 3 mois</span>
              </div>
              <div className="df-kpi">
                <span className="v">{fmtQty(t.nbJamais)}</span>
                <span className="l">Jamais facturés</span>
              </div>
              <div className="df-kpi">
                <span className="v">{fmtDate(t.plusAncienne)}</span>
                <span className="l">Facturation la plus ancienne</span>
              </div>
            </div>
          )}

          <div className="df-filters">
            <div className="df-search">
              <HiSearch />
              <input
                type="text"
                placeholder="Recherche rapide (nom, code, téléphone, vendeur…)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="df-chips">
              {FILTRES.map((f) => (
                <button
                  key={f.cle}
                  className={`df-chip ${filtre === f.cle ? "actif" : ""}`}
                  onClick={() => setFiltre(f.cle)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <span className="df-count">
              {rows.length.toLocaleString("fr-FR")} clients
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="df-empty">Aucun client pour ce filtre.</div>
          ) : (
            <div className="ag-theme-quartz-dark df-grid">
              <AgGridReact
                rowData={rows}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                quickFilterText={search}
                animateRows={false}
                rowHeight={30}
                headerHeight={30}
                floatingFiltersHeight={32}
                suppressFieldDotNotation
                tooltipShowDelay={300}
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};

export default AdminDerniereFacturationScreen;
