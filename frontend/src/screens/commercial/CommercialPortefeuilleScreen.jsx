// src/screens/commercial/CommercialPortefeuilleScreen.jsx
//
// PORTEFEUILLE CLIENTS du commercial : clients.REPRES = son code vendeur SUR LA
// SOCIÉTÉ sélectionnée. Enrichi CRM (CA N/N-1, dernier achat) pour repérer d'un
// coup d'œil les clients à recontacter.

import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  HiUserGroup,
  HiSearch,
  HiRefresh,
  HiChevronLeft,
  HiChevronRight,
  HiPhone,
} from "react-icons/hi";
import CommercialShell, {
  useSocietesCommerciales,
  fmtMontant,
  fmtNombre,
  fmtDate,
  Evolution,
} from "../../components/commercial/CommercialShell";
import { useGetCommercialClientsQuery } from "../../slices/commercialApiSlice";
import "./CommercialSpace.css";

const useDebounce = (value, delay = 400) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

const TRIS = [
  { key: "ca", label: "CA décroissant" },
  { key: "nom", label: "Nom (A→Z)" },
  { key: "recent", label: "Achat le plus récent" },
  { key: "ancien", label: "Sans achat depuis longtemps" },
];

const CommercialPortefeuilleScreen = () => {
  const [params] = useSearchParams();
  const { societes, dossier, setDossier } = useSocietesCommerciales();

  const [search, setSearch] = useState("");
  const [tri, setTri] = useState("ca");
  const [inactifs, setInactifs] = useState(params.get("inactifs") === "1");
  const [page, setPage] = useState(1);
  const recherche = useDebounce(search);

  // Société passée en paramètre (liens du dashboard).
  useEffect(() => {
    const d = params.get("dossier");
    if (d) setDossier(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => setPage(1), [dossier, recherche, tri, inactifs]);

  const { data, isFetching, isError, error, refetch } =
    useGetCommercialClientsQuery(
      {
        dossier,
        search: recherche || undefined,
        tri,
        inactifs: inactifs ? "1" : undefined,
        page,
        limit: 50,
      },
      { skip: !dossier },
    );

  const clients = data?.clients || [];

  return (
    <CommercialShell
      titre="Mon portefeuille clients"
      sousTitre="Les clients dont je suis le représentant attitré (clients.REPRES)."
      icone={HiUserGroup}
      societes={societes}
      dossier={dossier}
      onDossier={setDossier}
      actions={
        <button
          type="button"
          className="co-btn"
          // Requête en `skip` tant qu'aucune société n'est déterminée :
          // refetch() lèverait « query has not been started yet ».
          onClick={() => dossier && refetch()}
          disabled={isFetching || !dossier}
        >
          <HiRefresh /> Actualiser
        </button>
      }
    >
      {isError && (
        <div className="co-error">
          {error?.data?.message || "Impossible de charger le portefeuille."}
        </div>
      )}

      <div className="co-body">
        <section className="co-card">
          <div className="co-toolbar">
            <div className="co-field">
              <label htmlFor="co-search">Rechercher</label>
              <input
                id="co-search"
                type="text"
                placeholder="Nom, code client, ville…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="co-field">
              <label htmlFor="co-tri">Trier par</label>
              <select
                id="co-tri"
                value={tri}
                onChange={(e) => setTri(e.target.value)}
              >
                {TRIS.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className={`co-tab ${inactifs ? "active" : ""}`}
              onClick={() => setInactifs((v) => !v)}
              title="Clients sans achat depuis 90 jours"
            >
              <HiPhone /> À recontacter uniquement
            </button>
            <div style={{ marginLeft: "auto" }} className="co-hint">
              {data ? (
                <>
                  <strong>{fmtNombre(data.totalRecords)}</strong> clients ·{" "}
                  {fmtMontant(data.totalCaN)} F de CA
                </>
              ) : (
                <HiSearch />
              )}
            </div>
          </div>

          {isFetching && <div className="co-loading">Chargement…</div>}

          {!isFetching && clients.length === 0 && (
            <div className="co-empty">Aucun client ne correspond.</div>
          )}

          {!isFetching && clients.length > 0 && (
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Client</th>
                    <th>Ville</th>
                    <th>Téléphone</th>
                    <th className="num">CA année</th>
                    <th className="num">Évol.</th>
                    <th className="num">Factures</th>
                    <th>Dernier achat</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr
                      key={c.tiers}
                      className={
                        c.joursSansAchat === null || c.joursSansAchat >= 90
                          ? "co-row-alerte"
                          : ""
                      }
                    >
                      <td>{c.tiers}</td>
                      <td>
                        <Link to={`/commercial/clients/${dossier}/${c.tiers}`}>
                          {c.nom || "—"}
                        </Link>
                      </td>
                      <td>{c.ville || "—"}</td>
                      <td>{c.telephone || "—"}</td>
                      <td className="num">{fmtMontant(c.caN)}</td>
                      <td className="num">
                        <Evolution valeur={c.evolCA} />
                      </td>
                      <td className="num">{fmtNombre(c.nbFacture)}</td>
                      <td>
                        {c.derniereVente
                          ? `${fmtDate(c.derniereVente)} · ${fmtNombre(c.joursSansAchat)} j`
                          : "jamais"}
                      </td>
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

export default CommercialPortefeuilleScreen;
