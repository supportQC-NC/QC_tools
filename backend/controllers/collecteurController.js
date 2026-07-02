// backend/controllers/collecteurController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Collecteur, { STATUTS_COLLECTEUR } from "../models/CollecteurModel.js";

const parseDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

const normAccessoires = (arr) =>
  (Array.isArray(arr) ? arr : [])
    .map((a) => String(a || "").trim())
    .filter(Boolean);

// Entreprise / agent : id valide ou null (chaîne vide -> null)
const orNull = (v) => (v && String(v).trim() !== "" ? v : null);

const POPULATE = [
  { path: "entreprise", select: "trigramme nomComplet nomDossierDBF" },
  { path: "agent", select: "nom prenom email" },
];

// @desc    Liste des collecteurs
// @route   GET /api/collecteurs
// @access  Private/Admin
const getCollecteurs = asyncHandler(async (req, res) => {
  const collecteurs = await Collecteur.find({})
    .populate(POPULATE)
    .sort({ identifiant: 1 });
  res.json(collecteurs);
});

// @desc    Un collecteur
// @route   GET /api/collecteurs/:id
// @access  Private/Admin
const getCollecteurById = asyncHandler(async (req, res) => {
  const collecteur = await Collecteur.findById(req.params.id).populate(POPULATE);
  if (!collecteur) {
    res.status(404);
    throw new Error("Collecteur non trouvé");
  }
  res.json(collecteur);
});

// @desc    Créer un collecteur
// @route   POST /api/collecteurs
// @access  Private/Admin
const createCollecteur = asyncHandler(async (req, res) => {
  const {
    identifiant,
    nom,
    versionApp,
    recu,
    gachette,
    miseEnService,
    entreprise,
    agent,
    statut,
    accessoires,
    emplacement,
    observations,
    isActive,
  } = req.body;

  const id = String(identifiant || "").trim().toUpperCase();
  if (!id) {
    res.status(400);
    throw new Error("Identifiant requis");
  }

  const exists = await Collecteur.findOne({ identifiant: id });
  if (exists) {
    res.status(400);
    throw new Error("Ce identifiant existe déjà");
  }

  const collecteur = await Collecteur.create({
    identifiant: id,
    nom: String(nom || "").trim(),
    recu: parseDate(recu),
    gachette: !!gachette,
    miseEnService: parseDate(miseEnService),
    entreprise: orNull(entreprise),
    agent: orNull(agent),
    statut: STATUTS_COLLECTEUR.includes(statut) ? statut : "stock",
    versionApp: String(versionApp || "").trim(),
    accessoires: normAccessoires(accessoires),
    emplacement: String(emplacement || "").trim(),
    observations: String(observations || "").trim(),
    isActive: isActive !== undefined ? !!isActive : true,
    createdBy: req.user._id,
  });

  const populated = await collecteur.populate(POPULATE);
  res.status(201).json(populated);
});

// @desc    Modifier un collecteur
// @route   PUT /api/collecteurs/:id
// @access  Private/Admin
const updateCollecteur = asyncHandler(async (req, res) => {
  const collecteur = await Collecteur.findById(req.params.id);
  if (!collecteur) {
    res.status(404);
    throw new Error("Collecteur non trouvé");
  }

  const {
    identifiant,
    nom,
    versionApp,
    recu,
    gachette,
    miseEnService,
    entreprise,
    agent,
    statut,
    accessoires,
    emplacement,
    observations,
    isActive,
  } = req.body;

  if (identifiant !== undefined) {
    const id = String(identifiant || "").trim().toUpperCase();
    if (!id) {
      res.status(400);
      throw new Error("Identifiant requis");
    }
    if (id !== collecteur.identifiant) {
      const exists = await Collecteur.findOne({ identifiant: id });
      if (exists) {
        res.status(400);
        throw new Error("Ce identifiant existe déjà");
      }
    }
    collecteur.identifiant = id;
  }

  if (nom !== undefined) collecteur.nom = String(nom || "").trim();
  if (recu !== undefined) collecteur.recu = parseDate(recu);
  if (gachette !== undefined) collecteur.gachette = !!gachette;
  if (miseEnService !== undefined)
    collecteur.miseEnService = parseDate(miseEnService);
  if (entreprise !== undefined) collecteur.entreprise = orNull(entreprise);
  if (agent !== undefined) collecteur.agent = orNull(agent);
  if (statut !== undefined && STATUTS_COLLECTEUR.includes(statut))
    collecteur.statut = statut;
  if (versionApp !== undefined)
    collecteur.versionApp = String(versionApp || "").trim();
  if (accessoires !== undefined)
    collecteur.accessoires = normAccessoires(accessoires);
  if (emplacement !== undefined)
    collecteur.emplacement = String(emplacement || "").trim();
  if (observations !== undefined)
    collecteur.observations = String(observations || "").trim();
  if (isActive !== undefined) collecteur.isActive = !!isActive;

  const updated = await collecteur.save();
  const populated = await updated.populate(POPULATE);
  res.json(populated);
});

// @desc    Supprimer un collecteur
// @route   DELETE /api/collecteurs/:id
// @access  Private/Admin
const deleteCollecteur = asyncHandler(async (req, res) => {
  const collecteur = await Collecteur.findById(req.params.id);
  if (!collecteur) {
    res.status(404);
    throw new Error("Collecteur non trouvé");
  }
  await Collecteur.deleteOne({ _id: collecteur._id });
  res.json({ message: "Collecteur supprimé" });
});

export {
  getCollecteurs,
  getCollecteurById,
  createCollecteur,
  updateCollecteur,
  deleteCollecteur,
};