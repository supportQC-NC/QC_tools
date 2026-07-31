// backend/controllers/ficheControleController.js
import fs from "fs";
import asyncHandler from "../middleware/asyncHandler.js";
import FicheControle from "../models/FicheControleModel.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import { config, resoudreCheminPdf } from "../services/ficheControleService.js";
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
 * @desc    Télécharger / afficher le PDF d'une fiche
 * @route   GET /api/fiches-controle/:entrepriseId/:id/pdf
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
  // Chemin recalculé pour CET environnement (le PDF a pu être créé par l'agent
  // Windows ; le VPS Linux le relit via son montage /mnt/rcommun).
  const pdfPath = resoudreCheminPdf(fiche);
  if (!pdfPath) {
    res.status(404);
    throw new Error("Fichier PDF introuvable");
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${fiche.pdfFileName || "fiche.pdf"}"`,
  );
  fs.createReadStream(pdfPath).pipe(res);
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