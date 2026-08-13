// src/screens/commercial/CommercialFacturesScreen.jsx
//
// MES FACTURES — facture.REPRES = mon code vendeur sur la société sélectionnée.
// Avoirs comptés en négatif (comme partout dans QC Tools).

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  HiCurrencyDollar,
  HiRefresh,
  HiChevronLeft,
  HiChevronRight,
} from "react-icons/hi";
import CommercialShell, {
  useSocietesCommerciales,
  fmtMontant,
  fmtNombre,
  fmtDate,
} from "../../components/commercial/CommercialShell";
import { useGetCommercialFacturesQuery } from "../../slices/commercialApiSlice";
import "./CommercialSpace.css";

const useDebounce = (value, delay = 400) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

const TYPES = [
  { key: "FA", label: "Factures + avoirs" },
  { key: "F", label: "Factures seules" },
  { key: "A", label: "Avoirs seuls" },
];

const CommercialFacturesScreen = () => {
  const { societes, dossier, setDossier } = useSocietesCommerciales();
  const [search, setSearch] = useState("");
  const [typfact, setTypfact] = useState("FA");
  const [dateDebut, setDateDebut] = useState("");
  const [dateFin, setDateFin] = useState("");
  const [page, setPage] = useState(1);
  const recherche = useDebounce(search);

  useEffect(() => setPage(1), [dossier, recherche, typfact, dateDebut, dateFin]);

  const { data, isFetching, isError, error, refetch } =
    useGetCommercialFacturesQuery(
      {
        dossier,
        search: recherche || undefined,
        typfact,
        dateDebut: dateDebut || undefined,
        dateFin: dateFin || undefined,
        page,
        limit: 50,
      },
      { skip: !dossier },
    );

  const factures = data?.factures || [];

  return (
    <CommercialShell
      titre="Mes factures"
      sousTitre="Les factures réalisées sous mon code vendeur (facture.REPRES)."
      icone={HiCurrencyDollar}
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
          {error?.data?.message || "Impossible de charger les factures."}
        </div>
      )}

      <div className="co-body">
        <section className="co-card">
          <div className="co-toolbar">
            <div className="co-field">
              <label htmlFor="co-f-search">Rechercher</label>
              <input
                id="co-f-search"
                type="text"
                placeholder="N° facture, client, objet…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="co-field">
              <label htmlFor="co-f-type">Type</label>
              <select
                id="co-f-type"
                value={typfact}
                onChange={(e) => setTypfact(e.target.value)}
              >
                {TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="co-field">
              <label htmlFor="co-f-deb">Du</label>
              <input
                id="co-f-deb"
                type="date"
                value={dateDebut}
                onChange={(e) => setDateDebut(e.target.value)}
              />
            </div>
            <div className="co-field">
              <label htmlFor="co-f-fin">Au</label>
              <input
                id="co-f-fin"
                type="date"
                value={dateFin}
                onChange={(e) => setDateFin(e.target.value)}
              />
            </div>
            <div style={{ marginLeft: "auto" }} className="co-hint">
              {data && (
                <>
                  <strong>{fmtNombre(data.totalRecords)}</strong> factures ·{" "}
                  {fmtMontant(data.totalMontant)} F
                </>
              )}
            </div>
          </div>

          {isFetching && <div className="co-loading">Chargement…</div>}

          {!isFetching && factures.length === 0 && (
            <div className="co-empty">Aucune facture sur ce périmètre.</div>
          )}

          {!isFetching && factures.length > 0 && (
            <div className="co-table-wrap">
              <table className="co-table">
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Client</th>
                    <th>Objet</th>
                    <th className="num">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {factures.map((f) => (
                    <tr key={`${f.numfact}-${f.date}`}>
                      <td>{f.numfact}</td>
                      <td>{fmtDate(f.date)}</td>
                      <td>
                        <span
                          className={`co-chip ${
                            f.typfact === "A"
                              ? "co-chip-danger"
                              : "co-chip-preparer"
                          }`}
                        >
                          {f.typfact === "A" ? "Avoir" : "Facture"}
                        </span>
                      </td>
                      <td>
                        {f.tiers ? (
                          <Link to={`/commercial/clients/${dossier}/${f.tiers}`}>
                            {f.nom || f.tiers}
                          </Link>
                        ) : (
                          f.nom || "—"
                        )}
                      </td>
                      <td>{f.texte || "—"}</td>
                      <td className="num">{fmtMontant(f.montant)}</td>
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

export default CommercialFacturesScreen;
