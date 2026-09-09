// backend/controllers/inventaireZoneController.js
import fs from "fs";
import mongoose from "mongoose";
import asyncHandler from "../middleware/asyncHandler.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import InventaireCollecte from "../models/InventaireCollecteModel.js";
import LigneBipage from "../models/LigneBipageModel.js";
import FicheControle from "../models/FicheControleModel.js";
import Zone from "../models/ZoneModel.js";
import User from "../models/UserModel.js";
import {
  getInventaireDirs,
  makeInventaireSlug,
} from "../services/ficheControleService.js";

const PHASES = ["papillonnage", "bipage", "controle"];

/**
 * Résout l'AGENT crédité d'une phase. Le coupon détachable n'identifie que la
 * zone : l'agent est choisi dans la liste au moment du scan (`agentUserId`).
 * La liste n'est PAS bornée aux utilisateurs de la société de l'inventaire —
 * un inventaire est souvent renforcé par du personnel d'une autre société du
 * groupe. Sans choix, on crédite la personne connectée (ancien comportement).
 * @returns {Promise<{ id, nom } | null>} null si l'id fourni ne correspond à
 *          aucun utilisateur (l'appelant répond alors 400).
 */
const resoudreAgent = async (agentUserId, utilisateurConnecte) => {
  if (agentUserId) {
    if (!mongoose.isValidObjectId(agentUserId)) return null;
    const agent = await User.findById(agentUserId).select("nom prenom email");
    if (!agent) return null;
    return { id: agent._id, nom: nomComplet(agent) };
  }
  return { id: utilisateurConnecte._id, nom: nomComplet(utilisateurConnecte) };
};

/**
 * Normalise la sélection de proformas du « comptage sans collecteur ».
 * Dates gardées telles quelles (`AAAA-MM-JJ`) ; clients gardés en une chaîne
 * lisible, découpée côté recherche.
 */
const normaliserFiltreProformas = (f, utilisateur) => ({
  dateDebut: String(f?.dateDebut || "").trim(),
  dateFin: String(f?.dateFin || "").trim(),
  clients: String(f?.clients || "").trim(),
  definiAt: new Date(),
  definiPar: utilisateur?._id || null,
});

/** "Prénom Nom" (repli e-mail) — même formatage que le suivi bipage. */
const nomComplet = (u) =>
  u ? `${u.prenom || ""} ${u.nom || ""}`.trim() || u.email || "" : "";

// ===========================================
// HELPERS
// ===========================================

/**
 * Calcule la progression d'une session (global + par phase).
 */
const computeProgress = (session) => {
  const compteurs = { papillonnage: 0, bipage: 0, controle: 0 };

  (session.zones || []).forEach((z) => {
    PHASES.forEach((ph) => {
      if (z[ph] && z[ph].fait) compteurs[ph] += 1;
    });
  });

  const totalZones = session.zones ? session.zones.length : 0;
  const totalPhases = totalZones * PHASES.length;
  const faites = compteurs.papillonnage + compteurs.bipage + compteurs.controle;
  const pct = totalPhases ? Math.round((faites / totalPhases) * 100) : 0;

  const parPhase = (ph) => ({
    faites: compteurs[ph],
    total: totalZones,
    pct: totalZones ? Math.round((compteurs[ph] / totalZones) * 100) : 0,
  });

  return {
    totalZones,
    totalPhases,
    faites,
    pct,
    parPhase: {
      papillonnage: parPhase("papillonnage"),
      bipage: parPhase("bipage"),
      controle: parPhase("controle"),
    },
  };
};

/**
 * Résout un code-barres contre les zones d'une session.
 * @returns { zone, phase } où phase ∈ PHASES | "principal" | null
 */
const resoudreCode = (session, code) => {
  const c = String(code || "").trim();
  if (!c) return { zone: null, phase: null };

  for (const zone of session.zones) {
    if (zone.eanPapillonnage && zone.eanPapillonnage.trim() === c)
      return { zone, phase: "papillonnage" };
    if (zone.eanBipage && zone.eanBipage.trim() === c)
      return { zone, phase: "bipage" };
    if (zone.eanControle && zone.eanControle.trim() === c)
      return { zone, phase: "controle" };
    if (zone.eanPrincipal && zone.eanPrincipal.trim() === c)
      return { zone, phase: "principal" };
  }
  return { zone: null, phase: null };
};

