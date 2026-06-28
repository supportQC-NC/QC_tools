import asyncHandler from "../middleware/asyncHandler.js";
import Entreprise from "../models/EntrepriseModel.js";
import Permission from "../models/PermissionModel.js";

// @desc    Get all entreprises
// @route   GET /api/entreprises
// @access  Private/Admin
const getEntreprises = asyncHandler(async (req, res) => {
  const entreprises = await Entreprise.find({})
    .populate("createdBy", "nom prenom email")
    .sort({ nomComplet: 1 });

  res.json(entreprises);
});

// @desc    Get single entreprise
// @route   GET /api/entreprises/:id
// @access  Private/Admin
const getEntrepriseById = asyncHandler(async (req, res) => {
  const entreprise = await Entreprise.findById(req.params.id).populate(
    "createdBy",
    "nom prenom email",
  );

  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  res.json(entreprise);
});

// @desc    Get entreprise by nomDossierDBF
// @route   GET /api/entreprises/dossier/:nomDossierDBF
// @access  Private
const getEntrepriseByDossier = asyncHandler(async (req, res) => {
  const entreprise = await Entreprise.findOne({
    nomDossierDBF: req.params.nomDossierDBF,
  });

  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  res.json(entreprise);
});

// @desc    Create entreprise
// @route   POST /api/entreprises
// @access  Private/Admin
const createEntreprise = asyncHandler(async (req, res) => {
  const {
    nomDossierDBF,
    trigramme,
    nomComplet,
    description,
    cheminBase,
    cheminPhotos,
    cheminExportInventaire,
    mappingEntrepots,
    mappingEtatsCommande,
  } = req.body;

  // Vérifier si le dossier DBF existe déjà
  const dossierExists = await Entreprise.findOne({ nomDossierDBF });
  if (dossierExists) {
    res.status(400);
    throw new Error("Ce nom de dossier DBF existe déjà");
  }

  // Vérifier si le trigramme existe déjà
  const trigrammeExists = await Entreprise.findOne({
    trigramme: trigramme.toUpperCase(),
  });
  if (trigrammeExists) {
    res.status(400);
    throw new Error("Ce trigramme existe déjà");
  }

  const entrepriseData = {
    nomDossierDBF,
    trigramme: trigramme.toUpperCase(),
    nomComplet,
    description,
    cheminBase: cheminBase || "\\\\serveur\\Bases",
    cheminPhotos: cheminPhotos || "",
    cheminExportInventaire:
      cheminExportInventaire ||
      "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec",
    mappingEntrepots: mappingEntrepots || {
      S1: "Magasin",
      S2: "S2",
      S3: "S3",
      S4: "S4",
      S5: "S5",
    },
    createdBy: req.user._id,
  };

  // Ajouter le mapping des états si fourni
  if (mappingEtatsCommande) {
    entrepriseData.mappingEtatsCommande = mappingEtatsCommande;
  }

  const entreprise = await Entreprise.create(entrepriseData);

  res.status(201).json(entreprise);
});

