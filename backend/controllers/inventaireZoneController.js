// backend/controllers/inventaireZoneController.js
import asyncHandler from "../middleware/asyncHandler.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import InventaireCollecte from "../models/InventaireCollecteModel.js";
import LigneBipage from "../models/LigneBipageModel.js";
import FicheControle from "../models/FicheControleModel.js";
import Zone from "../models/ZoneModel.js";
import {
  ensureInventaireDirs,
  getInventaireDirs,
} from "../services/ficheControleService.js";

const PHASES = ["papillonnage", "bipage", "controle"];

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
  const { nom } = req.body;

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

  // Création des dossiers réseau (\\...\STOCK\<nom>\ + archive_dat, archive_pdf, zone_non_trouvee)
  // Best-effort : si le partage est inaccessible, on n'empêche pas l'init.
  let dossierDat = getInventaireDirs(nomFinal).base;
  try {
    const dirs = ensureInventaireDirs(nomFinal);
    dossierDat = dirs.base;
  } catch (err) {
    console.error(
      `[Inventaire] Dossier réseau non créé (${dossierDat}): ${err.message}`,
    );
  }

  const session = await InventaireZoneSession.create({
    entreprise: entreprise._id,
    nom: nomFinal,
    dossierDat,
    statut: "actif",
    zones: zonesSnapshot,
    totalZones: zonesSnapshot.length,
    totalPhases: zonesSnapshot.length * PHASES.length,
    createdBy: req.user._id,
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
 * @body    { code }
 *
 * VERROU RE-BIPAGE : si la zone scannée via son EAN "bipage" a déjà été
 * bipée ET imprimée (FicheControle.printed === true), le re-bipage est refusé.
 * Pour la re-biper, l'admin doit d'abord « Recommencer » la zone depuis
 * l'écran Détail des bipages.
 */
const biperZone = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { code } = req.body;

  if (!code || !String(code).trim()) {
    res.status(400);
    throw new Error("Code-barres requis");
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

  // Marquer la phase (idempotent)
  const dejaFait = zone[phase].fait;
  if (!dejaFait) {
    zone[phase].fait = true;
    zone[phase].at = new Date();
    zone[phase].by = req.user._id;
    session.markModified("zones");
    await session.save();
  }

  res.json({
    type: "phase",
    action: dejaFait ? "deja_fait" : "marque",
    zone: { code: zone.code, libelle: zone.libelle },
    phase,
    message: `Zone ${zone.code} — ${phase} ${dejaFait ? "déjà fait" : "validé"}`,
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

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  }).populate("createdBy", "nom prenom");

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
 * @body    { fait: boolean }
 */
const setPhaseManuelle = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { code, phase } = req.params;
  const { fait } = req.body;

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

  const zone = session.zones.find((z) => z.code === code);
  if (!zone) {
    res.status(404);
    throw new Error("Zone non trouvée dans cet inventaire");
  }

  const valeur = !!fait;
  zone[phase].fait = valeur;
  zone[phase].at = valeur ? new Date() : null;
  zone[phase].by = valeur ? req.user._id : null;
  session.markModified("zones");
  await session.save();

  res.json({
    zone: { code: zone.code, phase, fait: valeur },
    progress: computeProgress(session),
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

export {
  initInventaireZone,
  biperZone,
  getActiveSession,
  getProgress,
  getHistorique,
  setPhaseManuelle,
  deleteSession,
};