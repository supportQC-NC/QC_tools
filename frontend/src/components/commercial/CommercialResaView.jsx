// src/components/commercial/CommercialResaView.jsx
//
// RÉSERVATIONS & COMMANDES SPÉCIALES du commercial — repris de l'écran
// « Données ▸ Réservations » (onglets par type, filtres, badges d'état,
// pagination), mais restreint au portefeuille du commercial connecté et
// enrichi de ce qui manquait : SAVOIR CE QUI EST ARRIVÉ EN STOCK.
//
// Source : facture.dbf TYPFACT="R" (ETAT 1 = réservation, 2 = commande
// spéciale, libellés de entreprise.mappingEtatsReservation) — et NON
// proforma.dbf, qui ne porte pas les commandes spéciales. C'est la même source
// que l'écran « Entrées sur réservation » et que les alertes de cet espace.
//
// L'ERP ne purge jamais : la vue est bornée à une fenêtre glissante (12 mois par
// défaut), avec un basculement explicite vers tout l'historique.
//
// ⚠️ DEUX REQUÊTES, VOLONTAIREMENT :
//   1. la LISTE (index des entêtes, rapide) s'affiche tout de suite ;
//   2. la DISPONIBILITÉ (croisement detail.dbf × entrees.dbf, lent à froid)
//      arrive après et remplit la colonne « Stock ».
// Ne pas les fusionner : la page redeviendrait inutilisable à froid.

import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  HiRefresh,
  HiChevronLeft,
  HiChevronRight,
  HiChevronDown,
  HiBell,
  HiCheckCircle,
  HiClock,
  HiPhone,
  HiQuestionMarkCircle,
} from "react-icons/hi";
import CommercialShell, {
  useSocietesCommerciales,
  fmtMontant,
  fmtNombre,
  fmtDate,
  ChipCategorie,
} from "./CommercialShell";
import {
  useGetCommercialReservationsQuery,
  useGetCommercialReservationsDisponibilitesQuery,
  useGetCommercialReservationLignesQuery,
  useMarquerClientPrevenuMutation,
  useAnnulerClientPrevenuMutation,
} from "../../slices/commercialApiSlice";

const useDebounce = (value, delay = 400) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

const FENETRES = [
  { key: 12, label: "12 derniers mois" },
  { key: 6, label: "6 derniers mois" },
  { key: 24, label: "24 derniers mois" },
  { key: 0, label: "Tout l'historique" },
];

// Onglets de type, comme l'écran Données ▸ Réservations.
const ONGLETS = [
  { key: "", label: "Toutes" },
  { key: "reservation", label: "Réservations" },
  { key: "speciale", label: "Commandes spéciales" },
];

const CANAUX = ["Téléphone", "SMS", "Email", "Visite", "Autre"];

// Habillage de la colonne « Stock ».
const STATUTS = {
  complet: { label: "Arrivé en stock", chip: "preparer", Icone: HiCheckCircle },
  partiel: { label: "Partiellement arrivé", chip: "speciale", Icone: HiClock },
  attente: { label: "En attente", chip: "muted", Icone: HiClock },
  inconnu: {
    label: "Non vérifiable",
    chip: "muted",
    Icone: HiQuestionMarkCircle,
  },
};

const fmtDateHeure = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR");
};

