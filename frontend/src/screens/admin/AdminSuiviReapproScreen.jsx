// src/screens/admin/AdminSuiviReapproScreen.jsx
//
// SUIVI DES RÉAPPROS : ce qui est en train de se faire au collecteur, et ce qui
// vient d'être terminé.
//
// ⚠️ Deux façons de faire un réappro, donc deux origines fusionnées ici :
//   - « Liste »  : une liste poussée depuis le web (écran Listes de réappro),
//                  ouverte par un opérateur qui la déroule ligne à ligne ;
//   - « Libre »  : l'agent scanne ce qu'il veut depuis l'app mobile, sans liste.
// Un écran qui n'en montrerait qu'une seule laisserait la moitié du travail
// invisible.
import React, { useMemo, useState } from "react";
import {
  HiRefresh,
  HiSearch,
  HiDeviceMobile,
  HiClipboardList,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import { useGetSuiviReapprosQuery } from "../../slices/demandeReapproApiSlice";
// Feuille de style COMMUNE aux écrans de suivi terrain (bipage, réappro).
import "./SuiviTerrain.css";

const STATUT_LABEL = {
  a_faire: "À faire",
  en_cours: "En cours",
  termine: "Terminé",
};
const SOURCE_LABEL = {
  manuel: "Manuelle",
  proforma: "Proforma",
  rapport: "Rapport",
  libre: "Réappro libre",
};

const FENETRES = [
  { value: 7, label: "7 jours" },
  { value: 15, label: "15 jours" },
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

// Durées : minutes tant que c'est lisible, puis heures. « 412 min » ne parle
// à personne au-delà d'une heure de travail.
const fmtDuree = (ms) => {
  if (!ms || ms <= 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const reste = min % 60;
  if (h < 24) return reste ? `${h} h ${reste} min` : `${h} h`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
};

const fmtInt = (v) =>
  Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("fr-FR") : "—";

const AdminSuiviReapproScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier) || "";

  const [etat, setEtat] = useState("tous");
  const [type, setType] = useState("tous");
  const [jours, setJours] = useState(15);
  const [search, setSearch] = useState("");

  const { data, isFetching, refetch } = useGetSuiviReapprosQuery(
    { nomDossierDBF, etat: etat === "tous" ? undefined : etat, jours },
    { skip: !nomDossierDBF, refetchOnMountOrArgChange: true },
  );

  const lignes = useMemo(() => data?.lignes || [], [data]);
  const totaux = data?.totaux;

  const filtrees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lignes.filter((l) => {
      if (type !== "tous" && l.type !== type) return false;
      if (!q) return true;
      return [l.libelle, l.detail, l.operateur, l.creePar]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [lignes, type, search]);

  if (!nomDossierDBF) {
    return (
      <div className="st-screen">
        <div className="st-placeholder">
          <HiClipboardList />
          <p>
            Sélectionnez une société dans l'en-tête pour consulter le suivi des
            réappros.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="st-screen">
      <div className="st-header">
        <h1>
          <HiClipboardList /> Suivi des réappros
        </h1>
        <button className="st-btn-icon" onClick={refetch} title="Rafraîchir">
          <HiRefresh className={isFetching ? "st-spin" : ""} />
        </button>
      </div>
      <p className="st-intro">
        Les réappros en cours et terminés au collecteur, qu'ils viennent d'une
        <b> liste </b> poussée depuis le web ou d'un <b>réappro libre</b> lancé
        depuis l'application mobile.
      </p>

      <div className="st-kpis">
        <div className="st-kpi">
          <span className="st-kpi-lbl">À faire</span>
          <span className="st-kpi-val">{fmtInt(totaux?.a_faire ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">En cours</span>
          <span className="st-kpi-val">{fmtInt(totaux?.en_cours ?? 0)}</span>
        </div>
        <div className="st-kpi st-kpi-ok">
          <span className="st-kpi-lbl">Terminés</span>
          <span className="st-kpi-val">{fmtInt(totaux?.termine ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Depuis une liste</span>
          <span className="st-kpi-val">{fmtInt(totaux?.liste ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Réappros libres</span>
          <span className="st-kpi-val">{fmtInt(totaux?.libre ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Lignes prises</span>
          <span className="st-kpi-val">{fmtInt(totaux?.lignes ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Unités</span>
          <span className="st-kpi-val">{fmtInt(totaux?.unites ?? 0)}</span>
        </div>
      </div>

      <div className="st-toolbar">
        <div className="st-search">
          <HiSearch />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Liste, gisement, opérateur…"
          />
        </div>
        <label className="st-field">
          <span>État</span>
          <select value={etat} onChange={(e) => setEtat(e.target.value)}>
            <option value="tous">Tous</option>
            <option value="actif">En cours de traitement</option>
            <option value="a_faire">À faire</option>
            <option value="en_cours">Ouverts par un opérateur</option>
            <option value="termine">Terminés</option>
          </select>
        </label>
        <label className="st-field">
          <span>Origine</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="tous">Toutes</option>
            <option value="liste">Depuis une liste</option>
            <option value="libre">Réappro libre</option>
          </select>
        </label>
        <label className="st-field">
          <span>Période</span>
          <select value={jours} onChange={(e) => setJours(Number(e.target.value))}>
            {FENETRES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="st-table-wrap">
        <table className="st-table">
          <thead>
            <tr>
              <th>Origine</th>
              <th>Réappro</th>
              <th>État</th>
              <th>Opérateur</th>
              <th>Début</th>
              <th>Dernière activité</th>
              <th>Terminé le</th>
              <th className="st-num">Avancement</th>
              <th className="st-num">Unités</th>
              <th className="st-num">Temps effectif</th>
              <th className="st-num">Temps brut</th>
            </tr>
          </thead>
          <tbody>
            {filtrees.length === 0 ? (
              <tr>
                <td colSpan={11} className="st-empty">
                  {isFetching
                    ? "Chargement…"
                    : "Aucun réappro sur cette période."}
                </td>
              </tr>
            ) : (
              filtrees.map((l) => (
                <tr key={`${l.type}-${l.id}`}>
                  <td>
                    <span
                      className={`st-prio ${
                        l.type === "libre" ? "st-prio-urgent" : "st-prio-a_faire"
                      }`}
                    >
                      {l.type === "libre" ? "Libre" : "Liste"}
                    </span>
                  </td>
                  <td>
                    <span className="st-libelle">{l.libelle}</span>
                    <span className="st-comment">
                      {[l.detail, SOURCE_LABEL[l.source] || l.source]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </td>
                  <td>
                    <span className={`st-statut st-statut-${l.statut}`}>
                      {STATUT_LABEL[l.statut] || l.statut}
                    </span>
                  </td>
                  <td>
                    {l.operateur ? (
                      <span className="st-agent">
                        <HiDeviceMobile /> {l.operateur}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{fmtDate(l.debutAt)}</td>
                  <td>{fmtDate(l.derniereActiviteAt)}</td>
                  <td>{fmtDate(l.finAt)}</td>
                  <td className="st-num">
                    {l.type === "liste"
                      ? `${fmtInt(l.lignesTraitees)} / ${fmtInt(l.nbArticles)}`
                      : fmtInt(l.lignesTraitees)}
                  </td>
                  <td className="st-num">{fmtInt(l.unites)}</td>
                  <td className="st-num">{fmtDuree(l.tempsActifMs)}</td>
                  <td className="st-num">{fmtDuree(l.tempsBrutMs)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="st-intro">
        <b>Temps effectif</b> : somme des intervalles entre deux gestes, silences
        de plus de 5 minutes exclus. <b>Temps brut</b> : de l'ouverture à la
        validation, pauses comprises.
      </p>
    </div>
  );
};

export default AdminSuiviReapproScreen;
