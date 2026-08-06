import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiClipboardCheck,
  HiDownload,
  HiRefresh,
  HiOfficeBuilding,
  HiExclamationCircle,
  HiExternalLink,
} from "react-icons/hi";
import {
  selectGlobalDossier,
  selectGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import { useGetResaEntreesQuery } from "../../slices/resaEntreesApiSlice";
import { BASE_URL } from "../../constants";
import "./ResaEntreesScreen.css";

const toISOLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const todayISO = () => toISOLocal(new Date());
// Défaut = la veille (les entrées du jour ne sont pas encore complètes).
const yesterdayISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toISOLocal(d);
};

const fmtInt = (v) => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v)))
    return "—";
  return Math.trunc(Number(v)).toLocaleString("fr-FR").replace(/[\s,]/g, " ");
};

// Classe de puce selon l'état de réservation.
const etatChipClass = (code) => {
  if (Number(code) === 2) return "re-chip-special"; // Commande Spéciale
  if (Number(code) === 1) return "re-chip-stock"; // Réservation Stock
  return "re-chip-other";
};

const ResaEntreesScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  const [date, setDate] = useState(yesterdayISO());
  const [error, setError] = useState("");
  const [excelLoading, setExcelLoading] = useState(false);

  const { data, isFetching, isError, error: queryError, refetch } =
    useGetResaEntreesQuery(
      { nomDossierDBF, start: date, end: date },
      { skip: !nomDossierDBF },
    );

  const rows = useMemo(() => data?.rows || [], [data]);

  const exporterExcel = async () => {
    setError("");
    if (!nomDossierDBF) {
      setError("Sélectionnez une société dans l'en-tête.");
      return;
    }
    setExcelLoading(true);
    try {
      const res = await fetch(
        `${BASE_URL}/api/resa-entrees/${nomDossierDBF}/excel?start=${date}&end=${date}`,
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
      a.download = `resa_entrees_${nomDossierDBF}_${date}.xlsx`;
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
    <div className="re-page">
      <header className="re-header">
        <div className="re-header-left">
          <div className="re-header-icon">
            <HiClipboardCheck />
          </div>
          <div>
            <h1>Entrées sur réservation</h1>
            <p className="re-header-subtitle">
              Articles en réservation / commande spéciale qui sont entrés en stock
              — avec client et vendeur.
            </p>
          </div>
        </div>
        {entreprise && (
          <div className="re-entreprise-badge">
            <HiOfficeBuilding />
            <span>{entreprise.nomComplet || entreprise.nom || nomDossierDBF}</span>
          </div>
        )}
      </header>

      {!nomDossierDBF ? (
        <div className="re-empty">
          <HiExclamationCircle className="re-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>Choisissez une société dans l'en-tête pour voir les entrées sur réservation.</p>
        </div>
      ) : (
        <>
          <div className="re-toolbar">
            <div className="re-toolbar-left">
              <div className="re-field">
                <label htmlFor="re-date">Date d'entrée</label>
                <input
                  id="re-date"
                  type="date"
                  value={date}
                  max={todayISO()}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="re-stats">
                <div className="re-stat re-stat-primary">
                  <span className="re-stat-value">{data?.total ?? "—"}</span>
                  <span className="re-stat-label">Réservations</span>
                </div>
                <div className="re-stat">
                  <span className="re-stat-value">{data?.nbArticles ?? "—"}</span>
                  <span className="re-stat-label">Articles</span>
                </div>
                <div className="re-stat">
                  <span className="re-stat-value">{data?.nbClients ?? "—"}</span>
                  <span className="re-stat-label">Clients</span>
                </div>
              </div>
            </div>

            <div className="re-actions">
              <button
                type="button"
                className="re-btn re-btn-ghost"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <HiRefresh className={isFetching ? "re-spin" : ""} />
                Actualiser
              </button>
              <button
                type="button"
                className="re-btn re-btn-excel"
                onClick={exporterExcel}
                disabled={excelLoading || isFetching}
              >
                <HiDownload />
                {excelLoading ? "Excel…" : "Export Excel"}
              </button>
            </div>
          </div>

          {error && <div className="re-alert re-alert-err">{error}</div>}
          {isError && (
            <div className="re-alert re-alert-err">
              {queryError?.data?.message ||
                "Erreur lors du chargement des entrées sur réservation."}
            </div>
          )}

          <div className="re-table-wrap">
            <table className="re-table">
              <thead>
                <tr>
                  <th>NART</th>
                  <th>Désignation</th>
                  <th>État</th>
                  <th className="re-num">Qté résa</th>
                  <th className="re-num">Qté entrée</th>
                  <th className="re-num">Stock total</th>
                  <th>Client</th>
                  <th>Tiers</th>
                  <th>Vendeur</th>
                  <th>Réf résa</th>
                  <th>Date entrée</th>
                </tr>
              </thead>
              <tbody>
                {isFetching ? (
                  <tr>
                    <td colSpan={10} className="re-td-info">
                      <span className="re-spinner" /> Chargement (scan des
                      réservations)…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="re-td-info">
                      Aucun article réservé entré en stock pour cette date.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr key={`${r.nart}-${r.refResa}-${i}`}>
                      <td className="re-mono">
                        <a
                          className="re-nart-link"
                          href={`/admin/articles/${nomDossierDBF}/${encodeURIComponent(
                            r.nart,
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ouvrir la fiche article (nouvel onglet)"
                        >
                          {r.nart}
                          <HiExternalLink className="re-nart-ext" />
                        </a>
                      </td>
                      <td className="re-design" title={r.design}>
                        {r.design || <em className="re-muted">Article introuvable</em>}
                        {r.texteResa && (
                          <span className="re-note">{r.texteResa}</span>
                        )}
                      </td>
                      <td>
                        <span className={`re-chip ${etatChipClass(r.etatCode)}`}>
                          {r.etatResa}
                        </span>
                      </td>
                      <td className="re-num">{fmtInt(r.qteResa)}</td>
                      <td className="re-num">{fmtInt(r.qteEntree)}</td>
                      <td className="re-num">{fmtInt(r.stockTotal)}</td>
                      <td className="re-ell" title={r.client}>
                        {r.client || "—"}
                      </td>
                      <td className="re-mono re-muted">{r.tiers ?? "—"}</td>
                      <td className="re-vendeur">
                        <span className="re-badge-code">{r.vendeurCode ?? "—"}</span>
                        {r.vendeurNom && (
                          <span className="re-vendeur-nom">{r.vendeurNom}</span>
                        )}
                      </td>
                      <td className="re-mono">{r.refResa || "—"}</td>
                      <td className="re-mono">{r.dateEntree || "—"}</td>
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

export default ResaEntreesScreen;