const sessionResume = (session) => ({
  _id: session._id,
  nom: session.nom,
  statut: session.statut,
  totalZones: session.totalZones,
  totalPhases: session.totalPhases,
  createdAt: session.createdAt,
  archivedAt: session.archivedAt,
  progress: computeProgress(session),
});

// ===========================================
// INITIALISATION
// ===========================================

/**
 * @desc    Initialiser un inventaire de zones (archive l'actif précédent)
 * @route   POST /api/inventaires-zones/init/:entrepriseId
 * @access  Private/Admin
 */
const initInventaireZone = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { nom, filtreProformas } = req.body;

  const zones = await Zone.find({ entreprise: entreprise._id }).sort({
    code: 1,
  });

  if (zones.length === 0) {
    res.status(400);
    throw new Error(
      "Aucune zone pour cette entreprise. Importez d'abord les fiches inventaires.",
    );
  }

  // Archiver la session active existante
  await InventaireZoneSession.updateMany(
    { entreprise: entreprise._id, statut: "actif" },
    { $set: { statut: "archive", archivedAt: new Date() } },
  );

  // ⚠ Purge des collectes agent (zones en cours / déposées) — aucune trace
  // conservée : on repart sur un inventaire totalement vierge.
  await InventaireCollecte.deleteMany({ entreprise: entreprise._id });

  // ⚠ Purge des bipages (lignes des .DAT déjà collectés) de l'entreprise.
  await LigneBipage.deleteMany({ entreprise: entreprise._id });

  // Snapshot des zones
  const zonesSnapshot = zones.map((z) => ({
    code: z.code,
    libelle: z.libelle,
    type: z.type,
    eanPrincipal: z.eanPrincipal,
    eanPapillonnage: z.eanPapillonnage,
    eanBipage: z.eanBipage,
    eanControle: z.eanControle,
    papillonnage: {},
    bipage: {},
    controle: {},
  }));

  const nomFinal =
    (nom && nom.trim()) ||
    `Inventaire du ${new Date().toLocaleString("fr-FR")}`;

  // Slug de dossier UNIQUE (nom + horodatage) : une réinitialisation ne réutilise
  // JAMAIS le dossier d'un inventaire précédent, même à nom identique.
  const dossierSlug = makeInventaireSlug(nomFinal);

  // Création du SEUL dossier de base (\\...\STOCK\<slug>\). Les sous-dossiers
  // par emplacement (+ leurs archive_dat/archive_pdf/zone_non_trouvee) sont
  // créés à la demande, au dépôt et par le watcher : rien à la racine.
  // Best-effort : si le partage est inaccessible, on n'empêche pas l'init.
  const dossierDat = getInventaireDirs(dossierSlug).base;
  try {
    fs.mkdirSync(dossierDat, { recursive: true });
  } catch (err) {
    console.error(
      `[Inventaire] Dossier réseau non créé (${dossierDat}): ${err.message}`,
    );
  }

  const session = await InventaireZoneSession.create({
    entreprise: entreprise._id,
    nom: nomFinal,
    dossierDat,
    dossierSlug,
    statut: "actif",
    zones: zonesSnapshot,
    totalZones: zonesSnapshot.length,
    totalPhases: zonesSnapshot.length * PHASES.length,
    createdBy: req.user._id,
    // Sélection des proformas : renseignée une fois, au démarrage.
    filtreProformas: normaliserFiltreProformas(filtreProformas, req.user),
  });

  res.status(201).json({
    message: "Inventaire initialisé",
    session,
    progress: computeProgress(session),
  });
});

// ===========================================
// BIP
// ===========================================

