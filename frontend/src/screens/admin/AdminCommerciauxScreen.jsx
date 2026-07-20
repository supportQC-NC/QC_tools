// src/screens/admin/AdminCommerciauxScreen.jsx
import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import * as XLSX from "xlsx";
import {
  HiUserGroup,
  HiRefresh,
  HiDownload,
  HiArrowSmUp,
  HiArrowSmDown,
  HiMinusSm,
  HiOfficeBuilding,
  HiCurrencyDollar,
  HiUsers,
  HiChartBar,
  HiShoppingCart,
  HiDocumentText,
  HiTrendingUp,
  HiUserAdd,
  HiStar,
} from "react-icons/hi";
import {
  useGetCommerciauxQuery,
  useLazyGetCommerciauxFullQuery,
  useRefreshCommerciauxMutation,
} from "../../slices/commerciauxApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./AdminCommerciauxScreen.css";

const formatF = (n) => {
  const v = Math.round(Number(n) || 0);
  return `${v.toLocaleString("fr-FR")} F`;
};
const formatPct = (n) => `${(Number(n) || 0).toFixed(1)} %`;

const EvolBadge = ({ value }) => {
  const v = Number(value) || 0;
  if (v > 0.5)
    return (
      <span className="evol up">
        <HiArrowSmUp /> {v.toFixed(0)}%
      </span>
    );
  if (v < -0.5)
    return (
      <span className="evol down">
        <HiArrowSmDown /> {Math.abs(v).toFixed(0)}%
      </span>
    );
  return (
    <span className="evol flat">
      <HiMinusSm /> 0%
    </span>
  );
};

