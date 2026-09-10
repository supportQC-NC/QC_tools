// src/screens/admin/AdminSuiviPreparationScreen.jsx
//
// SUIVI DES PRÉPARATIONS DE COMMANDE — les deux façons de préparer, au même
// endroit :
//   - « Collecteur » : préparation scannée sur l'app mobile (parcours dock puis
//     magasin, avancement ligne à ligne, colisage) ;
//   - « Fiche papier » : fiche imprimée depuis le web et marquée « préparée »
//     à la main.
//
// ⚠️ Une fiche marquée « préparée » apparaît ici comme préparée mais reste
// visible sur l'écran « Préparation de commande manuelle » : ce sont deux
// lectures du même document, pas deux étapes d'un flux.
import React, { useMemo, useState } from "react";
import {
  HiRefresh,
  HiSearch,
  HiDeviceMobile,
  HiClipboardList,
  HiDocumentReport,
  HiMail,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalDossier } from "../../slices/entrepriseGlobalSlice";
import { useGetSuiviPreparationsQuery } from "../../slices/suiviPreparationApiSlice";
// Feuille de style COMMUNE aux écrans de suivi terrain (bipage, réappro,
// préparation).
import "./SuiviTerrain.css";

const STATUT_LABEL = {
  a_faire: "À préparer",
  en_cours: "En cours",
  prepare: "Préparée",
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

const fmtDuree = (ms) => {
  if (!ms || ms <= 0) return "—";
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const reste = min % 60;
  if (h < 24) return reste ? `${h} h ${reste} min` : `${h} h`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
};

// ⚠️ Quantités : `prodet.QTE` est un N(x.3), beaucoup d'articles se vendent au
// mètre. On ne les arrondit jamais à l'unité (3 décimales, zéros de fin
// supprimés) — seuls les COMPTEURS de lignes sont des entiers.
const fmtQte = (v) =>
  Number.isFinite(Number(v))
    ? Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 3 })
    : "—";
const fmtInt = (v) =>
  Number.isFinite(Number(v)) ? Math.round(Number(v)).toLocaleString("fr-FR") : "—";

