// src/components/commercial/CommercialDocumentsView.jsx
//
// Vue commune aux documents proforma.dbf de l'espace commercial :
// proformas / devis, réservations, commandes spéciales, à préparer.
// La catégorie vient de proforma.ETAT (0 = spéciale, 1 = réservation,
// 2 = à préparer, autre = devis) — même convention que l'écran Réservations
// existant, avec les libellés de la fiche société (mappingEtatsProforma).
//
// Permet aussi de RELANCER un ou plusieurs clients : la relance est enregistrée
// côté QC Tools (SuiviCommercial), l'ERP n'est jamais modifié.

import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  HiRefresh,
  HiChevronLeft,
  HiChevronRight,
  HiPhoneOutgoing,
  HiEye,
  HiX,
  HiCheckCircle,
} from "react-icons/hi";
import CommercialShell, {
  useSocietesCommerciales,
  fmtMontant,
  fmtNombre,
  fmtDate,
  ChipCategorie,
} from "./CommercialShell";
import {
  useGetCommercialProformasQuery,
  useGetCommercialProformaLignesQuery,
  useEnregistrerRelancesLotMutation,
  useSupprimerRelanceMutation,
} from "../../slices/commercialApiSlice";

const useDebounce = (value, delay = 400) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

// Lignes d'un document (chargées à la demande).
const LignesProforma = ({ dossier, numfact }) => {
  const { data, isFetching, isError } = useGetCommercialProformaLignesQuery({
    dossier,
    numfact,
  });
  if (isFetching) return <div className="co-loading">Chargement du détail…</div>;
  if (isError) return <div className="co-error">Détail indisponible.</div>;
  const lignes = data?.lignes || [];
  if (!lignes.length) return <div className="co-empty">Aucune ligne.</div>;
  return (
    <table className="co-table">
      <thead>
        <tr>
          <th>Article</th>
          <th>Désignation</th>
          <th className="num">Qté</th>
          <th className="num">P.U.</th>
          <th className="num">Total</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l, i) => (
          <tr key={`${l.nart}-${i}`}>
            <td>{l.commentaire ? "—" : l.nart}</td>
            <td>{l.design}</td>
            <td className="num">{l.commentaire ? "" : fmtNombre(l.qte)}</td>
            <td className="num">{l.commentaire ? "" : fmtMontant(l.pvte)}</td>
            <td className="num">{l.commentaire ? "" : fmtMontant(l.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/**
 * @param {string|null} categorie  catégorie figée de l'écran (null = toutes,
 *                                 avec onglets)
 * @param {boolean} vueRelanceParDefaut  démarre sur « à relancer »
 */
const CommercialDocumentsView = ({
  titre,
  sousTitre,
  icone,
  categorie = null,
  vueRelanceParDefaut = false,
}) => {
  const [params] = useSearchParams();
  const { societes, dossier, setDossier } = useSocietesCommerciales();

  const [vue, setVue] = useState(
    params.get("vue") === "relance" || vueRelanceParDefaut ? "relance" : "toutes",
  );
  const [search, setSearch] = useState("");
  // L'ERP ne purge pas les proformas : sans fenêtre, la liste « à relancer »
  // remonte jusqu'à 2019 et n'est plus actionnable.
  const [fenetreMois, setFenetreMois] = useState(12);
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState([]);
  const [detail, setDetail] = useState(null);
  const [canal, setCanal] = useState("telephone");
  const [note, setNote] = useState("");
  const recherche = useDebounce(search);

  useEffect(() => {
    const d = params.get("dossier");
    if (d) setDossier(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    setPage(1);
    setSelection([]);
  }, [dossier, recherche, vue, categorie, fenetreMois]);

  const { data, isFetching, isError, error, refetch } =
    useGetCommercialProformasQuery(
      {
        dossier,
        categorie: categorie || undefined,
        aRelancer: vue === "relance" ? "1" : undefined,
        search: recherche || undefined,
        fenetreMois,
        page,
        limit: 50,
      },
      { skip: !dossier },
    );

  const [relancerLot, { isLoading: relanceEnCours }] =
    useEnregistrerRelancesLotMutation();
  const [annulerRelance] = useSupprimerRelanceMutation();

  const docs = useMemo(() => data?.proformas || [], [data]);
  const tousSelectionnes =
    docs.length > 0 && selection.length === docs.length;

  const basculer = (numfact) =>
    setSelection((s) =>
      s.includes(numfact) ? s.filter((n) => n !== numfact) : [...s, numfact],
    );

  const validerRelances = async () => {
    if (!selection.length) return;
    await relancerLot({ dossier, numfacts: selection, canal, note }).unwrap();
    setSelection([]);
    setNote("");
  };

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
          {error?.data?.message || "Impossible de charger les documents."}
        </div>
      )}

      <div className="co-body">
        <section className="co-card">
          <div className="co-toolbar">
            <div className="co-tabs">
              <button
                type="button"
                className={`co-tab ${vue === "toutes" ? "active" : ""}`}
                onClick={() => setVue("toutes")}
              >
                Tous
              </button>
              <button
                type="button"
                className={`co-tab ${vue === "relance" ? "active" : ""}`}
                onClick={() => setVue("relance")}
              >
                <HiPhoneOutgoing /> À relancer
              </button>
            </div>
            <div className="co-field">
              <label htmlFor="co-doc-search">Rechercher</label>
              <input
                id="co-doc-search"
                type="text"
                placeholder="N° document, client, objet…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="co-field">
              <label htmlFor="co-doc-fen">Période</label>
              <select
                id="co-doc-fen"
                value={fenetreMois}
                onChange={(e) => setFenetreMois(Number(e.target.value))}
              >
                <option value={12}>12 derniers mois</option>
                <option value={6}>6 derniers mois</option>
                <option value={24}>24 derniers mois</option>
                <option value={0}>Tout l'historique</option>
              </select>
            </div>
            <div style={{ marginLeft: "auto" }} className="co-hint">
              {data && (
                <>
                  <strong>{fmtNombre(data.totalRecords)}</strong> documents ·{" "}
                  {fmtMontant(data.totalMontant)} F
                </>
              )}
            </div>
          </div>

          {selection.length > 0 && (
            <div className="co-select-bar">
              <strong>{selection.length} sélectionné(s)</strong>
              <div className="co-field">
                <label htmlFor="co-canal">Canal</label>
                <select
                  id="co-canal"
                  value={canal}
                  onChange={(e) => setCanal(e.target.value)}
                >
                  <option value="telephone">Téléphone</option>
                  <option value="email">Email</option>
                  <option value="visite">Visite</option>
                  <option value="sms">SMS</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
              <div className="co-field" style={{ flex: 1, minWidth: 200 }}>
                <label htmlFor="co-note">Note</label>
                <input
                  id="co-note"
                  type="text"
                  placeholder="Compte-rendu rapide (facultatif)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="co-btn co-btn-primary"
                onClick={validerRelances}
                disabled={relanceEnCours}
              >
                <HiCheckCircle /> Marquer comme relancé
              </button>
              <button
                type="button"
                className="co-btn"
                onClick={() => setSelection([])}
              >
                <HiX /> Annuler
              </button>
            </div>
          )}

          {isFetching && <div className="co-loading">Chargement…</div>}

          {!isFetching && docs.length === 0 && (
            <div className="co-empty">
              {vue === "relance"
                ? "Aucun document à relancer — tout est à jour 👍"
                : "Aucun document."}
            </div>
          )}

          {!isFetching && docs.length > 0 && (
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        checked={tousSelectionnes}
                        onChange={() =>
                          setSelection(
                            tousSelectionnes ? [] : docs.map((d) => d.numfact),
                          )
                        }
                        aria-label="Tout sélectionner"
                      />
                    </th>
                    <th>N°</th>
                    <th>Date</th>
                    <th>Client</th>
                    <th>Objet</th>
                    <th>Type</th>
                    <th className="num">Montant</th>
                    <th className="num">Ancienneté</th>
                    <th>Relance</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <React.Fragment key={d.numfact}>
                      <tr
                        className={
                          vue === "relance" && (d.joursAnciennete || 0) >= 60
                            ? "co-row-alerte"
                            : ""
                        }
                      >
                        <td>
                          <input
                            type="checkbox"
                            checked={selection.includes(d.numfact)}
                            onChange={() => basculer(d.numfact)}
                            aria-label={`Sélectionner ${d.numfact}`}
                          />
                        </td>
                        <td>{d.numfact}</td>
                        <td>{fmtDate(d.date)}</td>
                        <td>
                          {d.tiers ? (
                            <Link
                              to={`/commercial/clients/${dossier}/${d.tiers}`}
                            >
                              {d.nom || d.tiers}
                            </Link>
                          ) : (
                            d.nom || "—"
                          )}
                        </td>
                        <td>{d.texte || "—"}</td>
                        <td>
                          <ChipCategorie
                            categorie={d.categorie}
                            label={d.etatLabel}
                            labelErp={d.etatLabelErp}
                          />
                        </td>
                        <td className="num">{fmtMontant(d.montant)}</td>
                        <td className="num">
                          {fmtNombre(d.joursAnciennete)} j
                        </td>
                        <td>
                          {d.relanceLe ? (
                            <button
                              type="button"
                              className="co-chip co-chip-preparer"
                              onClick={() =>
                                annulerRelance({ dossier, numfact: d.numfact })
                              }
                              title="Annuler cette relance"
                              style={{ border: "none", cursor: "pointer" }}
                            >
                              relancé le {fmtDate(d.relanceLe)}
                            </button>
                          ) : (
                            <span className="co-chip co-chip-muted">—</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="co-btn"
                            onClick={() =>
                              setDetail(detail === d.numfact ? null : d.numfact)
                            }
                          >
                            <HiEye /> Détail
                          </button>
                        </td>
                      </tr>
                      {detail === d.numfact && (
                        <tr>
                          <td colSpan={10} style={{ padding: 0 }}>
                            <LignesProforma
                              dossier={dossier}
                              numfact={d.numfact}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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

export default CommercialDocumentsView;