// Construit les lignes Excel pour un ensemble de clients
const buildRows = (clients, mois, commercialNom) =>
  clients.map((c) => {
    const row = {
      Tiers: c.tiers,
      Nom: c.nomTiers,
      Catégorie: c.categorie,
      Profession: c.profes,
      Commercial: commercialNom,
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

const sanitizeSheet = (name) =>
  (name || "Feuille").replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Feuille";

const AdminCommerciauxScreen = () => {
  const navigate = useNavigate();

  // Société active : lue depuis la sélection GLOBALE (Header).
  const selectedEntreprise = useSelector(selectGlobalDossier) || "";

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetCommerciauxQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
  });

  const [triggerFull, { isFetching: exporting }] =
    useLazyGetCommerciauxFullQuery();
  const [refreshCommerciaux, { isLoading: refreshing }] =
    useRefreshCommerciauxMutation();

  const commerciaux = data?.commerciaux || [];
  const totaux = data?.totaux;

  const maxCa = useMemo(
    () => Math.max(1, ...commerciaux.map((c) => Math.abs(c.caN))),
    [commerciaux],
  );

  const handleRefresh = async () => {
    if (!selectedEntreprise) return;
    try {
      await refreshCommerciaux(selectedEntreprise).unwrap();
    } catch (e) {
      /* ignore */
    }
    refetch();
  };

  const handleExportGlobal = async () => {
    if (!selectedEntreprise) return;
    try {
      const full = await triggerFull(selectedEntreprise).unwrap();
      const wb = XLSX.utils.book_new();

      // Feuille GLOBAL : tous les clients de tous les commerciaux
      const globalRows = [];
      full.commerciaux.forEach((com) => {
        buildRows(com.clients, full.mois, com.nom).forEach((r) =>
          globalRows.push(r),
        );
      });
      globalRows.sort((a, b) => (b["CA HT N"] || 0) - (a["CA HT N"] || 0));
      const wsGlobal = XLSX.utils.json_to_sheet(globalRows);
      XLSX.utils.book_append_sheet(wb, wsGlobal, "GLOBAL");

      // Une feuille par commercial
      const usedNames = new Set(["GLOBAL"]);
      full.commerciaux.forEach((com) => {
        if (!com.clients.length) return;
        let name = sanitizeSheet(com.nom);
        let i = 2;
        while (usedNames.has(name)) {
          name = sanitizeSheet(`${com.nom} ${i}`);
          i += 1;
        }
        usedNames.add(name);
        const ws = XLSX.utils.json_to_sheet(
          buildRows(com.clients, full.mois, com.nom),
        );
        XLSX.utils.book_append_sheet(wb, ws, name);
      });

      const today = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `analyse_commerciaux_${selectedEntreprise}_${today}.xlsx`);
    } catch (e) {
      /* ignore */
    }
  };

  const badge = (com) => {
    if (com.code === 0) return <span className="com-tag magasin">Magasin</span>;
    if (com.estVendeur) return <span className="com-tag vendeur">Vendeur</span>;
    return <span className="com-tag orphelin">Code {com.code}</span>;
  };

  return (
    <div className="admin-commerciaux">
      <div className="ac-header">
        <h1>
          <HiUserGroup /> Analyse Commerciaux
        </h1>
        <div className="ac-header-actions">
          <button
            className="ac-btn"
            onClick={handleRefresh}
            disabled={!selectedEntreprise || refreshing || isFetching}
            title="Recalculer"
          >
            <HiRefresh className={refreshing ? "spin" : ""} /> Rafraîchir
          </button>
          <button
            className="ac-btn primary"
            onClick={handleExportGlobal}
            disabled={!selectedEntreprise || exporting || !commerciaux.length}
            title="Exporter tout en Excel"
          >
            <HiDownload /> {exporting ? "Export…" : "Excel global"}
          </button>
        </div>
      </div>

      {data && (
        <p className="ac-annee">
          {data.anneeN} vs {data.anneeN1}
          {data.dateArret ? ` · N-1 arrêté au ${data.dateArret}` : ""} · recalcul{" "}
          {new Date(data.generatedAt).toLocaleString("fr-FR")}
        </p>
      )}

      {!selectedEntreprise ? (
        <div className="ac-empty">Sélectionnez une entreprise pour commencer.</div>
      ) : isLoading ? (
        <Loader />
      ) : error ? (
        <div className="ac-error">
          Erreur de chargement. La première analyse peut être longue (gros
          fichier de factures) — réessayez dans quelques secondes.
        </div>
      ) : (
        <>
          {totaux && (
            <div className="ac-kpis">
              <div className="ac-kpi">
                <div className="ac-kpi-icon">
                  <HiCurrencyDollar />
                </div>
                <div>
                  <span className="ac-kpi-value">{formatF(totaux.caN)}</span>
                  <span className="ac-kpi-label">CA HT {data.anneeN}</span>
                  <EvolBadge value={totaux.evolCa} />
                </div>
              </div>
              <div className="ac-kpi">
                <div className="ac-kpi-icon alt">
                  <HiCurrencyDollar />
                </div>
                <div>
                  <span className="ac-kpi-value">{formatF(totaux.caN1)}</span>
                  <span className="ac-kpi-label">
                    CA HT {data.anneeN1}
                    {data.dateArret ? ` (au ${data.dateArret})` : ""}
                  </span>
                </div>
              </div>
              <div className="ac-kpi">
                <div className="ac-kpi-icon">
                  <HiChartBar />
                </div>
                <div>
                  <span className="ac-kpi-value">{formatF(totaux.margeN)}</span>
                  <span className="ac-kpi-label">
                    Marge {data.anneeN} · {formatPct(totaux.pctMarge)}
                  </span>
                  <EvolBadge value={totaux.evolMarge} />
                </div>
              </div>
              <div className="ac-kpi">
                <div className="ac-kpi-icon">
                  <HiShoppingCart />
                </div>
                <div>
                  <span className="ac-kpi-value">
                    {formatF(totaux.panierMoyen)}
                  </span>
                  <span className="ac-kpi-label">Panier moyen</span>
                </div>
              </div>
              <div className="ac-kpi">
                <div className="ac-kpi-icon">
                  <HiCurrencyDollar />
                </div>
                <div>
                  <span className="ac-kpi-value">
                    {formatF(totaux.caMoyenParClient)}
                  </span>
                  <span className="ac-kpi-label">CA moyen / client</span>
                </div>
              </div>
              <div className="ac-kpi">
                <div className="ac-kpi-icon">
                  <HiUsers />
                </div>
                <div>
                  <span className="ac-kpi-value">{totaux.nbClients}</span>
                  <span className="ac-kpi-label">Clients actifs</span>
                </div>
              </div>
              <div className="ac-kpi">
                <div className="ac-kpi-icon">
                  <HiDocumentText />
                </div>
                <div>
                  <span className="ac-kpi-value">{totaux.nbFactures}</span>
                  <span className="ac-kpi-label">Factures</span>
                  <span className="ac-kpi-mini">
                    vs {totaux.nbFacturesN1 ?? 0} en N-1
                  </span>
                </div>
              </div>
              <div className="ac-kpi">
                <div className="ac-kpi-icon">
                  <HiTrendingUp />
                </div>
                <div>
                  <span className="ac-kpi-value">
                    {totaux.nbClientsCroissance ?? 0}
                  </span>
                  <span className="ac-kpi-label">Clients en croissance</span>
                  <span className="ac-kpi-mini">
                    {totaux.nbClientsBaisse ?? 0} en baisse
                  </span>
                </div>
              </div>
              <div className="ac-kpi">
                <div className="ac-kpi-icon">
                  <HiUserAdd />
                </div>
                <div>
                  <span className="ac-kpi-value">
                    {totaux.nbClientsNouveaux ?? 0}
                  </span>
                  <span className="ac-kpi-label">Nouveaux clients</span>
                  <span className="ac-kpi-mini">
                    {totaux.nbClientsPerdus ?? 0} perdus
                  </span>
                </div>
              </div>
              <div className="ac-kpi">
                <div className="ac-kpi-icon">
                  <HiStar />
                </div>
                <div>
                  <span className="ac-kpi-value small">
                    {totaux.topCommercial?.nom || "—"}
                  </span>
                  <span className="ac-kpi-label">Top commercial</span>
                  <span className="ac-kpi-mini">
                    {totaux.topCommercial
                      ? formatF(totaux.topCommercial.caN)
                      : ""}
                  </span>
                </div>
              </div>
              <div className="ac-kpi">
                <div className="ac-kpi-icon">
                  <HiUserGroup />
                </div>
                <div>
                  <span className="ac-kpi-value">{totaux.nbCommerciaux}</span>
                  <span className="ac-kpi-label">Commerciaux</span>
                </div>
              </div>
            </div>
          )}

          <div className="ac-grid">
            {commerciaux.map((com) => {
              const partSoi =
                com.caN !== 0 ? (com.caParSoiN / com.caN) * 100 : 0;
              return (
                <button
                  key={com.code}
                  className="ac-card"
                  onClick={() =>
                    navigate(
                      `/admin/commerciaux/${selectedEntreprise}/${com.code}`,
                    )
                  }
                >
                  <div className="ac-card-top">
                    <div className="ac-card-name">
                      <HiOfficeBuilding />
                      <span>{com.nom}</span>
                    </div>
                    {badge(com)}
                  </div>

                  <div className="ac-card-ca">
                    <span className="big">{formatF(com.caN)}</span>
                    <EvolBadge value={com.evolCA} />
                  </div>

                  <div className="ac-bar">
                    <div
                      className="ac-bar-fill"
                      style={{ width: `${(Math.abs(com.caN) / maxCa) * 100}%` }}
                    />
                  </div>

                  {/* Comparaison portefeuille : réalisé par lui vs capté par d'autres */}
                  <div className="ac-split">
                    <div
                      className="ac-split-self"
                      style={{ width: `${Math.max(0, Math.min(100, partSoi))}%` }}
                      title={`Réalisé par ${com.nom} : ${formatF(com.caParSoiN)}`}
                    />
                    <div
                      className="ac-split-other"
                      title={`Capté par d'autres : ${formatF(com.caAutresN)}`}
                    />
                  </div>
                  <div className="ac-split-legend">
                    <span>
                      <i className="dot self" /> Lui {formatPct(partSoi)}
                    </span>
                    <span>
                      <i className="dot other" /> Autres{" "}
                      {formatPct(100 - partSoi)}
                    </span>
                  </div>

                  <div className="ac-card-stats">
                    <div>
                      <span className="lbl">Clients</span>
                      <span className="val">{com.nbClients}</span>
                    </div>
                    <div>
                      <span className="lbl">Factures</span>
                      <span className="val">{com.nbFactures}</span>
                    </div>
                    <div>
                      <span className="lbl">Marge</span>
                      <span className="val">{formatPct(com.pctMarge)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default AdminCommerciauxScreen;