// ── Détail d'une réservation : lignes + disponibilité + « prévenir » ─────────
const DetailReservation = ({ dossier, resa, dispo }) => {
  const { data, isFetching, isError, error } =
    useGetCommercialReservationLignesQuery(
      { dossier, numfact: resa.numfact },
      { skip: !dossier || !resa.numfact },
    );
  const [marquer, { isLoading: enregistrement }] =
    useMarquerClientPrevenuMutation();
  const [annuler, { isLoading: annulation }] = useAnnulerClientPrevenuMutation();

  const [canal, setCanal] = useState(CANAUX[0]);
  const [note, setNote] = useState("");

  const lignes = data?.lignes || [];
  const arrive = dispo?.statut === "complet" || dispo?.statut === "partiel";

  const valider = async () => {
    await marquer({
      dossier,
      numfact: resa.numfact,
      canal,
      note,
      tiers: resa.tiers,
      nomClient: resa.nom,
    }).unwrap();
    setNote("");
  };

  return (
    <div className="co-resa-detail">
      {isError && (
        <div className="co-error">
          {error?.data?.message || "Impossible de charger le détail."}
        </div>
      )}
      {isFetching && <div className="co-loading">Chargement du détail…</div>}

      {!isFetching && lignes.length > 0 && (
        <table className="co-table co-table-sub">
          <thead>
            <tr>
              <th>Article</th>
              <th>Désignation</th>
              <th className="num">Qté réservée</th>
              <th className="num">Stock actuel</th>
              <th>Entrée en stock</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={`${l.nart}-${l.qteResa}`}>
                <td>
                  <strong>{l.nart}</strong>
                </td>
                <td>{l.design || "—"}</td>
                <td className="num">{fmtNombre(l.qteResa)}</td>
                <td className="num">{fmtNombre(l.stockTotal)}</td>
                <td>
                  {l.arrive ? (
                    <span className="co-chip co-chip-preparer">
                      <HiCheckCircle /> {fmtDate(l.dateEntree)} ·{" "}
                      {fmtNombre(l.qteEntree)} reçu(s)
                    </span>
                  ) : (
                    <span className="co-chip co-chip-muted">Pas d'entrée</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!isFetching && !isError && lignes.length === 0 && (
        <div className="co-empty">Aucune ligne d'article sur ce document.</div>
      )}

      <div className="co-prevenir">
        {resa.prevenuLe ? (
          <>
            <span className="co-chip co-chip-preparer">
              <HiPhone /> Client prévenu le {fmtDateHeure(resa.prevenuLe)}
              {resa.prevenuCanal ? ` · ${resa.prevenuCanal}` : ""}
            </span>
            {resa.prevenuNote && (
              <span className="co-hint">« {resa.prevenuNote} »</span>
            )}
            <button
              type="button"
              className="co-btn"
              disabled={annulation}
              onClick={() => annuler({ dossier, numfact: resa.numfact })}
            >
              Annuler
            </button>
          </>
        ) : (
          <>
            <span className="co-hint">
              {arrive
                ? "Marchandise arrivée : prévenez le client, puis enregistrez-le ici."
                : "Rien n'est encore arrivé — vous pouvez tout de même noter un appel."}
            </span>
            <select value={canal} onChange={(e) => setCanal(e.target.value)}>
              {CANAUX.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Note (facultatif)…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              type="button"
              className="co-btn co-btn-primary"
              disabled={enregistrement}
              onClick={valider}
            >
              <HiCheckCircle /> Client prévenu
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const CommercialResaView = ({ titre, sousTitre, icone, categorie }) => {
  const [params] = useSearchParams();
  const { societes, dossier, setDossier } = useSocietesCommerciales();

  const [onglet, setOnglet] = useState(categorie || "");
  const [search, setSearch] = useState("");
  const [fenetreMois, setFenetreMois] = useState(12);
  const [stockFiltre, setStockFiltre] = useState("tous"); // tous | arrives | aPrevenir
  const [page, setPage] = useState(1);
  const [ouvert, setOuvert] = useState(null); // numfact déplié
  const recherche = useDebounce(search);

  useEffect(() => {
    const d = params.get("dossier");
    if (d) setDossier(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // L'écran est monté par deux routes (Réservations / Cdes spéciales) : quand
  // on passe de l'une à l'autre, l'onglet suit la route.
  useEffect(() => setOnglet(categorie || ""), [categorie]);

  useEffect(() => {
    setPage(1);
    setOuvert(null);
  }, [dossier, recherche, fenetreMois, onglet, stockFiltre]);

  const { data, isFetching, isError, error, refetch } =
    useGetCommercialReservationsQuery(
      {
        dossier,
        categorie: onglet || undefined,
        search: recherche || undefined,
        fenetreMois,
        page,
        // Le filtre « stock » s'applique côté client sur la page courante :
        // on charge donc plus large quand il est actif, pour ne pas afficher
        // une page presque vide.
        limit: stockFiltre === "tous" ? 50 : 500,
      },
      { skip: !dossier },
    );

  // Disponibilité : requête séparée, volontairement non bloquante.
  const {
    data: dispoData,
    isFetching: dispoEnCours,
    isError: dispoErreur,
  } = useGetCommercialReservationsDisponibilitesQuery(
    { dossier, fenetreMois },
    { skip: !dossier },
  );

  const dispoParDoc = useMemo(
    () => dispoData?.documents || {},
    [dispoData],
  );

  const rows = useMemo(() => {
    const liste = data?.reservations || [];
    if (stockFiltre === "tous") return liste;
    return liste.filter((r) => {
      const d = dispoParDoc[r.numfact];
      if (!d) return false;
      if (stockFiltre === "arrives") {
        return d.statut === "complet" || d.statut === "partiel";
      }
      return d.aPrevenir;
    });
  }, [data, dispoParDoc, stockFiltre]);

  const nbArrives =
    (dispoData?.nbComplets || 0) + (dispoData?.nbPartiels || 0);

  return (
    <CommercialShell
      titre={titre}
      sousTitre={sousTitre}
      icone={icone}
      societes={societes}
      dossier={dossier}
      onDossier={setDossier}
      actions={
        <button
          type="button"
          className="co-btn"
          onClick={() => dossier && refetch()}
          disabled={isFetching || !dossier}
        >
          <HiRefresh /> Actualiser
        </button>
      }
    >
      {isError && (
        <div className="co-error">
          {error?.data?.message || "Impossible de charger les réservations."}
        </div>
      )}

      <div className="co-body">
        <div className="co-kpis">
          <div className="co-kpi">
            <span className="co-kpi-label">Documents</span>
            <span className="co-kpi-value">
              {fmtNombre(data?.totalRecords || 0)}
            </span>
            <span className="co-kpi-sub">
              {fmtMontant(data?.totalMontant || 0)} F
            </span>
          </div>
          <div className="co-kpi">
            <span className="co-kpi-label">
              <HiCheckCircle /> Arrivés en stock
            </span>
            <span className="co-kpi-value">
              {dispoData ? fmtNombre(nbArrives) : "…"}
            </span>
            <span className="co-kpi-sub">
              dont {dispoData ? fmtNombre(dispoData.nbPartiels) : "…"} partiels
            </span>
          </div>
          <button
            type="button"
            className={`co-kpi ${dispoData?.nbAPrevenir ? "alerte" : "ok"}`}
            onClick={() =>
              setStockFiltre((v) => (v === "aPrevenir" ? "tous" : "aPrevenir"))
            }
            title="N'afficher que les clients à prévenir"
          >
            <span className="co-kpi-label">
              <HiBell /> Clients à prévenir
            </span>
            <span className="co-kpi-value">
              {dispoData ? fmtNombre(dispoData.nbAPrevenir) : "…"}
            </span>
            <span className="co-kpi-sub">réservation arrivée, non annoncée</span>
          </button>
        </div>

        <section className="co-card">
          <div className="co-tabs co-tabs-inline">
            {ONGLETS.map((o) => (
              <button
                key={o.key || "toutes"}
                type="button"
                className={`co-tab ${onglet === o.key ? "active" : ""}`}
                onClick={() => setOnglet(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="co-toolbar">
            <div className="co-field">
              <label htmlFor="co-r-search">Rechercher</label>
              <input
                id="co-r-search"
                type="text"
                placeholder="N° document, client, objet…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="co-field">
              <label htmlFor="co-r-fen">Période</label>
              <select
                id="co-r-fen"
                value={fenetreMois}
                onChange={(e) => setFenetreMois(Number(e.target.value))}
              >
                {FENETRES.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="co-field">
              <label htmlFor="co-r-stock">Entrée en stock</label>
              <select
                id="co-r-stock"
                value={stockFiltre}
                onChange={(e) => setStockFiltre(e.target.value)}
              >
                <option value="tous">Toutes</option>
                <option value="arrives">Arrivées en stock</option>
                <option value="aPrevenir">À prévenir</option>
              </select>
            </div>
            <Link className="co-btn" to="/commercial/alertes">
              <HiBell /> Détail des entrées en stock
            </Link>
            <div style={{ marginLeft: "auto" }} className="co-hint">
              {dispoEnCours && "Recherche des entrées en stock…"}
              {!dispoEnCours &&
                dispoErreur &&
                "Entrées en stock indisponibles pour le moment."}
            </div>
          </div>

          {isFetching && <div className="co-loading">Chargement…</div>}

          {!isFetching && rows.length === 0 && (
            <div className="co-empty">
              {stockFiltre !== "tous"
                ? "Aucune réservation ne correspond à ce filtre d'entrée en stock."
                : "Aucun document sur la période sélectionnée."}
              {stockFiltre === "tous" &&
                fenetreMois > 0 &&
                " Essayez « Tout l'historique »."}
            </div>
          )}

          {!isFetching && rows.length > 0 && (
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th />
                    <th>N°</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Objet</th>
                    <th>État</th>
                    <th className="num">Montant</th>
                    <th className="num">Ancienneté</th>
                    <th>Stock</th>
                    <th>Client prévenu</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const d = dispoParDoc[r.numfact];
                    const st = STATUTS[d?.statut] || STATUTS.inconnu;
                    const deplie = ouvert === r.numfact;
                    return (
                      <React.Fragment key={r.numfact}>
                        <tr className={d?.aPrevenir ? "co-row-alerte" : ""}>
                          <td>
                            <button
                              type="button"
                              className="co-btn-icone"
                              title={deplie ? "Replier" : "Voir les articles"}
                              onClick={() =>
                                setOuvert(deplie ? null : r.numfact)
                              }
                            >
                              {deplie ? <HiChevronDown /> : <HiChevronRight />}
                            </button>
                          </td>
                          <td>{r.numfact}</td>
                          <td>{fmtDate(r.date)}</td>
                          <td>
                            {r.tiers ? (
                              <Link
                                to={`/commercial/clients/${dossier}/${r.tiers}`}
                              >
                                {r.nom || r.tiers}
                              </Link>
                            ) : (
                              r.nom || "—"
                            )}
                          </td>
                          <td>{r.texte || "—"}</td>
                          <td>
                            <ChipCategorie
                              categorie={r.categorie}
                              label={r.etatLabel}
                            />
                          </td>
                          <td className="num">{fmtMontant(r.montant)}</td>
                          <td className="num">
                            {fmtNombre(r.joursAnciennete)} j
                          </td>
                          <td>
                            {!d ? (
                              <span className="co-hint">
                                {dispoEnCours ? "…" : "—"}
                              </span>
                            ) : (
                              <span
                                className={`co-chip co-chip-${st.chip}`}
                                title={
                                  d.dateArrivee
                                    ? `Dernière entrée le ${fmtDate(d.dateArrivee)} · ${d.nbArrivees}/${d.nbLignes} article(s)`
                                    : `${d.nbLignes} article(s) réservé(s)`
                                }
                              >
                                <st.Icone /> {st.label}
                                {d.statut === "partiel"
                                  ? ` (${d.nbArrivees}/${d.nbLignes})`
                                  : ""}
                              </span>
                            )}
                          </td>
                          <td>
                            {r.prevenuLe ? (
                              <span className="co-chip co-chip-preparer">
                                <HiPhone /> {fmtDateHeure(r.prevenuLe)}
                              </span>
                            ) : d?.aPrevenir ? (
                              <button
                                type="button"
                                className="co-btn co-btn-primary"
                                onClick={() => setOuvert(r.numfact)}
                              >
                                <HiBell /> À prévenir
                              </button>
                            ) : (
                              <span className="co-hint">—</span>
                            )}
                          </td>
                        </tr>
                        {deplie && (
                          <tr className="co-row-detail">
                            <td colSpan={10}>
                              <DetailReservation
                                dossier={dossier}
                                resa={r}
                                dispo={d}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Le filtre stock travaille sur un lot de 500 documents : on le dit
              plutôt que de laisser croire à une liste exhaustive. */}
          {stockFiltre !== "tous" && data && data.totalRecords > 500 && (
            <div className="co-hint co-hint-bloc">
              Filtre appliqué aux 500 documents les plus récents (sur{" "}
              {fmtNombre(data.totalRecords)}). Réduisez la période pour couvrir
              l'ensemble.
            </div>
          )}

          {stockFiltre === "tous" && data && data.totalPages > 1 && (
            <div className="co-pagination">
              <button
                type="button"
                className="co-btn"
                disabled={!data.hasPrevPage}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <HiChevronLeft /> Précédent
              </button>
              <span>
                Page {data.page} / {data.totalPages}
              </span>
              <button
                type="button"
                className="co-btn"
                disabled={!data.hasNextPage}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant <HiChevronRight />
              </button>
            </div>
          )}
        </section>
      </div>
    </CommercialShell>
  );
};

export default CommercialResaView;