const AdminSuiviPreparationScreen = () => {
  const nomDossierDBF = useSelector(selectGlobalDossier) || "";

  const [etat, setEtat] = useState("tous");
  const [origine, setOrigine] = useState("tous");
  const [jours, setJours] = useState(15);
  const [search, setSearch] = useState("");

  const { data, isFetching, refetch } = useGetSuiviPreparationsQuery(
    {
      nomDossierDBF,
      etat: etat === "tous" ? undefined : etat,
      origine: origine === "tous" ? undefined : origine,
      jours,
    },
    { skip: !nomDossierDBF, refetchOnMountOrArgChange: true },
  );

  const lignes = useMemo(() => data?.lignes || [], [data]);
  const totaux = data?.totaux;

  const filtrees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return lignes;
    return lignes.filter((l) =>
      [l.numpro, l.client, l.vendeur, l.operateur]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [lignes, search]);

  if (!nomDossierDBF) {
    return (
      <div className="st-screen">
        <div className="st-placeholder">
          <HiClipboardList />
          <p>
            Sélectionnez une société dans l'en-tête pour consulter le suivi des
            préparations.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="st-screen">
      <div className="st-header">
        <h1>
          <HiClipboardList /> Suivi des préparations
        </h1>
        <button className="st-btn-icon" onClick={refetch} title="Rafraîchir">
          <HiRefresh className={isFetching ? "st-spin" : ""} />
        </button>
      </div>
      <p className="st-intro">
        Les commandes en cours de préparation et celles qui viennent d'être
        préparées, qu'elles soient faites <b>au collecteur</b> ou sur une{" "}
        <b>fiche papier</b> marquée « préparée » depuis le web. Une fiche suivie
        ici reste visible sur l'écran « Préparation de commande manuelle ».
      </p>

      <div className="st-kpis">
        <div className="st-kpi">
          <span className="st-kpi-lbl">À préparer</span>
          <span className="st-kpi-val">{fmtInt(totaux?.a_faire ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">En cours</span>
          <span className="st-kpi-val">{fmtInt(totaux?.en_cours ?? 0)}</span>
        </div>
        <div className="st-kpi st-kpi-ok">
          <span className="st-kpi-lbl">Préparées</span>
          <span className="st-kpi-val">{fmtInt(totaux?.prepare ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Au collecteur</span>
          <span className="st-kpi-val">{fmtInt(totaux?.scannee ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Fiches papier</span>
          <span className="st-kpi-val">{fmtInt(totaux?.manuelle ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Unités préparées</span>
          <span className="st-kpi-val">{fmtQte(totaux?.unites ?? 0)}</span>
        </div>
        <div className="st-kpi">
          <span className="st-kpi-lbl">Colis / palettes</span>
          <span className="st-kpi-val">{fmtInt(totaux?.colis ?? 0)}</span>
        </div>
      </div>

      <div className="st-toolbar">
        <div className="st-search">
          <HiSearch />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="N° proforma, client, vendeur, préparateur…"
          />
        </div>
        <label className="st-field">
          <span>État</span>
          <select value={etat} onChange={(e) => setEtat(e.target.value)}>
            <option value="tous">Tous</option>
            <option value="actif">Non terminées</option>
            <option value="a_faire">À préparer</option>
            <option value="en_cours">En cours</option>
            <option value="prepare">Préparées</option>
          </select>
        </label>
        <label className="st-field">
          <span>Origine</span>
          <select value={origine} onChange={(e) => setOrigine(e.target.value)}>
            <option value="tous">Toutes</option>
            <option value="scannee">Collecteur</option>
            <option value="manuelle">Fiche papier</option>
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
              <th>Commande</th>
              <th>État</th>
              <th>Préparateur</th>
              <th>Début</th>
              <th>Préparée le</th>
              <th className="st-num">Lignes</th>
              <th className="st-num">Unités</th>
              <th className="st-num">Colisage</th>
              <th className="st-num">Durée</th>
              <th>Rapport</th>
            </tr>
          </thead>
          <tbody>
            {filtrees.length === 0 ? (
              <tr>
                <td colSpan={11} className="st-empty">
                  {isFetching
                    ? "Chargement…"
                    : "Aucune préparation sur cette période."}
                </td>
              </tr>
            ) : (
              filtrees.map((l) => (
                <tr key={`${l.origine}-${l.id}`}>
                  <td>
                    <span
                      className={`st-prio ${
                        l.origine === "scannee"
                          ? "st-prio-urgent"
                          : "st-prio-a_faire"
                      }`}
                    >
                      {l.origine === "scannee" ? "Collecteur" : "Fiche papier"}
                    </span>
                  </td>
                  <td>
                    <span className="st-libelle">
                      {l.numpro} · {l.client || "—"}
                    </span>
                    <span className="st-comment">
                      {[l.typeDoc, l.vendeur && `vendeur ${l.vendeur}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`st-statut st-statut-${
                        l.statut === "prepare"
                          ? "realisee"
                          : l.statut === "en_cours"
                            ? "en_cours"
                            : "en_attente"
                      }`}
                    >
                      {STATUT_LABEL[l.statut] || l.statut}
                    </span>
                    {l.etape && <span className="st-comment">{l.etape}</span>}
                  </td>
                  <td>
                    {l.operateur ? (
                      <span className="st-agent">
                        {l.origine === "scannee" && <HiDeviceMobile />}
                        {l.operateur}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{fmtDate(l.debutAt)}</td>
                  <td>{fmtDate(l.finAt)}</td>
                  <td className="st-num">
                    {l.nbLignes === null
                      ? "—"
                      : `${fmtInt(l.lignesFaites)} / ${fmtInt(l.nbLignes)}`}
                  </td>
                  <td className="st-num">
                    {l.unitesPreparees === null
                      ? "—"
                      : `${fmtQte(l.unitesPreparees)} / ${fmtQte(l.unitesCommandees)}`}
                  </td>
                  <td className="st-num">
                    {l.colisage
                      ? [
                          l.colisage.nbColis && `${l.colisage.nbColis} colis`,
                          l.colisage.nbPalettes &&
                            `${l.colisage.nbPalettes} pal.`,
                          l.colisage.nbLongueurs &&
                            `${l.colisage.nbLongueurs} long.`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "—"
                      : l.nbImpressions
                        ? `${fmtInt(l.nbImpressions)} impr.`
                        : "—"}
                  </td>
                  <td className="st-num">{fmtDuree(l.tempsMs)}</td>
                  <td>
                    {l.rapportAt ? (
                      <span className="st-agent" title={fmtDate(l.rapportAt)}>
                        <HiDocumentReport />
                        {l.emailAt && <HiMail title={fmtDate(l.emailAt)} />}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="st-intro">
        <b>Lignes</b> et <b>unités</b> ne sont comptées que pour les préparations
        faites au collecteur : rien n'est saisi ligne à ligne sur une fiche
        papier, l'écran affiche « — » plutôt qu'un faux zéro. Pour une fiche, la
        colonne colisage indique le nombre d'impressions.
      </p>
    </div>
  );
};

export default AdminSuiviPreparationScreen;
