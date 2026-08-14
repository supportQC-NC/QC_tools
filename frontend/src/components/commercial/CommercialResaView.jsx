// src/components/commercial/CommercialResaView.jsx
//
// RÉSERVATIONS & COMMANDES SPÉCIALES du commercial.
//
// Source : facture.dbf TYPFACT="R" (ETAT 1 = réservation, 2 = commande
// spéciale, libellés de entreprise.mappingEtatsReservation) — et NON
// proforma.dbf, qui ne porte pas les commandes spéciales. C'est la même source
// que l'écran « Entrées sur réservation » et que les alertes de cet espace.
//
// L'ERP ne purge jamais : la vue est bornée à une fenêtre glissante (12 mois par
// défaut), avec un basculement explicite vers tout l'historique.

import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  HiRefresh,
  HiChevronLeft,
  HiChevronRight,
  HiBell,
} from "react-icons/hi";
import CommercialShell, {
  useSocietesCommerciales,
  fmtMontant,
  fmtNombre,
  fmtDate,
  ChipCategorie,
} from "./CommercialShell";
import { useGetCommercialReservationsQuery } from "../../slices/commercialApiSlice";

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

const CommercialResaView = ({ titre, sousTitre, icone, categorie }) => {
  const [params] = useSearchParams();
  const { societes, dossier, setDossier } = useSocietesCommerciales();

  const [search, setSearch] = useState("");
  const [fenetreMois, setFenetreMois] = useState(12);
  const [page, setPage] = useState(1);
  const recherche = useDebounce(search);

  useEffect(() => {
    const d = params.get("dossier");
    if (d) setDossier(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => setPage(1), [dossier, recherche, fenetreMois, categorie]);

  const { data, isFetching, isError, error, refetch } =
    useGetCommercialReservationsQuery(
      {
        dossier,
        categorie,
        search: recherche || undefined,
        fenetreMois,
        page,
        limit: 50,
      },
      { skip: !dossier },
    );

  const rows = data?.reservations || [];

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
        <section className="co-card">
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
            <Link className="co-btn" to="/commercial/alertes">
              <HiBell /> Voir ce qui est arrivé en stock
            </Link>
            <div style={{ marginLeft: "auto" }} className="co-hint">
              {data && (
                <>
                  <strong>{fmtNombre(data.totalRecords)}</strong> documents ·{" "}
                  {fmtMontant(data.totalMontant)} F
                </>
              )}
            </div>
          </div>

          {isFetching && <div className="co-loading">Chargement…</div>}

          {!isFetching && rows.length === 0 && (
            <div className="co-empty">
              Aucun document sur la période sélectionnée.
              {fenetreMois > 0 && " Essayez « Tout l'historique »."}
            </div>
          )}

          {!isFetching && rows.length > 0 && (
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Objet</th>
                    <th>État</th>
                    <th className="num">Montant</th>
                    <th className="num">Ancienneté</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.numfact}>
                      <td>{r.numfact}</td>
                      <td>{fmtDate(r.date)}</td>
                      <td>
                        {r.tiers ? (
                          <Link to={`/commercial/clients/${dossier}/${r.tiers}`}>
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
                      <td className="num">{fmtNombre(r.joursAnciennete)} j</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data && data.totalPages > 1 && (
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
