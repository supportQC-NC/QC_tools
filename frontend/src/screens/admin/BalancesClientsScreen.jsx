import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiCurrencyDollar,
  HiDownload,
  HiRefresh,
  HiOfficeBuilding,
  HiExclamationCircle,
  HiBan,
} from "react-icons/hi";
import {
  selectGlobalDossier,
  selectGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import { useGetBalancesReportQuery } from "../../slices/balancesApiSlice";
import { BASE_URL } from "../../constants";
import "./BalancesClientsScreen.css";

// Montant entier avec séparateur d'espace + « XPF ».
const fmt = (v) => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v)))
    return "—";
  const n = Math.trunc(Number(v));
  return `${n.toLocaleString("fr-FR").replace(/[\s,]/g, " ")} XPF`;
};

// Classe couleur d'un montant : négatif => vert, positif => normal.
const amtClass = (v) => (Number(v) < 0 ? "bc-neg" : "");

const BalancesClientsScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  const [tab, setTab] = useState("toutes"); // toutes | bloquer
  const [error, setError] = useState("");
  const [excelLoading, setExcelLoading] = useState(false);

  const { data, isFetching, isError, error: queryError, refetch } =
    useGetBalancesReportQuery(nomDossierDBF, { skip: !nomDossierDBF });

  const allRows = useMemo(() => data?.rows || [], [data]);
  const rows = useMemo(
    () => (tab === "bloquer" ? allRows.filter((r) => r.aBloquer) : allRows),
    [allRows, tab],
  );

  const exporterExcel = async () => {
    setError("");
    if (!nomDossierDBF) {
      setError("Sélectionnez une société dans l'en-tête.");
      return;
    }
    setExcelLoading(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/balances-clients/${nomDossierDBF}/excel`,
        { credentials: "include" },
      );
      if (!res.ok) {
        let msg = `Échec (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* non-JSON */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `balances_clients_${nomDossierDBF}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (e) {
      setError(e.message || "Erreur lors de l'export.");
    } finally {
      setExcelLoading(false);
    }
  };

  return (
    <div className="bc-page">
      <header className="bc-header">
        <div className="bc-header-left">
          <div className="bc-header-icon">
            <HiCurrencyDollar />
          </div>
          <div>
            <h1>Balances / clients à bloquer</h1>
            <p className="bc-header-subtitle">
              Encours clients par ancienneté (balances.dbf) — liste des clients à
              bloquer (dette âgée ≥ 2 mois).
            </p>
          </div>
        </div>
        {entreprise && (
          <div className="bc-entreprise-badge">
            <HiOfficeBuilding />
            <span>{entreprise.nomComplet || entreprise.nom || nomDossierDBF}</span>
          </div>
        )}
      </header>

      {!nomDossierDBF ? (
        <div className="bc-empty">
          <HiExclamationCircle className="bc-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>Choisissez une société dans l'en-tête pour consulter les balances.</p>
        </div>
      ) : (
        <>
          <div className="bc-toolbar">
            <div className="bc-stats">
              <div className="bc-stat bc-stat-primary">
                <span className="bc-stat-value">{fmt(data?.totalSolde)}</span>
                <span className="bc-stat-label">Encours total</span>
              </div>
              <div className="bc-stat">
                <span className="bc-stat-value bc-danger">
                  {data?.nbABloquer ?? "—"}
                </span>
                <span className="bc-stat-label">À bloquer</span>
              </div>
              <div className="bc-stat">
                <span className="bc-stat-value">{data?.total ?? "—"}</span>
                <span className="bc-stat-label">Clients</span>
              </div>
            </div>

            <div className="bc-actions">
              <button
                type="button"
                className="bc-btn bc-btn-ghost"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <HiRefresh className={isFetching ? "bc-spin" : ""} />
                Actualiser
              </button>
              <button
                type="button"
                className="bc-btn bc-btn-excel"
                onClick={exporterExcel}
                disabled={excelLoading || isFetching}
              >
                <HiDownload />
                {excelLoading ? "Excel…" : "Export Excel"}
              </button>
            </div>
          </div>

          <div className="bc-tabs">
            <button
              className={`bc-tab ${tab === "toutes" ? "active" : ""}`}
              onClick={() => setTab("toutes")}
            >
              Toutes ({allRows.length})
            </button>
            <button
              className={`bc-tab ${tab === "bloquer" ? "active" : ""}`}
              onClick={() => setTab("bloquer")}
            >
              <HiBan /> À bloquer ({data?.nbABloquer ?? 0})
            </button>
          </div>

          {error && <div className="bc-alert bc-alert-err">{error}</div>}
          {isError && (
            <div className="bc-alert bc-alert-err">
              {queryError?.data?.message ||
                "Erreur lors du chargement des balances."}
            </div>
          )}

          <div className="bc-table-wrap">
            <table className="bc-table">
              <thead>
                <tr>
                  <th>Tiers</th>
                  <th>Client</th>
                  <th>Vendeur</th>
                  <th>Catégorie</th>
                  <th className="bc-num">Solde</th>
                  <th className="bc-num">M-1</th>
                  <th className="bc-num">M-2</th>
                  <th className="bc-num">M-3</th>
                  <th className="bc-num">3M+</th>
                </tr>
              </thead>
              <tbody>
                {isFetching ? (
                  <tr>
                    <td colSpan={9} className="bc-td-info">
                      <span className="bc-spinner" /> Chargement…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="bc-td-info">
                      Aucune balance à afficher.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr
                      key={`${r.tiers}-${i}`}
                      className={r.aBloquer ? "bc-row-bloquer" : ""}
                    >
                      <td className="bc-mono">{r.tiers}</td>
                      <td className="bc-nom">
                        {r.nom || <em className="bc-muted">Client inconnu</em>}
                        {r.aBloquer && <span className="bc-chip-bloquer">À BLOQUER</span>}
                      </td>
                      <td>{r.vendeur}</td>
                      <td className="bc-muted">{r.categorie || "—"}</td>
                      <td className={`bc-num bc-mono bc-solde ${amtClass(r.solde)}`}>
                        {fmt(r.solde)}
                      </td>
                      <td className={`bc-num bc-mono ${amtClass(r.m1)}`}>
                        {r.m1 ? fmt(r.m1) : "—"}
                      </td>
                      <td className={`bc-num bc-mono ${amtClass(r.m2)}`}>
                        {r.m2 ? fmt(r.m2) : "—"}
                      </td>
                      <td className={`bc-num bc-mono ${amtClass(r.m3)}`}>
                        {r.m3 ? fmt(r.m3) : "—"}
                      </td>
                      <td className={`bc-num bc-mono ${amtClass(r.m3plus)}`}>
                        {r.m3plus ? fmt(r.m3plus) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

export default BalancesClientsScreen;