/**
 * @desc    Biper un code-barres → marque la phase correspondante
 * @route   POST /api/inventaires-zones/:entrepriseId/bip
 * @access  Private/Admin
 * @body    { code, agentUserId? }
 *
 * `agentUserId` : l'agent qui a réellement fait le travail, choisi dans la
 * liste APRÈS le scan (le coupon ne porte aucune identité). Absent → la
 * personne connectée est créditée.
 *
 * `previsualiser: true` : résout le code SANS RIEN ÉCRIRE. C'est ce que le
 * front appelle au scan, pour savoir quelle zone et quelle phase annoncer dans
 * la fenêtre « qui a fait ce travail ? » ; la validation refait un appel, sans
 * le drapeau et avec `agentUserId`. Rien n'est marqué si l'opérateur annule.
 *
 * VERROU RE-BIPAGE : si la zone scannée via son EAN "bipage" a déjà été
 * bipée ET imprimée (FicheControle.printed === true), le re-bipage est refusé.
 * Pour la re-biper, l'admin doit d'abord « Recommencer » la zone depuis
 * l'écran Détail des bipages.
 */
const biperZone = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { code, agentUserId, previsualiser = false } = req.body;

  if (!code || !String(code).trim()) {
    res.status(400);
    throw new Error("Code-barres requis");
  }

  // En prévisualisation, aucun agent n'est encore choisi : on ne le résout pas.
  const agent = previsualiser
    ? null
    : await resoudreAgent(agentUserId, req.user);
  if (!previsualiser && !agent) {
    res.status(400);
    throw new Error("Agent introuvable : re-sélectionnez la personne.");
  }

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  if (!session) {
    res.status(400);
    throw new Error("Aucun inventaire actif. Initialisez d'abord un inventaire.");
  }

  const { zone, phase } = resoudreCode(session, code);

  if (!zone) {
    res.status(404);
    throw new Error("Code-barres inconnu dans cet inventaire");
  }

  // eanPrincipal : identification seule, aucune phase marquée
  if (phase === "principal") {
    return res.json({
      type: "principal",
      action: "identifiee",
      zone: { code: zone.code, libelle: zone.libelle },
      message: `Zone ${zone.code} identifiée`,
      progress: computeProgress(session),
    });
  }

  // BLOCAGE : re-bipage interdit si la zone est déjà bipée + imprimée.
  if (phase === "bipage") {
    const dejaImprimee = await FicheControle.exists({
      session: session._id,
      zoneCode: zone.code,
      printed: true,
    });
    if (dejaImprimee) {
      return res.status(200).json({
        type: "phase",
        action: "verrouille",
        verrouille: true,
        zone: { code: zone.code, libelle: zone.libelle },
        phase,
        message: `Zone ${zone.code} déjà bipée et imprimée. Re-bipage interdit : utilisez « Recommencer » dans Détail des bipages.`,
        progress: computeProgress(session),
      });
    }
  }

  const dejaFait = zone[phase].fait;

  // Résolution seule : le front a de quoi remplir la fenêtre de désignation.
  // Une phase déjà faite est renvoyée telle quelle (`dejaFait`) : le front
  // affiche l'avertissement habituel et n'ouvre pas la fenêtre — inutile de
  // désigner quelqu'un pour un travail déjà enregistré.
  if (previsualiser) {
    return res.json({
      type: "phase",
      action: "a_confirmer",
      zone: { code: zone.code, libelle: zone.libelle, type: zone.type },
      phase,
      dejaFait,
      message: dejaFait ? "déjà validé" : "à désigner",
      progress: computeProgress(session),
    });
  }

  // Marquer la phase (idempotent)
  if (!dejaFait) {
    zone[phase].fait = true;
    zone[phase].at = new Date();
    zone[phase].by = agent.id;
    zone[phase].saisiPar = req.user._id;
    session.markModified("zones");
    await session.save();
  }

  res.json({
    type: "phase",
    action: dejaFait ? "deja_fait" : "marque",
    zone: { code: zone.code, libelle: zone.libelle },
    phase,
    agent: dejaFait ? null : { _id: agent.id, nom: agent.nom },
    message: `Zone ${zone.code} — ${phase} ${
      dejaFait ? "déjà fait" : `validé (${agent.nom})`
    }`,
    progress: computeProgress(session),
  });
});

// ===========================================
// CONSULTATION
// ===========================================

/**
 * @desc    Session active détaillée (vue admin)
 * @route   GET /api/inventaires-zones/:entrepriseId/active
 * @access  Private/Admin
 */
const getActiveSession = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  // Les agents crédités des phases sont peuplés : l'écran affiche « fait par
  // X » sur chaque pastille, sinon la désignation de l'agent au scan resterait
  // invisible tant qu'on n'ouvre pas l'écran « Agents de l'inventaire ».
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  })
    .populate("createdBy", "nom prenom")
    .populate("zones.papillonnage.by", "nom prenom email")
    .populate("zones.bipage.by", "nom prenom email")
    .populate("zones.controle.by", "nom prenom email");

  if (!session) {
    return res.json({ active: null });
  }

  res.json({
    active: session,
    progress: computeProgress(session),
  });
});

/**
 * @desc    Progression légère (% global + par phase)
 * @route   GET /api/inventaires-zones/:entrepriseId/progress
 * @access  Private/Admin
 */
const getProgress = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  if (!session) {
    return res.json({ active: false, progress: null });
  }

  res.json({
    active: true,
    sessionId: session._id,
    nom: session.nom,
    progress: computeProgress(session),
  });
});

/**
 * @desc    Historique des sessions archivées (résumés)
 * @route   GET /api/inventaires-zones/:entrepriseId/historique
 * @access  Private/Admin
 */
const getHistorique = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const sessions = await InventaireZoneSession.find({
    entreprise: entreprise._id,
    statut: "archive",
  }).sort({ archivedAt: -1 });

  res.json({
    total: sessions.length,
    sessions: sessions.map(sessionResume),
  });
});

// ===========================================
// CORRECTION MANUELLE
// ===========================================

/**
 * @desc    Cocher/décocher manuellement une phase d'une zone
 * @route   PUT /api/inventaires-zones/:entrepriseId/zone/:code/:phase
 * @access  Private/Admin
 * @body    { fait: boolean, agentUserId?, emplacement? }
 *
 * ⚠️ `emplacement` n'est pas facultatif dans les faits : un même code de zone
 * existe au MAGASIN et au DOCK (A_1, A_10, A_11… chez QC) et ce sont DEUX
 * zones distinctes. Sans lui, on validait la première trouvée — donc souvent
 * la mauvaise. Il n'est toléré absent que si le code est unique dans la
 * session ; sinon on refuse plutôt que de deviner.
 */
const setPhaseManuelle = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { code, phase } = req.params;
  const { fait, agentUserId, emplacement } = req.body;

  if (!PHASES.includes(phase)) {
    res.status(400);
    throw new Error(`Phase invalide. Attendu : ${PHASES.join(", ")}`);
  }

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  if (!session) {
    res.status(400);
    throw new Error("Aucun inventaire actif");
  }

  const memeCode = (session.zones || []).filter((z) => z.code === code);
  if (memeCode.length === 0) {
    res.status(404);
    throw new Error("Zone non trouvée dans cet inventaire");
  }

  const empl = String(emplacement ?? "").trim();
  let zone;
  if (empl) {
    zone = memeCode.find((z) => (z.type || "").trim() === empl);
    if (!zone) {
      res.status(404);
      throw new Error(
        `Zone ${code} introuvable à l'emplacement ${empl} dans cet inventaire.`,
      );
    }
  } else if (memeCode.length > 1) {
    // Deux zones, deux comptages : on ne tranche pas à la place de l'appelant.
    res.status(400);
    throw new Error(
      `La zone ${code} existe à plusieurs emplacements (${memeCode
        .map((z) => z.type || "sans emplacement")
        .join(", ")}) : précisez lequel.`,
    );
  } else {
    [zone] = memeCode;
  }

  const valeur = !!fait;
  // Même règle que le bip : on crédite l'agent désigné, à défaut la personne
  // connectée. Décocher efface les deux traces.
  const agent = valeur ? await resoudreAgent(agentUserId, req.user) : null;
  if (valeur && !agent) {
    res.status(400);
    throw new Error("Agent introuvable : re-sélectionnez la personne.");
  }

  zone[phase].fait = valeur;
  zone[phase].at = valeur ? new Date() : null;
  zone[phase].by = valeur ? agent.id : null;
  zone[phase].saisiPar = valeur ? req.user._id : null;
  session.markModified("zones");
  await session.save();

  res.json({
    zone: { code: zone.code, type: zone.type || "", phase, fait: valeur },
    agent: agent ? { _id: agent.id, nom: agent.nom } : null,
    progress: computeProgress(session),
  });
});

// ===========================================
// ANNULATION (session active : table rase)
// ===========================================

