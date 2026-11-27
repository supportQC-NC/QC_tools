// src/screens/admin/AdminLocalisationInventaireScreen.jsx
//
// LOCALISATION INVENTAIRE (module à part entière, dossier Terrain) : où
// trouver un article en magasin, d'après les bipages d'un inventaire — l'actif
// ou un archivé (« Localisation inventaire 2026 », 2027…).
//
// Trois façons de répondre, dans cet ordre :
//   1. le PLAN — les zones de l'inventaire rangées par emplacement et par
//      allée, l'article épinglé là où il a été compté. C'est la vue d'arrivée
//      par défaut : « c'est dans l'allée A, troisième rayon ».
//      ⚠️ Plan SCHÉMATIQUE, déduit des codes de rayon (allée + repère) : la
//      géométrie réelle du magasin n'existe nulle part dans les données, et
//      l'écran doit le dire plutôt que laisser croire à une carte fidèle.
//   2. les SÉQUENCES de bipage — l'article au milieu des 3 articles comptés
//      avant et après lui : ses voisins physiques de rayon, pour le retrouver
//      des yeux quand l'étiquette manque.
//   3. le détail des zones, avec les quantités comptées.
//
// La recherche accepte un code (NART / code-barres, zéros de tête tolérés)
// MAIS AUSSI des mots de la désignation (« marteau pein ») : l'agent a souvent
// le produit en main sans étiquette lisible. Les suggestions arrivent à la
// frappe et portent déjà les zones — la réponse est souvent lisible sans même
// valider.
//
// Le filtre par EMPLACEMENT (MAGASIN/DOCK…) s'applique SUR les résultats, en
// un clic, sans relancer la recherche.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HiLocationMarker,
  HiSearch,
  HiPencil,
  HiCheck,
  HiX,
  HiTrash,
  HiExclamationCircle,
  HiMap,
  HiViewList,
  HiClock,
  HiCube,
  HiLightBulb,
} from "react-icons/hi";
import { useSelector } from "react-redux";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import {
  useGetInventairesLocalisationQuery,
  useLazyRechercherLocalisationQuery,
  useGetSuggestionsLocalisationQuery,
  useGetPlanLocalisationQuery,
  useRenommerInventaireLocalisationMutation,
} from "../../slices/localisationInventaireApiSlice";
import { useDeleteZoneSessionMutation } from "../../slices/inventaireZoneApiSlice";
import { fmtNombreLarge } from "../../utils/format";
import "./AdminLocalisationInventaireScreen.css";

const fmtDateHeure = (d) =>
  d
    ? new Date(d).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

// Quantités DÉCIMALES : beaucoup d'articles se vendent au mètre (tuyau, câble).
// 3 décimales, zéros de fin supprimés — jamais d'arrondi à l'unité.
const fmtQte = (n) => fmtNombreLarge(Number(n) || 0, 3);

// Provenance d'une ligne : un bipage de terrain ne se lit pas comme un ajout
// saisi au contrôle ou un delta de vérification point rouge.
const LIBELLE_SOURCE = {
  proforma: "Import proforma",
  excel: "Import Excel",
  manuel: "Ajout manuel",
  controle: "Ajout au contrôle",
  verification: "Vérif. point rouge",
};

// Historique de recherche, par société : la même référence est souvent
// cherchée plusieurs fois dans la journée (un agent au téléphone avec le
// comptoir). Purement local au navigateur.
const CLE_RECENTS = "locInv.recents.v1";
const MAX_RECENTS = 6;

const lireRecents = (entrepriseId) => {
  if (!entrepriseId) return [];
  try {
    const tout = JSON.parse(localStorage.getItem(CLE_RECENTS) || "{}");
    return Array.isArray(tout[entrepriseId]) ? tout[entrepriseId] : [];
  } catch {
    return [];
  }
};

