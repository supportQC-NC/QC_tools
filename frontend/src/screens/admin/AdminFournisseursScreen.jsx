// src/screens/admin/AdminFournisseursScreen.jsx
import React, { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  HiOfficeBuilding,
  HiSearch,
  HiRefresh,
  HiChevronLeft,
  HiChevronRight,
  HiExternalLink,
  HiExclamation,
  HiX,
  HiPhone,
  HiLocationMarker,
  HiTruck,
} from "react-icons/hi";
import { useGetFournisseursQuery } from "../../slices/fournissApiSlice";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import "./AdminFournisseursScreen.css";

const LIMIT = 50;

const useDebounce = (value, delay) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
};

const safeTrim = (value) => {
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

const AdminFournisseursScreen = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Société active : param d'URL si présent, sinon sélection GLOBALE (en-tête).
  const { nomDossierDBF: dossierParam } = useParams();
  const dossierGlobal = useSelector(selectGlobalDossier) || "";
  const selectedEntreprise = dossierParam || dossierGlobal;

  const [page, setPage] = useState(parseInt(searchParams.get("page")) || 1);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounce(search, 400);

  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useGetFournisseursQuery(
    {
      nomDossierDBF: selectedEntreprise,
      page,
      limit: LIMIT,
      search: debouncedSearch || undefined,
    },
    { skip: !selectedEntreprise },
  );

  // Réinitialise recherche + pagination quand la société change.
  useEffect(() => {
    setSearch("");
    setPage(1);
  }, [selectedEntreprise]);

  // Revient page 1 dès que la recherche change.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  // Synchronise l'URL (partage / retour arrière).
  useEffect(() => {
    const params = new URLSearchParams();
    if (page > 1) params.set("page", String(page));
    if (search) params.set("search", search);
    setSearchParams(params, { replace: true });
  }, [page, search, setSearchParams]);

  const fournisseurs = useMemo(() => data?.fournisseurs || [], [data]);
  const pagination = data?.pagination;

  // Adresse condensée : AD1..AD5 non vides, séparées par « · ».
  const formatAdresse = (f) =>
    [f.AD1, f.AD2, f.AD3, f.AD4, f.AD5]
      .map(safeTrim)
      .filter(Boolean)
      .join(" · ");

  const goToDetail = (fourn) =>
    navigate(`/admin/fournisseurs/${selectedEntreprise}/${fourn}`);

  return (
    <div className="admin-fourn-page">
      <header className="admin-fourn-header">
        <div className="header-left">
          <div className="header-icon fourn-icon">
            <HiTruck />
          </div>
          <div className="header-title">
            <h1>Fournisseurs</h1>
            <p className="header-subtitle">
              Consultation des fiches fournisseurs
              {selectedEntreprise ? ` — ${selectedEntreprise}` : ""}
            </p>
          </div>
        </div>
      </header>

      {!selectedEntreprise ? (
        <div className="fourn-empty-state">
          <div className="empty-icon">
            <HiOfficeBuilding />
          </div>
          <h2>Sélectionnez une entreprise</h2>
          <p>
            Choisissez une entreprise dans l'en-tête pour consulter ses
            fournisseurs.
          </p>
        </div>
      ) : (
        <div className="admin-fourn-content">
          <div className="fourn-toolbar">
            <div className="fourn-search">
              <HiSearch />
              <input
                type="text"
                placeholder="Rechercher : nom, code, adresse, téléphone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
              {search && (
                <button
                  type="button"
                  className="btn-clear-search"
                  onClick={() => setSearch("")}
                  title="Effacer"
                >
                  <HiX />
                </button>
              )}
            </div>

            <div className="fourn-stats">
              <div className="stat-item primary">
                <span className="stat-value">
                  {(pagination?.totalRecords || 0).toLocaleString("fr-FR")}
                </span>
                <span className="stat-label">
                  {debouncedSearch ? "Résultats" : "Fournisseurs"}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-value">
                  {pagination?.page || 1}/{pagination?.totalPages || 1}
                </span>
                <span className="stat-label">Page</span>
              </div>
              {data?._queryTime && (
                <div className="stat-item">
                  <span className="stat-value">{data._queryTime}</span>
                  <span className="stat-label">Temps</span>
                </div>
              )}
              <button
                className="btn-icon-action"
                onClick={refetch}
                disabled={isFetching}
                title="Rafraîchir"
              >
                <HiRefresh className={isFetching ? "spinning" : ""} />
              </button>
            </div>
          </div>

          <div className="fourn-table-container">
            {isLoading || isFetching ? (
              <div className="table-loading">
                <div className="loading-spinner"></div>
                <p>Chargement des fournisseurs…</p>
              </div>
            ) : error ? (
              <div className="table-error">
                <HiExclamation />
                <p>
                  Erreur :{" "}
                  {error?.data?.message ||
                    "impossible de charger les fournisseurs"}
                </p>
                <button onClick={refetch}>Réessayer</button>
              </div>
            ) : fournisseurs.length === 0 ? (
              <div className="table-empty">
                <HiTruck />
                <h3>Aucun fournisseur trouvé</h3>
                <p>
                  {debouncedSearch
                    ? "Modifiez votre recherche."
                    : "Ce dossier ne contient aucun fournisseur."}
                </p>
              </div>
            ) : (
              <table className="fourn-table">
                <thead>
                  <tr>
                    <th className="col-code">Code</th>
                    <th className="col-nom">Nom</th>
                    <th className="col-adresse">Adresse</th>
                    <th className="col-tel">Téléphone</th>
                    <th className="col-fax">Fax</th>
                    <th className="col-delai">Délai appro.</th>
                    <th className="col-local">Local</th>
                    <th className="col-actions">Fiche</th>
                  </tr>
                </thead>
                <tbody>
                  {fournisseurs.map((f) => {
                    const adresse = formatAdresse(f);
                    const isLocal = safeTrim(f.LOCAL).toUpperCase() === "O";
                    return (
                      <tr
                        key={f.FOURN}
                        className="fourn-row"
                        onClick={() => goToDetail(f.FOURN)}
                        title="Voir la fiche et les articles de ce fournisseur"
                      >
                        <td className="col-code">
                          <span className="fourn-code">{f.FOURN}</span>
                        </td>
                        <td className="col-nom">
                          <span className="nom-text" title={safeTrim(f.NOM)}>
                            {safeTrim(f.NOM) || "-"}
                          </span>
                        </td>
                        <td className="col-adresse">
                          {adresse ? (
                            <span className="ad-text" title={adresse}>
                              <HiLocationMarker /> {adresse}
                            </span>
                          ) : (
                            <span className="no-data-cell">-</span>
                          )}
                        </td>
                        <td className="col-tel">
                          {safeTrim(f.TEL) ? (
                            <span className="tel-text">
                              <HiPhone /> {safeTrim(f.TEL)}
                            </span>
                          ) : (
                            <span className="no-data-cell">-</span>
                          )}
                        </td>
                        <td className="col-fax">{safeTrim(f.FAX) || "-"}</td>
                        <td className="col-delai">
                          {f.DELAPRO ? (
                            <span className="delai-badge">{f.DELAPRO} j</span>
                          ) : (
                            <span className="no-data-cell">-</span>
                          )}
                        </td>
                        <td className="col-local">
                          <span
                            className={`local-badge ${isLocal ? "is-local" : "is-import"}`}
                          >
                            {isLocal ? "Local" : "Import"}
                          </span>
                        </td>
                        <td
                          className="col-actions"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link
                            to={`/admin/fournisseurs/${selectedEntreprise}/${f.FOURN}`}
                            className="btn-detail"
                            title="Fiche complète + articles"
                          >
                            <HiExternalLink />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {pagination && pagination.totalRecords > 0 && (
            <div className="fourn-pagination-bar">
              <div className="pagination-info">
                <strong>
                  {Math.min(
                    (pagination.page - 1) * LIMIT + 1,
                    pagination.totalRecords,
                  )}
                </strong>{" "}
                à{" "}
                <strong>
                  {Math.min(pagination.page * LIMIT, pagination.totalRecords)}
                </strong>{" "}
                sur{" "}
                <strong>
                  {pagination.totalRecords.toLocaleString("fr-FR")}
                </strong>
              </div>
              <div className="pagination-controls">
                <button
                  className="btn-page"
                  disabled={!pagination.hasPrevPage}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <HiChevronLeft />
                  <span>Préc.</span>
                </button>
                <div className="page-indicator">
                  <span className="current-page">{pagination.page}</span>/
                  <span className="total-pages">{pagination.totalPages}</span>
                </div>
                <button
                  className="btn-page"
                  disabled={!pagination.hasNextPage}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <span>Suiv.</span>
                  <HiChevronRight />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminFournisseursScreen;