/**
 * @desc    Annuler l'inventaire ACTIF : supprime le dossier réseau de dépôt
 *          (.DAT + PDF + sous-dossiers), purge les données liées et SUPPRIME
 *          la session. Contrairement à la réinitialisation, rien n'est archivé
 *          et aucun nouvel inventaire n'est créé → table rase.
 * @route   POST /api/inventaires-zones/:entrepriseId/annuler
 * @access  Private/Admin
 */
const annulerInventaireZone = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  if (!session) {
    res.status(400);
    throw new Error("Aucun inventaire actif à annuler.");
  }

  // 1) Suppression du dossier réseau de dépôt (best-effort : le partage peut
  //    être injoignable depuis le VPS ; on n'échoue pas pour autant).
  let dossierSupprime = false;
  let dossierErreur = "";
  const slug = session.dossierSlug || session.nom;
  const base = slug ? getInventaireDirs(slug).base : session.dossierDat;
  if (base) {
    try {
      fs.rmSync(base, { recursive: true, force: true });
      dossierSupprime = true;
    } catch (err) {
      dossierErreur = err.message;
    }
  }

  // 2) Purge des données liées (fiches de cette session + collectes/bipages de
  //    l'entreprise, comme une réinitialisation).
  await FicheControle.deleteMany({ session: session._id });
  await InventaireCollecte.deleteMany({ entreprise: entreprise._id });
  await LigneBipage.deleteMany({ entreprise: entreprise._id });

  // 3) Suppression de la session active.
  await InventaireZoneSession.deleteOne({ _id: session._id });

  res.json({
    message: "Inventaire annulé",
    dossier: base,
    dossierSupprime,
    dossierErreur,
  });
});

// ===========================================
// SUPPRESSION (sessions archivées uniquement)
// ===========================================

/**
 * @desc    Supprimer une session archivée
 * @route   DELETE /api/inventaires-zones/:entrepriseId/:id
 * @access  Private/Admin
 */
const deleteSession = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const session = await InventaireZoneSession.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });

  if (!session) {
    res.status(404);
    throw new Error("Session non trouvée");
  }

  if (session.statut === "actif") {
    res.status(400);
    throw new Error(
      "Impossible de supprimer la session active. Initialisez-en une nouvelle d'abord.",
    );
  }

  await InventaireZoneSession.deleteOne({ _id: session._id });
  res.json({ message: "Session supprimée" });
});

/**
 * @desc    Liste des utilisateurs sélectionnables comme agent au scan d'un
 *          coupon. VOLONTAIREMENT NON BORNÉE à la société de l'inventaire :
 *          un inventaire est régulièrement renforcé par du personnel d'une
 *          autre société du groupe, qui doit pouvoir être crédité. La route
 *          reste admin + accès société, et ne renvoie que l'identité (aucun
 *          droit, aucune donnée société).
 * @route   GET /api/inventaires-zones/:entrepriseId/agents-possibles
 * @access  Private/Admin
 */
const getAgentsPossibles = asyncHandler(async (req, res) => {
  const users = await User.find({ isActive: true })
    .select("nom prenom email")
    .sort({ nom: 1, prenom: 1 })
    .lean();

  res.json(
    users.map((u) => ({
      _id: u._id,
      nom: nomComplet(u),
      email: u.email || "",
    })),
  );
});

/**
 * @desc    Définir / corriger la sélection de proformas de l'inventaire actif
 *          (plage de dates + clients). Elle est saisie UNE FOIS et sert à tous
 *          les imports « comptage sans collecteur » qui suivent.
 * @route   PUT /api/inventaires-zones/:entrepriseId/filtre-proformas
 * @body    { dateDebut, dateFin, clients }
 * @access  Private/Admin
 */
const setFiltreProformas = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });
  if (!session) {
    res.status(400);
    throw new Error("Aucun inventaire actif");
  }

  session.filtreProformas = normaliserFiltreProformas(req.body, req.user);
  await session.save();

  res.json({
    message: "Sélection des proformas enregistrée",
    filtreProformas: session.filtreProformas,
  });
});

export {
  initInventaireZone,
  setFiltreProformas,
  annulerInventaireZone,
  biperZone,
  getAgentsPossibles,
  getActiveSession,
  getProgress,
  getHistorique,
  setPhaseManuelle,
  deleteSession,
};