// @desc    Update entreprise
// @route   PUT /api/entreprises/:id
// @access  Private/Admin
const updateEntreprise = asyncHandler(async (req, res) => {
  const entreprise = await Entreprise.findById(req.params.id);

  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  const {
    nomDossierDBF,
    trigramme,
    nomComplet,
    description,
    cheminBase,
    cheminPhotos,
    cheminExportInventaire,
    mappingEntrepots,
    mappingEtatsCommande,
    isActive,
  } = req.body;

  // Vérifier unicité du dossier DBF si modifié
  if (nomDossierDBF && nomDossierDBF !== entreprise.nomDossierDBF) {
    const dossierExists = await Entreprise.findOne({ nomDossierDBF });
    if (dossierExists) {
      res.status(400);
      throw new Error("Ce nom de dossier DBF existe déjà");
    }
  }

  // Vérifier unicité du trigramme si modifié
  if (trigramme && trigramme.toUpperCase() !== entreprise.trigramme) {
    const trigrammeExists = await Entreprise.findOne({
      trigramme: trigramme.toUpperCase(),
    });
    if (trigrammeExists) {
      res.status(400);
      throw new Error("Ce trigramme existe déjà");
    }
  }

  entreprise.nomDossierDBF = nomDossierDBF || entreprise.nomDossierDBF;
  entreprise.trigramme = trigramme
    ? trigramme.toUpperCase()
    : entreprise.trigramme;
  entreprise.nomComplet = nomComplet || entreprise.nomComplet;
  entreprise.description =
    description !== undefined ? description : entreprise.description;
  entreprise.cheminBase = cheminBase || entreprise.cheminBase;
  entreprise.cheminPhotos =
    cheminPhotos !== undefined ? cheminPhotos : entreprise.cheminPhotos;
  entreprise.cheminExportInventaire =
    cheminExportInventaire !== undefined
      ? cheminExportInventaire
      : entreprise.cheminExportInventaire;

  // Mise à jour du mapping entrepôts
  if (mappingEntrepots) {
    entreprise.mappingEntrepots = {
      S1: mappingEntrepots.S1 || entreprise.mappingEntrepots?.S1 || "Magasin",
      S2: mappingEntrepots.S2 || entreprise.mappingEntrepots?.S2 || "S2",
      S3: mappingEntrepots.S3 || entreprise.mappingEntrepots?.S3 || "S3",
      S4: mappingEntrepots.S4 || entreprise.mappingEntrepots?.S4 || "S4",
      S5: mappingEntrepots.S5 || entreprise.mappingEntrepots?.S5 || "S5",
    };
  }

  // Mise à jour du mapping des états de commande
  if (mappingEtatsCommande) {
    entreprise.mappingEtatsCommande = new Map(
      Object.entries(mappingEtatsCommande),
    );
  }

  entreprise.isActive = isActive !== undefined ? isActive : entreprise.isActive;

  const updatedEntreprise = await entreprise.save();

  res.json(updatedEntreprise);
});

// @desc    Delete entreprise
// @route   DELETE /api/entreprises/:id
// @access  Private/Admin
const deleteEntreprise = asyncHandler(async (req, res) => {
  const entreprise = await Entreprise.findById(req.params.id);

  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  // Retirer l'entreprise des permissions des utilisateurs
  await Permission.updateMany(
    { entreprises: entreprise.nomDossierDBF },
    { $pull: { entreprises: entreprise.nomDossierDBF } },
  );

  await Entreprise.deleteOne({ _id: entreprise._id });

  res.json({ message: "Entreprise supprimée" });
});

// @desc    Toggle entreprise active status
// @route   PATCH /api/entreprises/:id/toggle-active
// @access  Private/Admin
const toggleEntrepriseActive = asyncHandler(async (req, res) => {
  const entreprise = await Entreprise.findById(req.params.id);

  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  entreprise.isActive = !entreprise.isActive;
  await entreprise.save();

  res.json({
    _id: entreprise._id,
    isActive: entreprise.isActive,
    message: entreprise.isActive
      ? "Entreprise activée"
      : "Entreprise désactivée",
  });
});

// @desc    Get user's accessible entreprises
// @route   GET /api/entreprises/my-entreprises
// @access  Private
const getMyEntreprises = asyncHandler(async (req, res) => {
  const permission = await Permission.findOne({ user: req.user._id });

  // Admin ou accès à toutes les entreprises
  if (req.user.role === "admin" || permission?.allEntreprises) {
    const entreprises = await Entreprise.find({ isActive: true }).sort({
      nomComplet: 1,
    });
    return res.json(entreprises);
  }

  // Sinon, filtrer selon les permissions
  if (
    !permission ||
    !permission.entreprises ||
    permission.entreprises.length === 0
  ) {
    return res.json([]);
  }

  // Chercher par _id (et non par nomDossierDBF)
  const entreprises = await Entreprise.find({
    _id: { $in: permission.entreprises },
    isActive: true,
  }).sort({ nomComplet: 1 });

  res.json(entreprises);
});

// @desc    Get entreprise by trigramme (pour les photos)
// @route   GET /api/entreprises/trigramme/:trigramme
// @access  Private
const getEntrepriseByTrigramme = asyncHandler(async (req, res) => {
  const entreprise = await Entreprise.findOne({
    trigramme: req.params.trigramme.toUpperCase(),
  });

  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  res.json(entreprise);
});

export {
  getEntreprises,
  getEntrepriseById,
  getEntrepriseByDossier,
  createEntreprise,
  updateEntreprise,
  deleteEntreprise,
  toggleEntrepriseActive,
  getMyEntreprises,
  getEntrepriseByTrigramme,
};