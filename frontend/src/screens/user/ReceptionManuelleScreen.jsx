// src/screens/user/ReceptionManuelleScreen.jsx
//
// Module « Contrôle réception MANUEL » : version papier du contrôle de réception.
// L'utilisateur voit les commandes à contrôler (mêmes que le module scanné) et
// imprime la fiche de contrôle liée, qu'il remplit à la main sur le quai.
import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  HiClipboardCheck,
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
  useGetCommandesAControlerManuelQuery,
  useGetCommandeManuelDetailsQuery,
  useUpdateStatutFicheReceptionMutation,
} from "../../slices/receptionManuelleApiSlice";
import { BASE_URL } from "../../constants";
import "./ReceptionManuelleScreen.css";

const STATUTS = [
  { value: "", label: "Toutes" },
  { value: "a_controler", label: "À contrôler" },
  { value: "imprime", label: "Fiche imprimée" },
  { value: "controle", label: "Contrôlée" },
];

const STATUT_LABEL = {
  a_controler: "À contrôler",
  imprime: "Imprimée",
  controle: "Contrôlée",
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";
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
const fmtInt = (v) =>
  Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("fr-FR") : "—";

const ReceptionManuelleScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  const [rechercheSaisie, setRechercheSaisie] = useState("");
  const [search, setSearch] = useState("");
  const [statut, setStatut] = useState("");
  const [page, setPage] = useState(1);
  const [apercu, setApercu] = useState(null); // numcde en aperçu
  const [busy, setBusy] = useState(""); // numcde en cours d'impression
  const [error, setError] = useState("");

  const { data, isFetching, isError, error: queryError, refetch } =
    useGetCommandesAControlerManuelQuery(
      { nomDossierDBF, page, limit: 50, search, statut },
      { skip: !nomDossierDBF },
    );

  const [updateStatut, { isLoading: majStatut }] =
    useUpdateStatutFicheReceptionMutation();

  const commandes = useMemo(() => data?.commandes || [], [data]);
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
  const recupererPdf = async (numcde) => {
    const res = await fetch(
      `${BASE_URL}/api/reception-manuelle/${nomDossierDBF}/commandes/${encodeURIComponent(
        numcde,
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
  const imprimerFiche = async (numcde) => {
    setError("");
    setBusy(numcde);
    try {
      const blob = await recupererPdf(numcde);
      const href = URL.createObjectURL(blob);
      const onglet = window.open(href, "_blank");
      if (!onglet) {
        const a = document.createElement("a");
        a.href = href;
        a.download = `fiche_controle_${numcde}.pdf`;
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

  const telechargerFiche = async (numcde) => {
    setError("");
    setBusy(numcde);
    try {
      const blob = await recupererPdf(numcde);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `fiche_controle_${numcde}_${
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

  const changerStatut = async (numcde, nouveauStatut) => {
    setError("");
    try {
      await updateStatut({ nomDossierDBF, numcde, statut: nouveauStatut }).unwrap();
    } catch (e) {
      setError(e?.data?.message || "Impossible de mettre à jour le statut.");
    }
  };

  if (!nomDossierDBF) {
    return (
      <div className="rm-page">
        <div className="rm-empty">
          <HiExclamationCircle className="rm-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>
            Choisissez une société dans l'en-tête pour voir les commandes à
            contrôler.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rm-page">
      <header className="rm-header">
        <div className="rm-header-left">
          <div className="rm-header-icon">
            <HiClipboardCheck />
          </div>
          <div>
            <h1>Contrôle réception manuel</h1>
            <p className="rm-header-subtitle">
              Imprimez la fiche de contrôle d'une commande et remplissez-la à la
              main sur le quai.
            </p>
          </div>
        </div>
        {entreprise && (
          <div className="rm-entreprise-badge">
            <HiOfficeBuilding />
            <span>
              {entreprise.nomComplet || entreprise.nom || nomDossierDBF}
            </span>
          </div>
        )}
      </header>

      <div className="rm-toolbar">
        <form className="rm-search" onSubmit={lancerRecherche}>
          <HiSearch />
          <input
            type="text"
            placeholder="N° de commande ou bateau…"
            value={rechercheSaisie}
            onChange={(e) => setRechercheSaisie(e.target.value)}
          />
          <button type="submit" className="rm-btn rm-btn-ghost">
            Rechercher
          </button>
        </form>

        <div className="rm-filters">
          <label className="rm-field">
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
            className="rm-check rm-check-info"
            title="La quantité commandée n'apparaît jamais sur la fiche imprimée"
          >
            Comptage à l'aveugle
          </span>

          <button
            type="button"
            className="rm-btn rm-btn-ghost"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <HiRefresh className={isFetching ? "rm-spin" : ""} />
            Actualiser
          </button>
        </div>
      </div>

      {error && <div className="rm-alert rm-alert-err">{error}</div>}
      {isError && (
        <div className="rm-alert rm-alert-err">
          {queryError?.data?.message ||
            "Erreur lors du chargement des commandes à contrôler."}
        </div>
      )}

      <div className="rm-table-wrap">
        <table className="rm-table">
          <thead>
            <tr>
              <th>N° commande</th>
              <th>Fournisseur</th>
              <th>Bateau / vol</th>
              <th>Arrivée</th>
              <th>État</th>
              <th className="rm-num">Lignes</th>
              <th className="rm-num">Unités</th>
              <th>Suivi</th>
              <th className="rm-actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isFetching ? (
              <tr>
                <td colSpan={9} className="rm-td-info">
                  <span className="rm-spinner" /> Chargement…
                </td>
              </tr>
            ) : commandes.length === 0 ? (
              <tr>
                <td colSpan={9} className="rm-td-info">
                  Aucune commande à contrôler pour ce filtre.
                </td>
              </tr>
            ) : (
              commandes.map((c) => (
                <tr key={c.numcde}>
                  <td className="rm-mono rm-strong">{c.numcde}</td>
                  <td>{c.fournisseurNom || "—"}</td>
                  <td>{c.bateau || "—"}</td>
                  <td>{fmtDate(c.arrivee)}</td>
                  <td>
                    {c.etatLabel || (c.etat != null ? `État ${c.etat}` : "—")}
                  </td>
                  <td className="rm-num">{fmtInt(c.nbLignes)}</td>
                  <td className="rm-num">{fmtInt(c.totalUnites)}</td>
                  <td>
                    <span className={`rm-chip rm-chip-${c.suivi.statut}`}>
                      {STATUT_LABEL[c.suivi.statut]}
                    </span>
                    {c.suivi.nbImpressions > 0 && (
                      <span
                        className="rm-print-info"
                        title={`Dernière impression : ${fmtDateHeure(
                          c.suivi.dernierePrintAt,
                        )}${
                          c.suivi.dernierePrintPar
                            ? ` par ${c.suivi.dernierePrintPar}`
                            : ""
                        }`}
                      >
                        ×{c.suivi.nbImpressions}
                      </span>
                    )}
                  </td>
                  <td className="rm-actions">
                    <button
                      type="button"
                      className="rm-btn rm-btn-ghost rm-btn-sm"
                      onClick={() => setApercu(c.numcde)}
                      title="Aperçu des lignes de la commande"
                    >
                      <HiEye />
                    </button>
                    <button
                      type="button"
                      className="rm-btn rm-btn-primary rm-btn-sm"
                      onClick={() => imprimerFiche(c.numcde)}
                      disabled={busy === c.numcde}
                      title="Ouvrir la fiche de contrôle (PDF) pour impression"
                    >
                      <HiPrinter />
                      {busy === c.numcde ? "…" : "Fiche"}
                    </button>
                    <button
                      type="button"
                      className="rm-btn rm-btn-ghost rm-btn-sm"
                      onClick={() => telechargerFiche(c.numcde)}
                      disabled={busy === c.numcde}
                      title="Télécharger la fiche en PDF"
                    >
                      <HiDownload />
                    </button>
                    <button
                      type="button"
                      className={`rm-btn rm-btn-sm ${
                        c.suivi.statut === "controle"
                          ? "rm-btn-done"
                          : "rm-btn-ghost"
                      }`}
                      onClick={() =>
                        changerStatut(
                          c.numcde,
                          c.suivi.statut === "controle"
                            ? "a_controler"
                            : "controle",
                        )
                      }
                      disabled={majStatut}
                      title={
                        c.suivi.statut === "controle"
                          ? "Annuler « contrôlée »"
                          : "Marquer la commande comme contrôlée"
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
        <div className="rm-pagination">
          <button
            type="button"
            className="rm-btn rm-btn-ghost"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={!pagination.hasPrevPage || isFetching}
          >
            <HiChevronLeft /> Précédent
          </button>
          <span>
            Page {pagination.page} / {pagination.totalPages} —{" "}
            {fmtInt(pagination.totalRecords)} commandes
          </span>
          <button
            type="button"
            className="rm-btn rm-btn-ghost"
            onClick={() => setPage((p) => p + 1)}
            disabled={!pagination.hasNextPage || isFetching}
          >
            Suivant <HiChevronRight />
          </button>
        </div>
      )}

      {apercu && (
        <ApercuCommande
          nomDossierDBF={nomDossierDBF}
          numcde={apercu}
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
// APERÇU : lignes de la commande. La quantité commandée est affichée ICI (vue
// bureau) mais n'est JAMAIS imprimée sur la fiche de contrôle.
// ---------------------------------------------------------------------------
const ApercuCommande = ({
  nomDossierDBF,
  numcde,
  busy,
  onImprimer,
  onTelecharger,
  onClose,
}) => {
  const { data, isFetching, isError, error } = useGetCommandeManuelDetailsQuery({
    nomDossierDBF,
    numcde,
  });

  const lignes = data?.lignes || [];

  return (
    <div className="rm-modal-overlay" onClick={onClose}>
      <div className="rm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rm-modal-header">
          <div>
            <h2>Commande {numcde}</h2>
            <p>
              {data?.commande?.fournisseurNom || "—"}
              {data?.commande?.bateau ? ` · ${data.commande.bateau}` : ""} ·
              arrivée {fmtDate(data?.commande?.arrivee)}
            </p>
          </div>
          <button type="button" className="rm-icon-btn" onClick={onClose}>
            <HiX />
          </button>
        </div>

        <div className="rm-modal-stats">
          <div className="rm-stat">
            <span className="rm-stat-value">{fmtInt(data?.totalLignes)}</span>
            <span className="rm-stat-label">Lignes</span>
          </div>
          <div className="rm-stat">
            <span className="rm-stat-value">{fmtInt(data?.totalUnites)}</span>
            <span className="rm-stat-label">Unités</span>
          </div>
          <div className="rm-stat">
            <span className="rm-stat-value">{fmtInt(data?.nbNouveautes)}</span>
            <span className="rm-stat-label">Nouveautés</span>
          </div>
          <div className="rm-stat">
            <span className="rm-stat-value">
              {data?.resaDisponible === false ? "—" : fmtInt(data?.nbReservations)}
            </span>
            <span className="rm-stat-label">Réservations</span>
          </div>
          <div className="rm-stat">
            <span className="rm-stat-value">
              {fmtInt(data?.suivi?.nbImpressions)}
            </span>
            <span className="rm-stat-label">Impressions</span>
          </div>
        </div>

        {data?.commentaires?.length > 0 && (
          <div className="rm-comments">
            <strong>Commentaires de la commande</strong>
            <ul>
              {data.commentaires.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {isError && (
          <div className="rm-alert rm-alert-err">
            {error?.data?.message || "Erreur lors du chargement de la commande."}
          </div>
        )}

        {data?.resaDisponible === false && (
          <div className="rm-alert rm-alert-warn">
            Réservations en cours de calcul : la fiche sortira sans les repères
            « R ». Réactualisez dans une minute pour les obtenir.
          </div>
        )}

        <div className="rm-modal-table-wrap">
          <table className="rm-table rm-table-compact">
            <thead>
              <tr>
                <th className="rm-num">NL</th>
                <th>Code article</th>
                <th>Désignation</th>
                <th>Réf. frn</th>
                <th>Gencode</th>
                <th className="rm-num" title="Non imprimée sur la fiche">
                  Qté cdée
                </th>
              </tr>
            </thead>
            <tbody>
              {isFetching ? (
                <tr>
                  <td colSpan={6} className="rm-td-info">
                    <span className="rm-spinner" /> Chargement des lignes…
                  </td>
                </tr>
              ) : lignes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="rm-td-info">
                    Aucune ligne article dans cette commande.
                  </td>
                </tr>
              ) : (
                lignes.map((l, i) => (
                  <tr key={`${l.nart}-${l.nl}-${i}`}>
                    <td className="rm-num rm-muted">{l.nl || "—"}</td>
                    <td className="rm-mono">{l.nart}</td>
                    <td>
                      {l.designation || <em className="rm-muted">—</em>}
                      {l.estReserve && (
                        <span
                          className="rm-tag rm-tag-resa"
                          title="Réservé pour un client — à mettre de côté"
                        >
                          R
                        </span>
                      )}
                      {l.estNouveau && <span className="rm-tag rm-tag-new">N</span>}
                      {l.inconnu && (
                        <span className="rm-tag rm-tag-unknown" title="Article absent de la base">
                          ?
                        </span>
                      )}
                    </td>
                    <td className="rm-muted">{l.refer || "—"}</td>
                    <td className="rm-mono rm-muted">{l.gencod || "—"}</td>
                    <td className="rm-num rm-muted">{fmtInt(l.qteCommandee)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rm-modal-footer">
          <span className="rm-footer-note">
            La fiche est imprimée SANS la quantité commandée (comptage à
            l'aveugle).
          </span>
          <div className="rm-modal-actions">
            <button
              type="button"
              className="rm-btn rm-btn-ghost"
              onClick={onTelecharger}
              disabled={busy}
            >
              <HiDownload /> Télécharger
            </button>
            <button
              type="button"
              className="rm-btn rm-btn-primary"
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

export default ReceptionManuelleScreen;
