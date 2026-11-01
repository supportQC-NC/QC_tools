// src/screens/admin/AdminProformaAnalyseScreen.jsx
//
// ANALYSE PROFORMA : l'utilisateur choisit une plage de dates et un code
// vendeur (menu déroulant alimenté par la fiche société + les codes REPRES
// rencontrés sur la période) ; l'écran liste toutes les ENTÊTES de proforma
// correspondantes — jamais le détail — et les exporte en Excel.
//
// Même grammaire que l'Analyse factures : société = sélection GLOBALE du
// header, période par défaut = début d'année → aujourd'hui, export XLSX côté
// client. Les libellés d'état viennent du mappingEtatsProforma de la fiche
// société (vocabulaire ERP restitué tel quel, jamais de libellés en dur).

import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import * as XLSX from "xlsx";
import { roundInt, fmtFranc } from "../../utils/format";
import { AgGridReact } from "ag-grid-react";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import {
  HiDownload,
  HiDocumentText,
  HiCurrencyDollar,
  HiUsers,
} from "react-icons/hi";
import { useGetProformaAnalyseQuery } from "../../slices/proformaAnalyseApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminProformaAnalyseScreen.css";

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const startOfYear = () => ymd(new Date(new Date().getFullYear(), 0, 1));
const today = () => ymd(new Date());

const fNum = (n) => (Number(n) || 0).toLocaleString("fr-FR");
const fDate = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("fr-FR") : "";
const num = { type: "rightAligned" };

