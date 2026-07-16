// backend/controllers/receptionSuiviController.js
//
// Suivi (lecture seule) des CONTRÔLES DE RÉCEPTION en cours, pour l'app mobile.
// Une réception est "en cours" tant que son rapport n'est pas généré/envoyé
// (status = en_cours | analyse_ecarts). Dès que l'agent a généré les fichiers
// (envoyés par mail + postés), status passe à "termine" -> elle sort de la liste.
import fs from "fs";
import path from "path";
import asyncHandler from "../middleware/asyncHandler.js";
import Reception from "../models/ReceptionModel.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";

const EN_COURS = ["en_cours", "analyse_ecarts"];

// @desc    (MOBILE) Réceptions en cours pour les entreprises de l'agent
// @route   GET /api/reception-suivi/mobile/en-cours
// @access  Private — module reception (read)
const getMobileReceptionsEnCours = asyncHandler(async (req, res) => {
  const scope = await getAccessibleEntreprises(req.user);
  const query = { status: { $in: EN_COURS } };
  if (!scope.all) query.entreprise = { $in: scope.ids };

  const receptions = await Reception.find(query)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  const out = receptions.map((r) => ({
    _id: r._id,
    numcde: r.numcde,
    nomDossierDBF: r.nomDossierDBF || r.entreprise?.nomDossierDBF || "",
    entrepriseNom: r.entreprise?.nomComplet || r.nomDossierDBF || "",
    status: r.status,
    fournisseurNom: r.commandeInfo?.fournisseurNom || "",
    updatedAt: r.updatedAt,
    nbComptages: (r.comptages || []).length,
    nbSignalements: (r.signalements || []).length,
    comptages: (r.comptages || []).map((c) => ({
      nart: c.nart,
      gencod: c.gencod,
      designation: c.designation,
      qteComptee: c.qteComptee,
      qteValidee: c.qteValidee,
      dansCommande: c.dansCommande,
      isInconnu: c.isInconnu,
    })),
    signalements: (r.signalements || []).map((s) => ({
      _id: s._id,
      nart: s.nart,
      designation: s.designation,
      type: s.type,
      hasPhoto: !!s.photoFileName,
    })),
  }));

  res.json(out);
});

// @desc    (MOBILE) Photo d'un signalement (anomalie) d'une réception
// @route   GET /api/reception-suivi/:id/signalement/:sigId/photo
// @access  Private — module reception (read)
const getSignalementPhoto = asyncHandler(async (req, res) => {
  const reception = await Reception.findById(req.params.id);
  if (!reception) {
    res.status(404);
    throw new Error("Réception introuvable");
  }
  const sig = reception.signalements.id(req.params.sigId);
  if (!sig || !sig.photoPath) {
    res.status(404);
    throw new Error("Photo introuvable");
  }
  const abs = path.resolve(sig.photoPath);
  if (!fs.existsSync(abs)) {
    res.status(404);
    throw new Error("Fichier photo absent");
  }
  res.sendFile(abs);
});

export { getMobileReceptionsEnCours, getSignalementPhoto };