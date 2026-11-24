// src/screens/admin/AdminLocalisationInventaireScreen.jsx
//
// LOCALISATION INVENTAIRE (module à part entière, dossier Terrain) : où
// trouver un article en magasin, d'après les bipages d'un inventaire — l'actif
// ou un archivé (« Localisation inventaire 2026 », 2027…).
//
// L'agent choisit l'inventaire et l'emplacement (types des fiches
// d'inventaire : MAGASIN, DOCK…), tape ou douche un code (NART ou gencod,
// zéros de tête tolérés), et obtient CHAQUE zone où l'article a été bipé,
// avec les 3 articles bipés AVANT et APRÈS dans la même séquence de scan :
// les voisins physiques de rayon, les repères pour le retrouver des yeux.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HiLocationMarker,
  HiSearch,
  HiPencil,
  HiCheck,
  HiX,
  HiExclamationCircle,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetInventairesLocalisationQuery,
  useGetEmplacementsLocalisationQuery,
  useLazyRechercherLocalisationQuery,
  useRenommerInventaireLocalisationMutation,
} from "../../slices/localisationInventaireApiSlice";
import "./AdminLocalisationInventaireScreen.css";

// Quantités à 3 décimales, zéros de fin supprimés (articles au mètre).
const fmtQte = (n) => {
  const v = Number(n) || 0;
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
};

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