const AdminProformaAnalyseScreen = () => {
  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalDossier) || "";
  const [dateDebut, setDateDebut] = useState(startOfYear);
  const [dateFin, setDateFin] = useState(today);
  const [vendeur, setVendeur] = useState("");
  // Filtre LOCAL par état (pastilles) : ne refait pas la requête.
  const [etatFiltre, setEtatFiltre] = useState(null);

  // Changer de société remet le vendeur à « tous » (les codes diffèrent).
  useEffect(() => {
    setVendeur("");
    setEtatFiltre(null);
  }, [selectedEntreprise]);

  const { data, isLoading, isFetching, error } = useGetProformaAnalyseQuery(
    { nomDossierDBF: selectedEntreprise, dateDebut, dateFin, vendeur },
    { skip: !selectedEntreprise || !dateDebut || !dateFin },
  );

  const totaux = data?.totaux;
  const vendeurs = data?.vendeurs || [];
  const loading = isLoading || (isFetching && !data);

  // L'état filtré peut disparaître de la nouvelle réponse : on le lâche.
  useEffect(() => {
    if (
      etatFiltre !== null &&
      totaux &&
      !totaux.parEtat.some((e) => e.etat === etatFiltre)
    ) {
      setEtatFiltre(null);
    }
  }, [totaux, etatFiltre]);

  const proformas = useMemo(() => {
    const rows = data?.proformas || [];
    return etatFiltre === null
      ? rows
      : rows.filter((p) => p.etat === etatFiltre);
  }, [data, etatFiltre]);

  const libelleVendeur = data?.vendeur
    ? `${data.vendeur.nom} (${data.vendeur.code})`
    : "Tous les vendeurs";

  const columns = useMemo(
    () => [
      {
        field: "numfact", headerName: "N° proforma", minWidth: 120,
        cellClass: "cell-mono col-strong",
      },
      {
        field: "date", headerName: "Date", minWidth: 110, sort: "desc",
        valueFormatter: (p) => fDate(p.value),
      },
      { field: "tiers", headerName: "Code client", minWidth: 110, cellClass: "cell-mono" },
      { field: "nom", headerName: "Client", minWidth: 200, flex: 1 },
      {
        field: "represNom", headerName: "Vendeur", minWidth: 160,
        valueGetter: (p) => `${p.data.represNom} (${p.data.repres})`,
      },
      { field: "etatLabel", headerName: "État", minWidth: 140 },
      {
        field: "montant", headerName: "Montant", ...num, minWidth: 130,
        filter: "agNumberColumnFilter", valueFormatter: (p) => fmtFranc(p.value),
      },
      {
        field: "dateChantier", headerName: "Date chantier", minWidth: 120,
        valueFormatter: (p) => fDate(p.value),
      },
      { field: "texte", headerName: "Observation", minWidth: 220, flex: 1 },
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

    const wsS = [
      ["Analyse proforma"],
      ["Entreprise", selectedEntreprise],
      ["Du", data.dateDebut, "au", data.dateFin],
      ["Vendeur", libelleVendeur],
      [],
      ["Nombre de proformas", proformas.length],
      ["Montant total (XPF)", roundInt(proformas.reduce((s, p) => s + p.montant, 0))],
      [],
      ["État", "Nb proformas", "Montant (XPF)"],
      ...totaux.parEtat.map((e) => [e.etatLabel, e.nb, roundInt(e.montant)]),
    ];

    const wsP = [
      [
        "N° proforma", "Date", "Code client", "Client", "Vendeur", "Code vendeur",
        "État", "Montant (XPF)", "Date chantier", "Observation",
      ],
      ...proformas.map((p) => [
        p.numfact, p.date, p.tiers, p.nom, p.represNom, p.repres,
        p.etatLabel, roundInt(p.montant), p.dateChantier || "", p.texte,
      ]),
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsS), "Synthèse");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wsP), "Proformas");
    XLSX.writeFile(
      wb,
      `proformas_${selectedEntreprise}_${data.vendeur ? data.vendeur.code : "tous"}_${data.dateDebut}_${data.dateFin}.xlsx`,
    );
  };

  return (
    <div className="admin-proforma-analyse">
      <div className="pa-header">
        <h1>
          <HiDocumentText /> Analyse Proforma
        </h1>
        <div className="pa-actions">
          <label className="pa-field">
            Du
            <input
              type="date"
              value={dateDebut}
              max={dateFin}
              onChange={(e) => setDateDebut(e.target.value)}
            />
          </label>
          <label className="pa-field">
            Au
            <input
              type="date"
              value={dateFin}
              min={dateDebut}
              max={today()}
              onChange={(e) => setDateFin(e.target.value)}
            />
          </label>
          <label className="pa-field vendeur">
            Vendeur
            <select value={vendeur} onChange={(e) => setVendeur(e.target.value)}>
              <option value="">Tous les vendeurs</option>
              {vendeurs.map((v) => (
                <option key={v.code} value={v.code}>
                  {v.nom} ({v.code})
                </option>
              ))}
            </select>
          </label>
          <button
            className="pa-btn primary"
            onClick={handleExport}
            disabled={!data || proformas.length === 0}
          >
            <HiDownload /> Excel
          </button>
        </div>
      </div>

      <div className="pa-note">
        Entêtes de <strong>proforma.dbf</strong> uniquement, sans le détail des
        lignes. Les libellés d'état viennent de la fiche société (mapping états
        proforma).
      </div>

      {!selectedEntreprise ? (
        <div className="pa-empty">
          Choisissez une entreprise dans l'en-tête, une période et un vendeur.
        </div>
      ) : loading ? (
        <div className="pa-loading">
          <Loader />
          <p className="pa-hint">
            Lecture des entêtes de proforma — long au 1ᵉʳ accès, puis en cache
            10 min.
          </p>
        </div>
      ) : error ? (
        <div className="pa-error">
          {error?.data?.message || "Erreur de chargement."}
        </div>
      ) : data ? (
        <>
          {/* ===== KPI ===== */}
          <div className="pa-kpis">
            <div className="pa-kpi">
              <div className="pa-kpi-icon"><HiDocumentText /></div>
              <div>
                <span className="pa-kpi-value">{fNum(totaux.nbProformas)}</span>
                <span className="pa-kpi-label">Proformas sur la période</span>
                <span className="pa-kpi-mini">
                  du {fDate(data.dateDebut)} au {fDate(data.dateFin)}
                </span>
              </div>
            </div>
            <div className="pa-kpi">
              <div className="pa-kpi-icon"><HiCurrencyDollar /></div>
              <div>
                <span className="pa-kpi-value">{fmtFranc(totaux.montantTotal)}</span>
                <span className="pa-kpi-label">Montant total</span>
                <span className="pa-kpi-mini">
                  {fmtFranc(totaux.montantMoyen)} / proforma
                </span>
              </div>
            </div>
            <div className="pa-kpi">
              <div className="pa-kpi-icon"><HiUsers /></div>
              <div>
                <span className="pa-kpi-value">
                  {data.vendeur ? data.vendeur.code : fNum(vendeurs.length)}
                </span>
                <span className="pa-kpi-label">
                  {data.vendeur ? data.vendeur.nom : "Codes vendeur connus"}
                </span>
                <span className="pa-kpi-mini">{libelleVendeur}</span>
              </div>
            </div>
          </div>

          {/* ===== Répartition par état (filtre local du tableau) ===== */}
          <div className="pa-etats">
            <button
              type="button"
              className={`pa-etat-chip ${etatFiltre === null ? "on" : ""}`}
              onClick={() => setEtatFiltre(null)}
            >
              Tous les états — <strong>{fNum(totaux.nbProformas)}</strong>
            </button>
            {totaux.parEtat.map((e) => (
              <button
                key={e.etat}
                type="button"
                className={`pa-etat-chip ${etatFiltre === e.etat ? "on" : ""}`}
                onClick={() =>
                  setEtatFiltre(etatFiltre === e.etat ? null : e.etat)
                }
                title={`${fmtFranc(e.montant)} au total`}
              >
                {e.etatLabel} — <strong>{fNum(e.nb)}</strong>
              </button>
            ))}
          </div>

          {/* ===== Tableau des entêtes ===== */}
          <div className="pa-table-title">
            {fNum(proformas.length)} proforma{proformas.length > 1 ? "s" : ""} —{" "}
            {libelleVendeur}
            <small> (tri et filtres par colonne ; l'export suit le filtre)</small>
          </div>
          <div className="ag-theme-quartz pa-grid">
            <AgGridReact
              rowData={proformas}
              columnDefs={columns}
              defaultColDef={defaultColDef}
              animateRows
              suppressCellFocus
            />
          </div>
        </>
      ) : null}
    </div>
  );
};

export default AdminProformaAnalyseScreen;
