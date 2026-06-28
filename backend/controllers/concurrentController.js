// backend/controllers/concurrentController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Concurrent from "../models/ConcurrentModel.js";
import Releve from "../models/ReleveModel.js";

/**
 * @desc    Obtenir tous les concurrents
 * @route   GET /api/concurrents
 * @access  Private
 */
const getConcurrents = asyncHandler(async (req, res) => {
  const { actifOnly } = req.query;

  const query = {};
  if (actifOnly === "true") {
    query.isActive = true;
  }

  const concurrents = await Concurrent.find(query)
    .populate("createdBy", "nom prenom email")
    .sort({ nom: 1 });

  res.json(concurrents);
});

/**
 * @desc    Obtenir un concurrent par ID
 * @route   GET /api/concurrents/:id
 * @access  Private
 */
const getConcurrentById = asyncHandler(async (req, res) => {
  const concurrent = await Concurrent.findById(req.params.id).populate(
    "createdBy",
    "nom prenom email",
  );

  if (!concurrent) {
    res.status(404);
    throw new Error("Concurrent non trouvé");
  }

  res.json(concurrent);
});

/**
 * @desc    Créer un concurrent
 * @route   POST /api/concurrents
 * @access  Private/Admin
 */
const createConcurrent = asyncHandler(async (req, res) => {
  const { nom, adresse, ville, codePostal, telephone, type, notes } = req.body;

  if (!nom || !nom.trim()) {
    res.status(400);
    throw new Error("Le nom du concurrent est requis");
  }

  // Vérifier si un concurrent avec le même nom existe déjà
  const existant = await Concurrent.findOne({
    nom: { $regex: new RegExp(`^${nom.trim()}$`, "i") },
  });

  if (existant) {
    res.status(400);
    throw new Error("Un concurrent avec ce nom existe déjà");
  }

  const concurrent = await Concurrent.create({
    nom: nom.trim(),
    adresse: adresse?.trim() || "",
    ville: ville?.trim() || "",
    codePostal: codePostal?.trim() || "",
    telephone: telephone?.trim() || "",
    type: type || "autre",
    notes: notes?.trim() || "",
    createdBy: req.user._id,
  });

  res.status(201).json(concurrent);
});

/**
 * @desc    Mettre à jour un concurrent
 * @route   PUT /api/concurrents/:id
 * @access  Private/Admin
 */
const updateConcurrent = asyncHandler(async (req, res) => {
  const concurrent = await Concurrent.findById(req.params.id);

  if (!concurrent) {
    res.status(404);
    throw new Error("Concurrent non trouvé");
  }

  const { nom, adresse, ville, codePostal, telephone, type, notes, isActive } =
    req.body;

  // Vérifier unicité du nom si modifié
  if (nom && nom.trim().toLowerCase() !== concurrent.nom.toLowerCase()) {
    const existant = await Concurrent.findOne({
      nom: { $regex: new RegExp(`^${nom.trim()}$`, "i") },
      _id: { $ne: concurrent._id },
    });

    if (existant) {
      res.status(400);
      throw new Error("Un concurrent avec ce nom existe déjà");
    }
  }

  concurrent.nom = nom?.trim() || concurrent.nom;
  concurrent.adresse =
    adresse !== undefined ? adresse.trim() : concurrent.adresse;
  concurrent.ville = ville !== undefined ? ville.trim() : concurrent.ville;
  concurrent.codePostal =
    codePostal !== undefined ? codePostal.trim() : concurrent.codePostal;
  concurrent.telephone =
    telephone !== undefined ? telephone.trim() : concurrent.telephone;
  concurrent.type = type || concurrent.type;
  concurrent.notes = notes !== undefined ? notes.trim() : concurrent.notes;
  concurrent.isActive = isActive !== undefined ? isActive : concurrent.isActive;

  const updatedConcurrent = await concurrent.save();

  res.json(updatedConcurrent);
});

/**
 * @desc    Supprimer un concurrent
 * @route   DELETE /api/concurrents/:id
 * @access  Private/Admin
 */
const deleteConcurrent = asyncHandler(async (req, res) => {
  const concurrent = await Concurrent.findById(req.params.id);

  if (!concurrent) {
    res.status(404);
    throw new Error("Concurrent non trouvé");
  }

  // Vérifier si des relevés sont liés à ce concurrent
  const relevesCount = await Releve.countDocuments({
    concurrent: concurrent._id,
  });

  if (relevesCount > 0) {
    res.status(400);
    throw new Error(
      `Impossible de supprimer ce concurrent. ${relevesCount} relevé(s) y sont associé(s). Désactivez-le plutôt.`,
    );
  }

  await Concurrent.deleteOne({ _id: concurrent._id });

  res.json({ message: "Concurrent supprimé" });
});

/**
 * @desc    Activer/Désactiver un concurrent
 * @route   PATCH /api/concurrents/:id/toggle-active
 * @access  Private/Admin
 */
const toggleConcurrentActive = asyncHandler(async (req, res) => {
  const concurrent = await Concurrent.findById(req.params.id);

  if (!concurrent) {
    res.status(404);
    throw new Error("Concurrent non trouvé");
  }

  concurrent.isActive = !concurrent.isActive;
  await concurrent.save();

  res.json({
    _id: concurrent._id,
    isActive: concurrent.isActive,
    message: concurrent.isActive ? "Concurrent activé" : "Concurrent désactivé",
  });
});

/**
 * @desc    Obtenir les statistiques des concurrents
 * @route   GET /api/concurrents/stats
 * @access  Private/Admin
 */
const getConcurrentsStats = asyncHandler(async (req, res) => {
  const totalConcurrents = await Concurrent.countDocuments();
  const concurrentsActifs = await Concurrent.countDocuments({ isActive: true });

  // Statistiques par type
  const parType = await Concurrent.aggregate([
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);

  // Concurrents les plus utilisés dans les relevés
  const plusUtilises = await Releve.aggregate([
    {
      $group: {
        _id: "$concurrent",
        nombreReleves: { $sum: 1 },
      },
    },
    {
      $sort: { nombreReleves: -1 },
    },
    {
      $limit: 10,
    },
    {
      $lookup: {
        from: "concurrents",
        localField: "_id",
        foreignField: "_id",
        as: "concurrent",
      },
    },
    {
      $unwind: "$concurrent",
    },
    {
      $project: {
        _id: 1,
        nom: "$concurrent.nom",
        nombreReleves: 1,
      },
    },
  ]);

  res.json({
    totalConcurrents,
    concurrentsActifs,
    concurrentsInactifs: totalConcurrents - concurrentsActifs,
    parType,
    plusUtilises,
  });
});

export {
  getConcurrents,
  getConcurrentById,
  createConcurrent,
  updateConcurrent,
  deleteConcurrent,
  toggleConcurrentActive,
  getConcurrentsStats,
};
