// src/screens/user/PreparationManuelleScreen.jsx
//
// Module « Préparation de commande MANUELLE » : version papier de la préparation.
// L'utilisateur voit les proformas à préparer (mêmes que le module scanné :
// ETAT = 2) et imprime la fiche de préparation liée, que l'agent remplit à la
// main dans les allées — dock (S2) d'abord, magasin (S1) ensuite.
import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiClipboardList,
  HiOfficeBuilding,
  HiExclamationCircle,
  HiRefresh,
  HiSearch,
  HiPrinter,
  HiDownload,
  HiEye,
  HiX,
  HiCheckCircle,
  HiChevronLeft,
  HiChevronRight,
} from "react-icons/hi";
import {
  selectGlobalDossier,
  selectGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import {
  useGetProformasAPreparerManuelQuery,
  useGetProformaManuelDetailsQuery,
  useUpdateStatutFichePreparationMutation,
} from "../../slices/preparationManuelleApiSlice";
import { BASE_URL } from "../../constants";
import "./PreparationManuelleScreen.css";

const STATUTS = [
  { value: "", label: "Toutes" },
  { value: "a_preparer", label: "À préparer" },
  { value: "imprime", label: "Fiche imprimée" },
  { value: "prepare", label: "Préparée" },
];

const STATUT_LABEL = {
  a_preparer: "À préparer",
  imprime: "Imprimée",
  prepare: "Préparée",
};

// Libellés des deux zones de prélèvement (même code couleur que la fiche PDF).
const ZONES = {
  dock: { titre: "1 · Dock", sous: "stock dock (S2) — à faire en premier" },
  magasin: { titre: "2 · Magasin", sous: "reliquat en rayon (S1) — après le dock" },
};

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const fmtDateHeure = (d) =>
  d
    ? new Date(d).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
// Compteurs (nombre de lignes, d'articles, d'impressions) : toujours entiers.
const fmtInt = (v) =>
  Number.isFinite(Number(v))
    ? Math.round(Number(v)).toLocaleString("fr-FR")
    : "—";
// ⚠️ Quantités et stocks viennent de champs DBF N(x.3) : un article vendu au
// mètre vaut 0,5 ou 3,6. Les arrondir à l'unité fausserait ce que l'agent doit
// prendre — 3 décimales max, zéros de fin supprimés.
const fmtQte = (v) =>
  Number.isFinite(Number(v))
    ? Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 })
    : "—";

const PreparationManuelleScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  const [rechercheSaisie, setRechercheSaisie] = useState("");
  const [search, setSearch] = useState("");
  const [statut, setStatut] = useState("");
  const [page, setPage] = useState(1);
  const [apercu, setApercu] = useState(null); // numfact en aperçu
  const [busy, setBusy] = useState(""); // numfact en cours d'impression
  const [error, setError] = useState("");

  const {
    data,
    isFetching,
    isError,
    error: queryError,
    refetch,
  } = useGetProformasAPreparerManuelQuery(
    { nomDossierDBF, page, limit: 50, search, statut },
    { skip: !nomDossierDBF },
  );

  const [updateStatut, { isLoading: majStatut }] =
    useUpdateStatutFichePreparationMutation();

  const proformas = useMemo(() => data?.proformas || [], [data]);
  const pagination = data?.pagination;

  // Changement de société : on repart d'une liste propre.
  useEffect(() => {
    setPage(1);
    setSearch("");
    setRechercheSaisie("");
    setStatut("");
    setApercu(null);
    setError("");
  }, [nomDossierDBF]);

  const lancerRecherche = (e) => {
    e.preventDefault();
    setPage(1);
    setSearch(rechercheSaisie.trim());
  };

  // Récupère le PDF de la fiche (POST : l'impression est tracée côté serveur).
  const recupererPdf = async (numfact) => {
    const res = await fetch(
      `${BASE_URL}/api/preparation-manuelle/${nomDossierDBF}/proformas/${encodeURIComponent(
        numfact,
      )}/fiche-pdf`,
      { method: "POST", credentials: "include" },
    );
    if (!res.ok) {
      let msg = `Génération de la fiche échouée (${res.status})`;
      try {
        const j = await res.json();
        if (j?.message) msg = j.message;
      } catch {
        /* réponse non-JSON */
      }
      throw new Error(msg);
    }
    return res.blob();
  };

  // Ouvre la fiche dans un onglet (aperçu avant impression du navigateur).
  // Repli en téléchargement si la popup est bloquée.
  const imprimerFiche = async (numfact) => {
    setError("");
    setBusy(numfact);
    try {
      const blob = await recupererPdf(numfact);
      const href = URL.createObjectURL(blob);
      const onglet = window.open(href, "_blank");
      if (!onglet) {
        const a = document.createElement("a");
        a.href = href;
        a.download = `fiche_preparation_${numfact}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(href), 60000);
      refetch();
    } catch (e) {
      setError(e.message || "Impossible de générer la fiche.");
    } finally {
      setBusy("");
    }
  };

  const telechargerFiche = async (numfact) => {
    setError("");
    setBusy(numfact);
    try {
      const blob = await recupererPdf(numfact);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `fiche_preparation_${numfact}_${
        entreprise?.trigramme || nomDossierDBF
      }.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
      refetch();
    } catch (e) {
      setError(e.message || "Impossible de générer la fiche.");
    } finally {
      setBusy("");
    }
  };

  const changerStatut = async (numfact, nouveauStatut) => {
    setError("");
    try {
      await updateStatut({
        nomDossierDBF,
        numfact,
        statut: nouveauStatut,
      }).unwrap();
    } catch (e) {
      setError(e?.data?.message || "Impossible de mettre à jour le statut.");
    }
  };

  if (!nomDossierDBF) {
    return (
      <div className="pm-page">
        <div className="pm-empty">
          <HiExclamationCircle className="pm-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>
            Choisissez une société dans l'en-tête pour voir les proformas à
            préparer.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pm-page">
      <header className="pm-header">
        <div className="pm-header-left">
          <div className="pm-header-icon">
            <HiClipboardList />
          </div>
          <div>
            <h1>Préparation de commande manuelle</h1>
            <p className="pm-header-subtitle">
              Imprimez la fiche de préparation d'une proforma : parcours dock
              (S2) puis magasin (S1), quantité à prendre par ligne.
            </p>
          </div>
        </div>
        {entreprise && (
          <div className="pm-entreprise-badge">
            <HiOfficeBuilding />
            <span>
              {entreprise.nomComplet || entreprise.nom || nomDossierDBF}
            </span>
          </div>
        )}
      </header>

      <div className="pm-toolbar">
        <form className="pm-search" onSubmit={lancerRecherche}>
          <HiSearch />
          <input
            type="text"
            placeholder="N° de proforma, client ou observation…"
            value={rechercheSaisie}
            onChange={(e) => setRechercheSaisie(e.target.value)}
          />
          <button type="submit" className="pm-btn pm-btn-ghost">
            Rechercher
          </button>
        </form>

        <div className="pm-filters">
          <label className="pm-field">
            <span>Statut</span>
            <select
              value={statut}
              onChange={(e) => {
                setPage(1);
                setStatut(e.target.value);
              }}
            >
              {STATUTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <span
            className="pm-check pm-check-info"
            title="Seules les proformas à préparer (ETAT = 2) sont listées"
          >
            Dock puis magasin
          </span>

          <button
            type="button"
            className="pm-btn pm-btn-ghost"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <HiRefresh className={isFetching ? "pm-spin" : ""} />
            Actualiser
          </button>
        </div>
      </div>

      {error && <div className="pm-alert pm-alert-err">{error}</div>}
      {isError && (
        <div className="pm-alert pm-alert-err">
          {queryError?.data?.message ||
            "Erreur lors du chargement des proformas à préparer."}
        </div>
      )}

      <div className="pm-table-wrap">
        <table className="pm-table">
          <thead>
            <tr>
              <th>N° proforma</th>
              <th>Client</th>
              <th>Vendeur</th>
              <th>Date</th>
              <th>État</th>
              <th className="pm-num">Lignes</th>
              <th className="pm-num">Unités</th>
              <th>Suivi</th>
              <th className="pm-actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isFetching ? (
              <tr>
                <td colSpan={9} className="pm-td-info">
                  <span className="pm-spinner" /> Chargement…
                </td>
              </tr>
            ) : proformas.length === 0 ? (
              <tr>
                <td colSpan={9} className="pm-td-info">
                  Aucune proforma à préparer pour ce filtre.
                </td>
              </tr>
            ) : (
              proformas.map((p) => (
                <tr key={p.numfact}>
                  <td className="pm-mono pm-strong">{p.numfact}</td>
                  <td>
                    {p.clientNom || "—"}
                    {p.clientCode != null && (
                      <span className="pm-muted"> ({p.clientCode})</span>
                    )}
                  </td>
                  <td>{p.vendeurNom || p.vendeurCode || "—"}</td>
                  <td>{fmtDate(p.datfact)}</td>
                  <td>
                    {p.etatLabel || (p.etat != null ? `État ${p.etat}` : "—")}
                  </td>
                  <td className="pm-num">{fmtInt(p.nbLignes)}</td>
                  <td className="pm-num">{fmtQte(p.totalUnites)}</td>
                  <td>
                    <span className={`pm-chip pm-chip-${p.suivi.statut}`}>
                      {STATUT_LABEL[p.suivi.statut]}
                    </span>
                    {p.suivi.nbImpressions > 0 && (
                      <span
                        className="pm-print-info"
                        title={`Dernière impression : ${fmtDateHeure(
                          p.suivi.dernierePrintAt,
                        )}${
                          p.suivi.dernierePrintPar
                            ? ` par ${p.suivi.dernierePrintPar}`
                            : ""
                        }`}
                      >
                        ×{p.suivi.nbImpressions}
                      </span>
                    )}
                  </td>
                  <td className="pm-actions">
                    <button
                      type="button"
                      className="pm-btn pm-btn-ghost pm-btn-sm"
                      onClick={() => setApercu(p.numfact)}
                      title="Aperçu du parcours de préparation"
                    >
                      <HiEye />
                    </button>
                    <button
                      type="button"
                      className="pm-btn pm-btn-primary pm-btn-sm"
                      onClick={() => imprimerFiche(p.numfact)}
                      disabled={busy === p.numfact}
                      title="Ouvrir la fiche de préparation (PDF) pour impression"
                    >
                      <HiPrinter />
                      {busy === p.numfact ? "…" : "Fiche"}
                    </button>
                    <button
                      type="button"
                      className="pm-btn pm-btn-ghost pm-btn-sm"
                      onClick={() => telechargerFiche(p.numfact)}
                      disabled={busy === p.numfact}
                      title="Télécharger la fiche en PDF"
                    >
                      <HiDownload />
                    </button>
                    <button
                      type="button"
                      className={`pm-btn pm-btn-sm ${
                        p.suivi.statut === "prepare"
                          ? "pm-btn-done"
                          : "pm-btn-ghost"
                      }`}
                      onClick={() =>
                        changerStatut(
                          p.numfact,
                          p.suivi.statut === "prepare"
                            ? "a_preparer"
                            : "prepare",
                        )
                      }
                      disabled={majStatut}
                      title={
                        p.suivi.statut === "prepare"
                          ? "Annuler « préparée »"
                          : "Marquer la proforma comme préparée"
                      }
                    >
                      <HiCheckCircle />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="pm-pagination">
          <button
            type="button"
            className="pm-btn pm-btn-ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!pagination.hasPrevPage || isFetching}
          >
            <HiChevronLeft /> Précédent
          </button>
          <span>
            Page {pagination.page} / {pagination.totalPages} —{" "}
            {fmtInt(pagination.totalRecords)} proformas
          </span>
          <button
            type="button"
            className="pm-btn pm-btn-ghost"
            onClick={() => setPage((p) => p + 1)}
            disabled={!pagination.hasNextPage || isFetching}
          >
            Suivant <HiChevronRight />
          </button>
        </div>
      )}

      {apercu && (
        <ApercuPreparation
          nomDossierDBF={nomDossierDBF}
          numfact={apercu}
          busy={busy === apercu}
          onImprimer={() => imprimerFiche(apercu)}
          onTelecharger={() => telechargerFiche(apercu)}
          onClose={() => setApercu(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// APERÇU : le parcours tel qu'il sera imprimé — d'abord tout ce qui se prend au
// dock, puis le reliquat au magasin. Un même article peut donc apparaître dans
// les deux sections, avec la quantité propre à chaque zone.
// ---------------------------------------------------------------------------
const ApercuPreparation = ({
  nomDossierDBF,
  numfact,
  busy,
  onImprimer,
  onTelecharger,
  onClose,
}) => {
  const { data, isFetching, isError, error } = useGetProformaManuelDetailsQuery({
    nomDossierDBF,
    numfact,
  });

  const totaux = data?.totaux;

  return (
    <div className="pm-modal-overlay" onClick={onClose}>
      <div className="pm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pm-modal-header">
          <div>
            <h2>Proforma {numfact}</h2>
            <p>
              {data?.proforma?.clientNom || "—"}
              {data?.proforma?.vendeurNom
                ? ` · vendeur ${data.proforma.vendeurNom}`
                : ""}{" "}
              · {fmtDate(data?.proforma?.datfact)}
            </p>
          </div>
          <button type="button" className="pm-icon-btn" onClick={onClose}>
            <HiX />
          </button>
        </div>

        <div className="pm-modal-stats">
          <div className="pm-stat">
            <span className="pm-stat-value">{fmtInt(totaux?.nbArticles)}</span>
            <span className="pm-stat-label">Articles</span>
          </div>
          <div className="pm-stat">
            <span className="pm-stat-value">{fmtQte(totaux?.totalDemande)}</span>
            <span className="pm-stat-label">Unités demandées</span>
          </div>
          <div className="pm-stat">
            <span className="pm-stat-value">{fmtQte(totaux?.totalDock)}</span>
            <span className="pm-stat-label">Au dock</span>
          </div>
          <div className="pm-stat">
            <span className="pm-stat-value">{fmtQte(totaux?.totalMagasin)}</span>
            <span className="pm-stat-label">Au magasin</span>
          </div>
          <div className="pm-stat">
            <span className="pm-stat-value">{fmtInt(totaux?.nbManquants)}</span>
            <span className="pm-stat-label">Stock insuffisant</span>
          </div>
          <div className="pm-stat">
            <span className="pm-stat-value">
              {fmtInt(data?.suivi?.nbImpressions)}
            </span>
            <span className="pm-stat-label">Impressions</span>
          </div>
        </div>

        {data?.commentaires?.length > 0 && (
          <div className="pm-comments">
            <strong>Commentaires de la proforma</strong>
            <ul>
              {data.commentaires.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {isError && (
          <div className="pm-alert pm-alert-err">
            {error?.data?.message || "Erreur lors du chargement de la proforma."}
          </div>
        )}

        <div className="pm-modal-table-wrap">
          {isFetching ? (
            <p className="pm-td-info">
              <span className="pm-spinner" /> Chargement du parcours…
            </p>
          ) : (
            <>
              <SectionZone zone="dock" lignes={data?.lignesDock || []} />
              <SectionZone zone="magasin" lignes={data?.lignesMagasin || []} />
            </>
          )}
        </div>

        <div className="pm-modal-footer">
          <span className="pm-footer-note">
            La colonne « CTRL » est laissée vide sur la fiche : l'agent y note la
            quantité réellement prise en cas d'écart.
          </span>
          <div className="pm-modal-actions">
            <button
              type="button"
              className="pm-btn pm-btn-ghost"
              onClick={onTelecharger}
              disabled={busy}
            >
              <HiDownload /> Télécharger
            </button>
            <button
              type="button"
              className="pm-btn pm-btn-primary"
              onClick={onImprimer}
              disabled={busy}
            >
              <HiPrinter /> {busy ? "Génération…" : "Imprimer la fiche"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Une section du parcours (dock ou magasin), dans l'ordre exact de la fiche.
const SectionZone = ({ zone, lignes }) => {
  const total = lignes.reduce((s, l) => s + (l.aPrendre || 0), 0);

  return (
    <section className={`pm-zone pm-zone-${zone}`}>
      <header className="pm-zone-head">
        <span className="pm-zone-title">{ZONES[zone].titre}</span>
        <span className="pm-zone-sub">{ZONES[zone].sous}</span>
        <span className="pm-zone-count">
          {fmtInt(lignes.length)} ligne{lignes.length > 1 ? "s" : ""} ·{" "}
          {fmtQte(total)} unité{total > 1 ? "s" : ""}
        </span>
      </header>

      {lignes.length === 0 ? (
        <p className="pm-zone-empty">
          {zone === "dock"
            ? "Rien à prendre au dock : aucun article n'a de stock dock (S2)."
            : "Rien à prendre au magasin : le dock couvre la totalité de la commande."}
        </p>
      ) : (
        <table className="pm-table pm-table-compact">
          <thead>
            <tr>
              <th className="pm-num">NL</th>
              <th>Code article</th>
              <th>Désignation</th>
              <th>Gencode</th>
              <th>Rayon / emplacement</th>
              <th className="pm-num">Stock zone</th>
              <th className="pm-num">À prendre</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={`${l.nart}-${l.nl}-${i}`}>
                <td className="pm-num pm-muted">{l.nl || "—"}</td>
                <td className="pm-mono">{l.nart}</td>
                <td>
                  {l.designation || <em className="pm-muted">—</em>}
                  {l.manquant > 0 && (
                    <span
                      className="pm-tag pm-tag-manquant"
                      title={`Stock de la zone insuffisant : ${fmtQte(
                        l.manquant,
                      )} unité(s) probablement introuvable(s)`}
                    >
                      !
                    </span>
                  )}
                  {l.autreZone && (
                    <span
                      className="pm-tag pm-tag-autre"
                      title="Cet article est aussi à prendre dans l'autre zone"
                    >
                      &gt;
                    </span>
                  )}
                </td>
                <td className="pm-mono pm-muted">{l.gencod || "—"}</td>
                <td className="pm-muted">
                  {[l.rayon || l.gism1, l.sousRayon].filter(Boolean).join(" · ") ||
                    "—"}
                </td>
                <td className="pm-num pm-muted">{fmtQte(l.stockZone)}</td>
                <td className="pm-num">
                  <span
                    className={`pm-qte ${l.manquant > 0 ? "pm-qte-manquant" : ""}`}
                  >
                    {fmtQte(l.aPrendre)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};

export default PreparationManuelleScreen;
