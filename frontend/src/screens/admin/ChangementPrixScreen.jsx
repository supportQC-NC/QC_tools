import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiCurrencyDollar,
  HiDownload,
  HiTag,
  HiRefresh,
  HiOfficeBuilding,
  HiExclamationCircle,
  HiArrowNarrowRight,
  HiExternalLink,
} from "react-icons/hi";
import {
  selectGlobalDossier,
  selectGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import { useGetChangementsPrixQuery } from "../../slices/changementPrixApiSlice";
import { BASE_URL } from "../../constants";
import "./ChangementPrixScreen.css";

// Date locale au format "YYYY-MM-DD" (input date HTML).
const toISOLocal = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Hier (défaut, comme le script Python d'origine).
const yesterdayISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toISOLocal(d);
};

// Prix entier avec séparateur d'espace + « XPF » (aligné sur les étiquettes).
const fmtPrix = (v) => {
  if (v === null || v === undefined || v === "" || Number.isNaN(Number(v)))
    return "—";
  const n = Math.trunc(Number(v));
  return `${n.toLocaleString("fr-FR").replace(/[\s,]/g, " ")} XPF`;
};

const ChangementPrixScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  const [date, setDate] = useState(yesterdayISO());
  const [error, setError] = useState("");
  const [excelLoading, setExcelLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const {
    data,
    isFetching,
    isError,
    error: queryError,
    refetch,
  } = useGetChangementsPrixQuery(
    { nomDossierDBF, date },
    { skip: !nomDossierDBF },
  );

  const rows = useMemo(() => data?.rows || [], [data]);
  const nbEtiquetables = useMemo(
    () => rows.filter((r) => !r.introuvable).length,
    [rows],
  );

  // Télécharge un flux binaire (Excel/PDF) depuis une URL avec cookie JWT.
  const telecharger = async ({ url, method = "GET", body, filename, setBusy }) => {
    setError("");
    if (!nomDossierDBF) {
      setError("Sélectionnez une société dans l'en-tête.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        let msg = `Échec (${res.status})`;
        try {
          const j = await res.json();
          if (j?.message) msg = j.message;
        } catch {
          /* réponse non-JSON */
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
    } catch (e) {
      setError(e.message || "Erreur lors du téléchargement.");
    } finally {
      setBusy(false);
    }
  };

  const exporterExcel = () =>
    telecharger({
      url: `${BASE_URL}/api/changement-prix/${nomDossierDBF}/excel?date=${date}`,
      filename: `changement_prix_${nomDossierDBF}_${date}.xlsx`,
      setBusy: setExcelLoading,
    });

  const genererEtiquettes = () =>
    telecharger({
      url: `${BASE_URL}/api/changement-prix/${nomDossierDBF}/etiquettes`,
      method: "POST",
      body: { date },
      filename: `etiquettes_changement_prix_${date}.pdf`,
      setBusy: setPdfLoading,
    });

  return (
    <div className="cp-page">
      {/* ── Header ── */}
      <header className="cp-header">
        <div className="cp-header-left">
          <div className="cp-header-icon">
            <HiCurrencyDollar />
          </div>
          <div>
            <h1>Changement de prix de vente</h1>
            <p className="cp-header-subtitle">
              Articles dont le prix a changé (source&nbsp;: verif.dbf) — rapport
              Excel &amp; étiquettes de prix.
            </p>
          </div>
        </div>

        {entreprise && (
          <div className="cp-entreprise-badge">
            <HiOfficeBuilding />
            <span>{entreprise.nomComplet || entreprise.nom || nomDossierDBF}</span>
          </div>
        )}
      </header>

      {!nomDossierDBF ? (
        <div className="cp-empty">
          <HiExclamationCircle className="cp-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>
            Choisissez une société dans l'en-tête pour consulter les changements
            de prix.
          </p>
        </div>
      ) : (
        <>
          {/* ── Barre d'outils / stats ── */}
          <div className="cp-toolbar">
            <div className="cp-toolbar-left">
              <div className="cp-field">
                <label htmlFor="cp-date">Date des changements</label>
                <input
                  id="cp-date"
                  type="date"
                  value={date}
                  max={toISOLocal(new Date())}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div className="cp-stats">
                <div className="cp-stat cp-stat-primary">
                  <span className="cp-stat-value">{data?.total ?? "—"}</span>
                  <span className="cp-stat-label">Changements</span>
                </div>
                <div className="cp-stat">
                  <span className="cp-stat-value">{nbEtiquetables}</span>
                  <span className="cp-stat-label">Étiquetables</span>
                </div>
                {data?.dateFr && (
                  <div className="cp-stat">
                    <span className="cp-stat-value">{data.dateFr}</span>
                    <span className="cp-stat-label">Date</span>
                  </div>
                )}
              </div>
            </div>

            <div className="cp-actions">
              <button
                type="button"
                className="cp-btn cp-btn-ghost"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <HiRefresh className={isFetching ? "cp-spin" : ""} />
                Actualiser
              </button>
              <button
                type="button"
                className="cp-btn cp-btn-excel"
                onClick={exporterExcel}
                disabled={excelLoading || isFetching}
              >
                <HiDownload />
                {excelLoading ? "Excel…" : "Rapport Excel"}
              </button>
              <button
                type="button"
                className="cp-btn cp-btn-pdf"
                onClick={genererEtiquettes}
                disabled={pdfLoading || isFetching || nbEtiquetables === 0}
                title={
                  nbEtiquetables === 0
                    ? "Aucun article à étiqueter pour cette date"
                    : "Étiquettes standard 5×4 cm des articles changés"
                }
              >
                <HiTag />
                {pdfLoading ? "Étiquettes…" : "Étiquettes PDF"}
              </button>
            </div>
          </div>

          {error && <div className="cp-alert cp-alert-err">{error}</div>}
          {isError && (
            <div className="cp-alert cp-alert-err">
              {queryError?.data?.message ||
                "Erreur lors du chargement des changements de prix."}
            </div>
          )}

          {/* ── Table ── */}
          <div className="cp-table-wrap">
            <table className="cp-table">
              <thead>
                <tr>
                  <th>NART</th>
                  <th>Désignation</th>
                  <th>Fournisseur</th>
                  <th>Gencod</th>
                  <th className="cp-num">Prix initial</th>
                  <th className="cp-num">Prix actuel</th>
                  <th className="cp-num">Prix de vente</th>
                </tr>
              </thead>
              <tbody>
                {isFetching ? (
                  <tr>
                    <td colSpan={7} className="cp-td-info">
                      <span className="cp-spinner" />
                      Chargement…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="cp-td-info">
                      Aucun changement de prix pour cette date.
                    </td>
                  </tr>
                ) : (
                  rows.map((r, i) => (
                    <tr
                      key={`${r.nart}-${i}`}
                      className={r.introuvable ? "cp-row-missing" : ""}
                    >
                      <td className="cp-mono">
                        <a
                          className="cp-nart-link"
                          href={`/admin/articles/${nomDossierDBF}/${encodeURIComponent(
                            r.nart,
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Ouvrir la fiche article (nouvel onglet)"
                        >
                          {r.nart}
                          <HiExternalLink className="cp-nart-ext" />
                        </a>
                      </td>
                      <td className="cp-design">
                        {r.designation || (
                          <em className="cp-muted">Article introuvable</em>
                        )}
                        {r.enPromo && <span className="cp-promo-chip">PROMO</span>}
                      </td>
                      <td>
                        {r.fournisseur ? (
                          <span className="cp-badge-code">{r.fournisseur}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="cp-mono cp-muted">{r.gencod || "—"}</td>
                      <td className="cp-num cp-mono">{fmtPrix(r.prixInitial)}</td>
                      <td className="cp-num cp-mono cp-num-new">
                        <HiArrowNarrowRight className="cp-arrow" />
                        {fmtPrix(r.prixActuel)}
                      </td>
                      <td className="cp-num cp-mono">
                        {r.enPromo ? (
                          <span className="cp-promo-price">
                            <span className="cp-old-price">
                              {fmtPrix(r.pvtettc)}
                            </span>
                            <span className="cp-new-promo">
                              {fmtPrix(r.pvpromo)}
                            </span>
                          </span>
                        ) : (
                          fmtPrix(r.pvtettc)
                        )}
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

export default ChangementPrixScreen;
