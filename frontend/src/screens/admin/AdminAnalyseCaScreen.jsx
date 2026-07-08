// src/screens/admin/AdminAnalyseCaScreen.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useGetEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetAnalyseCaApercuQuery,
  useGenererAnalyseCaMutation,
} from "../../slices/analyseCaApiSlice";
import "./AdminAnalyseCaScreen.css";

const STORAGE_KEY = "analyse_ca_entreprise";

// Mois précédent au format YYYY-MM (défaut du sélecteur).
function moisPrecedent() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
}

const fmtXPF = (n) =>
  typeof n === "number"
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " XPF"
    : "—";
const fmtPct = (n) =>
  typeof n === "number" ? `${n > 0 ? "+" : ""}${n.toFixed(1)} %` : "—";
const fmtNb = (n) =>
  typeof n === "number" ? new Intl.NumberFormat("fr-FR").format(n) : "—";

const AdminAnalyseCaScreen = () => {
  const [selectedEntreprise, setSelectedEntreprise] = useState(
    () => localStorage.getItem(STORAGE_KEY) || "",
  );
  const [moisCoupure, setMoisCoupure] = useState(moisPrecedent);

  const { data: entreprises, isLoading: loadingEntreprises } =
    useGetEntreprisesQuery();

  const {
    data: apercu,
    isLoading: loadingApercu,
    isFetching: fetchingApercu,
    error: apercuError,
  } = useGetAnalyseCaApercuQuery(
    { nomDossierDBF: selectedEntreprise, moisCoupure },
    { skip: !selectedEntreprise || !moisCoupure },
  );

  const [genererAnalyseCa, { isLoading: generating }] =
    useGenererAnalyseCaMutation();
  const [genError, setGenError] = useState(null);
  const [lastFile, setLastFile] = useState(null);

  // Sélection par défaut : "qc" sinon 1re entreprise active.
  useEffect(() => {
    if (!selectedEntreprise && entreprises && entreprises.length > 0) {
      const qc = entreprises.find((e) => e.nomDossierDBF === "qc");
      const active = qc || entreprises.find((e) => e.isActive) || entreprises[0];
      if (active) setSelectedEntreprise(active.nomDossierDBF);
    }
  }, [entreprises, selectedEntreprise]);

  useEffect(() => {
    if (selectedEntreprise) localStorage.setItem(STORAGE_KEY, selectedEntreprise);
  }, [selectedEntreprise]);

  const kpis = apercu?.kpis;
  const meta = apercu?.meta;
  const periode = meta?.periode;

  const trigramme = useMemo(() => {
    const e = (entreprises || []).find(
      (x) => x.nomDossierDBF === selectedEntreprise,
    );
    return e?.trigramme || "";
  }, [entreprises, selectedEntreprise]);

  const handleGenerer = async () => {
    if (!selectedEntreprise || !moisCoupure) return;
    setGenError(null);
    setLastFile(null);
    try {
      const res = await genererAnalyseCa({
        nomDossierDBF: selectedEntreprise,
        moisCoupure,
      }).unwrap();
      if (!res?.blob) throw new Error("Réponse invalide");
      const href = window.URL.createObjectURL(res.blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = res.filename || "analyse_ca.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(href);
      setLastFile(res.filename || "analyse_ca.xlsx");
    } catch (err) {
      setGenError(
        err?.data?.message || err?.message || "Échec de la génération du fichier.",
      );
    }
  };

  const apercuBusy = loadingApercu || fetchingApercu;

  return (
    <div className="aca-screen">
      <header className="aca-header">
        <h1 className="aca-title">Analyse CA</h1>
        <p className="aca-subtitle">
          Rapport Excel multi-onglets (chiffre d'affaires, marges, évolutions)
          par type de client, article, classe, rayon, fournisseur et promotions.
        </p>
      </header>

      <section className="aca-toolbar">
        <label className="aca-field">
          Entreprise
          <select
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
        </label>

        <label className="aca-field">
          Mois de coupure
          <input
            type="month"
            value={moisCoupure}
            max={moisPrecedent()}
            onChange={(e) => setMoisCoupure(e.target.value)}
          />
        </label>

        <button
          type="button"
          className="aca-btn aca-btn-primary"
          onClick={handleGenerer}
          disabled={!selectedEntreprise || !moisCoupure || generating || apercuBusy}
        >
          {generating ? "Génération…" : "Générer le fichier Excel"}
        </button>
      </section>

      {genError && <div className="aca-alert aca-alert-error">{genError}</div>}
      {lastFile && (
        <div className="aca-alert aca-alert-success">
          Fichier généré : <strong>{lastFile}</strong> (téléchargement lancé).
        </div>
      )}

      {!selectedEntreprise && (
        <div className="aca-empty">Sélectionnez une entreprise pour commencer.</div>
      )}

      {selectedEntreprise && apercuError && (
        <div className="aca-alert aca-alert-error">
          Impossible de charger l'aperçu :{" "}
          {apercuError?.data?.message || "erreur serveur."}
        </div>
      )}

      {selectedEntreprise && apercuBusy && (
        <div className="aca-loading">Chargement de l'aperçu…</div>
      )}

      {selectedEntreprise && !apercuBusy && apercu && (
        <>
          <section className="aca-periode">
            <div>
              <span className="aca-periode-label">Période N</span>
              <span className="aca-periode-value">
                {periode?.labelN || `Année ${periode?.anneeN ?? ""}`}
              </span>
            </div>
            <div>
              <span className="aca-periode-label">Comparé à N-1</span>
              <span className="aca-periode-value">
                {periode?.labelN1 || `Année ${periode?.anneeN1 ?? ""}`}
              </span>
            </div>
            <div>
              <span className="aca-periode-label">Trigramme</span>
              <span className="aca-periode-value">{trigramme || "—"}</span>
            </div>
          </section>

          <section className="aca-kpis">
            <div className="aca-kpi">
              <span className="aca-kpi-label">CA N</span>
              <span className="aca-kpi-value">{fmtXPF(kpis?.caN)}</span>
              <span
                className={`aca-kpi-evol ${
                  (kpis?.evolCaPct ?? 0) >= 0 ? "pos" : "neg"
                }`}
              >
                {fmtPct(kpis?.evolCaPct)} vs N-1
              </span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Marge N</span>
              <span className="aca-kpi-value">{fmtXPF(kpis?.margeN)}</span>
              <span className="aca-kpi-sub">
                Taux {typeof kpis?.tauxMargeN === "number" ? `${kpis.tauxMargeN.toFixed(1)} %` : "—"}
              </span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Factures N</span>
              <span className="aca-kpi-value">{fmtNb(kpis?.nbFacturesN)}</span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Clients N</span>
              <span className="aca-kpi-value">{fmtNb(kpis?.nbClientsN)}</span>
            </div>
            <div className="aca-kpi">
              <span className="aca-kpi-label">Articles vendus N</span>
              <span className="aca-kpi-value">{fmtNb(kpis?.nbArticlesN)}</span>
            </div>
          </section>

          <section className="aca-onglets">
            <h2 className="aca-section-title">
              Onglets du fichier ({meta?.onglets?.length ?? 0})
            </h2>
            <ul className="aca-onglets-list">
              {(meta?.onglets || []).map((o) => (
                <li key={o} className="aca-onglet-chip">
                  {o}
                </li>
              ))}
            </ul>

            {meta?.ongletsOmis?.length > 0 && (
              <div className="aca-alert aca-alert-info">
                Onglets omis (fichier <code>artplus.dbf</code> absent pour cette
                entreprise) : {meta.ongletsOmis.join(", ")}.
              </div>
            )}
            {meta && !meta.dictionnairePresent && (
              <div className="aca-alert aca-alert-info">
                Dictionnaire des rayons absent : l'onglet <strong>Rayons</strong>{" "}
                utilise le code GISM1 comme libellé (métrage non calculé).
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default AdminAnalyseCaScreen;