// backend/controllers/demandeReapproController.js
import asyncHandler from "../middleware/asyncHandler.js";
import DemandeReappro from "../models/DemandeReapproModel.js";
import { getMagasinArticlesByGisements } from "../services/analyseReapproService.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";
import Entreprise from "../models/EntrepriseModel.js";

const ACTIF = ["en_attente", "en_cours"];

const nomUtilisateur = (u) =>
  [u?.prenom, u?.nom].filter(Boolean).join(" ") || u?.email || "Utilisateur";

// @desc    Créer des demandes de réappro MAGASIN pour un ou plusieurs gisements
// @route   POST /api/demande-reappro/:nomDossierDBF
// @access  Private — module analyse_reappro_admin (write) + accès entreprise
// Body : { gisements: string[], priorite?: "urgent"|"a_faire"|"normal", commentaire? }
// Une demande est créée PAR gisement. Un gisement ayant déjà une demande ACTIVE
// est ignoré (anti-doublon) et remonté dans "ignores".
const createDemandes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise || {
    nomDossierDBF: req.params.nomDossierDBF,
  };
  const key = entreprise.nomDossierDBF;

  const gisements = Array.isArray(req.body.gisements) ? req.body.gisements : [];
  const priorite = ["urgent", "a_faire", "normal"].includes(req.body.priorite)
    ? req.body.priorite
    : "a_faire";
  const commentaire = String(req.body.commentaire || "").slice(0, 500);

  if (gisements.length === 0) {
    res.status(400);
    throw new Error("Aucun gisement sélectionné.");
  }

  // Gisements déjà couverts par une demande active -> ignorés.
  const dejaActifs = await DemandeReappro.find({
    entreprise: key,
    type: "magasin",
    gisement: { $in: gisements },
    statut: { $in: ACTIF },
  }).select("gisement");
  const bloques = new Set(dejaActifs.map((d) => d.gisement));

  const aTraiter = gisements.filter((g) => !bloques.has(g));
  const ignores = [...bloques];

  const crees = [];
  if (aTraiter.length > 0) {
    // On récupère tous les articles magasin de ces gisements en une passe.
    const articles = await getMagasinArticlesByGisements(entreprise, aTraiter);
    const parGisement = new Map();
    articles.forEach((a) => {
      const g = a.gisement || "(sans gisement)";
      if (!parGisement.has(g)) parGisement.set(g, []);
      parGisement.get(g).push(a);
    });

    for (const g of aTraiter) {
      const arts = parGisement.get(g) || [];
      if (arts.length === 0) continue; // plus rien à réassortir sur ce gisement
      // eslint-disable-next-line no-await-in-loop
      const d = await DemandeReappro.create({
        entreprise: key,
        type: "magasin",
        gisement: g,
        priorite,
        statut: "en_attente",
        articles: arts,
        nbArticles: arts.length,
        commentaire,
        createdBy: req.user?._id,
        createdByNom: nomUtilisateur(req.user),
      });
      crees.push(d);
    }
  }

  res.status(201).json({
    crees: crees.length,
    ignores, // gisements déjà en demande active
    demandes: crees,
  });
});

// @desc    Liste des demandes de réappro d'une entreprise
// @route   GET /api/demande-reappro/:nomDossierDBF
// @access  Private — module analyse_reappro_admin (read) + accès entreprise
// Query : statut? ("en_attente"|"en_cours"|"realisee"|"actif")
const getDemandes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise || {
    nomDossierDBF: req.params.nomDossierDBF,
  };
  const filter = { entreprise: entreprise.nomDossierDBF, type: "magasin" };

  if (req.query.statut === "actif") filter.statut = { $in: ACTIF };
  else if (
    ["en_attente", "en_cours", "realisee"].includes(req.query.statut)
  ) {
    filter.statut = req.query.statut;
  }

  // On ne renvoie pas le détail des articles ici (allège la liste).
  const demandes = await DemandeReappro.find(filter)
    .select("-articles")
    .sort({ createdAt: -1 })
    .limit(300);

  res.json(demandes);
});

// @desc    Détail d'une demande (avec ses articles)
// @route   GET /api/demande-reappro/detail/:id
// @access  Private
const getDemandeById = asyncHandler(async (req, res) => {
  const d = await DemandeReappro.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Demande introuvable");
  }
  res.json(d);
});

// @desc    Supprimer une demande (annulation depuis le web)
// @route   DELETE /api/demande-reappro/:id
// @access  Private — module analyse_reappro_admin (delete)
const deleteDemande = asyncHandler(async (req, res) => {
  const d = await DemandeReappro.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Demande introuvable");
  }
  await d.deleteOne();
  res.json({ ok: true });
});

const PRIO_RANK = { urgent: 0, a_faire: 1, normal: 2 };

// @desc    (MOBILE) Demandes actives pour les entreprises de l'agent
// @route   GET /api/demande-reappro/mobile/list
// @access  Private — module reapro (read)
// Triées par priorité (urgent d'abord) puis ancienneté. Articles inclus.
const getMobileDemandes = asyncHandler(async (req, res) => {
  const scope = await getAccessibleEntreprises(req.user);
  const filter = { type: "magasin", statut: { $in: ACTIF } };
  if (!scope.all) {
    const ents = await Entreprise.find({ _id: { $in: scope.ids } }).select(
      "nomDossierDBF",
    );
    filter.entreprise = { $in: ents.map((e) => e.nomDossierDBF) };
  }
  const demandes = await DemandeReappro.find(filter).limit(200).lean();
  demandes.sort(
    (a, b) =>
      (PRIO_RANK[a.priorite] ?? 9) - (PRIO_RANK[b.priorite] ?? 9) ||
      new Date(a.createdAt) - new Date(b.createdAt),
  );
  res.json(demandes);
});

// @desc    (MOBILE) Marquer une demande comme réalisée par l'agent
// @route   PATCH /api/demande-reappro/mobile/:id/realiser
// @access  Private — module reapro (write)
const realiserDemande = asyncHandler(async (req, res) => {
  const d = await DemandeReappro.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Demande introuvable");
  }
  if (d.statut !== "realisee") {
    d.statut = "realisee";
    d.realisedBy = req.user?._id;
    d.realisedByNom = nomUtilisateur(req.user);
    d.realisedAt = new Date();
    await d.save();
  }
  res.json(d);
});

export {
  createDemandes,
  getDemandes,
  getDemandeById,
  deleteDemande,
  getMobileDemandes,
  realiserDemande,
};