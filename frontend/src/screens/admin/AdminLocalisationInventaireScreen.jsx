// src/screens/admin/AdminLocalisationInventaireScreen.jsx
//
// LOCALISATION INVENTAIRE (module à part entière, dossier Terrain) : où
// trouver un article en magasin, d'après les bipages d'un inventaire — l'actif
// ou un archivé (« Localisation inventaire 2026 », 2027…).
//
// L'agent choisit l'inventaire, tape ou douche un code (NART ou gencod, zéros
// de tête tolérés), et obtient CHAQUE zone où l'article a été bipé avec les
// 3 articles bipés AVANT et APRÈS dans la même séquence de scan : les voisins
// physiques de rayon. Le filtre par EMPLACEMENT (MAGASIN/DOCK…) s'applique
// SUR les résultats, en un clic, sans relancer la recherche — la recherche
// serveur ramène toujours tous les emplacements.

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  HiLocationMarker,
  HiSearch,
  HiPencil,
  HiCheck,
  HiX,
  HiTrash,
  HiExclamationCircle,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetInventairesLocalisationQuery,
  useLazyRechercherLocalisationQuery,
  useRenommerInventaireLocalisationMutation,
} from "../../slices/localisationInventaireApiSlice";
import { useDeleteZoneSessionMutation } from "../../slices/inventaireZoneApiSlice";
import "./AdminLocalisationInventaireScreen.css";

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
  // Suppression d'un inventaire archivé (ménage des tests) : ADMIN seulement,
  // le serveur refuse de toute façon (route adminOnly + cascade complète).
  const { userInfo } = useSelector((state) => state.auth);
  const isAdmin = userInfo?.role === "admin";

  const [sessionId, setSessionId] = useState("");
  const [code, setCode] = useState("");
  // Filtre d'emplacement APPLIQUÉ AUX RÉSULTATS (pas à la requête).
  const [emplFiltre, setEmplFiltre] = useState("tous");
  const [renommage, setRenommage] = useState(null); // null | texte en cours
  const [erreur, setErreur] = useState("");
  const inputRef = useRef(null);

  const { data: inventaires, isLoading: chargtInv } =
    useGetInventairesLocalisationQuery(entrepriseId, { skip: !entrepriseId });

  // Sélection par défaut : l'inventaire ACTIF, sinon le plus récent qui a des
  // lignes. Resélectionnée au changement de société.
  useEffect(() => {
    setSessionId("");
    setEmplFiltre("tous");
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

  const [lancerRecherche, { data: resultat, isFetching: recherche }] =
    useLazyRechercherLocalisationQuery();
  const [renommer, { isLoading: renommageEnCours }] =
    useRenommerInventaireLocalisationMutation();
  const [supprimerSession, { isLoading: suppressionEnCours }] =
    useDeleteZoneSessionMutation();

  const supprimerInventaire = async () => {
    if (!inventaire || inventaire.statut === "actif") return;
    if (
      !window.confirm(
        `Supprimer définitivement l'inventaire « ${
          inventaire.nom || "?"
        } — ${inventaire.annee} » ?\n\n` +
          "Toutes ses données partent avec : lignes bipées, collectes, fiches " +
          "de contrôle et bilan. Il ne sera plus localisable. Irréversible.",
      )
    ) {
      return;
    }
    setErreur("");
    try {
      await supprimerSession({ entrepriseId, id: sessionId }).unwrap();
      // Retour à la sélection par défaut (l'actif, ou le plus récent restant).
      setSessionId("");
    } catch (err) {
      setErreur(err?.data?.message || "Suppression refusée.");
    }
  };

  const chercher = async () => {
    const c = code.trim();
    setErreur("");
    if (!c || !sessionId) return;
    setEmplFiltre("tous");
    try {
      await lancerRecherche({ entrepriseId, sessionId, code: c }).unwrap();
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

  // ── Filtrage des résultats par emplacement (instantané, côté client) ──
  const occurrences = resultat?.occurrences || [];
  const emplacementsResultat = useMemo(() => {
    // Un bouton par emplacement présent dans les résultats, avec le nombre
    // de ZONES concernées (pas de séquences : c'est la question de l'agent).
    const parEmpl = new Map();
    for (const z of resultat?.totalParZone || []) {
      parEmpl.set(z.zoneType, (parEmpl.get(z.zoneType) || 0) + 1);
    }
    return [...parEmpl.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], "fr"),
    );
  }, [resultat]);

  const zonesAffichees = useMemo(
    () =>
      (resultat?.totalParZone || []).filter(
        (z) => emplFiltre === "tous" || z.zoneType === emplFiltre,
      ),
    [resultat, emplFiltre],
  );
  const occurrencesAffichees = useMemo(
    () =>
      occurrences.filter(
        (o) => emplFiltre === "tous" || o.zoneType === emplFiltre,
      ),
    [occurrences, emplFiltre],
  );

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
          {/* ── Barre inventaire + recherche : une seule bande, l'essentiel ── */}
          <div className="li-bandeau">
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
                    {isAdmin && inventaire && inventaire.statut !== "actif" && (
                      <button
                        className="li-btn-ico li-danger"
                        title="Supprimer cet inventaire archivé et toutes ses données (bipages, fiches, bilan) — irréversible"
                        disabled={suppressionEnCours}
                        onClick={supprimerInventaire}
                      >
                        <HiTrash />
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
            </div>

            <div className="li-critere li-critere-recherche">
              <label>Article</label>
              <div className="li-recherche">
                <div className="li-search">
                  <HiSearch />
                  <input
                    ref={inputRef}
                    type="text"
                    placeholder="NART ou code-barres…"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && chercher()}
                    disabled={!sessionId}
                  />
                </div>
                <button
                  className="li-btn-localiser"
                  onClick={chercher}
                  disabled={!code.trim() || !sessionId || recherche}
                >
                  {recherche ? "Recherche…" : "Localiser"}
                </button>
              </div>
            </div>
          </div>

          {inventaire && !inventaire.nbLignes && (
            <p className="li-avert">
              Cet inventaire n'a aucune ligne de bipage en base (antérieur à la
              conservation, ou jamais bipé) : rien ne pourra être localisé.
            </p>
          )}

          {erreur && (
            <p className="li-erreur">
              <HiExclamationCircle /> {erreur}
            </p>
          )}

          {/* ── Résultats ── */}
          {resultat && !recherche && (
            <>
              {occurrences.length === 0 ? (
                <div className="li-placeholder">
                  <p>
                    « {resultat.code} » n'a pas été bipé dans cet inventaire
                    {entrepriseObj?.trigramme
                      ? ` chez ${entrepriseObj.trigramme}`
                      : ""}
                    .
                  </p>
                </div>
              ) : (
                <>
                  {/* Fiche de l'article : codes COMPLETS, jamais tronqués. */}
                  <div className="li-synthese">
                    <div className="li-article">
                      <strong>{occurrences[0].designation || "Article"}</strong>
                      <div className="li-article-codes">
                        <span className="li-code-chip">
                          <label>NART</label>
                          {occurrences[0].nart || "—"}
                        </span>
                        {occurrences[0].gencod && (
                          <span className="li-code-chip">
                            <label>GENCODE</label>
                            {occurrences[0].gencod}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Filtre par EMPLACEMENT — appliqué aux résultats, en un
                      clic, sans relancer la recherche. */}
                  {emplacementsResultat.length > 1 && (
                    <div className="li-empl-filtre">
                      <span className="li-empl-filtre-lbl">Emplacement :</span>
                      <button
                        className={`li-chip li-chip-grande ${
                          emplFiltre === "tous" ? "on" : ""
                        }`}
                        onClick={() => setEmplFiltre("tous")}
                      >
                        Tous
                        <span className="li-chip-n">
                          {resultat.totalParZone.length} zone
                          {resultat.totalParZone.length > 1 ? "s" : ""}
                        </span>
                      </button>
                      {emplacementsResultat.map(([empl, nb]) => (
                        <button
                          key={empl}
                          className={`li-chip li-chip-grande ${
                            emplFiltre === empl ? "on" : ""
                          }`}
                          onClick={() =>
                            setEmplFiltre(emplFiltre === empl ? "tous" : empl)
                          }
                        >
                          {empl}
                          <span className="li-chip-n">
                            {nb} zone{nb > 1 ? "s" : ""}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Zones où l'article a été trouvé — LARGES et lisibles. */}
                  <div className="li-zones-resume">
                    {zonesAffichees.map((z) => (
                      <div
                        key={`${z.zoneCode}||${z.zoneType}`}
                        className="li-zone-pill"
                      >
                        <b>{z.zoneCode}</b>
                        <span>{z.zoneLibelle || "—"}</span>
                        <em>{z.zoneType}</em>
                      </div>
                    ))}
                  </div>

                  {resultat.tronque && (
                    <p className="li-avert">
                      Résultats tronqués : ce code sort dans un très grand
                      nombre de zones.
                    </p>
                  )}

                  {/* Une carte PLEINE LARGEUR par séquence de bipage : la
                      cible au milieu de ses voisins de rayon. */}
                  <div className="li-occurrences">
                    {occurrencesAffichees.map((o) => (
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
                            {[o.agentNom, o.bipeAt ? fmtDate(o.bipeAt) : ""]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                        {/* Les voisins de scan, dans l'ordre du rayon. La
                            position relative (−3…+3) dit à l'agent de combien
                            d'articles se décaler sur l'étagère. */}
                        <ol className="li-voisins">
                          {o.voisins.map((v) => {
                            const delta = (v.ordre || 0) - (o.ordre || 0);
                            return (
                              <li
                                key={`${o.ligneId}-${v.ordre}`}
                                className={v.cible ? "cible" : ""}
                              >
                                <span className="li-v-pos">
                                  {v.cible ? (
                                    <HiLocationMarker />
                                  ) : delta > 0 ? (
                                    `+${delta}`
                                  ) : (
                                    `−${Math.abs(delta)}`
                                  )}
                                </span>
                                <span className="li-v-infos">
                                  <span className="li-v-des">
                                    {v.designation || "—"}
                                  </span>
                                  <span className="li-v-codes">
                                    <em>NART</em> {v.nart || "—"}
                                    {v.gencod && (
                                      <>
                                        <em>GENCODE</em> {v.gencod}
                                      </>
                                    )}
                                  </span>
                                </span>
                              </li>
                            );
                          })}
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