const ecrireRecents = (entrepriseId, liste) => {
  if (!entrepriseId) return;
  try {
    const tout = JSON.parse(localStorage.getItem(CLE_RECENTS) || "{}");
    tout[entrepriseId] = liste.slice(0, MAX_RECENTS);
    localStorage.setItem(CLE_RECENTS, JSON.stringify(tout));
  } catch {
    /* navigation privée, stockage refusé : l'historique est un confort */
  }
};

const cleZone = (code, type) => `${code}||${type}`;

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
  // Saisie STABILISÉE (300 ms) : c'est elle qui déclenche les suggestions.
  const [codeDiffere, setCodeDiffere] = useState("");
  const [suggestionsOuvertes, setSuggestionsOuvertes] = useState(false);
  const [indexSurligne, setIndexSurligne] = useState(-1);
  // Vue des résultats : le PLAN d'abord (« c'est où ? »), les séquences
  // ensuite (« à quoi ça ressemble autour ? »).
  const [vue, setVue] = useState("plan");
  // Filtre d'emplacement APPLIQUÉ AUX RÉSULTATS (pas à la requête).
  const [emplFiltre, setEmplFiltre] = useState("tous");
  const [renommage, setRenommage] = useState(null); // null | texte en cours
  const [erreur, setErreur] = useState("");
  const [recents, setRecents] = useState([]);
  const [zoneFocus, setZoneFocus] = useState(""); // zone mise en avant au clic
  const inputRef = useRef(null);
  const refsZones = useRef({});

  const { data: inventaires, isLoading: chargtInv } =
    useGetInventairesLocalisationQuery(entrepriseId, { skip: !entrepriseId });

  // Sélection par défaut : l'inventaire ACTIF, sinon le plus récent qui a des
  // lignes. Resélectionnée au changement de société.
  useEffect(() => {
    setSessionId("");
    setEmplFiltre("tous");
    setErreur("");
    setRecents(lireRecents(entrepriseId));
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

  // Un nouveau résultat remet l'écran dans son état d'arrivée : le PLAN
  // (« c'est où ? ») et des ancres de scroll propres — les refs des zones de
  // la recherche précédente pointeraient sur des cartes démontées.
  useEffect(() => {
    refsZones.current = {};
    setZoneFocus("");
    setVue("plan");
  }, [resultat]);

  // ── Plan de l'inventaire : chargé dès qu'un inventaire est choisi, il sert
  //    aussi de vue d'exploration avant toute recherche. ──
  const { data: plan, isFetching: planEnCours } = useGetPlanLocalisationQuery(
    { entrepriseId, sessionId },
    { skip: !entrepriseId || !sessionId },
  );

  // ── Suggestions à la frappe ──
  useEffect(() => {
    const t = setTimeout(() => setCodeDiffere(code.trim()), 300);
    return () => clearTimeout(t);
  }, [code]);

  const qSuggestions = codeDiffere.length >= 2 ? codeDiffere : "";
  const { data: suggestionsData, isFetching: suggestionsEnCours } =
    useGetSuggestionsLocalisationQuery(
      { entrepriseId, sessionId, q: qSuggestions },
      { skip: !entrepriseId || !sessionId || !qSuggestions },
    );
  const suggestions = suggestionsData?.suggestions || [];

  const memoriserRecent = useCallback(
    (terme, article) => {
      const entree = {
        terme,
        designation: article?.designation || "",
        nart: article?.nart || "",
      };
      setRecents((prec) => {
        const liste = [
          entree,
          ...prec.filter((r) => r.terme !== terme),
        ].slice(0, MAX_RECENTS);
        ecrireRecents(entrepriseId, liste);
        return liste;
      });
    },
    [entrepriseId],
  );

  const chercher = useCallback(
    async (terme, article) => {
      const c = String(terme ?? code).trim();
      setErreur("");
      setSuggestionsOuvertes(false);
      setIndexSurligne(-1);
      if (!c || !sessionId) return;
      setEmplFiltre("tous");
      setZoneFocus("");
      if (c !== code) setCode(c);
      try {
        const res = await lancerRecherche({
          entrepriseId,
          sessionId,
          code: c,
        }).unwrap();
        // On ne retient que les recherches QUI ONT ABOUTI : un code tapé de
        // travers n'a rien à faire dans les raccourcis.
        if (res?.occurrences?.length) memoriserRecent(c, article || res.occurrences[0]);
      } catch (err) {
        setErreur(err?.data?.message || "Recherche impossible.");
      }
      inputRef.current?.select();
    },
    [code, entrepriseId, sessionId, lancerRecherche, memoriserRecent],
  );

  // Choisir une suggestion = localiser son NART (jamais le texte tapé : deux
  // articles peuvent partager des mots de désignation).
  const choisirSuggestion = (s) => {
    setCode(s.nart || s.gencod || "");
    chercher(s.nart || s.gencod || "", s);
  };

  const auClavier = (e) => {
    if (!suggestionsOuvertes || !suggestions.length) {
      if (e.key === "Enter") chercher();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndexSurligne((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndexSurligne(
        (i) => (i - 1 + suggestions.length) % suggestions.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (indexSurligne >= 0) choisirSuggestion(suggestions[indexSurligne]);
      else chercher();
    } else if (e.key === "Escape") {
      setSuggestionsOuvertes(false);
      setIndexSurligne(-1);
    }
  };

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
  // Mémoïsé : `|| []` créerait un tableau neuf à chaque rendu et relancerait
  // tous les useMemo qui en dépendent.
  const occurrences = useMemo(() => resultat?.occurrences || [], [resultat]);
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

  // Index des zones TROUVÉES, pour épingler le plan : clé « code||type » →
  // total compté dans cette zone.
  const zonesTrouvees = useMemo(() => {
    const m = new Map();
    for (const z of resultat?.totalParZone || []) {
      m.set(cleZone(z.zoneCode, z.zoneType), z);
    }
    return m;
  }, [resultat]);

  // Quantité totale comptée, toutes zones : la question « combien en tout ? »
  const totalCompte = useMemo(
    () =>
      (resultat?.totalParZone || []).reduce(
        (s, z) => s + (Number(z.totalQte) || 0),
        0,
      ),
    [resultat],
  );

  // Clic sur une zone du plan → on bascule sur ses séquences de bipage et on
  // l'amène sous les yeux. Le plan répond « où », les séquences « à côté de
  // quoi » : l'enchaînement des deux est le parcours naturel.
  const allerAuxSequences = (zoneCode, zoneType) => {
    if (!zonesTrouvees.has(cleZone(zoneCode, zoneType))) return;
    setVue("sequences");
    setZoneFocus(cleZone(zoneCode, zoneType));
    // Le rendu de la vue « séquences » doit avoir eu lieu avant le scroll.
    setTimeout(() => {
      refsZones.current[cleZone(zoneCode, zoneType)]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 60);
  };

  const libelleInventaire = (i) =>
    `${i.nom || "Inventaire"} — ${i.annee}${
      i.statut === "actif" ? " (en cours)" : ""
    }${i.nbLignes ? "" : " — aucune ligne"}`;

  const aCherche = Boolean(resultat) && !recherche;
  const articleTrouve = occurrences[0] || null;

  // ── Plan : blocs filtrés par l'emplacement sélectionné ──
  const emplacementsPlan = useMemo(
    () =>
      (plan?.emplacements || []).filter(
        (e) => emplFiltre === "tous" || e.emplacement === emplFiltre,
      ),
    [plan, emplFiltre],
  );

  return (
    <div className="loc-inv">
      {/* ── En-tête : titre + inventaire interrogé, sur une seule ligne ── */}
      <div className="li-header">
        <h1>
          <HiLocationMarker /> Localisation inventaire
        </h1>

        {entrepriseId && (
          <div className="li-inv-select">
            {renommage === null ? (
              <>
                <select
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  disabled={chargtInv || !inventaires?.length}
                  aria-label="Inventaire interrogé"
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
        )}
      </div>

      {!entrepriseId ? (
        <div className="li-placeholder">
          <HiLocationMarker />
          <p>Sélectionnez une société dans l'en-tête.</p>
        </div>
      ) : (
        <>
          {/* ── Recherche : la porte d'entrée de l'écran ── */}
          <div className="li-hero">
            <div className="li-hero-champ">
              <div className="li-search">
                <HiSearch />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Désignation, NART ou code-barres — ex. « marteau » ou 122041"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setSuggestionsOuvertes(true);
                    setIndexSurligne(-1);
                  }}
                  onFocus={() => setSuggestionsOuvertes(true)}
                  // Fermeture différée : un clic sur une suggestion doit être
                  // traité avant que la liste ne disparaisse.
                  onBlur={() =>
                    setTimeout(() => setSuggestionsOuvertes(false), 150)
                  }
                  onKeyDown={auClavier}
                  disabled={!sessionId}
                  role="combobox"
                  aria-expanded={suggestionsOuvertes && suggestions.length > 0}
                  aria-controls="li-suggestions"
                  aria-autocomplete="list"
                />
                {code && (
                  <button
                    className="li-vider"
                    title="Effacer"
                    onClick={() => {
                      setCode("");
                      inputRef.current?.focus();
                    }}
                  >
                    <HiX />
                  </button>
                )}
              </div>

              {/* Suggestions : désignation, codes et DÉJÀ les zones — la
                  réponse est souvent lisible sans valider. */}
              {suggestionsOuvertes && !!qSuggestions && (
                <ul className="li-suggestions" id="li-suggestions" role="listbox">
                  {suggestionsEnCours && !suggestions.length && (
                    <li className="li-sug-info">Recherche…</li>
                  )}
                  {!suggestionsEnCours && !suggestions.length && (
                    <li className="li-sug-info">
                      Aucun article bipé ne correspond dans cet inventaire.
                    </li>
                  )}
                  {suggestions.map((s, i) => (
                    <li
                      key={`${s.nart}-${i}`}
                      role="option"
                      aria-selected={i === indexSurligne}
                      className={i === indexSurligne ? "on" : ""}
                      onMouseEnter={() => setIndexSurligne(i)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choisirSuggestion(s)}
                    >
                      <span className="li-sug-des">
                        {s.designation || "(sans désignation)"}
                      </span>
                      <span className="li-sug-codes">
                        <em>NART</em> {s.nart || "—"}
                        {s.gencod && (
                          <>
                            <em>GENCODE</em> {s.gencod}
                          </>
                        )}
                      </span>
                      <span className="li-sug-zones">
                        {s.zones.slice(0, 4).map((z) => (
                          <b key={`${z.zoneCode}-${z.zoneType}`}>{z.zoneCode}</b>
                        ))}
                        {s.nbZones > 4 && <i>+{s.nbZones - 4}</i>}
                        <u>
                          {s.nbZones} zone{s.nbZones > 1 ? "s" : ""}
                        </u>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <button
              className="li-btn-localiser"
              onClick={() => chercher()}
              disabled={!code.trim() || !sessionId || recherche}
            >
              {recherche ? "Recherche…" : "Localiser"}
            </button>
          </div>

          {/* Historique local : la même référence est cherchée plusieurs fois
              dans la journée. */}
          {!!recents.length && (
            <div className="li-recents">
              <HiClock />
              <span className="li-recents-lbl">Récents</span>
              {recents.map((r) => (
                <button
                  key={r.terme}
                  className="li-chip li-chip-recent"
                  title={r.designation || r.terme}
                  onClick={() => {
                    setCode(r.terme);
                    chercher(r.terme, r);
                  }}
                >
                  {r.designation
                    ? r.designation.slice(0, 28) +
                      (r.designation.length > 28 ? "…" : "")
                    : r.terme}
                </button>
              ))}
              <button
                className="li-recents-vider"
                title="Vider l'historique"
                onClick={() => {
                  setRecents([]);
                  ecrireRecents(entrepriseId, []);
                }}
              >
                <HiX />
              </button>
            </div>
          )}

          {/* Aucun inventaire du tout : le dire, plutôt que laisser le plan
              annoncer « aucune zone » pour un inventaire qui n'existe pas. */}
          {!chargtInv && !inventaires?.length && (
            <div className="li-placeholder">
              <HiMap />
              <p>Aucun inventaire par zones pour cette société.</p>
              <p className="li-placeholder-aide">
                La localisation s'appuie sur les bipages d'un inventaire : il
                faut en avoir initialisé au moins un.
              </p>
            </div>
          )}

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

          {/* ── Article trouvé : la fiche de réponse ── */}
          {aCherche && articleTrouve && (
            <div className="li-synthese">
              <div className="li-article">
                <strong>{articleTrouve.designation || "Article"}</strong>
                <div className="li-article-codes">
                  <span className="li-code-chip">
                    <label>NART</label>
                    {articleTrouve.nart || "—"}
                  </span>
                  {articleTrouve.gencod && (
                    <span className="li-code-chip">
                      <label>GENCODE</label>
                      {articleTrouve.gencod}
                    </span>
                  )}
                </div>
              </div>
              <div className="li-synthese-chiffres">
                <div className="li-kpi">
                  <b>{resultat.totalParZone.length}</b>
                  <span>
                    zone{resultat.totalParZone.length > 1 ? "s" : ""}
                  </span>
                </div>
                <div className="li-kpi">
                  <b>{fmtQte(totalCompte)}</b>
                  <span>compté{totalCompte > 1 ? "s" : ""} au total</span>
                </div>
                <div className="li-kpi">
                  <b>{occurrences.length}</b>
                  <span>
                    séquence{occurrences.length > 1 ? "s" : ""} de bipage
                  </span>
                </div>
              </div>
            </div>
          )}

          {aCherche && !articleTrouve && (
            <div className="li-placeholder li-placeholder-vide">
              <HiExclamationCircle />
              <p>
                « {resultat.code} » n'a pas été bipé dans cet inventaire
                {entrepriseObj?.trigramme
                  ? ` chez ${entrepriseObj.trigramme}`
                  : ""}
                .
              </p>
              <p className="li-placeholder-aide">
                Le plan ci-dessous montre les zones qui n'ont enregistré aucun
                bipage : l'article s'y trouve peut-être sans avoir été compté.
              </p>
            </div>
          )}

          {/* ── Bascule de vue + filtre d'emplacement ── */}
          {sessionId && (aCherche || plan) && (
            <div className="li-barre-vues">
              <div className="li-vues">
                <button
                  className={`li-vue ${vue === "plan" ? "on" : ""}`}
                  onClick={() => setVue("plan")}
                >
                  <HiMap /> Plan
                </button>
                <button
                  className={`li-vue ${vue === "sequences" ? "on" : ""}`}
                  onClick={() => setVue("sequences")}
                  disabled={!occurrences.length}
                  title={
                    occurrences.length
                      ? "Les articles comptés juste avant et juste après"
                      : "Lancez une recherche pour voir les séquences de bipage"
                  }
                >
                  <HiViewList /> Séquences de bipage
                </button>
              </div>

              {emplacementsResultat.length > 1 ||
              (plan?.emplacements || []).length > 1 ? (
                <div className="li-empl-filtre">
                  <span className="li-empl-filtre-lbl">Emplacement</span>
                  <button
                    className={`li-chip ${emplFiltre === "tous" ? "on" : ""}`}
                    onClick={() => setEmplFiltre("tous")}
                  >
                    Tous
                  </button>
                  {(emplacementsResultat.length
                    ? emplacementsResultat
                    : (plan?.emplacements || []).map((e) => [
                        e.emplacement,
                        e.nbZones,
                      ])
                  ).map(([empl, nb]) => (
                    <button
                      key={empl}
                      className={`li-chip ${emplFiltre === empl ? "on" : ""}`}
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
              ) : null}
            </div>
          )}

          {resultat?.tronque && (
            <p className="li-avert">
              Résultats tronqués : ce code sort dans un très grand nombre de
              zones.
            </p>
          )}

          {/* ══ VUE PLAN ══ */}
          {sessionId && vue === "plan" && (
            <>
              {planEnCours && !plan ? (
                <div className="li-placeholder">
                  <p>Chargement du plan…</p>
                </div>
              ) : !plan?.nbZones ? (
                <div className="li-placeholder">
                  <HiMap />
                  <p>Cet inventaire n'a aucune zone à représenter.</p>
                </div>
              ) : (
                <div className="li-plan">
                  <div className="li-plan-note">
                    <HiLightBulb />
                    <span>
                      Plan <b>schématique</b> : les allées et leur ordre sont
                      déduits des codes de rayon (allée + repère), pas de la
                      géométrie réelle du magasin. L'ordre de chaque allée est
                      celui du parcours de préparation.
                    </span>
                  </div>

                  {/* Légende : trois états suffisent à lire le plan. */}
                  <div className="li-legende">
                    {aCherche && articleTrouve && (
                      <span className="li-lg">
                        <i className="li-pastille trouve" /> Article ici
                      </span>
                    )}
                    <span className="li-lg">
                      <i className="li-pastille comptee" /> Zone comptée
                    </span>
                    <span className="li-lg">
                      <i className="li-pastille vide" /> Aucun bipage
                      enregistré
                    </span>
                    <span className="li-lg">
                      <i className="li-pastille neutre" /> Zone neutralisée
                    </span>
                  </div>

                  {emplacementsPlan.map((empl) => (
                    <section className="li-plan-empl" key={empl.emplacement}>
                      <header className="li-plan-empl-head">
                        <h2>
                          <HiCube /> {empl.emplacement}
                        </h2>
                        <span>
                          {empl.nbZones} zone{empl.nbZones > 1 ? "s" : ""} ·{" "}
                          {empl.allees.length} allée
                          {empl.allees.length > 1 ? "s" : ""}
                        </span>
                      </header>

                      <div className="li-allees">
                        {empl.allees.map((a) => {
                          // Une allée qui porte l'article est mise en avant :
                          // sur 50 allées, c'est ce qui saute aux yeux.
                          const porteArticle = a.zones.some((z) =>
                            zonesTrouvees.has(
                              cleZone(z.zoneCode, z.zoneType),
                            ),
                          );
                          return (
                            <div
                              className={`li-allee ${
                                porteArticle ? "porte-article" : ""
                              }`}
                              key={a.allee}
                            >
                              <div className="li-allee-lbl">
                                <b>{a.allee}</b>
                                <span>
                                  {a.nbZones} zone{a.nbZones > 1 ? "s" : ""}
                                </span>
                              </div>
                              <div className="li-allee-zones">
                                {a.zones.map((z) => {
                                  const hit = zonesTrouvees.get(
                                    cleZone(z.zoneCode, z.zoneType),
                                  );
                                  const classes = [
                                    "li-zone",
                                    hit ? "trouve" : "",
                                    z.neutralisee ? "neutre" : "",
                                    !z.neutralisee && !z.nbLignes
                                      ? "vide"
                                      : "",
                                    // On n'estompe QUE s'il y a une cible à
                                    // faire ressortir : une recherche sans
                                    // résultat grisait tout le plan, alors
                                    // que c'est justement là qu'il faut
                                    // pouvoir lire les zones non comptées.
                                    aCherche && articleTrouve && !hit
                                      ? "estompe"
                                      : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ");
                                  return (
                                    <button
                                      type="button"
                                      className={classes}
                                      key={cleZone(z.zoneCode, z.zoneType)}
                                      onClick={() =>
                                        allerAuxSequences(
                                          z.zoneCode,
                                          z.zoneType,
                                        )
                                      }
                                      title={
                                        [
                                          z.zoneCode,
                                          z.zoneLibelle,
                                          z.neutralisee
                                            ? "zone neutralisée"
                                            : `${z.nbLignes} ligne${
                                                z.nbLignes > 1 ? "s" : ""
                                              } bipée${
                                                z.nbLignes > 1 ? "s" : ""
                                              }`,
                                          hit
                                            ? `Article compté ici : ${fmtQte(
                                                hit.totalQte,
                                              )}`
                                            : "",
                                        ]
                                          .filter(Boolean)
                                          .join(" · ")
                                      }
                                    >
                                      {hit && (
                                        <span className="li-zone-pin">
                                          <HiLocationMarker />
                                        </span>
                                      )}
                                      <span className="li-zone-code">
                                        {z.zoneCode}
                                      </span>
                                      <span className="li-zone-lib">
                                        {z.zoneLibelle || "—"}
                                      </span>
                                      {hit ? (
                                        <span className="li-zone-qte">
                                          {fmtQte(hit.totalQte)}
                                        </span>
                                      ) : (
                                        !aCherche && (
                                          <span className="li-zone-n">
                                            {z.nbLignes || 0}
                                          </span>
                                        )
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ══ VUE SÉQUENCES : l'article au milieu de ses voisins de rayon ══ */}
          {sessionId && vue === "sequences" && (
            <>
              {/* Rappel des zones trouvées, en tête : la réponse courte. */}
              {!!zonesAffichees.length && (
                <div className="li-zones-resume">
                  {zonesAffichees.map((z) => (
                    <button
                      key={cleZone(z.zoneCode, z.zoneType)}
                      className="li-zone-pill"
                      onClick={() => {
                        setZoneFocus(cleZone(z.zoneCode, z.zoneType));
                        refsZones.current[
                          cleZone(z.zoneCode, z.zoneType)
                        ]?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                      }}
                    >
                      <b>{z.zoneCode}</b>
                      <span>{z.zoneLibelle || "—"}</span>
                      <em>
                        {z.zoneType} · {fmtQte(z.totalQte)} compté
                        {Number(z.totalQte) > 1 ? "s" : ""}
                      </em>
                    </button>
                  ))}
                </div>
              )}

              <div className="li-occurrences">
                {occurrencesAffichees.map((o) => (
                  <div
                    className={`li-occ ${
                      zoneFocus === cleZone(o.zoneCode, o.zoneType)
                        ? "focus"
                        : ""
                    }`}
                    key={o.ligneId}
                    ref={(el) => {
                      // La première séquence de la zone sert d'ancre de scroll.
                      const k = cleZone(o.zoneCode, o.zoneType);
                      if (el && !refsZones.current[k]) refsZones.current[k] = el;
                    }}
                  >
                    <div className="li-occ-head">
                      <div className="li-occ-zone">
                        <span className="li-occ-code">{o.zoneCode}</span>
                        <span className="li-occ-lib">
                          {o.zoneLibelle || "—"}
                        </span>
                        <span className="li-occ-empl">{o.zoneType}</span>
                        {LIBELLE_SOURCE[o.source] && (
                          <span className="li-occ-source">
                            {LIBELLE_SOURCE[o.source]}
                          </span>
                        )}
                      </div>
                      <div className="li-occ-meta">
                        {[o.agentNom, o.bipeAt ? fmtDateHeure(o.bipeAt) : ""]
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
                            <span className="li-v-qte">{fmtQte(v.qteScan)}</span>
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
    </div>
  );
};

export default AdminLocalisationInventaireScreen;
