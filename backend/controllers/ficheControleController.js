// backend/controllers/ficheControleController.js
import fs from "fs";
import asyncHandler from "../middleware/asyncHandler.js";
import FicheControle from "../models/FicheControleModel.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import {
  config,
  resoudreCheminPdf,
  assurerPdfFiche,
} from "../services/ficheControleService.js";
import {
  scanManuel,
  isWatching,
  startInventaireWatcher,
  stopInventaireWatcher,
} from "../services/inventaireWatchService.js";

/**
 * @desc    Liste des fiches de l'inventaire actif
 * @route   GET /api/fiches-controle/:entrepriseId
 * @access  Private/Admin
 */
const getFiches = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  if (!session) {
    return res.json({ active: false, fiches: [] });
  }

  const fiches = await FicheControle.find({ session: session._id }).sort({
    date: -1,
  });

  res.json({
    active: true,
    session: { _id: session._id, nom: session.nom, dossierDat: session.dossierDat },
    fiches,
  });
});

/**
 * @desc    Déclenche un scan immédiat des dossiers .DAT
 * @route   POST /api/fiches-controle/:entrepriseId/scan
 * @access  Private/Admin
 */
const scanMaintenant = asyncHandler(async (req, res) => {
  const report = await scanManuel();
  res.json({ message: "Scan effectué", report });
});

/**
 * @desc    État de la surveillance automatique
 * @route   GET /api/fiches-controle/watch/status
 * @access  Private/Admin
 */
const statutSurveillance = asyncHandler(async (req, res) => {
  res.json({ watching: isWatching(), intervalMs: config.watchIntervalMs });
});

/**
 * @desc    Démarrer la surveillance automatique
 * @route   POST /api/fiches-controle/watch/start
 * @access  Private/Admin
 */
const demarrerSurveillance = asyncHandler(async (req, res) => {
  startInventaireWatcher();
  res.json({ watching: true, intervalMs: config.watchIntervalMs });
});

/**
 * @desc    Arrêter la surveillance automatique
 * @route   POST /api/fiches-controle/watch/stop
 * @access  Private/Admin
 */
const arreterSurveillance = asyncHandler(async (req, res) => {
  stopInventaireWatcher();
  res.json({ watching: false });
});

/**
 * @desc    Demander la réimpression d'une fiche.
 *          L'impression a lieu là où sont l'imprimante + le Rcommun (agent
 *          local). Le backend web (potentiellement le VPS Linux) ne peut pas
 *          imprimer : il POSE le drapeau `reprintRequested`, que le watcher/
 *          agent local exécute au passage suivant (~quelques secondes).
 * @route   POST /api/fiches-controle/:entrepriseId/:id/reprint
 * @access  Private/Admin
 */
const reimprimer = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const fiche = await FicheControle.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });

  if (!fiche) {
    res.status(404);
    throw new Error("Fiche non trouvée");
  }

  fiche.reprintRequested = true;
  fiche.reprintRequestedAt = new Date();
  fiche.printError = "";
  await fiche.save();

  res.json({
    message:
      "Réimpression envoyée : la fiche va sortir sur l'imprimante du magasin.",
    fiche,
  });
});

/**
 * @desc    Afficher (aperçu) ou télécharger le PDF d'une fiche.
 *          Le PDF vit sur le partage réseau, mais il peut avoir été déplacé ou
 *          supprimé par le programme externe qui surveille le dossier — et le
 *          backend web (VPS) n'a pas toujours accès à ce partage. On le
 *          REGÉNÈRE alors à l'identique depuis le .DAT ou depuis les lignes
 *          stockées en base : l'aperçu et le téléchargement marchent donc
 *          toujours, indépendamment de l'agent d'impression.
 * @route   GET /api/fiches-controle/:entrepriseId/:id/pdf[?download=1]
 * @access  Private/Admin
 */
const telechargerPdf = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const fiche = await FicheControle.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });

  if (!fiche) {
    res.status(404);
    throw new Error("Fiche non trouvée");
  }

  const { chemin, temporaire } = await assurerPdfFiche(fiche, entreprise);
  if (!chemin) {
    res.status(404);
    throw new Error(
      "PDF indisponible : ni le fichier sur le partage, ni les lignes bipées ne sont accessibles pour cette fiche.",
    );
  }

  // Nom de fichier lisible côté poste : "fiche_<zone>_<emplacement>.pdf".
  const base =
    [fiche.zoneCode, fiche.zoneType].filter(Boolean).join("_") || "fiche";
  const nomFichier = (fiche.pdfFileName || `fiche ${base}.pdf`).replace(
    /[\\/:*?"<>|]/g,
    "_",
  );
  const disposition = req.query.download ? "attachment" : "inline";

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="${nomFichier}"`,
  );

  const stream = fs.createReadStream(chemin);
  // Le PDF regénéré est un temporaire : on le supprime une fois envoyé (ou si
  // le client coupe la connexion), sinon on remplit %TEMP% à chaque aperçu.
  const nettoyer = () => {
    if (!temporaire) return;
    try {
      fs.unlinkSync(chemin);
    } catch {
      /* ignore */
    }
  };
  stream.on("close", nettoyer);
  stream.on("error", nettoyer);
  res.on("close", nettoyer);
  stream.pipe(res);
});

/**
 * @desc    Supprimer une fiche (enregistrement + PDF)
 * @route   DELETE /api/fiches-controle/:entrepriseId/:id
 * @access  Private/Admin
 */
const supprimerFiche = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const fiche = await FicheControle.findOne({
    _id: req.params.id,
    entreprise: entreprise._id,
  });

  if (!fiche) {
    res.status(404);
    throw new Error("Fiche non trouvée");
  }

  try {
    const pdfPath = resoudreCheminPdf(fiche);
    if (pdfPath) {
      fs.unlinkSync(pdfPath);
    }
  } catch {
    // ignore : suppression du PDF best-effort
  }

  await FicheControle.deleteOne({ _id: fiche._id });
  res.json({ message: "Fiche supprimée" });
});

export {
  getFiches,
  scanMaintenant,
  statutSurveillance,
  demarrerSurveillance,
  arreterSurveillance,
  reimprimer,
  telechargerPdf,
  supprimerFiche,
};