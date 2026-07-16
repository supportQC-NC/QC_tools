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
import commandeCacheService from "../services/commandeService.js";
import articleService from "../services/articleService.js";

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

// @desc    Progression des contrôles EN COURS d'une entreprise, indexée par numcde.
//          Sert à superposer l'état du contrôle sur la liste des commandes à
//          contrôler (/a-controler), pour un suivi identique au module réception.
// @route   GET /api/reception-suivi/(mobile/)progress/:nomDossierDBF
// @access  Private — reception (mobile) ou reception_suivi_admin (web) + entreprise
const getReceptionProgress = asyncHandler(async (req, res) => {
  const nomDossierDBF =
    req.entreprise?.nomDossierDBF || req.params.nomDossierDBF;

  const receptions = await Reception.find({
    nomDossierDBF,
    status: { $in: EN_COURS },
  })
    .sort({ updatedAt: -1 })
    .limit(300)
    .lean();

  const out = receptions.map((r) => ({
    receptionId: r._id,
    numcde: r.numcde,
    status: r.status,
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
    signalements: (r.signalements || []).map((sig) => ({
      _id: sig._id,
      nart: sig.nart,
      designation: sig.designation,
      type: sig.type,
      hasPhoto: !!(sig.photoFileName || sig.photoPath),
    })),
  }));

  res.json(out);
});

const estCommentaire = (r) => String(r?.NART || "").includes("!");
const estNouveauArticle = (art) => {
  if (!art) return false;
  for (let i = 1; i <= 12; i += 1) {
    const v =
      parseFloat(art[`V${i}`] ?? art[`V${String(i).padStart(2, "0")}`]) || 0;
    if (v !== 0) return false; // au moins une vente -> pas une nouveauté
  }
  return true;
};

// @desc    Agrégats par commande (nb articles distincts, total unités, nouveautés)
// @route   GET /api/reception-suivi/agregats/:nomDossierDBF
// @access  Private — module reception_suivi_admin (read) + entreprise
// Renvoie un objet { NUMCDE(maj): { nbArticles, totalUnites, nbNouveautes } }.
const getCommandesAgregats = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise || {
    nomDossierDBF: req.params.nomDossierDBF,
  };

  const [detail, artCache] = await Promise.all([
    commandeCacheService.getCmdDetail(entreprise),
    articleService.getArticles(entreprise),
  ]);

  const nartMap = new Map();
  (artCache.records || []).forEach((a) => {
    if (a.NART != null) nartMap.set(String(a.NART).trim().toUpperCase(), a);
  });

  const out = {};
  for (const [numcde, indices] of detail.indexByNumcde.entries()) {
    let nbArticles = 0;
    let totalUnites = 0;
    let nbNouveautes = 0;
    indices.forEach((i) => {
      const r = detail.records[i];
      if (estCommentaire(r)) return; // ligne commentaire
      nbArticles += 1;
      totalUnites += parseFloat(r.QTE) || 0;
      const art = nartMap.get(String(r.NART || "").trim().toUpperCase());
      if (estNouveauArticle(art)) nbNouveautes += 1;
    });
    out[numcde] = { nbArticles, totalUnites: Math.round(totalUnites), nbNouveautes };
  }

  res.json(out);
});

// @desc    10 dernières réceptions TERMINÉES d'une entreprise + fichiers générés
// @route   GET /api/reception-suivi/recentes/:nomDossierDBF
// @access  Private — module reception_suivi_admin (read) + entreprise
const getRecentesControlees = asyncHandler(async (req, res) => {
  const nomDossierDBF =
    req.entreprise?.nomDossierDBF || req.params.nomDossierDBF;

  const receptions = await Reception.find({ nomDossierDBF, status: "termine" })
    .sort({ "rapport.generatedAt": -1, updatedAt: -1 })
    .limit(10)
    .lean();

  const out = receptions.map((r) => {
    let fichiers = [];
    const fp = r.rapport?.filePath;
    if (fp) {
      try {
        const dir = path.dirname(fp);
        if (fs.existsSync(dir)) {
          fichiers = fs
            .readdirSync(dir)
            .filter((f) => /\.(pdf|csv|dat|xlsx)$/i.test(f))
            .map((f) => ({ name: f, ext: path.extname(f).slice(1).toLowerCase() }));
        }
      } catch (e) {
        /* dossier inaccessible -> pas de fichiers listés */
      }
    }
    return {
      _id: r._id,
      numcde: r.numcde,
      fournisseurNom: r.commandeInfo?.fournisseurNom || "",
      generatedAt: r.rapport?.generatedAt || r.updatedAt,
      emailSentAt: r.rapport?.emailSentAt || null,
      fichiers,
    };
  });

  res.json(out);
});

// @desc    Télécharge un fichier généré d'une réception (PDF / CSV / .dat)
// @route   GET /api/reception-suivi/:id/fichier/:filename
// @access  Private — module reception_suivi_admin (read)
const downloadFichierReception = asyncHandler(async (req, res) => {
  const reception = await Reception.findById(req.params.id).lean();
  if (!reception?.rapport?.filePath) {
    res.status(404);
    throw new Error("Aucun fichier pour cette réception");
  }
  const dir = path.dirname(reception.rapport.filePath);
  const safe = path.basename(req.params.filename); // anti path-traversal
  const abs = path.join(dir, safe);
  if (!fs.existsSync(abs)) {
    res.status(404);
    throw new Error("Fichier introuvable");
  }
  res.download(abs, safe);
});

export {
  getMobileReceptionsEnCours,
  getReceptionProgress,
  getCommandesAgregats,
  getRecentesControlees,
  downloadFichierReception,
  getSignalementPhoto,
};