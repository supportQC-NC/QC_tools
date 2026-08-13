// src/screens/commercial/CommercialDashboardScreen.jsx
//
// TABLEAU DE BORD COMMERCIAL — page d'accueil du commercial.
// Agrège ses sociétés (bouton « Toutes ») ou en isole une. Chaque indicateur
// renvoie vers le détail correspondant. Les données sont filtrées côté serveur
// sur société + code vendeur : un commercial ne voit que son propre périmètre.

import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  HiViewGrid,
  HiUserGroup,
  HiCurrencyDollar,
  HiDocumentReport,
  HiBookmark,
  HiStar,
  HiBell,
  HiPhone,
  HiRefresh,
  HiExclamationCircle,
  HiCheckCircle,
} from "react-icons/hi";
import CommercialShell, {
  useSocietesCommerciales,
  fmtMontant,
  fmtNombre,
  fmtDate,
  Evolution,
  ChipCategorie,
} from "../../components/commercial/CommercialShell";
import {
  useGetCommercialDashboardQuery,
  useGetCommercialDashboardCaQuery,
  useGetCommercialAlertesQuery,
  useMarquerAlertesVuesMutation,
} from "../../slices/commercialApiSlice";
import "./CommercialSpace.css";

// ── Carte ALERTES d'une société ──────────────────────────────────────────────
// Requête SÉPARÉE du dashboard : le premier appel scanne les DBF de factures
// (lent), on ne veut pas retarder l'affichage des indicateurs principaux.
const AlertesCard = ({ dossier, trigramme }) => {
  const { data, isFetching, isError, error, refetch } =
    useGetCommercialAlertesQuery({ dossier }, { skip: !dossier });
  const [marquer, { isLoading: marquage }] = useMarquerAlertesVuesMutation();

  const alertes = data?.alertes || [];
  const nouvelles = alertes.filter((a) => !a.vue);

  const toutMarquer = async () => {
    if (!nouvelles.length) return;
    await marquer({ dossier, cles: nouvelles.map((a) => a.cle) }).unwrap();
  };

  return (
    <section className="co-card">
      <div className="co-card-head">
        <h2>
          <HiBell /> Commandes spéciales disponibles — {trigramme}
        </h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {nouvelles.length > 0 && (
            <button
              type="button"
              className="co-btn"
              onClick={toutMarquer}
              disabled={marquage}
            >
              <HiCheckCircle /> Tout marquer comme vu
            </button>
          )}
          <button
            type="button"
            className="co-btn"
            onClick={() => dossier && refetch()}
            disabled={isFetching || !dossier}
          >
            <HiRefresh /> Actualiser
          </button>
        </div>
      </div>

      {isFetching && (
        <div className="co-loading">
          Recherche des articles réservés entrés en stock… (première recherche
          longue, le résultat est ensuite mis en cache)
        </div>
      )}
      {isError && !isFetching && (
        <div className="co-error">
          {error?.data?.message || "Impossible de charger les alertes."}
        </div>
      )}
      {!isFetching && !isError && alertes.length === 0 && (
        <div className="co-empty">
          Aucun article réservé n'est entré en stock sur la période.
        </div>
      )}
      {!isFetching && alertes.length > 0 && (
        <div className="co-table-wrap">
          <table className="co-table">
            <thead>
              <tr>
                <th>Entrée</th>
                <th>Client</th>
                <th>Article</th>
                <th className="num">Qté résa</th>
                <th className="num">Qté entrée</th>
                <th>État</th>
                <th>Réf.</th>
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
                  <td>
                    <span className="co-chip co-chip-speciale">{a.etatResa}</span>
                  </td>
                  <td>{a.refResa}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

// ── Bloc d'une société ───────────────────────────────────────────────────────
// `bloc`  : documents + portefeuille (rapide).
// `caBloc`: chiffre d'affaires, top clients, clients à recontacter — chargé en
//           différé (cache factures lent), d'où les états « calcul en cours ».
const BlocSociete = ({ bloc, caBloc, caEnCours }) => {
  const dossier = bloc.entreprise.nomDossierDBF;

  if (bloc.erreur) {
    return (
      <section className="co-card">
        <div className="co-card-head">
          <h2>
            <HiExclamationCircle /> {bloc.entreprise.nomComplet}
          </h2>
        </div>
        <div className="co-error">{bloc.erreur}</div>
      </section>
    );
  }

  const { portefeuille, documents, apercus } = bloc;
  const ca = caBloc?.ca || null;
  const pf = caBloc?.portefeuille || null;

  return (
    <>
      <section className="co-card">
        <div className="co-card-head">
          <h2>
            {bloc.entreprise.nomComplet}{" "}
            <span className="co-chip co-chip-muted">
              code vendeur {bloc.codes.join(" / ")}
            </span>
          </h2>
          {ca && (
            <span className="co-hint">
              CA {ca.anneeN} vs {ca.anneeN1} arrêté au {ca.dateArret}
            </span>
          )}
        </div>

        <div className="co-card-body">
          <div className="co-kpis">
            <Link className="co-kpi" to={`/commercial/clients?dossier=${dossier}`}>
              <span className="co-kpi-label">
                <HiUserGroup /> Mon portefeuille
              </span>
              <span className="co-kpi-value">
                {fmtNombre(portefeuille.nbClients)}
              </span>
              <span className="co-kpi-sub">
                {pf
                  ? `dont ${fmtNombre(pf.nbClientsActifs)} actifs cette année`
                  : "clients à mon nom"}
              </span>
            </Link>

            <div className="co-kpi">
              <span className="co-kpi-label">
                <HiCurrencyDollar /> Chiffre d'affaires
              </span>
              {ca ? (
                <>
                  <span className="co-kpi-value">{fmtMontant(ca.caN)}</span>
                  <span className="co-kpi-sub">
                    <Evolution valeur={ca.evolCa} /> vs {ca.anneeN1} (
                    {fmtMontant(ca.caN1)})
                  </span>
                </>
              ) : (
                <>
                  <span className="co-kpi-value">…</span>
                  <span className="co-kpi-sub">
                    {caEnCours ? "calcul en cours…" : "indisponible"}
                  </span>
                </>
              )}
            </div>

            <Link
              className={`co-kpi ${documents.aRelancer.nb > 0 ? "alerte" : "ok"}`}
              to={`/commercial/proformas?dossier=${dossier}&vue=relance`}
            >
              <span className="co-kpi-label">
                <HiDocumentReport /> Proformas à relancer
              </span>
              <span className="co-kpi-value">
                {fmtNombre(documents.aRelancer.nb)}
              </span>
              <span className="co-kpi-sub">
                {fmtMontant(documents.aRelancer.montant)} F en jeu
              </span>
            </Link>

            <Link
              className="co-kpi"
              to={`/commercial/reservations?dossier=${dossier}`}
            >
              <span className="co-kpi-label">
                <HiBookmark /> Réservations en cours
              </span>
              <span className="co-kpi-value">
                {fmtNombre(documents.reservations.nb)}
              </span>
              <span className="co-kpi-sub">
                {fmtMontant(documents.reservations.montant)} F
              </span>
            </Link>

            <Link
              className="co-kpi"
              to={`/commercial/commandes-speciales?dossier=${dossier}`}
            >
              <span className="co-kpi-label">
                <HiStar /> Commandes spéciales
              </span>
              <span className="co-kpi-value">
                {fmtNombre(documents.speciales.nb)}
              </span>
              <span className="co-kpi-sub">
                {fmtMontant(documents.speciales.montant)} F
              </span>
            </Link>

            <Link
              className={`co-kpi ${pf?.nbAContacter > 0 ? "alerte" : "ok"}`}
              to={`/commercial/clients?dossier=${dossier}&inactifs=1`}
            >
              <span className="co-kpi-label">
                <HiPhone /> Clients à recontacter
              </span>
              <span className="co-kpi-value">
                {pf ? fmtNombre(pf.nbAContacter) : "…"}
              </span>
              <span className="co-kpi-sub">
                {pf
                  ? "sans achat depuis 90 jours"
                  : caEnCours
                    ? "calcul en cours…"
                    : "indisponible"}
              </span>
            </Link>
          </div>
        </div>
      </section>

      <div className="co-grid-2">
        {/* Top 3 clients */}
        <section className="co-card">
          <div className="co-card-head">
            <h2>
              <HiUserGroup /> Top 3 clients
            </h2>
            <Link className="co-btn" to={`/commercial/clients?dossier=${dossier}`}>
              Tout le portefeuille
            </Link>
          </div>
          {!pf ? (
            <div className="co-loading">
              {caEnCours
                ? "Calcul du chiffre d'affaires en cours…"
                : "Chiffre d'affaires indisponible."}
            </div>
          ) : pf.top.length === 0 ? (
            <div className="co-empty">Aucun chiffre d'affaires sur la période.</div>
          ) : (
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th className="num">CA {ca?.anneeN}</th>
                    <th className="num">Évol.</th>
                    <th className="num">Part</th>
                  </tr>
                </thead>
                <tbody>
                  {pf.top.map((c) => (
                    <tr key={c.tiers}>
                      <td>
                        <Link to={`/commercial/clients/${dossier}/${c.tiers}`}>
                          {c.nom || c.tiers}
                        </Link>
                      </td>
                      <td className="num">{fmtMontant(c.caN)}</td>
                      <td className="num">
                        <Evolution valeur={c.evolCA} />
                      </td>
                      <td className="num">{(c.partPct || 0).toFixed(1)} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Proformas à relancer */}
        <section className="co-card">
          <div className="co-card-head">
            <h2>
              <HiDocumentReport /> À relancer en priorité
            </h2>
            <Link
              className="co-btn"
              to={`/commercial/proformas?dossier=${dossier}&vue=relance`}
            >
              Gérer les relances
            </Link>
          </div>
          {apercus.aRelancer.length === 0 ? (
            <div className="co-empty">Rien à relancer, tout est à jour 👍</div>
          ) : (
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Client</th>
                    <th>Type</th>
                    <th className="num">Montant</th>
                    <th className="num">Ancienneté</th>
                  </tr>
                </thead>
                <tbody>
                  {apercus.aRelancer.map((p) => (
                    <tr key={p.numfact}>
                      <td>{p.numfact}</td>
                      <td>
                        <Link to={`/commercial/clients/${dossier}/${p.tiers}`}>
                          {p.nom || p.tiers}
                        </Link>
                      </td>
                      <td>
                        <ChipCategorie
                          categorie={p.categorie}
                          label={p.etatLabel}
                        />
                      </td>
                      <td className="num">{fmtMontant(p.montant)}</td>
                      <td className="num">{fmtNombre(p.joursAnciennete)} j</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Réservations récentes */}
        <section className="co-card">
          <div className="co-card-head">
            <h2>
              <HiBookmark /> Réservations en cours
            </h2>
            <Link
              className="co-btn"
              to={`/commercial/reservations?dossier=${dossier}`}
            >
              Voir tout
            </Link>
          </div>
          {apercus.reservations.length === 0 ? (
            <div className="co-empty">Aucune réservation en cours.</div>
          ) : (
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th className="num">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {apercus.reservations.map((p) => (
                    <tr key={p.numfact}>
                      <td>{p.numfact}</td>
                      <td>{fmtDate(p.date)}</td>
                      <td>
                        <Link to={`/commercial/clients/${dossier}/${p.tiers}`}>
                          {p.nom || p.tiers}
                        </Link>
                      </td>
                      <td className="num">{fmtMontant(p.montant)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Clients à recontacter */}
        <section className="co-card">
          <div className="co-card-head">
            <h2>
              <HiPhone /> Clients à recontacter
            </h2>
            <Link
              className="co-btn"
              to={`/commercial/clients?dossier=${dossier}&inactifs=1`}
            >
              Voir tout
            </Link>
          </div>
          {!pf ? (
            <div className="co-loading">
              {caEnCours ? "Analyse des derniers achats…" : "Indisponible."}
            </div>
          ) : pf.aContacter.length === 0 ? (
            <div className="co-empty">
              Tous vos clients ont commandé récemment.
            </div>
          ) : (
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Téléphone</th>
                    <th>Dernier achat</th>
                    <th className="num">CA</th>
                  </tr>
                </thead>
                <tbody>
                  {pf.aContacter.map((c) => (
                    <tr key={c.tiers}>
                      <td>
                        <Link to={`/commercial/clients/${dossier}/${c.tiers}`}>
                          {c.nom || c.tiers}
                        </Link>
                      </td>
                      <td>{c.telephone || "—"}</td>
                      <td>
                        {c.derniereVente
                          ? `${fmtDate(c.derniereVente)} (${fmtNombre(c.joursSansAchat)} j)`
                          : "jamais"}
                      </td>
                      <td className="num">{fmtMontant(c.caN)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <AlertesCard dossier={dossier} trigramme={bloc.entreprise.trigramme} />
    </>
  );
};

// ── Écran ────────────────────────────────────────────────────────────────────
const CommercialDashboardScreen = () => {
  const { societes, isLoading: chargeProfil } = useSocietesCommerciales();
  // null = toutes les sociétés du commercial.
  const [dossier, setDossier] = useState(null);

  // Deux requêtes : la première (documents) répond vite, la seconde (CA) peut
  // prendre plusieurs minutes à froid — on n'attend pas pour afficher la page.
  const { data, isFetching, isError, error, refetch } =
    useGetCommercialDashboardQuery(
      { dossier: dossier || undefined },
      { skip: chargeProfil },
    );
  const {
    data: caData,
    isFetching: caEnCours,
    refetch: refetchCa,
  } = useGetCommercialDashboardCaQuery(
    { dossier: dossier || undefined },
    { skip: chargeProfil },
  );

  const blocs = data?.societes || [];
  const totaux = data?.totaux;
  const caParDossier = new Map(
    (caData?.societes || [])
      .filter((b) => !b.erreur)
      .map((b) => [b.entreprise.nomDossierDBF, b]),
  );

  return (
    <CommercialShell
      titre="Mon tableau de bord commercial"
      sousTitre="Mon portefeuille, mes devis à relancer et mes commandes à suivre."
      icone={HiViewGrid}
      societes={societes}
      dossier={dossier}
      onDossier={setDossier}
      avecToutes
      actions={
        <button
          type="button"
          className="co-btn"
          // RTK Query lève « Cannot refetch a query that has not been started »
          // si la requête est encore en `skip` : on ne rafraîchit qu'une fois
          // le profil (et donc les sociétés) chargé.
          onClick={() => {
            if (chargeProfil) return;
            refetch();
            refetchCa();
          }}
          disabled={isFetching || chargeProfil}
        >
          <HiRefresh /> Actualiser
        </button>
      }
    >
      {isError && (
        <div className="co-error">
          {error?.data?.message || "Impossible de charger le tableau de bord."}
        </div>
      )}

      <div className="co-body">
        {isFetching && !data && (
          <div className="co-loading">Chargement de votre activité…</div>
        )}

        {/* Synthèse multi-sociétés */}
        {totaux && blocs.length > 1 && (
          <div className="co-kpis">
            <div className="co-kpi">
              <span className="co-kpi-label">
                <HiUserGroup /> Clients (toutes sociétés)
              </span>
              <span className="co-kpi-value">{fmtNombre(totaux.nbClients)}</span>
              <span className="co-kpi-sub">
                sur {fmtNombre(totaux.nbSocietes)} sociétés
              </span>
            </div>
            <div className="co-kpi">
              <span className="co-kpi-label">
                <HiCurrencyDollar /> CA cumulé
              </span>
              <span className="co-kpi-value">
                {caData ? fmtMontant(caData.totaux.caN) : "…"}
              </span>
              <span className="co-kpi-sub">
                {caData
                  ? `N-1 : ${fmtMontant(caData.totaux.caN1)}`
                  : caEnCours
                    ? "calcul en cours…"
                    : "indisponible"}
              </span>
            </div>
            <div className={`co-kpi ${totaux.aRelancer > 0 ? "alerte" : "ok"}`}>
              <span className="co-kpi-label">
                <HiDocumentReport /> À relancer
              </span>
              <span className="co-kpi-value">
                {fmtNombre(totaux.aRelancer)}
              </span>
              <span className="co-kpi-sub">documents en attente</span>
            </div>
            <div className="co-kpi">
              <span className="co-kpi-label">
                <HiBookmark /> Réservations
              </span>
              <span className="co-kpi-value">
                {fmtNombre(totaux.reservations)}
              </span>
              <span className="co-kpi-sub">
                {fmtNombre(totaux.speciales)} commandes spéciales
              </span>
            </div>
          </div>
        )}

        {blocs.map((bloc) => (
          <BlocSociete
            key={bloc.entreprise.nomDossierDBF}
            bloc={bloc}
            caBloc={caParDossier.get(bloc.entreprise.nomDossierDBF)}
            caEnCours={caEnCours}
          />
        ))}

        {!isFetching && blocs.length === 0 && (
          <div className="co-empty">
            Aucune société n'est rattachée à votre profil commercial.
          </div>
        )}
      </div>
    </CommercialShell>
  );
};

export default CommercialDashboardScreen;
