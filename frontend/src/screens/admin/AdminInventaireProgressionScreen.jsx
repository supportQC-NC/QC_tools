// src/screens/admin/AdminInventaireProgressionScreen.jsx
import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  HiChartBar,
  HiRefresh,
  HiPlay,
  HiArchive,
  HiClipboardCheck,
  HiSearch,
  HiCheck,
  HiX,
  HiCheckCircle,
  HiExclamationCircle,
  HiTrash,
  HiDownload,
  HiEye,
  HiEyeOff,
  HiExclamation,
} from "react-icons/hi";
import {
  useGetActiveSessionQuery,
  useInitInventaireZoneMutation,
  useAnnulerInventaireZoneMutation,
  useBiperZoneMutation,
  useSetPhaseManuelleMutation,
  useSetZoneNeutraliseeMutation,
  useGetZoneHistoriqueQuery,
  useDeleteZoneSessionMutation,
  useGetAgentsPossiblesQuery,
} from "../../slices/inventaireZoneApiSlice";
import { useGetZonesEmplacementsQuery } from "../../slices/zoneApiSlice";
import { useSelector } from "react-redux";
import { useGetMyEntreprisesQuery } from "../../slices/entrepriseApiSlice";
import { selectGlobalEntrepriseId } from "../../slices/entrepriseGlobalSlice";
import ImportComptageZone from "../../components/Admin/ImportComptageZone";
import UserPicker from "../../components/ui/UserPicker/UserPicker";
import { useLazyGetUserParBadgeQuery } from "../../slices/userApiSlice";
import useInventaireMaj from "../../hooks/useInventaireMaj";
import "./AdminProgressionScreen.css";

// Le TEMPS RÉEL vient du socket `inventaire:maj` (useInventaireMaj, refetch à
// la seconde sur chaque dépôt/phase) : le polling n'est plus qu'un FILET de
// sécurité — à 4 s, chaque navigateur ouvert martelait un GET qui relit la
// session complète (600+ zones, 4 populate) toutes les 4 secondes.
const POLL = 15000;

const PHASES = ["papillonnage", "bipage", "controle"];
const PHASE_META = {
  papillonnage: { label: "Papillonnage", color: "#8b5cf6" },
  bipage: { label: "Bipage", color: "#4da6ff" },
  controle: { label: "Contrôle", color: "#4ade80" },
};

// Statut d'avancement d'une zone (même règle que le récap par zone) :
//   3 phases → vert (complet) ; bipage → violet ; papillonnage → orange ; sinon rouge.
// Une zone NEUTRALISÉE (rayon qui n'existe plus physiquement) est grise et
// hors avancement.
const STATUT_META = {
  complet: { label: "Complet", color: "#4ade80" },
  comptage: { label: "Bipage", color: "#8b5cf6" },
  papillonnage: { label: "Papillonnage", color: "#f59e0b" },
  todo: { label: "Pas commencé", color: "#ff6b6b" },
  neutralisee: { label: "Neutralisée (hors inventaire)", color: "#6b7280" },
};
// Nom de l'agent crédité d'une phase. Le serveur peuple `by` ; on retombe sur
// une chaîne vide si la phase est ancienne (avant la désignation d'agent).
const nomAgentPhase = (p) => {
  const u = p?.by;
  if (!u || typeof u !== "object") return "";
  return `${u.prenom || ""} ${u.nom || ""}`.trim() || u.email || "";
};

// Libellé de l'entrée « zones sans emplacement » du filtre. Valeur sentinelle :
// une chaîne vide dans un <select> vaut « tous les emplacements ».
const SANS_EMPLACEMENT = "__sans__";

/**
 * Avancement d'un lot de zones, mêmes règles que `computeProgress` du serveur
 * (une zone = 3 phases ; les zones NEUTRALISÉES ne comptent pas). Recalculé
 * ici pour que le filtre d'emplacement fasse bouger les compteurs sans
 * aller-retour serveur.
 */
const calculerProgression = (lot) => {
  const compteurs = { papillonnage: 0, bipage: 0, controle: 0 };
  const actives = lot.filter((z) => !z.neutralisee);
  actives.forEach((z) => {
    PHASES.forEach((ph) => {
      if (z[ph]?.fait) compteurs[ph] += 1;
    });
  });
  const totalZones = actives.length;
  const zonesNeutralisees = lot.length - actives.length;
  const totalPhases = totalZones * PHASES.length;
  const faites = PHASES.reduce((t, ph) => t + compteurs[ph], 0);
  const parPhase = {};
  PHASES.forEach((ph) => {
    parPhase[ph] = {
      faites: compteurs[ph],
      total: totalZones,
      pct: totalZones ? Math.round((compteurs[ph] / totalZones) * 100) : 0,
    };
  });
  return {
    totalZones,
    totalPhases,
    faites,
    pct: totalPhases ? Math.round((faites / totalPhases) * 100) : 0,
    zonesNeutralisees,
    parPhase,
  };
};

const zoneStatut = (z) => {
  if (z?.neutralisee) return "neutralisee";
  const pap = !!z?.papillonnage?.fait;
  const bip = !!z?.bipage?.fait;
  const ctrl = !!z?.controle?.fait;
  if (pap && bip && ctrl) return "complet";
  if (bip) return "comptage";
  if (pap) return "papillonnage";
  return "todo";
};

