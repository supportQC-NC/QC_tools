// src/screens/user/ListesReapproScreen.jsx
//
// Module « Listes de réappro » (CDC §1 et §3).
// Une liste de réappro = un lot d'articles à aller chercher au dock, poussé par
// quelqu'un et préparé par un opérateur sur le collecteur. Cet écran donne la
// vue en ligne : qui, quoi, combien, urgence, rayon, observation, date, statut,
// opérateur et avancement — triable, avec changement d'urgence à la volée.
// Les listes de plus de 15 jours sont masquées par défaut (case « tout »).
//
// La création manuelle (§3) se fait ici : nom, observation, urgence, puis un
// panier de codes (NART, gencode ou référence fournisseur) + quantités. La
// quantité n'est PAS bornée au stock : la disponibilité n'est pas contrôlée.
import React, { useMemo, useState } from "react";
import { useSelector } from "react-redux";
import * as XLSX from "xlsx";
import {
  HiRefresh,
  HiOfficeBuilding,
  HiExclamationCircle,
  HiPlus,
  HiTrash,
  HiX,
  HiEye,
  HiSearch,
  HiClipboardList,
  HiDownload,
  HiPencil,
} from "react-icons/hi";
import {
  selectGlobalDossier,
  selectGlobalEntreprise,
} from "../../slices/entrepriseGlobalSlice";
import {
  useGetDemandesQuery,
  useLazyGetDemandeDetailQuery,
  useCreateDemandePanierMutation,
  useLazyGetArticleReapproQuery,
  useGetStatsPreparateursQuery,
  useImporterProformasMutation,
  useUpdateUrgenceDemandeMutation,
  useUpdateDemandeMutation,
  useDeleteDemandeMutation,
} from "../../slices/demandeReapproApiSlice";
import Loader from "../../components/Shared/Loader/Loader";
import "./ListesReapproScreen.css";

const URGENCES = [
  { value: "urgent", label: "Urgent" },
  { value: "a_faire", label: "À faire" },
  { value: "normal", label: "Normal" },
];
const URGENCE_RANG = { urgent: 0, a_faire: 1, normal: 2 };

// Nommage du fichier de transfert .dat (le CONTENU du fichier est figé).
const NOMMAGES = [
  { value: "gisement", label: "Gisement (par défaut)" },
  { value: "proforma", label: "N° de proforma" },
  { value: "libre", label: "Libellé libre" },
];

const STATUT_LABEL = {
  en_attente: "À faire",
  en_cours: "En cours",
  realisee: "Terminé",
};
const SOURCE_LABEL = {
  manuel: "Manuelle",
  proforma: "Proforma",
  rapport: "Rapport",
};

const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const fmtNb = (n) => (Number(n) || 0).toLocaleString("fr-FR");
const fmtJour = (d) => d.toISOString().slice(0, 10);

// Durées lisibles d'un coup d'œil : « 45 s », « 8 min 20 s », « 2 h 05 ».
const fmtDuree = (ms) => {
  const s = Math.round((Number(ms) || 0) / 1000);
  if (s <= 0) return "—";
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m} min ${rs} s` : `${m} min`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} h ${String(rm).padStart(2, "0")}` : `${h} h`;
};

// Avancement : lignes traitées / lignes totales (voir CDC §1).
const pourcent = (d) => {
  const total = Number(d?.nbArticles) || 0;
  if (!total) return 0;
  if (d.statut === "realisee") return 100;
  return Math.min(100, Math.round(((Number(d.lignesTraitees) || 0) / total) * 100));
};

const ListesReapproScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier);
  const entreprise = useSelector(selectGlobalEntreprise);

  const [onglet, setOnglet] = useState("listes"); // listes | stats
  const [statut, setStatut] = useState("");
  const [tout, setTout] = useState(false); // ignorer la fenêtre de 15 jours
  const [recherche, setRecherche] = useState("");
  const [tri, setTri] = useState({ col: "date", sens: "desc" });
  const [erreur, setErreur] = useState("");
  const [detail, setDetail] = useState(null);
  const [creation, setCreation] = useState(false);
  const [edition, setEdition] = useState(null); // liste en cours de modification

  const { data: listes = [], isLoading, isFetching, refetch } =
    useGetDemandesQuery(
      { nomDossierDBF, statut: statut || undefined, jours: tout ? 0 : undefined },
      { skip: !nomDossierDBF },
    );

  const [chargerDetail, { isFetching: detailEnCours }] =
    useLazyGetDemandeDetailQuery();
  const [updateUrgence] = useUpdateUrgenceDemandeMutation();
  const [deleteDemande] = useDeleteDemandeMutation();
  const [importerProformas, { isLoading: importEnCours }] =
    useImporterProformasMutation();

  const lignes = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const filtrees = q
      ? listes.filter((d) =>
          [d.nom, d.rayon, d.commentaire, d.createdByNom, d.sourceRef]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        )
      : listes.slice();

    const sens = tri.sens === "asc" ? 1 : -1;
    return filtrees.sort((a, b) => {
      switch (tri.col) {
        case "urgence":
          return (
            ((URGENCE_RANG[a.priorite] ?? 9) - (URGENCE_RANG[b.priorite] ?? 9)) *
              sens ||
            new Date(b.createdAt) - new Date(a.createdAt)
          );
        case "qui":
          return (
            String(a.createdByNom || "").localeCompare(
              String(b.createdByNom || ""),
              "fr",
            ) * sens
          );
        case "statut":
          return String(a.statut).localeCompare(String(b.statut), "fr") * sens;
        default:
          return (new Date(a.createdAt) - new Date(b.createdAt)) * sens;
      }
    });
  }, [listes, recherche, tri]);

  const trierPar = (col) =>
    setTri((t) =>
      t.col === col
        ? { col, sens: t.sens === "asc" ? "desc" : "asc" }
        : { col, sens: col === "date" ? "desc" : "asc" },
    );

  const changerUrgence = async (id, priorite) => {
    setErreur("");
    try {
      await updateUrgence({ id, priorite }).unwrap();
    } catch (e) {
      setErreur(e?.data?.message || "Changement d'urgence impossible.");
    }
  };

  // Le serveur balaye les proformas toutes les heures ; ce bouton force un tour.
  const lancerImport = async () => {
    setErreur("");
    try {
      const r = await importerProformas(nomDossierDBF).unwrap();
      setErreur("");
      window.alert(
        `Proformas « reappro » : ${r.crees} liste(s) créée(s), ${r.majs} mise(s) à jour, ` +
          `${r.supprimes} supprimée(s) — ${r.candidats} proforma(s) examinée(s).`,
      );
    } catch (e) {
      setErreur(e?.data?.message || "Import des proformas impossible.");
    }
  };

  const supprimer = async (d) => {
    if (!window.confirm(`Supprimer la liste « ${d.nom || d.gisement} » ?`)) return;
    setErreur("");
    try {
      await deleteDemande(d._id).unwrap();
    } catch (e) {
      setErreur(e?.data?.message || "Suppression impossible.");
    }
  };

  const ouvrirDetail = async (d) => {
    setErreur("");
    try {
      const complet = await chargerDetail(d._id).unwrap();
      setDetail(complet);
    } catch (e) {
      setErreur(e?.data?.message || "Détail indisponible.");
    }
  };

  if (!nomDossierDBF) {
    return (
      <div className="lr-page">
        <div className="lr-empty">
          <HiExclamationCircle className="lr-empty-icon" />
          <h2>Aucune société sélectionnée</h2>
          <p>Choisissez une société dans l'en-tête pour voir ses listes de réappro.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lr-page">
      <header className="lr-header">
        <div className="lr-header-left">
          <div className="lr-header-icon">
            <HiClipboardList />
          </div>
          <div>
            <h1>Listes de réappro</h1>
            <p className="lr-header-subtitle">
              Ce qui est à aller chercher au dock : qui l'a demandé, quoi,
              l'urgence et où en est la préparation.
            </p>
          </div>
        </div>
        {entreprise && (
          <div className="lr-entreprise-badge">
            <HiOfficeBuilding />
            <span>{entreprise.nomComplet || entreprise.nom || nomDossierDBF}</span>
          </div>
        )}
      </header>

      <div className="lr-tabs">
        <button
          className={`lr-tab ${onglet === "listes" ? "lr-tab-actif" : ""}`}
          onClick={() => setOnglet("listes")}
        >
          Listes
        </button>
        <button
          className={`lr-tab ${onglet === "stats" ? "lr-tab-actif" : ""}`}
          onClick={() => setOnglet("stats")}
        >
          Statistiques
        </button>
      </div>

      {onglet === "stats" ? (
        <StatsPanel nomDossierDBF={nomDossierDBF} entreprise={entreprise} />
      ) : (
      <>
      <div className="lr-toolbar">
        <div className="lr-search">
          <HiSearch />
          <input
            type="text"
            placeholder="Nom, rayon, observation, demandeur…"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </div>

        <label className="lr-field">
          <span>Statut</span>
          <select value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="">Tous</option>
            <option value="en_attente">À faire</option>
            <option value="en_cours">En cours</option>
            <option value="realisee">Terminé</option>
          </select>
        </label>

        <label className="lr-check">
          <input
            type="checkbox"
            checked={tout}
            onChange={(e) => setTout(e.target.checked)}
          />
          <span>Afficher au-delà de 15 jours</span>
        </label>

        <button className="lr-btn lr-btn-ghost" onClick={refetch} disabled={isFetching}>
          <HiRefresh /> Actualiser
        </button>
        <button
          className="lr-btn lr-btn-ghost"
          onClick={lancerImport}
          disabled={importEnCours}
          title="Crée les listes des proformas dont l'observation commence par « Reappro » (fait aussi automatiquement chaque heure)"
        >
          <HiDownload /> {importEnCours ? "Import…" : "Importer les proformas"}
        </button>
        <button className="lr-btn lr-btn-primary" onClick={() => setCreation(true)}>
          <HiPlus /> Nouvelle liste
        </button>
      </div>

      {erreur && <div className="lr-error">{erreur}</div>}

      {isLoading ? (
        <Loader />
      ) : lignes.length === 0 ? (
        <div className="lr-empty">
          <HiClipboardList className="lr-empty-icon" />
          <h2>Aucune liste</h2>
          <p>
            {tout
              ? "Aucune liste de réappro pour cette société."
              : "Aucune liste des 15 derniers jours. Cochez « au-delà de 15 jours » pour voir l'historique."}
          </p>
        </div>
      ) : (
        <div className="lr-table-wrap">
          <table className="lr-table">
            <thead>
              <tr>
                <th className="lr-sortable" onClick={() => trierPar("urgence")}>
                  Urgence
                </th>
                <th>Liste</th>
                <th>Source</th>
                <th className="lr-sortable" onClick={() => trierPar("qui")}>
                  Demandé par
                </th>
                <th className="lr-num">Articles</th>
                <th className="lr-num">Quantités</th>
                <th>Rayon</th>
                <th className="lr-sortable" onClick={() => trierPar("date")}>
                  Date
                </th>
                <th className="lr-sortable" onClick={() => trierPar("statut")}>
                  Statut
                </th>
                <th>Opérateur</th>
                <th>Avancement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lignes.map((d) => {
                const pct = pourcent(d);
                return (
                  <tr key={d._id}>
                    <td>
                      <select
                        className={`lr-urgence lr-urgence-${d.priorite}`}
                        value={d.priorite}
                        disabled={d.statut === "realisee"}
                        onChange={(e) => changerUrgence(d._id, e.target.value)}
                        title={
                          d.historiqueUrgence?.length
                            ? `Modifiée ${d.historiqueUrgence.length} fois`
                            : "Changer l'urgence"
                        }
                      >
                        {URGENCES.map((u) => (
                          <option key={u.value} value={u.value}>
                            {u.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div className="lr-nom">{d.nom || d.gisement || "—"}</div>
                      {!!d.commentaire && (
                        <div className="lr-obs" title={d.commentaire}>
                          {d.commentaire}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className="lr-tag">
                        {SOURCE_LABEL[d.source] || d.source || "—"}
                      </span>
                      {!!d.sourceRef && (
                        <span className="lr-ref">{d.sourceRef}</span>
                      )}
                    </td>
                    <td>{d.createdByNom || "—"}</td>
                    <td className="lr-num">{fmtNb(d.nbArticles)}</td>
                    <td className="lr-num">{fmtNb(d.totalQuantite)}</td>
                    <td>{d.rayon || "—"}</td>
                    <td>{fmtDate(d.createdAt)}</td>
                    <td>
                      <span className={`lr-statut lr-statut-${d.statut}`}>
                        {STATUT_LABEL[d.statut] || d.statut}
                      </span>
                    </td>
                    <td>{d.operateur?.nom || d.realisedByNom || "—"}</td>
                    <td>
                      <div className="lr-progress" title={`${pct} %`}>
                        <div
                          className="lr-progress-bar"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="lr-progress-txt">{pct} %</span>
                    </td>
                    <td className="lr-actions">
                      <button
                        className="lr-icon-btn"
                        title="Voir les articles"
                        onClick={() => ouvrirDetail(d)}
                      >
                        <HiEye />
                      </button>
                      {d.statut === "en_attente" && (
                        <button
                          className="lr-icon-btn"
                          title="Modifier (nom, rayon, observation, nom du fichier .dat)"
                          onClick={() => setEdition(d)}
                        >
                          <HiPencil />
                        </button>
                      )}
                      <button
                        className="lr-icon-btn lr-icon-danger"
                        title="Supprimer la liste"
                        onClick={() => supprimer(d)}
                      >
                        <HiTrash />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      </>
      )}

      {detail && (
        <DetailModal
          demande={detail}
          chargement={detailEnCours}
          onClose={() => setDetail(null)}
        />
      )}
      {edition && (
        <EditionModal
          demande={edition}
          onClose={() => setEdition(null)}
          onEnregistre={() => {
            setEdition(null);
            refetch();
          }}
        />
      )}
      {creation && (
        <CreationModal
          nomDossierDBF={nomDossierDBF}
          onClose={() => setCreation(false)}
          onCree={() => {
            setCreation(false);
            refetch();
          }}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Nommage du fichier de transfert .dat (le contenu n'en dépend pas)    */
const ChoixNommage = ({ valeur, onValeur, libre, onLibre }) => (
  <div className="lr-form-grid">
    <label className="lr-field">
      <span>Nom du fichier .dat</span>
      <select value={valeur} onChange={(e) => onValeur(e.target.value)}>
        {NOMMAGES.map((n) => (
          <option key={n.value} value={n.value}>
            {n.label}
          </option>
        ))}
      </select>
    </label>
    {valeur === "libre" && (
      <label className="lr-field">
        <span>Libellé du fichier</span>
        <input
          value={libre}
          onChange={(e) => onLibre(e.target.value)}
          placeholder="ex : vis inox lot 3"
          maxLength={60}
        />
      </label>
    )}
  </div>
);

/* ------------------------------------------------------------------ */
/* Édition d'une liste encore « à faire »                               */
const EditionModal = ({ demande, onClose, onEnregistre }) => {
  const [nom, setNom] = useState(demande.nom || "");
  const [rayon, setRayon] = useState(demande.rayon || "");
  const [observation, setObservation] = useState(demande.commentaire || "");
  const [nommage, setNommage] = useState(demande.nommageTransfert || "gisement");
  const [nomLibre, setNomLibre] = useState(demande.nomTransfertLibre || "");
  const [msg, setMsg] = useState(null);
  const [updateDemande, { isLoading }] = useUpdateDemandeMutation();

  const enregistrer = async () => {
    setMsg(null);
    try {
      await updateDemande({
        id: demande._id,
        nom,
        rayon,
        commentaire: observation,
        nommageTransfert: nommage,
        nomTransfertLibre: nomLibre,
      }).unwrap();
      onEnregistre();
    } catch (e) {
      setMsg({
        type: "error",
        texte: e?.data?.message || "Modification impossible.",
      });
    }
  };

  return (
    <div className="lr-modal-overlay" onClick={onClose}>
      <div className="lr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lr-modal-head">
          <h2>Modifier la liste</h2>
          <button className="lr-icon-btn" onClick={onClose}>
            <HiX />
          </button>
        </div>

        <div className="lr-form-grid">
          <label className="lr-field">
            <span>Nom de la liste</span>
            <input value={nom} onChange={(e) => setNom(e.target.value)} />
          </label>
          <label className="lr-field">
            <span>Rayon</span>
            <input value={rayon} onChange={(e) => setRayon(e.target.value)} />
          </label>
          <label className="lr-field lr-field-wide">
            <span>Observation</span>
            <input
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
            />
          </label>
        </div>

        <ChoixNommage
          valeur={nommage}
          onValeur={setNommage}
          libre={nomLibre}
          onLibre={setNomLibre}
        />
        <p className="lr-hint">
          {demande.source === "proforma"
            ? `Proforma ${demande.sourceRef}.`
            : "Liste manuelle : « N° de proforma » retombe sur le gisement."}{" "}
          Le contenu du fichier de transfert ne change jamais.
        </p>

        {msg && <div className={`lr-msg lr-msg-${msg.type}`}>{msg.texte}</div>}

        <div className="lr-modal-foot">
          <span className="lr-hint">
            Modifiable tant que la préparation n'a pas commencé.
          </span>
          <div className="lr-foot-actions">
            <button className="lr-btn lr-btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button
              className="lr-btn lr-btn-primary"
              onClick={enregistrer}
              disabled={isLoading}
            >
              {isLoading ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Performances de préparation par opérateur (CDC §1)                   */
const StatsPanel = ({ nomDossierDBF, entreprise }) => {
  const [debut, setDebut] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return fmtJour(d);
  });
  const [fin, setFin] = useState(() => fmtJour(new Date()));

  const { data, isLoading, isFetching, refetch } = useGetStatsPreparateursQuery(
    { nomDossierDBF, debut, fin },
    { skip: !nomDossierDBF },
  );

  const operateurs = data?.operateurs || [];
  const t = data?.totaux;

  const exporterExcel = () => {
    const lignes = operateurs.map((o) => ({
      Opérateur: o.operateur,
      Réappros: o.nbListes,
      Lignes: o.nbLignes,
      "Lignes prises": o.nbPrises,
      Introuvables: o.nbIntrouvables,
      Unités: o.unites,
      "Temps effectif (min)": Math.round(o.tempsActifMs / 60000),
      "Temps brut (min)": Math.round(o.tempsBrutMs / 60000),
      "Temps moyen / ligne (s)": Math.round(o.tempsMoyenLigneMs / 1000),
      "Listes sans mesure": o.listesSansTemps,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(lignes),
      "Préparateurs",
    );
    XLSX.writeFile(
      wb,
      `reappro_stats_${entreprise?.trigramme || nomDossierDBF}_${debut}_${fin}.xlsx`,
    );
  };

  return (
    <div className="lr-stats">
      <div className="lr-toolbar">
        <label className="lr-field">
          <span>Du</span>
          <input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} />
        </label>
        <label className="lr-field">
          <span>Au</span>
          <input type="date" value={fin} onChange={(e) => setFin(e.target.value)} />
        </label>
        <button className="lr-btn lr-btn-ghost" onClick={refetch} disabled={isFetching}>
          <HiRefresh /> Actualiser
        </button>
        <button
          className="lr-btn lr-btn-ghost"
          onClick={exporterExcel}
          disabled={operateurs.length === 0}
        >
          <HiDownload /> Export Excel
        </button>
      </div>

      {isLoading ? (
        <Loader />
      ) : operateurs.length === 0 ? (
        <div className="lr-empty">
          <HiClipboardList className="lr-empty-icon" />
          <h2>Aucune liste terminée sur la période</h2>
          <p>Les statistiques se remplissent au fur et à mesure des préparations.</p>
        </div>
      ) : (
        <>
          <div className="lr-table-wrap">
            <table className="lr-table">
              <thead>
                <tr>
                  <th>Opérateur</th>
                  <th className="lr-num">Réappros</th>
                  <th className="lr-num">Lignes</th>
                  <th className="lr-num">Prises</th>
                  <th className="lr-num">Introuvables</th>
                  <th className="lr-num">Unités</th>
                  <th className="lr-num">Temps effectif</th>
                  <th className="lr-num">Temps brut</th>
                  <th className="lr-num">Moyenne / ligne</th>
                </tr>
              </thead>
              <tbody>
                {operateurs.map((o) => (
                  <tr key={o.operateur}>
                    <td>
                      {o.operateur}
                      {o.listesSansTemps > 0 && (
                        <span
                          className="lr-ref"
                          title="Listes préparées avant la mesure du temps : non comptées dans le temps effectif"
                        >
                          {o.listesSansTemps} sans mesure
                        </span>
                      )}
                    </td>
                    <td className="lr-num">{fmtNb(o.nbListes)}</td>
                    <td className="lr-num">{fmtNb(o.nbLignes)}</td>
                    <td className="lr-num">{fmtNb(o.nbPrises)}</td>
                    <td className="lr-num">{fmtNb(o.nbIntrouvables)}</td>
                    <td className="lr-num">{fmtNb(o.unites)}</td>
                    <td className="lr-num">{fmtDuree(o.tempsActifMs)}</td>
                    <td className="lr-num">{fmtDuree(o.tempsBrutMs)}</td>
                    <td className="lr-num">{fmtDuree(o.tempsMoyenLigneMs)}</td>
                  </tr>
                ))}
                {t && (
                  <tr className="lr-total">
                    <td>Total</td>
                    <td className="lr-num">{fmtNb(t.nbListes)}</td>
                    <td className="lr-num">{fmtNb(t.nbLignes)}</td>
                    <td className="lr-num">{fmtNb(t.nbPrises)}</td>
                    <td className="lr-num">{fmtNb(t.nbIntrouvables)}</td>
                    <td className="lr-num">{fmtNb(t.unites)}</td>
                    <td className="lr-num">{fmtDuree(t.tempsActifMs)}</td>
                    <td className="lr-num">{fmtDuree(t.tempsBrutMs)}</td>
                    <td className="lr-num">{fmtDuree(t.tempsMoyenLigneMs)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="lr-legende">
            <strong>Temps effectif</strong> : temps réellement passé à préparer —
            on additionne les intervalles entre articles validés et on ignore les
            interruptions de plus de{" "}
            {Math.round((data?.seuilPauseMs || 300000) / 60000)} minutes.{" "}
            <strong>Temps brut</strong> : de l'ouverture de la liste à sa
            validation, pauses comprises.
          </p>
        </>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Détail d'une liste : les articles et, si préparée, ce qui a été pris */
const DetailModal = ({ demande, chargement, onClose }) => (
  <div className="lr-modal-overlay" onClick={onClose}>
    <div className="lr-modal" onClick={(e) => e.stopPropagation()}>
      <div className="lr-modal-head">
        <h2>{demande.nom || demande.gisement}</h2>
        <button className="lr-icon-btn" onClick={onClose}>
          <HiX />
        </button>
      </div>
      <div className="lr-modal-sub">
        {STATUT_LABEL[demande.statut]} · {fmtNb(demande.nbArticles)} articles ·{" "}
        {fmtNb(demande.totalQuantite)} unités
        {demande.operateur?.nom ? ` · ${demande.operateur.nom}` : ""}
      </div>
      {chargement ? (
        <Loader />
      ) : (
        <div className="lr-modal-body">
          <table className="lr-table lr-table-compact">
            <thead>
              <tr>
                <th>Article</th>
                <th>Désignation</th>
                <th className="lr-num">Demandé</th>
                <th className="lr-num">Pris</th>
                <th className="lr-num">Stock</th>
                <th>État</th>
              </tr>
            </thead>
            <tbody>
              {(demande.articles || []).map((a) => (
                <tr key={a.nart}>
                  <td className="lr-mono">{a.nart}</td>
                  <td>{a.design}</td>
                  <td className="lr-num">{fmtNb(a.quantiteDemandee)}</td>
                  <td className="lr-num">{fmtNb(a.quantitePrise)}</td>
                  <td className="lr-num">{fmtNb(a.stock)}</td>
                  <td>
                    {a.statutLigne === "prise"
                      ? "Pris"
                      : a.statutLigne === "introuvable"
                        ? "Introuvable"
                        : "À faire"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  </div>
);

/* ------------------------------------------------------------------ */
/* Création manuelle : entête + panier de codes (NART / gencode / REFER) */
const CreationModal = ({ nomDossierDBF, onClose, onCree }) => {
  const [nom, setNom] = useState("");
  const [rayon, setRayon] = useState("");
  const [observation, setObservation] = useState("");
  const [priorite, setPriorite] = useState("a_faire");
  const [nommage, setNommage] = useState("gisement");
  const [nomLibre, setNomLibre] = useState("");
  const [code, setCode] = useState("");
  const [quantite, setQuantite] = useState("1");
  const [panier, setPanier] = useState([]);
  const [msg, setMsg] = useState(null);

  const [resoudre, { isFetching: resolution }] = useLazyGetArticleReapproQuery();
  const [creerPanier, { isLoading: envoi }] = useCreateDemandePanierMutation();

  const ajouter = async (e) => {
    e?.preventDefault();
    const valeur = code.trim();
    if (!valeur) return;
    setMsg(null);
    try {
      const art = await resoudre({ nomDossierDBF, nart: valeur }).unwrap();
      if (panier.some((p) => p.nart === art.nart)) {
        setMsg({ type: "warn", texte: `${art.nart} est déjà dans la liste.` });
        return;
      }
      const q = Math.max(1, Math.round(Number(quantite) || 1));
      setPanier((p) => [...p, { ...art, quantite: q }]);
      setCode("");
      setQuantite("1");
    } catch (err) {
      setMsg({
        type: "error",
        texte:
          err?.data?.message ||
          "Code inconnu (ni code article, ni code-barres, ni référence fournisseur).",
      });
    }
  };

  const changerQte = (nart, val) =>
    setPanier((p) =>
      p.map((x) =>
        x.nart === nart
          ? { ...x, quantite: Math.max(1, Math.round(Number(val) || 1)) }
          : x,
      ),
    );
  const retirer = (nart) => setPanier((p) => p.filter((x) => x.nart !== nart));

  const enregistrer = async () => {
    if (panier.length === 0) return;
    setMsg(null);
    try {
      const res = await creerPanier({
        nomDossierDBF,
        nom,
        rayon,
        priorite,
        commentaire: observation,
        nommageTransfert: nommage,
        nomTransfertLibre: nomLibre,
        articles: panier.map((p) => ({ nart: p.nart, quantite: p.quantite })),
      }).unwrap();
      if (res?.inconnus?.length) {
        setMsg({
          type: "warn",
          texte: `Liste créée, codes ignorés : ${res.inconnus.join(", ")}`,
        });
        return;
      }
      onCree();
    } catch (err) {
      setMsg({ type: "error", texte: err?.data?.message || "Création impossible." });
    }
  };

  const totalUnites = panier.reduce((s, p) => s + p.quantite, 0);

  return (
    <div className="lr-modal-overlay" onClick={onClose}>
      <div className="lr-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lr-modal-head">
          <h2>Nouvelle liste de réappro</h2>
          <button className="lr-icon-btn" onClick={onClose}>
            <HiX />
          </button>
        </div>

        <div className="lr-form-grid">
          <label className="lr-field">
            <span>Nom de la liste</span>
            <input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder="ex : réappro visserie"
            />
          </label>
          <label className="lr-field">
            <span>Rayon (facultatif)</span>
            <input
              value={rayon}
              onChange={(e) => setRayon(e.target.value)}
              placeholder="ex : quincaillerie"
            />
          </label>
          <label className="lr-field">
            <span>Urgence</span>
            <select value={priorite} onChange={(e) => setPriorite(e.target.value)}>
              {URGENCES.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <label className="lr-field lr-field-wide">
            <span>Observation</span>
            <input
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder="précision pour le préparateur"
            />
          </label>
        </div>

        <ChoixNommage
          valeur={nommage}
          onValeur={setNommage}
          libre={nomLibre}
          onLibre={setNomLibre}
        />
        <p className="lr-hint">
          Nomme le fichier <code>.dat</code> déposé dans collect_sec. Son
          contenu, lui, ne change jamais.
        </p>

        <form className="lr-add-row" onSubmit={ajouter}>
          <input
            className="lr-add-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code article, code-barres ou référence fournisseur"
            autoFocus
          />
          <input
            className="lr-add-qte"
            type="number"
            min="1"
            value={quantite}
            onChange={(e) => setQuantite(e.target.value)}
          />
          <button
            type="submit"
            className="lr-btn lr-btn-primary"
            disabled={!code.trim() || resolution}
          >
            <HiPlus /> {resolution ? "Recherche…" : "Ajouter"}
          </button>
        </form>

        {msg && <div className={`lr-msg lr-msg-${msg.type}`}>{msg.texte}</div>}

        <div className="lr-modal-body">
          {panier.length === 0 ? (
            <p className="lr-hint">
              Ajoutez des articles : la quantité demandée n'est pas limitée au
              stock, le stock est affiché à titre indicatif.
            </p>
          ) : (
            <table className="lr-table lr-table-compact">
              <thead>
                <tr>
                  <th>Article</th>
                  <th>Désignation</th>
                  <th className="lr-num">Stock</th>
                  <th className="lr-num">Quantité</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {panier.map((p) => (
                  <tr key={p.nart}>
                    <td className="lr-mono">{p.nart}</td>
                    <td>{p.design}</td>
                    <td className="lr-num">{fmtNb(p.stock)}</td>
                    <td className="lr-num">
                      <input
                        className="lr-qte-input"
                        type="number"
                        min="1"
                        value={p.quantite}
                        onChange={(e) => changerQte(p.nart, e.target.value)}
                      />
                    </td>
                    <td className="lr-actions">
                      <button
                        className="lr-icon-btn lr-icon-danger"
                        onClick={() => retirer(p.nart)}
                        title="Retirer"
                      >
                        <HiTrash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="lr-modal-foot">
          <span className="lr-hint">
            {panier.length} article(s) · {fmtNb(totalUnites)} unité(s)
          </span>
          <div className="lr-foot-actions">
            <button className="lr-btn lr-btn-ghost" onClick={onClose}>
              Annuler
            </button>
            <button
              className="lr-btn lr-btn-primary"
              onClick={enregistrer}
              disabled={panier.length === 0 || envoi}
            >
              {envoi ? "Création…" : "Créer la liste"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ListesReapproScreen;
