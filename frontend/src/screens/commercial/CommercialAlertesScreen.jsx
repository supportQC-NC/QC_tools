// src/screens/commercial/CommercialAlertesScreen.jsx
//
// MES ALERTES — articles réservés / en commande spéciale pour mes clients qui
// viennent d'ENTRER EN STOCK (croisement réservations × entrees.dbf, service
// « Entrées sur réservation » déjà en place, filtré sur mon code vendeur).
//
// Objectif : le commercial n'a plus à vérifier manuellement si la marchandise
// de son client est arrivée — il voit l'info et appelle.

import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  HiBell,
  HiRefresh,
  HiCheckCircle,
  HiExclamationCircle,
} from "react-icons/hi";
import CommercialShell, {
  useSocietesCommerciales,
  fmtNombre,
} from "../../components/commercial/CommercialShell";
import {
  useGetCommercialAlertesQuery,
  useMarquerAlertesVuesMutation,
} from "../../slices/commercialApiSlice";
import "./CommercialSpace.css";

const FENETRES = [
  { key: "15", label: "15 derniers jours" },
  { key: "45", label: "45 derniers jours" },
  { key: "90", label: "90 derniers jours" },
];

const CommercialAlertesScreen = () => {
  const { societes, dossier, setDossier } = useSocietesCommerciales();
  const [jours, setJours] = useState("45");
  const [masquerVues, setMasquerVues] = useState(false);

  const { data, isFetching, isError, error, refetch } =
    useGetCommercialAlertesQuery({ dossier, jours }, { skip: !dossier });
  const [marquer, { isLoading: marquage }] = useMarquerAlertesVuesMutation();

  const toutes = data?.alertes || [];
  const alertes = masquerVues ? toutes.filter((a) => !a.vue) : toutes;
  const nouvelles = toutes.filter((a) => !a.vue);

  const marquerTout = async () => {
    if (!nouvelles.length) return;
    await marquer({ dossier, cles: nouvelles.map((a) => a.cle) }).unwrap();
  };

  return (
    <CommercialShell
      titre="Mes alertes"
      sousTitre="Réservations et commandes spéciales de mes clients arrivées en stock."
      icone={HiBell}
      societes={societes}
      dossier={dossier}
      onDossier={setDossier}
      actions={
        <button
          type="button"
          className="co-btn"
          // Requête en `skip` tant qu'aucune société n'est déterminée.
          onClick={() => dossier && refetch()}
          disabled={isFetching || !dossier}
        >
          <HiRefresh /> Actualiser
        </button>
      }
    >
      {isError && (
        <div className="co-error">
          {error?.data?.message || "Impossible de charger les alertes."}
        </div>
      )}

      <div className="co-body">
        <div className="co-kpis">
          <div className={`co-kpi ${nouvelles.length ? "alerte" : "ok"}`}>
            <span className="co-kpi-label">
              <HiExclamationCircle /> Nouvelles alertes
            </span>
            <span className="co-kpi-value">{fmtNombre(nouvelles.length)}</span>
            <span className="co-kpi-sub">clients à prévenir</span>
          </div>
          <div className="co-kpi">
            <span className="co-kpi-label">Total sur la période</span>
            <span className="co-kpi-value">{fmtNombre(toutes.length)}</span>
            <span className="co-kpi-sub">articles entrés en stock</span>
          </div>
        </div>

        <section className="co-card">
          <div className="co-toolbar">
            <div className="co-field">
              <label htmlFor="co-a-jours">Période</label>
              <select
                id="co-a-jours"
                value={jours}
                onChange={(e) => setJours(e.target.value)}
              >
                {FENETRES.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className={`co-tab ${masquerVues ? "active" : ""}`}
              onClick={() => setMasquerVues((v) => !v)}
            >
              Masquer les alertes déjà vues
            </button>
            {nouvelles.length > 0 && (
              <button
                type="button"
                className="co-btn co-btn-primary"
                onClick={marquerTout}
                disabled={marquage}
              >
                <HiCheckCircle /> Tout marquer comme vu
              </button>
            )}
          </div>

          {isFetching && (
            <div className="co-loading">
              Recherche des articles réservés entrés en stock… La première
              recherche parcourt l'historique des factures et peut prendre un
              moment ; les suivantes sont immédiates.
            </div>
          )}

          {!isFetching && alertes.length === 0 && (
            <div className="co-empty">
              Aucun article réservé n'est entré en stock sur la période.
            </div>
          )}

          {!isFetching && alertes.length > 0 && (
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th>Entrée en stock</th>
                    <th>Client</th>
                    <th>Article</th>
                    <th className="num">Qté réservée</th>
                    <th className="num">Qté entrée</th>
                    <th className="num">Stock</th>
                    <th>État</th>
                    <th>Réservation</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {alertes.map((a) => (
                    <tr key={a.cle} className={a.vue ? "" : "co-row-alerte"}>
                      <td>{a.dateEntree}</td>
                      <td>
                        {a.tiers ? (
                          <Link to={`/commercial/clients/${dossier}/${a.tiers}`}>
                            {a.client || a.tiers}
                          </Link>
                        ) : (
                          a.client || "—"
                        )}
                      </td>
                      <td>
                        <strong>{a.nart}</strong> — {a.design}
                      </td>
                      <td className="num">{fmtNombre(a.qteResa)}</td>
                      <td className="num">{fmtNombre(a.qteEntree)}</td>
                      <td className="num">{fmtNombre(a.stockTotal)}</td>
                      <td>
                        <span className="co-chip co-chip-speciale">
                          {a.etatResa}
                        </span>
                      </td>
                      <td>
                        {a.refResa}
                        {a.dateResa ? ` · ${a.dateResa}` : ""}
                      </td>
                      <td>
                        {a.vue ? (
                          <span className="co-chip co-chip-muted">vue</span>
                        ) : (
                          <button
                            type="button"
                            className="co-btn"
                            onClick={() =>
                              marquer({ dossier, cles: [a.cle] })
                            }
                          >
                            <HiCheckCircle /> Vu
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </CommercialShell>
  );
};

export default CommercialAlertesScreen;