const AdminInventaireProgressionScreen = () => {
  const selectedEntreprise = useSelector(selectGlobalEntrepriseId) || "";
  // Cycle de vie (initialiser / réinitialiser / annuler) : ADMIN SEULEMENT.
  // Les responsables suivent et pilotent l'inventaire (module « inventaire »)
  // mais ne le créent ni ne l'annulent — le serveur refuse de toute façon,
  // on ne leur montre pas des boutons qui finiraient en 403.
  const { userInfo } = useSelector((state) => state.auth);
  const isAdmin = userInfo?.role === "admin";
  const [bipCode, setBipCode] = useState("");
  // Désignation de l'agent : elle a lieu APRÈS le scan. Le coupon ne porte
  // aucune identité, donc le scan ne fait que RÉSOUDRE le code (rien n'est
  // marqué) ; cette fenêtre demande qui a fait le travail, et c'est sa
  // validation qui écrit. Annuler ne laisse aucune trace.
  // { source: 'bip'|'manuel', code?, zone, phase }
  const [designation, setDesignation] = useState(null);
  const [agentUserId, setAgentUserId] = useState("");
  // Filtre de la liste d'agents : par défaut, seuls les comptes qui ont ACCÈS à
  // la société de l'inventaire. La liste complète reste à un clic — un renfort
  // venu d'une autre société du groupe doit rester créditable — mais dérouler
  // tout l'annuaire pour trouver l'agent du magasin n'est pas tenable.
  // L'état vit ici et pas dans la fenêtre : un même poste enchaîne les coupons,
  // il ne doit pas re-cocher à chaque scan.
  const [agentsSocieteSeuls, setAgentsSocieteSeuls] = useState(true);
  // Badge scanné : le poste bipe la carte de l'agent plutôt que de le chercher
  // dans la liste. Le scan ne fait que REMPLIR le sélecteur — la validation
  // reste la même, et la liste reste utilisable quand quelqu'un a oublié sa
  // carte.
  const [badgeSaisi, setBadgeSaisi] = useState("");
  const [badgeMsg, setBadgeMsg] = useState(null);
  const [resoudreBadge, { isFetching: badgeEnCours }] =
    useLazyGetUserParBadgeQuery();
  // Dernier agent désigné : re-proposé au coupon suivant, un agent en rapporte
  // en général plusieurs d'affilée.
  const [dernierAgentId, setDernierAgentId] = useState("");
  const [bipFeedback, setBipFeedback] = useState(null); // { tone, message }
  const [search, setSearch] = useState("");
  // Filtre d'emplacement (MAGASIN, DOCK…). Il agit sur le tableau ET sur
  // l'avancement : pendant un inventaire on pilote une zone géographique à la
  // fois, et le pourcentage global ne dit rien de l'avancement du dock.
  const [emplacement, setEmplacement] = useState("");
  const [showInitConfirm, setShowInitConfirm] = useState(false);
  // Sélection des proformas du « comptage sans collecteur », saisie une seule
  // fois ici : elle est ensuite portée par l'inventaire.
  const [initProformas, setInitProformas] = useState({
    dateDebut: "",
    dateFin: "",
    clients: "",
  });
  // DESTINATION du dossier de l'inventaire, choisie à l'initialisation :
  // "rcommun" = partage STOCK (défaut, seul dossier que l'agent d'impression
  // surveille) ; "collect_sec" = le chemin d'export de la société.
  const [initDestination, setInitDestination] = useState("rcommun");
  // Garde-fous des actions destructrices (zone de danger) : réinitialiser un
  // inventaire EN COURS exige une case cochée en connaissance de cause, et
  // l'annulation exige la saisie du trigramme de la société — un clic de trop
  // ne doit jamais suffire à perdre le travail des agents.
  const [initConfirmCoche, setInitConfirmCoche] = useState(false);
  const [annulerConfirmTexte, setAnnulerConfirmTexte] = useState("");
  const [showAnnulerConfirm, setShowAnnulerConfirm] = useState(false);
  const [showHistorique, setShowHistorique] = useState(false);
  // Confirmation de neutralisation d'une zone qui porte DÉJÀ du travail
  // (phases faites, lignes bipées) : le serveur refuse d'écrire tant que la
  // confirmation n'est pas explicite. { zone, travail }
  const [confirmNeutralisation, setConfirmNeutralisation] = useState(null);

  const bipInputRef = useRef(null);

  const { data: entreprises } = useGetMyEntreprisesQuery();

  // TOUS les comptes actifs, pas seulement ceux de la société : un inventaire
  // est souvent renforcé par du personnel d'une autre société du groupe.
  const { data: agentsPossibles } = useGetAgentsPossiblesQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise },
  );

  // Agents proposés dans la fenêtre de désignation. L'agent DÉJÀ sélectionné
  // est toujours conservé, même hors filtre : sans lui, le sélecteur
  // réafficherait « Moi (par défaut) » alors qu'un badge vient d'être bipé.
  const agentsAffiches = useMemo(() => {
    const tous = agentsPossibles || [];
    if (!agentsSocieteSeuls) return tous;
    return tous.filter(
      (u) => u.aAccesEntreprise || String(u._id) === String(agentUserId),
    );
  }, [agentsPossibles, agentsSocieteSeuls, agentUserId]);

  const nbAgentsSociete = useMemo(
    () => (agentsPossibles || []).filter((u) => u.aAccesEntreprise).length,
    [agentsPossibles],
  );

  const {
    data: activeData,
    isLoading: loadingActive,
    refetch,
  } = useGetActiveSessionQuery(selectedEntreprise, {
    skip: !selectedEntreprise,
    pollingInterval: selectedEntreprise ? POLL : 0,
  });

  // Temps réel : dépôt de collecte, phase validée, fiche traitée → refetch
  // immédiat par le socket (le polling ci-dessus reste le filet).
  useInventaireMaj(selectedEntreprise, refetch);

  const { data: historiqueData } = useGetZoneHistoriqueQuery(
    selectedEntreprise,
    { skip: !selectedEntreprise || !showHistorique },
  );

  const [initInventaire, { isLoading: initializing }] =
    useInitInventaireZoneMutation();
  const [annulerInventaire, { isLoading: annulating }] =
    useAnnulerInventaireZoneMutation();
  const [biperZone, { isLoading: biping }] = useBiperZoneMutation();
  const [setPhaseManuelle] = useSetPhaseManuelleMutation();
  const [setZoneNeutralisee, { isLoading: neutralisant }] =
    useSetZoneNeutraliseeMutation();
  const [deleteZoneSession, { isLoading: deletingSession }] =
    useDeleteZoneSessionMutation();

  const session = activeData?.active || null;
  const progress = activeData?.progress || null;

  const zones = useMemo(() => session?.zones || [], [session]);

  // EMPLACEMENTS de la société : ceux de son dictionnaire des rayons et ceux
  // de ses fiches de zone (zones ajoutées à la main comprises).
  //
  // ⚠️ Plus les dépôts de stock de l'ERP (S1 → MAGASIN, S2 → DOCK, S3/S4/S5
  // nommés dans la fiche société) : cette liste en dur laissait « magasin » et
  // « dock » pour seul choix à une société dont le dictionnaire déclare aussi
  // RESERVE, QUAI, SAV… — le type de zone est libre depuis le 12/11/2026.
  const { data: emplacementsSociete } = useGetZonesEmplacementsQuery(
    { entrepriseId: selectedEntreprise },
    { skip: !selectedEntreprise },
  );

  // Emplacements proposés au filtre : ceux de la société, PLUS ceux réellement
  // portés par les zones de l'inventaire (une session initialisée avant une
  // mise à jour du dictionnaire garde les siens). Les zones sans emplacement
  // sont regroupées sous une entrée explicite plutôt que d'être invisibles.
  //
  // Le compte affiché est celui des zones DE L'INVENTAIRE : un emplacement
  // déclaré au dictionnaire mais absent de la session se lit « aucune zone »
  // au lieu d'ouvrir un tableau vide sans explication.
  const emplacements = useMemo(() => {
    const compte = new Map();
    zones.forEach((z) => {
      const key = (z.type || "").trim();
      compte.set(key, (compte.get(key) || 0) + 1);
    });
    for (const e of emplacementsSociete?.emplacements || []) {
      if (!compte.has(e.key)) compte.set(e.key, 0);
    }
    return [...compte.entries()]
      .map(([key, nbZones]) => ({ key, nbZones }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [zones, emplacementsSociete]);

  const zonesEmplacement = useMemo(() => {
    if (!emplacement) return zones;
    if (emplacement === SANS_EMPLACEMENT)
      return zones.filter((z) => !(z.type || "").trim());
    return zones.filter((z) => (z.type || "").trim() === emplacement);
  }, [zones, emplacement]);

  const filteredZones = useMemo(() => {
    const q = search.trim().toLowerCase();
    const lot = q
      ? zonesEmplacement.filter((z) =>
          [z.code, z.libelle, z.type].some((v) =>
            (v || "").toLowerCase().includes(q),
          ),
        )
      : zonesEmplacement;
    // Tri par code À L'AFFICHAGE : une zone ajoutée après l'initialisation de
    // l'inventaire (fiche créée à la main) est AJOUTÉE EN FIN du tableau de la
    // session — l'ajout est atomique pour ne pas écraser une phase validée en
    // même temps, il ne peut donc pas réordonner. Sans ce tri elle se
    // retrouverait en dernière ligne, derrière des centaines de rayons, et
    // passerait pour absente. `numeric` range A_1, A_2d, A_9, A_10 dans
    // l'ordre du magasin (et non A_1, A_10, A_2d).
    return [...lot].sort((a, b) =>
      String(a.code || "").localeCompare(String(b.code || ""), "fr", {
        numeric: true,
      }),
    );
  }, [zonesEmplacement, search]);

  // Avancement du PÉRIMÈTRE AFFICHÉ. Recalculé côté client sur les mêmes règles
  // que le serveur (une zone = 3 phases) : sans ça, filtrer sur le dock
  // laisserait un pourcentage global qui ne parle de rien.
  const progressFiltre = useMemo(
    () => calculerProgression(zonesEmplacement),
    [zonesEmplacement],
  );

  // Avancement PAR TYPE DE ZONE. Les types viennent des fiches d'inventaire
  // elles-mêmes (`zone.type`), jamais d'une liste en dur : une société dont le
  // dictionnaire déclare RESERVE, QUAI ou SAV voit chacun de ses types, pas
  // seulement magasin et dock. Les zones sans type sont regroupées sous
  // « Sans emplacement » plutôt que d'être invisibles de la ventilation.
  const progressParType = useMemo(() => {
    const groupes = new Map();
    zones.forEach((z) => {
      const key = (z.type || "").trim();
      if (!groupes.has(key)) groupes.set(key, []);
      groupes.get(key).push(z);
    });
    return [...groupes.entries()]
      .map(([key, lot]) => ({ key, ...calculerProgression(lot) }))
      .sort((a, b) => a.key.localeCompare(b.key, "fr", { numeric: true }));
  }, [zones]);

  // La ventilation n'apporte rien quand toutes les zones partagent le même
  // type (ou n'en ont aucun) : on ne l'affiche qu'à partir de deux types.
  const afficherParType = progressParType.length > 1;

  const entrepriseObj = entreprises?.find((e) => e._id === selectedEntreprise);

  // Mot exigé pour confirmer l'ANNULATION : le trigramme de la société — le
  // taper force à relire QUELLE société va perdre son inventaire. Repli
  // générique tant que la liste des sociétés n'est pas chargée.
  const motAnnulation = (entrepriseObj?.trigramme || "SUPPRIMER").toUpperCase();
  const annulationConfirmee =
    annulerConfirmTexte.trim().toUpperCase() === motAnnulation;

  // Auto-focus du champ bip dès qu'une session active est présente
  useEffect(() => {
    if (session && bipInputRef.current) {
      bipInputRef.current.focus();
    }
  }, [session]);

  // Réinitialise l'état local quand la société sélectionnée change
  useEffect(() => {
    setBipFeedback(null);
    setBipCode("");
    setSearch("");
    setEmplacement("");
    setShowHistorique(false);
    setDesignation(null);
    setAgentUserId("");
    setAgentsSocieteSeuls(true);
    setDernierAgentId("");
    setInitDestination("rcommun");
    setShowInitConfirm(false);
    setShowAnnulerConfirm(false);
    setInitConfirmCoche(false);
    setAnnulerConfirmTexte("");
  }, [selectedEntreprise]);

  const handleConfirmInit = async () => {
    // Un inventaire EN COURS ne se réinitialise pas sans la case cochée (le
    // bouton est désactivé, ceci n'est qu'un garde-fou de cohérence).
    if (session && !initConfirmCoche) return;
    setShowInitConfirm(false);
    setInitConfirmCoche(false);
    setBipFeedback(null);
    try {
      await initInventaire({
        entrepriseId: selectedEntreprise,
        filtreProformas: initProformas,
        destination: initDestination,
      }).unwrap();
    } catch (err) {
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Erreur lors de l'initialisation",
      });
    }
  };

  const handleConfirmAnnuler = async () => {
    // L'annulation supprime tout : elle n'est jouée que si le trigramme a
    // bien été saisi (le bouton est désactivé, garde-fou de cohérence).
    if (!annulationConfirmee) return;
    setShowAnnulerConfirm(false);
    setAnnulerConfirmTexte("");
    setBipFeedback(null);
    try {
      const res = await annulerInventaire(selectedEntreprise).unwrap();
      if (res?.dossierSupprime === false) {
        setBipFeedback({
          tone: "warning",
          message: `Inventaire annulé, mais le dossier réseau n'a pas pu être supprimé${
            res.dossierErreur ? ` : ${res.dossierErreur}` : ""
          }. Supprimez-le manuellement si besoin.`,
        });
      }
    } catch (err) {
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Erreur lors de l'annulation",
      });
    }
  };

  // Message de retour homogène : "<zone> · <phase> — <message serveur>".
  const messageBip = (res) =>
    res.zone?.code && res.phase && PHASE_META[res.phase]
      ? `${res.zone.code} · ${PHASE_META[res.phase].label} — ${res.message}`
      : res.message;

  // ÉTAPE 1 — le scan ne marque RIEN : il résout le code pour savoir quelle
  // zone et quelle phase annoncer dans la fenêtre de désignation.
  const handleBip = async () => {
    const code = bipCode.trim();
    if (!code || biping) return;
    try {
      const res = await biperZone({
        entrepriseId: selectedEntreprise,
        code,
        previsualiser: true,
      }).unwrap();

      if (res.action === "a_confirmer" && !res.dejaFait) {
        // Le code est bon et la phase reste à faire → on demande QUI.
        setBipFeedback(null);
        setAgentUserId(dernierAgentId);
        setDesignation({
          source: "bip",
          code,
          zone: res.zone,
          phase: res.phase,
        });
        setBipCode("");
        return;
      }

      // Garde-fou : on n'a demandé qu'une RÉSOLUTION. Si le serveur répond
      // qu'il a marqué la phase, c'est qu'il n'a pas honoré `previsualiser`
      // (backend en retard sur le front) — la phase a été écrite sans que
      // personne n'ait été désigné. On le dit, plutôt que de laisser croire
      // que le parcours s'est déroulé normalement.
      if (res.action === "marque" || res.action === "deja_fait") {
        setBipFeedback({
          tone: "warning",
          message: `${messageBip(res)} — validée sans désignation : le serveur n'a pas pris en compte la demande. Mettez le backend à jour.`,
        });
        setBipCode("");
        if (bipInputRef.current) bipInputRef.current.focus();
        return;
      }

      // Zone seulement identifiée, phase déjà faite ou verrouillée : rien à
      // désigner, on affiche le message tel quel.
      const tone = res.action === "identifiee" ? "info" : "warning";
      setBipFeedback({ tone, message: messageBip(res) });
      setBipCode("");
      if (bipInputRef.current) bipInputRef.current.focus();
    } catch (err) {
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Code inconnu",
      });
      setBipCode("");
      if (bipInputRef.current) bipInputRef.current.focus();
    }
  };

  // ÉTAPE 2 — validation de la désignation : c'est ICI que la phase est marquée,
  // que l'on soit venu du scan d'un coupon ou d'une coche manuelle.
  /**
   * Un badge vient d'être bipé (ou saisi). On résout la personne et on
   * pré-remplit le sélecteur.
   * ⚠️ Déclenché sur la LONGUEUR (13 chiffres), pas sur « Entrée » : beaucoup
   * de douchettes n'envoient aucun suffixe — même règle que sur le collecteur.
   */
  const traiterBadge = async (valeur) => {
    const code = String(valeur || "").replace(/\D/g, "");
    setBadgeSaisi(valeur);
    setBadgeMsg(null);
    if (code.length !== 13) return;
    try {
      const u = await resoudreBadge(code).unwrap();
      setAgentUserId(u._id);
      // Badge d'un renfort qui n'a pas accès à la société : on rouvre la liste
      // complète. Le filtre resterait coché avec un seul nom dedans, et on
      // croirait à une liste cassée.
      const connu = (agentsPossibles || []).find(
        (a) => String(a._id) === String(u._id),
      );
      if (connu && !connu.aAccesEntreprise) setAgentsSocieteSeuls(false);
      setBadgeMsg({ type: "ok", texte: `Badge reconnu : ${u.nomComplet}` });
      setBadgeSaisi("");
    } catch (err) {
      setBadgeMsg({
        type: "err",
        texte: err?.data?.message || "Badge inconnu.",
      });
      setBadgeSaisi("");
    }
  };

  const handleConfirmerDesignation = async () => {
    if (!designation || biping) return;
    try {
      const res =
        designation.source === "manuel"
          ? await setPhaseManuelle({
              entrepriseId: selectedEntreprise,
              code: designation.zone.code,
              emplacement: designation.zone.type || "",
              phase: designation.phase,
              fait: true,
              agentUserId,
            }).unwrap()
          : await biperZone({
              entrepriseId: selectedEntreprise,
              code: designation.code,
              agentUserId,
            }).unwrap();
      setDernierAgentId(agentUserId);
      setBipFeedback({
        tone: res.action === "deja_fait" ? "warning" : "success",
        message:
          designation.source === "manuel"
            ? `${designation.zone.code}${
                designation.zone.type ? ` (${designation.zone.type})` : ""
              } · ${PHASE_META[designation.phase]?.label} — validé${
                res.agent?.nom ? ` (${res.agent.nom})` : ""
              }`
            : messageBip(res),
      });
    } catch (err) {
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Validation impossible",
      });
    } finally {
      setDesignation(null);
      if (bipInputRef.current) bipInputRef.current.focus();
    }
  };

  const handleAnnulerDesignation = () => {
    const manuel = designation?.source === "manuel";
    setDesignation(null);
    setBipFeedback({
      tone: "warning",
      message: manuel
        ? "Validation annulée : la phase reste à faire."
        : "Scan annulé : aucune phase n'a été validée.",
    });
    if (bipInputRef.current) bipInputRef.current.focus();
  };

  const handleBipKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleBip();
    }
  };

  // Coche manuelle. VALIDER passe par la même fenêtre de désignation que le
  // scan : sans elle, la phase serait créditée à la personne au poste, ce qui
  // fausserait l'écran « Agents de l'inventaire ». DÉVALIDER est immédiat
  // (rien à attribuer).
  const handleTogglePhase = async (zone, phase, currentFait) => {
    if (!currentFait) {
      setBipFeedback(null);
      setAgentUserId(dernierAgentId);
      setDesignation({
        source: "manuel",
        zone: { code: zone.code, libelle: zone.libelle, type: zone.type },
        phase,
      });
      return;
    }
    try {
      await setPhaseManuelle({
        entrepriseId: selectedEntreprise,
        code: zone.code,
        emplacement: zone.type || "",
        phase,
        fait: false,
      }).unwrap();
    } catch (err) {
      // Le serveur peut REFUSER la décoche (papillonnage d'une zone bipée :
      // bipée ⇒ papillonnée) : sans message, le clic semblerait ignoré.
      const message = err?.data?.message;
      if (message) setBipFeedback({ tone: "warning", message });
      // sinon silencieux : le polling resynchronise
    }
  };

  // Neutraliser / réactiver une zone. Premier appel SANS confirmation : si la
  // zone porte déjà du travail (phase faite, lignes bipées), le serveur répond
  // `confirmation_requise` sans rien écrire et on ouvre la fenêtre de
  // confirmation ; la validation rappelle avec `confirmer: true`.
  const handleToggleNeutralisee = async (zone, { confirmer = false } = {}) => {
    if (neutralisant) return;
    const versNeutralisee = !zone.neutralisee;
    try {
      const res = await setZoneNeutralisee({
        entrepriseId: selectedEntreprise,
        code: zone.code,
        emplacement: zone.type || "",
        neutralisee: versNeutralisee,
        ...(confirmer && { confirmer: true }),
      }).unwrap();

      if (res.action === "confirmation_requise") {
        setConfirmNeutralisation({ zone: res.zone, travail: res.travail });
        return;
      }

      setConfirmNeutralisation(null);
      setBipFeedback({
        tone: res.action === "neutralisee" ? "warning" : "success",
        message:
          res.action === "neutralisee"
            ? `Zone ${res.zone.code} neutralisée : elle ne compte plus dans l'avancement.`
            : `Zone ${res.zone.code} réactivée : elle compte de nouveau dans l'avancement.`,
      });
    } catch (err) {
      setConfirmNeutralisation(null);
      setBipFeedback({
        tone: "error",
        message: err?.data?.message || "Neutralisation impossible",
      });
    }
  };

  const handleDeleteHisto = async (id) => {
    // ⚠️ Depuis la conservation des bipages (24/11/2026), supprimer une
    // session archivée emporte TOUTES ses données : lignes bipées, collectes,
    // fiches, bilan — l'inventaire disparaît de la Localisation inventaire.
    const s = (historiqueData?.sessions || []).find((x) => x._id === id);
    if (
      !window.confirm(
        `Supprimer définitivement l'inventaire « ${s?.nom || "?"} » ?\n\n` +
          "Toutes ses données partent avec : lignes bipées, collectes, fiches " +
          "de contrôle et bilan. Il disparaîtra de la Localisation inventaire. " +
          "Irréversible.",
      )
    ) {
      return;
    }
    try {
      await deleteZoneSession({ entrepriseId: selectedEntreprise, id }).unwrap();
    } catch {
      /* ignore */
    }
  };

  const formatDate = (d) =>
    d
      ? new Date(d).toLocaleString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "-";

  const ProgressBar = ({ label, pct, count, total, color }) => (
    <div className="prog-item">
      <div className="prog-head">
        <span className="prog-label">{label}</span>
        <span className="prog-count">
          {count}/{total} · {pct}%
        </span>
      </div>
      <div className="prog-track">
        <div
          className="prog-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );

  return (
    <div className="admin-prog">
      {/* En-tête */}
      <div className="admin-prog-header">
        <h1>
          <HiChartBar /> Progression d'inventaire
        </h1>
        <div className="admin-prog-actions">
          <button
            className="btn-icon"
            onClick={refetch}
            disabled={!selectedEntreprise}
            title="Rafraîchir"
          >
            <HiRefresh />
          </button>
        </div>
      </div>

      {!selectedEntreprise ? (
        <div className="admin-prog-placeholder">
          <HiChartBar />
          <p>
            Sélectionnez une société dans l'en-tête pour suivre son inventaire.
          </p>
        </div>
      ) : loadingActive ? (
        <div className="admin-loading">Chargement…</div>
      ) : !session ? (
        <div className="admin-prog-placeholder">
          <HiClipboardCheck />
          <p>Aucun inventaire actif pour {entrepriseObj?.trigramme}.</p>
          {bipFeedback && (
            <div className={`bip-feedback ${bipFeedback.tone}`}>
              {bipFeedback.tone === "error" ||
              bipFeedback.tone === "warning" ? (
                <HiExclamationCircle />
              ) : (
                <HiCheckCircle />
              )}
              <span>{bipFeedback.message}</span>
            </div>
          )}
          {isAdmin ? (
            <button
              className="btn-primary"
              onClick={() => setShowInitConfirm(true)}
              disabled={initializing}
            >
              <HiPlay /> Initialiser un inventaire
            </button>
          ) : (
            <p>Seul un administrateur peut initialiser un inventaire.</p>
          )}
          <button
            className="btn-secondary"
            onClick={() => setShowHistorique(true)}
          >
            <HiArchive /> Historique
          </button>
        </div>
      ) : (
        <>
          {/* Barre d'action session */}
          <div className="session-bar">
            <div className="session-info">
              <strong>{session.nom}</strong>
              <span className="session-meta">
                Démarré le {formatDate(session.createdAt)}
                {session.createdBy &&
                  ` · par ${session.createdBy.prenom || ""} ${session.createdBy.nom || ""}`}
              </span>
              {/* Dépôt réel des .dat : la racine suit la DESTINATION choisie à
                  l'initialisation (partage STOCK ou collect_sec). C'est aussi
                  le dossier que lit l'agent d'impression (`tickOnce` recalcule
                  la racine session par session). */}
              {session.dossierDat && (
                <span
                  className="session-meta"
                  title={
                    session.destination === "collect_sec"
                      ? "Dossier d'export de la société (collect_sec), surveillé par l'agent d'impression"
                      : "Partage STOCK (RCOMMUN), surveillé par l'agent d'impression"
                  }
                >
                  Dépôt (
                  {session.destination === "collect_sec"
                    ? "collect_sec"
                    : "RCOMMUN"}
                  ) : {session.dossierDat}
                </span>
              )}
              {session.dossierFtp && (
                <span
                  className="session-meta"
                  title="Dossier de référence sur le serveur FTP robot-documents (copie du dossier de dépôt)"
                >
                  Miroir FTP : {session.dossierFtp}
                </span>
              )}
            </div>
            <div className="session-actions">
              <button
                className="btn-secondary"
                onClick={() =>
                  window.open(
                    `/api/inventaires-zones/${selectedEntreprise}/dossier-zip`,
                    "_blank",
                  )
                }
                title="Télécharge le dossier complet de l'inventaire (.dat + fiches PDF, FTP et partage fusionnés) en ZIP, à enregistrer sur ce poste"
              >
                <HiDownload /> Enregistrer le dossier (ZIP)
              </button>
              <button
                className="btn-secondary"
                onClick={() => setShowHistorique(true)}
              >
                <HiArchive /> Historique
              </button>
              {/* Réinitialiser et Annuler ne vivent plus ici : ces actions
                  détruisent ou archivent l'inventaire EN COURS, elles sont
                  reléguées dans la zone de danger en bas d'écran, loin des
                  gestes du quotidien. */}
            </div>
          </div>

          {/* Bip */}
          <div className="bip-card">
            <h2>
              <HiClipboardCheck /> Scanner un coupon détachable
            </h2>
            <p className="bip-hint">
              Scannez le code-barres du coupon (papillonnage / bipage /
              contrôle) rapporté par l'agent : le code est reconnu, puis
              l'application demande <b>qui</b> a fait le travail avant de
              valider la phase.
            </p>
            <div className="bip-row">
              <input
                ref={bipInputRef}
                className="bip-input"
                type="text"
                value={bipCode}
                onChange={(e) => setBipCode(e.target.value)}
                onKeyDown={handleBipKeyDown}
                placeholder="Scannez ou saisissez un code-barres puis Entrée…"
                autoFocus
              />
              <button
                className="btn-primary"
                onClick={handleBip}
                disabled={biping || !bipCode.trim()}
              >
                Valider
              </button>
            </div>
            {bipFeedback && (
              <div className={`bip-feedback ${bipFeedback.tone}`}>
                {bipFeedback.tone === "error" ||
                bipFeedback.tone === "warning" ? (
                  <HiExclamationCircle />
                ) : (
                  <HiCheckCircle />
                )}
                <span>{bipFeedback.message}</span>
              </div>
            )}
          </div>

          {/* Comptage sans collecteur (Excel / proforma), zone par zone.
              Ici et pas dans « Détail des bipages » : c'est le pilotage de
              l'inventaire, et un import vaut passage de l'agent — il coche
              papillonnage et bipage quand la zone n'avait jamais été comptée. */}
          {/* Zones neutralisées exclues : on n'importe pas un comptage dans un
              rayon qui n'existe plus. */}
          <ImportComptageZone
            entrepriseId={selectedEntreprise}
            zones={zones.filter((z) => !z.neutralisee)}
            emplacementsDispo={emplacementsSociete?.emplacements || []}
            filtreProformas={session?.filtreProformas}
            onMessage={(message, tone) =>
              setBipFeedback({ tone: tone === "error" ? "error" : "success", message })
            }
          />

          {/* Progression — du périmètre affiché, avec rappel du total quand un
              emplacement est isolé. */}
          {progress && (
            <>
            <div className="prog-cards">
              <div className="prog-global">
                <div className="prog-global-pct">{progressFiltre.pct}%</div>
                <div className="prog-global-label">
                  {emplacement
                    ? `Avancement · ${
                        emplacement === SANS_EMPLACEMENT
                          ? "sans emplacement"
                          : emplacement
                      }`
                    : "Avancement global"}
                  <span>
                    {progressFiltre.faites}/{progressFiltre.totalPhases} phases
                    {" · "}
                    {progressFiltre.totalZones} zone
                    {progressFiltre.totalZones > 1 ? "s" : ""}
                    {progressFiltre.zonesNeutralisees > 0 &&
                      ` · ${progressFiltre.zonesNeutralisees} neutralisée${
                        progressFiltre.zonesNeutralisees > 1 ? "s" : ""
                      }`}
                  </span>
                  {emplacement && (
                    <span className="prog-global-total">
                      Tous emplacements : {progress.pct}% ({progress.faites}/
                      {progress.totalPhases})
                    </span>
                  )}
                </div>
              </div>
              <div className="prog-bars">
                {PHASES.map((ph) => (
                  <ProgressBar
                    key={ph}
                    label={PHASE_META[ph].label}
                    color={PHASE_META[ph].color}
                    pct={progressFiltre.parPhase[ph].pct}
                    count={progressFiltre.parPhase[ph].faites}
                    total={progressFiltre.parPhase[ph].total}
                  />
                ))}
              </div>
            </div>

            {/* Avancement PAR TYPE DE ZONE — les types sont ceux des fiches
                d'inventaire (tous les emplacements du dictionnaire, pas
                seulement magasin/dock). Chaque carte est cliquable et pose le
                filtre d'emplacement du tableau. */}
            {afficherParType && (
              <div className="prog-types">
                <div className="prog-types-head">
                  Avancement par type de zone
                  <span>
                    cliquer sur un type filtre le tableau et les compteurs
                  </span>
                </div>
                <div className="prog-types-grid">
                  {progressParType.map((t) => {
                    const filtreKey = t.key || SANS_EMPLACEMENT;
                    const actif = emplacement === filtreKey;
                    return (
                      <button
                        key={filtreKey}
                        type="button"
                        className={`prog-type-card${actif ? " actif" : ""}`}
                        onClick={() => setEmplacement(actif ? "" : filtreKey)}
                        title={
                          actif
                            ? "Retirer le filtre (tous les emplacements)"
                            : `N'afficher que les zones « ${
                                t.key || "sans emplacement"
                              } »`
                        }
                      >
                        <div className="prog-type-head">
                          <span className="prog-type-nom">
                            {t.key || "Sans emplacement"}
                          </span>
                          <span className="prog-type-pct">{t.pct}%</span>
                        </div>
                        <div className="prog-track">
                          <div
                            className="prog-fill"
                            style={{
                              width: `${t.pct}%`,
                              background: "#8b5cf6",
                            }}
                          />
                        </div>
                        <div className="prog-type-meta">
                          {t.faites}/{t.totalPhases} phases · {t.totalZones}{" "}
                          zone{t.totalZones > 1 ? "s" : ""}
                          {t.zonesNeutralisees > 0 &&
                            ` · ${t.zonesNeutralisees} neutralisée${
                              t.zonesNeutralisees > 1 ? "s" : ""
                            }`}
                        </div>
                        <div className="prog-type-phases">
                          {PHASES.map((ph) => (
                            <span
                              key={ph}
                              className="prog-type-phase"
                              title={`${PHASE_META[ph].label} : ${t.parPhase[ph].faites}/${t.parPhase[ph].total}`}
                            >
                              <i
                                style={{ background: PHASE_META[ph].color }}
                              />
                              {t.parPhase[ph].faites}/{t.parPhase[ph].total}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            </>
          )}

          {/* Filtres du tableau */}
          <div className="zones-filtres">
            <select
              className="filter-select"
              value={emplacement}
              onChange={(e) => setEmplacement(e.target.value)}
              title="N'afficher qu'un emplacement (magasin, dock…)"
            >
              <option value="">Tous les emplacements</option>
              {emplacements.map((e) =>
                e.key ? (
                  <option key={e.key} value={e.key}>
                    {e.key}
                    {e.nbZones
                      ? ` · ${e.nbZones} zone${e.nbZones > 1 ? "s" : ""}`
                      : " · aucune zone"}
                  </option>
                ) : (
                  <option key={SANS_EMPLACEMENT} value={SANS_EMPLACEMENT}>
                    Sans emplacement · {e.nbZones} zone
                    {e.nbZones > 1 ? "s" : ""}
                  </option>
                ),
              )}
            </select>

            <div className="search-box">
              <HiSearch />
              <input
                type="text"
                placeholder="Filtrer les zones (code, libellé)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <span className="zones-compte">
              {filteredZones.length} zone{filteredZones.length > 1 ? "s" : ""}
              {filteredZones.length !== zones.length
                ? ` sur ${zones.length}`
                : ""}
            </span>
          </div>

          {/* Tableau zones */}
          <div className="admin-prog-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th className="statut-col"></th>
                  <th>Code</th>
                  <th>Libellé</th>
                  {PHASES.map((ph) => (
                    <th key={ph} className="phase-col">
                      {PHASE_META[ph].label}
                    </th>
                  ))}
                  <th className="neutraliser-col"></th>
                </tr>
              </thead>
              <tbody>
                {filteredZones.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="no-data">
                      Aucune zone.
                    </td>
                  </tr>
                ) : (
                  filteredZones.map((z) => {
                    const st = zoneStatut(z);
                    const neutralisee = !!z.neutralisee;
                    return (
                    <tr
                      key={`${z.code}||${z.type || ""}`}
                      className={neutralisee ? "zone-neutralisee" : undefined}
                    >
                      <td className="statut-col">
                        <span
                          className="statut-dot"
                          style={{ background: STATUT_META[st].color }}
                          title={STATUT_META[st].label}
                        />
                      </td>
                      <td className="code-cell">{z.code}</td>
                      <td>
                        {z.libelle}
                        {z.type && <span className="zone-type">{z.type}</span>}
                        {neutralisee && (
                          <span className="zone-neutralisee-tag">
                            Neutralisée
                          </span>
                        )}
                      </td>
                      {PHASES.map((ph) => {
                        const fait = !!z[ph]?.fait;
                        return (
                          <td key={ph} className="phase-col">
                            <button
                              className={`phase-badge ${fait ? "done" : ""}`}
                              style={
                                fait
                                  ? { borderColor: PHASE_META[ph].color }
                                  : undefined
                              }
                              disabled={neutralisee}
                              onClick={() =>
                                handleTogglePhase(z, ph, fait)
                              }
                              title={
                                neutralisee
                                  ? "Zone neutralisée : réactivez-la pour modifier ses phases"
                                  : fait
                                  ? `Fait${
                                      nomAgentPhase(z[ph])
                                        ? ` par ${nomAgentPhase(z[ph])}`
                                        : ""
                                    }${
                                      z[ph]?.at
                                        ? ` le ${formatDate(z[ph].at)}`
                                        : ""
                                    } — cliquer pour annuler`
                                  : `À faire — cliquer pour valider`
                              }
                            >
                              {fait ? <HiCheck /> : "—"}
                            </button>
                          </td>
                        );
                      })}
                      <td className="neutraliser-col">
                        <button
                          className="btn-icon"
                          disabled={neutralisant}
                          onClick={() => handleToggleNeutralisee(z)}
                          title={
                            neutralisee
                              ? "Réactiver la zone (elle comptera de nouveau dans l'avancement)"
                              : "Neutraliser la zone (rayon qui n'existe plus) : elle sort de l'avancement et ses coupons sont refusés"
                          }
                        >
                          {neutralisee ? <HiEye /> : <HiEyeOff />}
                        </button>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* ZONE DE DANGER — réinitialisation et annulation de l'inventaire
              EN COURS. Volontairement isolée en bas d'écran, cerclée de rouge
              et doublée de confirmations renforcées : ni l'une ni l'autre ne
              doit pouvoir être déclenchée par erreur pendant un inventaire.
              ADMIN SEULEMENT : le cycle de vie n'est pas ouvert aux
              responsables (le serveur refuse de toute façon). */}
          {isAdmin && (
          <div className="danger-zone">
            <div className="danger-zone-head">
              <h2>
                <HiExclamation /> Zone de danger
              </h2>
              <p>
                Ces actions touchent l'inventaire <strong>en cours</strong> de{" "}
                <strong>{entrepriseObj?.trigramme}</strong>. Elles sont
                irréversibles ou font perdre le fil du travail des agents : ne
                les utilisez qu'en connaissance de cause.
              </p>
            </div>
            <div className="danger-zone-row">
              <div className="danger-zone-texte">
                <strong>Réinitialiser l'inventaire</strong>
                <small>
                  Archive l'inventaire en cours et en recrée un nouveau à
                  partir des zones actuelles. L'avancement repart de zéro ;
                  l'inventaire archivé reste consultable dans l'historique.
                </small>
              </div>
              <button
                className="btn-danger-outline"
                onClick={() => {
                  setInitConfirmCoche(false);
                  setShowInitConfirm(true);
                }}
                disabled={initializing}
              >
                <HiRefresh /> Réinitialiser…
              </button>
            </div>
            <div className="danger-zone-row">
              <div className="danger-zone-texte">
                <strong>Annuler l'inventaire</strong>
                <small>
                  Supprime <strong>définitivement</strong> l'inventaire actif :
                  dossier réseau (.dat et fiches PDF), collectes, bipages et
                  fiches de contrôle. Aucun historique n'est conservé.
                </small>
              </div>
              <button
                className="btn-danger-outline"
                onClick={() => {
                  setAnnulerConfirmTexte("");
                  setShowAnnulerConfirm(true);
                }}
                disabled={annulating}
              >
                <HiTrash /> Annuler l'inventaire…
              </button>
            </div>
          </div>
          )}
        </>
      )}

      {/* Modal confirmation init */}
      {showInitConfirm && (
        <div className="modal-backdrop" onClick={() => setShowInitConfirm(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className={`modal-header${session ? " modal-header-danger" : ""}`}>
              <h2>
                {session ? <HiExclamation /> : <HiPlay />}{" "}
                {session
                  ? "Réinitialiser l'inventaire"
                  : "Initialiser un inventaire"}
              </h2>
              <button
                className="btn-close-modal"
                onClick={() => setShowInitConfirm(false)}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              <p>
                Un nouvel inventaire sera créé pour{" "}
                <strong>{entrepriseObj?.trigramme}</strong> à partir des zones
                actuelles.
              </p>

              {/* Un inventaire est EN COURS : on rappelle ce qui va être
                  archivé (nom + avancement réel) et on exige une coche
                  explicite — réinitialiser au milieu d'un comptage fait
                  repartir tout l'avancement de zéro. */}
              {session && (
                <div className="danger-encart">
                  <p>
                    <HiExclamation /> L'inventaire en cours{" "}
                    <strong>{session.nom}</strong>
                    {progress
                      ? ` (avancé à ${progress.pct} %, ${progress.faites}/${progress.totalPhases} phases)`
                      : ""}{" "}
                    sera <strong>archivé</strong> : l'avancement, le scan des
                    coupons et les dépôts des collecteurs repartiront de zéro
                    sur le nouvel inventaire.
                  </p>
                  <label className="danger-coche">
                    <input
                      type="checkbox"
                      checked={initConfirmCoche}
                      onChange={(e) => setInitConfirmCoche(e.target.checked)}
                    />
                    <span>
                      Je comprends que l'inventaire en cours sera archivé et
                      que l'avancement repartira de zéro.
                    </span>
                  </label>
                </div>
              )}

              {/* DESTINATION du dossier de l'inventaire. Le choix est définitif
                  pour cet inventaire : dépôt des .dat, surveillance par
                  l'agent d'impression et téléchargement du ZIP suivent tous
                  cette racine. Le miroir FTP, lui, reste une copie de
                  référence (réglable par société dans la fiche société). */}
              <div className="init-destination">
                <h3>Dossier de l'inventaire</h3>
                <p>
                  Où seront déposés les fichiers .dat des collecteurs et les
                  fiches de contrôle PDF de cet inventaire. L'agent
                  d'impression suit ce choix : dans les deux cas les fiches
                  sortent automatiquement à l'imprimante.
                </p>
                <label className="init-destination-choix">
                  <input
                    type="radio"
                    name="initDestination"
                    value="rcommun"
                    checked={initDestination === "rcommun"}
                    onChange={() => setInitDestination("rcommun")}
                  />
                  <span>
                    <strong>RCOMMUN — partage STOCK</strong>
                    <small>
                      Choix habituel : le dossier historique des inventaires,
                      à la racine du partage STOCK.
                    </small>
                  </span>
                </label>
                <label className="init-destination-choix">
                  <input
                    type="radio"
                    name="initDestination"
                    value="collect_sec"
                    checked={initDestination === "collect_sec"}
                    onChange={() => setInitDestination("collect_sec")}
                  />
                  <span>
                    <strong>
                      Dossier d'export de la société (collect_sec)
                    </strong>
                    <small>
                      Le chemin d'export configuré sur la fiche société, celui
                      des .dat de réappro. Pour une société sans partage STOCK.
                      L'inventaire y crée son propre sous-dossier, à côté des
                      .dat de réappro. ⚠️ Le poste qui fait tourner l'agent
                      d'impression doit pouvoir accéder à ce dossier.
                    </small>
                  </span>
                </label>
              </div>

              {/* Sélection des proformas : demandée UNE SEULE FOIS, ici. Les
                  imports « comptage sans collecteur » s'en serviront ensuite
                  sans jamais rien redemander. Modifiable plus tard depuis le
                  bloc de comptage. */}
              <div className="init-proformas">
                <h3>Proformas du comptage sans collecteur</h3>
                <p>
                  Plage de dates et clients des proformas qui serviront à
                  compter les rayons sans collecteur. Renseignés une fois pour
                  tout l'inventaire ; facultatif si vous n'importez que des
                  fichiers Excel.
                </p>
                <div className="init-proformas-champs">
                  <label>
                    Du
                    <input
                      type="date"
                      value={initProformas.dateDebut}
                      onChange={(e) =>
                        setInitProformas((f) => ({
                          ...f,
                          dateDebut: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    au
                    <input
                      type="date"
                      value={initProformas.dateFin}
                      onChange={(e) =>
                        setInitProformas((f) => ({
                          ...f,
                          dateFin: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="init-proformas-grow">
                    Client(s)
                    <input
                      type="text"
                      placeholder="9900 ou 9900, 9901…"
                      value={initProformas.clients}
                      onChange={(e) =>
                        setInitProformas((f) => ({
                          ...f,
                          clients: e.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className={session ? "btn-danger" : "btn-primary"}
                onClick={handleConfirmInit}
                disabled={initializing || (session && !initConfirmCoche)}
                title={
                  session && !initConfirmCoche
                    ? "Cochez la case de confirmation pour réinitialiser"
                    : undefined
                }
              >
                {initializing
                  ? "Initialisation…"
                  : session
                    ? "Réinitialiser l'inventaire"
                    : "Initialiser"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setShowInitConfirm(false)}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Désignation de l'agent — s'ouvre APRÈS le scan, avant toute écriture.
          Le coupon détachable ne porte aucune identité : sans cette étape, la
          phase serait créditée à la personne au poste, jamais à l'agent. */}
      {designation && (
        <div className="modal-backdrop" onClick={handleAnnulerDesignation}>
          <div
            className="modal-box modal-agent"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>
                <HiClipboardCheck /> Qui a réalisé ce travail ?
              </h2>
              <button
                className="btn-close-modal"
                onClick={handleAnnulerDesignation}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              <div className="designation-zone">
                <span
                  className="designation-phase"
                  style={{
                    borderColor: PHASE_META[designation.phase]?.color,
                    color: PHASE_META[designation.phase]?.color,
                  }}
                >
                  {PHASE_META[designation.phase]?.label || designation.phase}
                </span>
                <span className="designation-code">
                  {designation.zone?.code}
                </span>
                {designation.zone?.libelle && (
                  <span className="designation-lib">
                    {designation.zone.libelle}
                  </span>
                )}
              </div>
              {/* Bip du badge : posé AVANT la liste, c'est le geste normal.
                  La liste reste dessous pour les cas sans carte. */}
              <div className="designation-badge">
                <input
                  type="text"
                  className="designation-badge-input"
                  value={badgeSaisi}
                  onChange={(e) => traiterBadge(e.target.value)}
                  placeholder="Bipez le badge de l'agent…"
                  autoFocus
                />
                {badgeEnCours && (
                  <span className="designation-badge-etat">Recherche…</span>
                )}
              </div>
              {badgeMsg && (
                <p className={`designation-badge-msg ${badgeMsg.type}`}>
                  {badgeMsg.texte}
                </p>
              )}

              {/* Filtre de la liste : par défaut les seuls comptes ayant
                  accès à la société de l'inventaire. Décocher rouvre tout
                  l'annuaire, pour créditer un renfort d'une autre société. */}
              <label className="designation-filtre">
                <input
                  type="checkbox"
                  checked={agentsSocieteSeuls}
                  onChange={(e) => setAgentsSocieteSeuls(e.target.checked)}
                />
                <span>
                  Seulement les comptes ayant accès à{" "}
                  <strong>
                    {entrepriseObj?.trigramme || "cette société"}
                  </strong>
                  <em>
                    {agentsSocieteSeuls
                      ? ` ${nbAgentsSociete} compte${nbAgentsSociete > 1 ? "s" : ""}`
                      : ` ${(agentsPossibles || []).length} compte${
                          (agentsPossibles || []).length > 1 ? "s" : ""
                        } — tout l'annuaire`}
                  </em>
                </span>
              </label>

              <UserPicker
                users={agentsAffiches}
                value={agentUserId}
                onChange={setAgentUserId}
                placeholder="Moi (par défaut)"
                emptyLabel="Moi (par défaut)"
              />
              <p className="designation-hint">
                Bipez le badge de l'agent, ou cherchez-le par son nom ou son
                e-mail. Décochez le filtre pour atteindre{" "}
                <strong>tous</strong> les comptes de l'application : un renfort
                venu d'une autre société du groupe doit pouvoir être crédité
                (bipez son badge et la liste s'ouvre d'elle-même). Sans choix,
                la phase est mise à votre nom.
              </p>
            </div>
            <div className="modal-footer">
              {/* ⚠️ Plus d'autoFocus ici : c'est le champ de bip, en tête de
                  fenêtre, qui doit recevoir le focus. Deux autoFocus dans la
                  même fenêtre, c'est le dernier monté qui gagne — le bouton
                  volait le focus au champ, et la douchette n'écrivait nulle
                  part. */}
              <button
                className="btn-primary"
                onClick={handleConfirmerDesignation}
                disabled={biping}
              >
                {biping ? "Validation…" : "Valider la phase"}
              </button>
              <button
                className="btn-secondary"
                onClick={handleAnnulerDesignation}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation de neutralisation d'une zone qui porte déjà du travail
          (phases faites, lignes bipées) : demandée par le serveur, qui n'écrit
          rien tant que `confirmer` n'est pas renvoyé. */}
      {confirmNeutralisation && (
        <div
          className="modal-backdrop"
          onClick={() => setConfirmNeutralisation(null)}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                <HiEyeOff /> Neutraliser la zone{" "}
                {confirmNeutralisation.zone.code}
              </h2>
              <button
                className="btn-close-modal"
                onClick={() => setConfirmNeutralisation(null)}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              <p>
                La zone{" "}
                <strong>
                  {confirmNeutralisation.zone.code}
                  {confirmNeutralisation.zone.type
                    ? ` (${confirmNeutralisation.zone.type})`
                    : ""}
                </strong>
                {confirmNeutralisation.zone.libelle
                  ? ` — ${confirmNeutralisation.zone.libelle} —`
                  : ""}{" "}
                porte <strong>déjà du travail</strong> :
              </p>
              <ul>
                {(confirmNeutralisation.travail?.phasesFaites || []).map(
                  (ph) => (
                    <li key={ph}>
                      phase <strong>{PHASE_META[ph]?.label || ph}</strong>{" "}
                      validée ;
                    </li>
                  ),
                )}
                {confirmNeutralisation.travail?.nbLignesBipage > 0 && (
                  <li>
                    <strong>
                      {confirmNeutralisation.travail.nbLignesBipage} ligne
                      {confirmNeutralisation.travail.nbLignesBipage > 1
                        ? "s"
                        : ""}{" "}
                      de bipage
                    </strong>{" "}
                    collectée
                    {confirmNeutralisation.travail.nbLignesBipage > 1
                      ? "s"
                      : ""}{" "}
                    ;
                  </li>
                )}
                {confirmNeutralisation.travail?.nbCollectes > 0 && (
                  <li>
                    <strong>
                      {confirmNeutralisation.travail.nbCollectes} collecte
                      {confirmNeutralisation.travail.nbCollectes > 1 ? "s" : ""}
                    </strong>{" "}
                    au collecteur (en cours ou déposée
                    {confirmNeutralisation.travail.nbCollectes > 1 ? "s" : ""}) ;
                  </li>
                )}
              </ul>
              <p>
                La neutraliser la sort de l'avancement global et refuse ses
                coupons au scan. <strong>Rien n'est supprimé</strong> : les
                phases et les bipages restent enregistrés, et la réactiver
                rend tout tel quel.
              </p>
            </div>
            <div className="modal-footer">
              <button
                className="btn-danger"
                disabled={neutralisant}
                onClick={() =>
                  handleToggleNeutralisee(confirmNeutralisation.zone, {
                    confirmer: true,
                  })
                }
              >
                {neutralisant ? "Neutralisation…" : "Oui, neutraliser"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setConfirmNeutralisation(null)}
              >
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmation annulation */}
      {showAnnulerConfirm && (
        <div
          className="modal-backdrop"
          onClick={() => setShowAnnulerConfirm(false)}
        >
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header modal-header-danger">
              <h2>
                <HiExclamation /> Annuler l'inventaire
              </h2>
              <button
                className="btn-close-modal"
                onClick={() => setShowAnnulerConfirm(false)}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              <p>
                L'inventaire actif{" "}
                {session?.nom && <strong>{session.nom} </strong>}de{" "}
                <strong>{entrepriseObj?.trigramme}</strong>
                {progress
                  ? ` (avancé à ${progress.pct} %, ${progress.faites}/${progress.totalPhases} phases)`
                  : ""}{" "}
                sera <strong>définitivement supprimé</strong> :
              </p>
              <ul>
                <li>
                  le dossier de dépôt réseau et son contenu (fichiers .DAT et
                  fiches PDF) seront <strong>effacés</strong> ;
                </li>
                <li>
                  les collectes, bipages et fiches de contrôle liés seront
                  purgés ;
                </li>
                <li>aucun historique ne sera conservé.</li>
              </ul>
              <p>
                Cette action est <strong>irréversible</strong>. Pour archiver
                l'inventaire en gardant sa trace dans l'historique, utilisez
                plutôt « Réinitialiser ».
              </p>
              {/* Confirmation par saisie du trigramme : un clic réflexe sur
                  « Oui » ne doit pas pouvoir détruire un inventaire en cours. */}
              <div className="danger-encart">
                <label className="danger-saisie">
                  <span>
                    Tapez <strong>{motAnnulation}</strong> pour confirmer la
                    suppression :
                  </span>
                  <input
                    type="text"
                    value={annulerConfirmTexte}
                    onChange={(e) => setAnnulerConfirmTexte(e.target.value)}
                    placeholder={motAnnulation}
                    autoFocus
                  />
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-danger"
                onClick={handleConfirmAnnuler}
                disabled={annulating || !annulationConfirmee}
                title={
                  !annulationConfirmee
                    ? `Tapez ${motAnnulation} pour activer ce bouton`
                    : undefined
                }
              >
                {annulating
                  ? "Annulation…"
                  : "Supprimer définitivement l'inventaire"}
              </button>
              <button
                className="btn-secondary"
                onClick={() => setShowAnnulerConfirm(false)}
              >
                Retour
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal historique */}
      {showHistorique && (
        <div className="modal-backdrop" onClick={() => setShowHistorique(false)}>
          <div
            className="modal-box modal-large"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2>
                <HiArchive /> Historique des inventaires
              </h2>
              <button
                className="btn-close-modal"
                onClick={() => setShowHistorique(false)}
              >
                <HiX />
              </button>
            </div>
            <div className="modal-content">
              {!historiqueData ? (
                <p>Chargement…</p>
              ) : historiqueData.sessions.length === 0 ? (
                <p>Aucun inventaire archivé.</p>
              ) : (
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Nom</th>
                      <th>Archivé le</th>
                      <th>Avancement</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {historiqueData.sessions.map((s) => (
                      <tr key={s._id}>
                        <td>{s.nom}</td>
                        <td>{formatDate(s.archivedAt)}</td>
                        <td>
                          {s.progress.pct}% ({s.progress.faites}/
                          {s.progress.totalPhases})
                        </td>
                        <td>
                          <button
                            className="btn-icon"
                            onClick={() =>
                              window.open(
                                `/api/inventaires-zones/${selectedEntreprise}/dossier-zip?sessionId=${s._id}`,
                                "_blank",
                              )
                            }
                            title="Enregistrer le dossier de cet inventaire (ZIP)"
                          >
                            <HiDownload />
                          </button>
                          {isAdmin && (
                            <button
                              className="btn-icon danger"
                              onClick={() => handleDeleteHisto(s._id)}
                              disabled={deletingSession}
                              title="Supprimer cet inventaire et toutes ses données (bipages, fiches, bilan)"
                            >
                              <HiTrash />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminInventaireProgressionScreen;