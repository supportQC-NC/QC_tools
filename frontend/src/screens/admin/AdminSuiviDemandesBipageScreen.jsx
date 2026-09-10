// src/screens/admin/AdminSuiviDemandesBipageScreen.jsx
//
// SUIVI DES DEMANDES DE BIPAGE (bipage « terrain ») : ce qui a été envoyé aux
// collecteurs depuis le web, ce qui a été bipé, par qui et en combien de temps.
//
// ⚠️ À ne pas confondre avec « Suivi bipage inventaire » (/admin/suivi-bipage),
// qui suit le
// bipage d'INVENTAIRE zone par zone et se vide à chaque réinitialisation
// d'inventaire. Deux cycles de vie différents, donc deux écrans : celui-ci vit
// avec les demandes (DemandeBipage), l'autre avec l'inventaire en cours.
import React, { useMemo, useState } from "react";
import {
  HiClipboardCheck,
  HiRefresh,
  HiSearch,
  HiDeviceMobile,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import { useGetSuiviDemandesBipageQuery } from "../../slices/demandeBipageApiSlice";
// Feuille de style COMMUNE aux écrans de suivi terrain (bipage, réappro).
import "./SuiviTerrain.css";

const STATUT_LABEL = {
  en_attente: "En attente",
  en_cours: "En cours",
  realisee: "Réalisée",
};
const SOURCE_LABEL = {
  proforma: "Proforma",
  gisement: "Gisement",
  groupe: "Groupe",
  manuel: "Manuelle",
};
const PRIORITE_LABEL = { urgent: "Urgent", a_faire: "À faire", normal: "Normal" };

// Fenêtres proposées. « Tout l'historique » reste possible mais n'est pas le
// défaut : les demandes ne sont jamais purgées.
const FENETRES = [
  { value: 7, label: "7 jours" },
  { value: 30, label: "30 jours" },
  { value: 90, label: "90 jours" },
  { value: 0, label: "Tout l'historique" },
];

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// Délai création → réalisation. En minutes tant que c'est lisible, puis en
// heures : « 1 412 min » ne dit rien à personne.
const fmtDelai = (min) => {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const reste = min % 60;
  if (h < 24) return reste ? `${h} h ${reste} min` : `${h} h`;
  const j = Math.floor(h / 24);
  return `${j} j ${h % 24} h`;
};

const fmtInt = (v) =>
  Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("fr-FR") : "—";

const AdminSuiviDemandesBipageScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier) || "";

  const [statut, setStatut] = useState("tous");
  const [jours, setJours] = useState(30);
  const [search, setSearch] = useState("");

  const { data, isFetching, refetch } = useGetSuiviDemandesBipageQuery(
    { nomDossierDBF, statut: statut === "tous" ? undefined : statut, jours },
    { skip: !nomDossierDBF, refetchOnMountOrArgChange: true },
  );

  const demandes = useMemo(() => data?.demandes || [], [data]);
  const totaux = data?.totaux;

  const filtrees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return demandes;
    return demandes.filter((d) =>
      [d.libelle, d.sourceRef, d.createdByNom, d.realisedByNom]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [demandes, search]);

  if (!nomDossierDBF) {
    return (
      <div className="st-screen">
        <div className="st-placeholder">
          <HiClipboardCheck />
          <p>
            Sélectionnez une société dans l'en-tête pour consulter le suivi des
            bipages.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="st-screen">
      <div className="st-header">
        <h1>
          <HiClipboardCheck /> Suivi bipage terrain
        </h1>
        <button className="st-btn-icon" onClick={refetch} title="Rafraîchir">
          <HiRefresh className={isFetching ? "st-spin" : ""} />
        </button>
      </div>
      <p className="st-intro">
        Ce que les collecteurs ont reçu et bipé, demande par demande. Le comptage
        d'inventaire par zone se suit ailleurs, sur « Suivi bipage inventaire ».
      </p>

      {/* Compteurs de la fenêtre affichée */}
      <div className="st-kpis">
        <div className="st-kpi">
          <span className="st-kpi-lbl">En attente</span>
          <span className="st-kpi-val">{fmtInt(totaux?.en_attente ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">En cours</span>
          <span className="st-kpi-val">{fmtInt(totaux?.en_cours ?? 0)}</span>
        </div>
        <div className="st-kpi st-kpi-ok">
          <span className="st-kpi-lbl">Réalisées</span>
          <span className="st-kpi-val">{fmtInt(totaux?.realisee ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Articles demandés</span>
          <span className="st-kpi-val">{fmtInt(totaux?.articles ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Lignes bipées</span>
          <span className="st-kpi-val">{fmtInt(totaux?.lignesBipees ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Unités comptées</span>
          <span className="st-kpi-val">{fmtInt(totaux?.unites ?? 0)}</span>
        </div>
      </div>

      {/* Filtres */}
      <div className="st-toolbar">
        <div className="st-search">
          <HiSearch />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Demande, gisement, groupe, agent…"
          />
        </div>
        <label className="st-field">
          <span>Statut</span>
          <select value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="tous">Tous</option>
            <option value="actif">À faire (en attente + en cours)</option>
            <option value="en_attente">En attente</option>
            <option value="en_cours">En cours</option>
            <option value="realisee">Réalisées</option>
          </select>
        </label>
        <label className="st-field">
          <span>Période</span>
          <select
            value={jours}
            onChange={(e) => setJours(Number(e.target.value))}
          >
            {FENETRES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Tableau */}
      <div className="st-table-wrap">
        <table className="st-table">
          <thead>
            <tr>
              <th>Demande</th>
              <th>Source</th>
              <th>Priorité</th>
              <th>Statut</th>
              <th>Créée par</th>
              <th>Créée le</th>
              <th>Bipée par</th>
              <th>Bipée le</th>
              <th className="st-num">Articles</th>
              <th className="st-num">Lignes bipées</th>
              <th className="st-num">Unités</th>
              <th className="st-num">Délai</th>
            </tr>
          </thead>
          <tbody>
            {filtrees.length === 0 ? (
              <tr>
                <td colSpan={12} className="st-empty">
                  {isFetching
                    ? "Chargement…"
                    : "Aucune demande de bipage sur cette période."}
                </td>
              </tr>
            ) : (
              filtrees.map((d) => (
                <tr key={d._id}>
                  <td>
                    <span className="st-libelle">{d.libelle || "—"}</span>
                    {d.commentaire && (
                      <span className="st-comment">{d.commentaire}</span>
                    )}
                  </td>
                  <td>{SOURCE_LABEL[d.source] || d.source}</td>
                  <td>
                    <span className={`st-prio st-prio-${d.priorite}`}>
                      {PRIORITE_LABEL[d.priorite] || d.priorite}
                    </span>
                  </td>
                  <td>
                    <span className={`st-statut st-statut-${d.statut}`}>
                      {STATUT_LABEL[d.statut] || d.statut}
                    </span>
                  </td>
                  <td>{d.createdByNom || "—"}</td>
                  <td>{fmtDate(d.createdAt)}</td>
                  <td>
                    {d.realisedByNom ? (
                      <span className="st-agent">
                        <HiDeviceMobile /> {d.realisedByNom}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{fmtDate(d.realisedAt)}</td>
                  <td className="st-num">{fmtInt(d.nbArticles)}</td>
                  <td className="st-num">{fmtInt(d.nbLignesBipees)}</td>
                  <td className="st-num">{fmtInt(d.unitesBipees)}</td>
                  <td className="st-num">{fmtDelai(d.delaiMinutes)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AdminSuiviDemandesBipageScreen;