const AdminLocalisationInventaireScreen = () => {
  const entrepriseId = useSelector(selectGlobalEntrepriseId) || "";
  const { data: entreprises } = useGetMyEntreprisesQuery();
  const entrepriseObj = entreprises?.find((e) => e._id === entrepriseId);

  const [sessionId, setSessionId] = useState("");
  const [emplacement, setEmplacement] = useState("tous");
  const [code, setCode] = useState("");
  const [renommage, setRenommage] = useState(null); // null | texte en cours
  const [erreur, setErreur] = useState("");
  const inputRef = useRef(null);

  const { data: inventaires, isLoading: chargtInv } =
    useGetInventairesLocalisationQuery(entrepriseId, { skip: !entrepriseId });

  // Sélection par défaut : l'inventaire ACTIF, sinon le plus récent qui a des
  // lignes. Resélectionnée au changement de société.
  useEffect(() => {
    setSessionId("");
    setEmplacement("tous");
    setErreur("");
  }, [entrepriseId]);
  useEffect(() => {
    if (sessionId || !inventaires?.length) return;
    const actif = inventaires.find((i) => i.statut === "actif" && i.nbLignes);
    const defaut =
      actif || inventaires.find((i) => i.nbLignes) || inventaires[0];
    if (defaut) setSessionId(defaut._id);
  }, [inventaires, sessionId]);

  const inventaire = useMemo(
    () => (inventaires || []).find((i) => i._id === sessionId) || null,
    [inventaires, sessionId],
  );

  const { data: emplacements } = useGetEmplacementsLocalisationQuery(
    { entrepriseId, sessionId },
    { skip: !entrepriseId || !sessionId },
  );

  const [lancerRecherche, { data: resultat, isFetching: recherche }] =
    useLazyRechercherLocalisationQuery();
  const [renommer, { isLoading: renommageEnCours }] =
    useRenommerInventaireLocalisationMutation();

  const chercher = async () => {
    const c = code.trim();
    setErreur("");
    if (!c || !sessionId) return;
    try {
      await lancerRecherche({
        entrepriseId,
        sessionId,
        code: c,
        emplacement: emplacement === "tous" ? "" : emplacement,
      }).unwrap();
    } catch (err) {
      setErreur(err?.data?.message || "Recherche impossible.");
    }
    inputRef.current?.select();
  };

  const validerRenommage = async () => {
    const nom = (renommage || "").trim();
    if (!nom || !inventaire) {
      setRenommage(null);
      return;
    }
    setErreur("");
    try {
      await renommer({ entrepriseId, sessionId, nom }).unwrap();
      setRenommage(null);
    } catch (err) {
      setErreur(err?.data?.message || "Renommage refusé.");
    }
  };

  const libelleInventaire = (i) =>
    `${i.nom || "Inventaire"} — ${i.annee}${
      i.statut === "actif" ? " (en cours)" : ""
    }${i.nbLignes ? "" : " — aucune ligne"}`;

  return (
    <div className="loc-inv">
      <div className="li-header">
        <h1>
          <HiLocationMarker /> Localisation inventaire
        </h1>
      </div>

      {!entrepriseId ? (
        <div className="li-placeholder">
          <HiLocationMarker />
          <p>Sélectionnez une société dans l'en-tête.</p>
        </div>
      ) : (
        <>
          {/* ── Choix de l'inventaire + emplacement ── */}
          <div className="li-criteres">
            <div className="li-critere">
              <label>Inventaire</label>
              <div className="li-inv-select">
                {renommage === null ? (
                  <>
                    <select
                      value={sessionId}
                      onChange={(e) => setSessionId(e.target.value)}
                      disabled={chargtInv || !inventaires?.length}
                    >
                      {(inventaires || []).map((i) => (
                        <option key={i._id} value={i._id}>
                          {libelleInventaire(i)}
                        </option>
                      ))}
                    </select>
                    {inventaire && (
                      <button
                        className="li-btn-ico"
                        title="Renommer cet inventaire (ex. « QC 2026 ») — le dossier d'archive ne change pas"
                        onClick={() => setRenommage(inventaire.nom || "")}
                      >
                        <HiPencil />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      value={renommage}
                      maxLength={80}
                      autoFocus
                      onChange={(e) => setRenommage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") validerRenommage();
                        if (e.key === "Escape") setRenommage(null);
                      }}
                    />
                    <button
                      className="li-btn-ico li-ok"
                      title="Enregistrer le nom"
                      disabled={renommageEnCours}
                      onClick={validerRenommage}
                    >
                      <HiCheck />
                    </button>
                    <button
                      className="li-btn-ico"
                      title="Abandonner"
                      onClick={() => setRenommage(null)}
                    >
                      <HiX />
                    </button>
                  </>
                )}
              </div>
              {inventaire && !inventaire.nbLignes && (
                <small className="li-avert">
                  Cet inventaire n'a aucune ligne de bipage en base (antérieur à
                  la conservation, ou jamais bipé) : rien ne pourra être
                  localisé.
                </small>
              )}
            </div>

            <div className="li-critere">
              <label>Emplacement</label>
              <div className="li-chips">
                <button
                  className={`li-chip ${emplacement === "tous" ? "on" : ""}`}
                  onClick={() => setEmplacement("tous")}
                >
                  Tous
                </button>
                {(emplacements || []).map((e) => (
                  <button
                    key={e.emplacement}
                    className={`li-chip ${
                      emplacement === e.emplacement ? "on" : ""
                    }`}
                    onClick={() =>
                      setEmplacement(
                        emplacement === e.emplacement ? "tous" : e.emplacement,
                      )
                    }
                  >
                    {e.emplacement}{" "}
                    <span className="li-chip-n">{e.nbZones}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ── Recherche ── */}
          <div className="li-recherche">
            <div className="li-search">
              <HiSearch />
              <input
                ref={inputRef}
                type="text"
                placeholder="NART ou code-barres de l'article…"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && chercher()}
                disabled={!sessionId}
              />
            </div>
            <button
              className="btn-primary"
              onClick={chercher}
              disabled={!code.trim() || !sessionId || recherche}
            >
              {recherche ? "Recherche…" : "Localiser"}
            </button>
          </div>

          {erreur && (
            <p className="li-erreur">
              <HiExclamationCircle /> {erreur}
            </p>
          )}

          {/* ── Résultats ── */}
          {resultat && !recherche && (
            <>
              {resultat.occurrences.length === 0 ? (
                <div className="li-placeholder">
                  <p>
                    « {resultat.code} » n'a pas été bipé dans cet inventaire
                    {emplacement !== "tous"
                      ? ` (emplacement ${emplacement})`
                      : ""}
                    {entrepriseObj?.trigramme
                      ? ` chez ${entrepriseObj.trigramme}`
                      : ""}
                    .
                  </p>
                </div>
              ) : (
                <>
                  {/* Synthèse : où, et combien au total par zone. */}
                  <div className="li-synthese">
                    <div className="li-article">
                      <strong>
                        {resultat.occurrences[0].designation || "Article"}
                      </strong>
                      <span>
                        NART {resultat.occurrences[0].nart || "—"}
                        {resultat.occurrences[0].gencod
                          ? ` · ${resultat.occurrences[0].gencod}`
                          : ""}
                      </span>
                    </div>
                    <div className="li-zones-resume">
                      {resultat.totalParZone.map((z) => (
                        <div
                          key={`${z.zoneCode}||${z.zoneType}`}
                          className="li-zone-pill"
                        >
                          <b>{z.zoneCode}</b>
                          <span>{z.zoneLibelle || z.zoneType}</span>
                          <em>
                            {fmtQte(z.totalQte)} pce
                            {z.nbLignes > 1 ? ` · ${z.nbLignes} séquences` : ""}
                          </em>
                        </div>
                      ))}
                    </div>
                  </div>
                  {resultat.tronque && (
                    <p className="li-avert">
                      Résultats tronqués : ce code sort dans un très grand
                      nombre de zones, affinez avec l'emplacement.
                    </p>
                  )}

                  {/* Une carte par séquence de bipage, avec les voisins. */}
                  <div className="li-occurrences">
                    {resultat.occurrences.map((o) => (
                      <div className="li-occ" key={o.ligneId}>
                        <div className="li-occ-head">
                          <div className="li-occ-zone">
                            <span className="li-occ-code">{o.zoneCode}</span>
                            <span className="li-occ-lib">
                              {o.zoneLibelle || "—"}
                            </span>
                            <span className="li-occ-empl">{o.zoneType}</span>
                          </div>
                          <div className="li-occ-meta">
                            <b>{fmtQte(o.qteScan)}</b> comptés
                            {o.agentNom ? ` · ${o.agentNom}` : ""}
                            {o.bipeAt ? ` · ${fmtDate(o.bipeAt)}` : ""}
                          </div>
                        </div>
                        {/* Les voisins de scan : avant → cible → après. */}
                        <ol className="li-voisins">
                          {o.voisins.map((v) => (
                            <li
                              key={`${o.ligneId}-${v.ordre}`}
                              className={v.cible ? "cible" : ""}
                            >
                              <span className="li-v-nart">{v.nart || "—"}</span>
                              <span className="li-v-des">
                                {v.designation || v.gencod || "—"}
                              </span>
                              <span className="li-v-qte">
                                {fmtQte(v.qteScan)}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default AdminLocalisationInventaireScreen;
