// backend/controllers/releveController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Releve from "../models/ReleveModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import Concurrent from "../models/ConcurrentModel.js";
import articleCacheService from "../services/articleService.js";
import { genererExcelReleve } from "../services/releveExcelService.js";
import path from "path";
import fs from "fs";

/**
 * @desc    Créer un nouveau relevé de prix
 * @route   POST /api/releves
 * @access  Private
 */
const createReleve = asyncHandler(async (req, res) => {
  const { entrepriseId, concurrentId } = req.body;

  // Vérifier l'entreprise
  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  // Vérifier le concurrent
  const concurrent = await Concurrent.findById(concurrentId);
  if (!concurrent) {
    res.status(404);
    throw new Error("Concurrent non trouvé");
  }

  if (!concurrent.isActive) {
    res.status(400);
    throw new Error("Ce concurrent est désactivé");
  }

  // Vérifier si un relevé est déjà en cours pour cet utilisateur, entreprise et concurrent
  const releveEnCours = await Releve.findOne({
    entreprise: entrepriseId,
    concurrent: concurrentId,
    user: req.user._id,
    status: "en_cours",
  });

  if (releveEnCours) {
    // Retourner le relevé existant
    const relevePopulated = await Releve.findById(releveEnCours._id)
      .populate("entreprise", "nomDossierDBF trigramme nomComplet")
      .populate("concurrent", "nom adresse ville type");
    return res.json(relevePopulated);
  }

  // Créer un nouveau relevé
  const releve = await Releve.create({
    entreprise: entrepriseId,
    nomDossierDBF: entreprise.nomDossierDBF,
    concurrent: concurrentId,
    user: req.user._id,
    lignes: [],
  });

  // Précharger le cache des articles pour cette entreprise (en arrière-plan)
  articleCacheService.preload(entreprise).catch((err) => {
    console.error("Erreur préchargement cache:", err);
  });

  const relevePopulated = await Releve.findById(releve._id)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .populate("concurrent", "nom adresse ville type");

  res.status(201).json(relevePopulated);
});

/**
 * @desc    Obtenir le relevé en cours de l'utilisateur pour une entreprise et un concurrent
 * @route   GET /api/releves/en-cours/:entrepriseId/:concurrentId
 * @access  Private
 */
const getReleveEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId, concurrentId } = req.params;

  const releve = await Releve.findOne({
    entreprise: entrepriseId,
    concurrent: concurrentId,
    user: req.user._id,
    status: "en_cours",
  })
    .populate("entreprise", "nomDossierDBF trigramme nomComplet cheminBase")
    .populate("concurrent", "nom adresse ville type");

  // Si relevé existe, précharger le cache en arrière-plan
  if (releve?.entreprise) {
    articleCacheService.preload(releve.entreprise).catch((err) => {
      console.error("Erreur préchargement cache:", err);
    });
  }

  res.json(releve);
});

/**
 * @desc    Obtenir tous les relevés en cours de l'utilisateur pour une entreprise
 * @route   GET /api/releves/en-cours/:entrepriseId
 * @access  Private
 */
const getRelevesEnCoursParEntreprise = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;

  const releves = await Releve.find({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  })
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .populate("concurrent", "nom adresse ville type")
    .sort({ updatedAt: -1 });

  res.json(releves);
});

/**
 * @desc    Scanner un article par GENCOD pour un relevé
 * @route   POST /api/releves/:id/scan
 * @access  Private
 */
const scanArticleReleve = asyncHandler(async (req, res) => {
  const { gencod } = req.body;
  const startTime = Date.now();

  if (!gencod || !gencod.trim()) {
    res.status(400);
    throw new Error("Le code GENCOD est requis");
  }

  const releve = await Releve.findById(req.params.id);
  if (!releve) {
    res.status(404);
    throw new Error("Relevé non trouvé");
  }

  if (releve.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce relevé est déjà terminé");
  }

  // Vérifier que l'utilisateur est bien le propriétaire du relevé
  if (releve.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  const entreprise = await Entreprise.findById(releve.entreprise);
  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  if (!fs.existsSync(dbfPath)) {
    res.status(404);
    throw new Error(
      `Fichier articles non trouvé pour l'entreprise ${entreprise.nomComplet}`,
    );
  }

  // Recherche O(1) via le cache - par GENCOD uniquement
  const article = await articleCacheService.findByGencod(
    entreprise,
    gencod.trim(),
  );

  if (!article) {
    res.status(404);
    throw new Error(`Article avec le code barre ${gencod} non trouvé`);
  }

  // Suivre la chaîne de renvois si nécessaire (GENDOUBL)
  let articleFinal = article;
  let isRenvoi = false;
  const gendoubl = article.GENDOUBL ? article.GENDOUBL.trim() : "";

  if (gendoubl) {
    const articleRenvoi = await articleCacheService.findByNart(
      entreprise,
      gendoubl,
    );
    if (articleRenvoi) {
      articleFinal = articleRenvoi;
      isRenvoi = true;
    }
  }

  // Vérifier si l'article existe déjà dans le relevé
  const ligneExistante = releve.lignes.find(
    (l) =>
      l.gencod === gencod.trim() ||
      l.nart === (articleFinal.NART ? articleFinal.NART.trim() : ""),
  );

  const queryTime = Date.now() - startTime;

  res.json({
    releveId: releve._id,
    articleInfo: {
      nart: articleFinal.NART ? articleFinal.NART.trim() : "",
      gencod: articleFinal.GENCOD ? articleFinal.GENCOD.trim() : gencod.trim(),
      designation: articleFinal.DESIGN ? articleFinal.DESIGN.trim() : "",
      groupe: articleFinal.GROUPE ? articleFinal.GROUPE.trim() : "",
      pvtettc: parseFloat(articleFinal.PVTETTC) || 0,
      pvte: parseFloat(articleFinal.PVTE) || 0,
      isRenvoi,
    },
    dejaPresent: !!ligneExistante,
    ligneExistante: ligneExistante || null,
    _queryTime: `${queryTime}ms`,
  });
});

/**
 * @desc    Ajouter ou mettre à jour une ligne dans le relevé
 * @route   POST /api/releves/:id/lignes
 * @access  Private
 */
const addLigneReleve = asyncHandler(async (req, res) => {
  const { nart, gencod, designation, groupe, pvtettc, prixReleve } = req.body;

  if (prixReleve === undefined || prixReleve === null || prixReleve < 0) {
    res.status(400);
    throw new Error("Le prix relevé est requis et doit être positif ou nul");
  }

  const releve = await Releve.findById(req.params.id);
  if (!releve) {
    res.status(404);
    throw new Error("Relevé non trouvé");
  }

  if (releve.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce relevé est déjà terminé");
  }

  if (releve.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  // Vérifier si l'article existe déjà dans le relevé
  const ligneIndex = releve.lignes.findIndex(
    (l) => l.gencod === gencod || l.nart === nart,
  );

  if (ligneIndex !== -1) {
    // Mettre à jour la ligne existante
    releve.lignes[ligneIndex].prixReleve = parseFloat(prixReleve);
    releve.lignes[ligneIndex].pvtettc =
      parseFloat(pvtettc) || releve.lignes[ligneIndex].pvtettc;
    releve.lignes[ligneIndex].scannedAt = new Date();
  } else {
    // Ajouter une nouvelle ligne
    const difference = parseFloat(pvtettc) - parseFloat(prixReleve);
    const pourcentageDiff =
      pvtettc > 0 ? parseFloat(((difference / pvtettc) * 100).toFixed(2)) : 0;

    releve.lignes.push({
      nart,
      gencod,
      designation: designation || "",
      groupe: groupe || "",
      pvtettc: parseFloat(pvtettc) || 0,
      prixReleve: parseFloat(prixReleve),
      difference,
      pourcentageDiff,
    });
  }

  releve.calculerTotaux();
  await releve.save();

  const relevePopulated = await Releve.findById(releve._id)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .populate("concurrent", "nom adresse ville type");

  res.json(relevePopulated);
});

/**
 * @desc    Modifier une ligne du relevé
 * @route   PUT /api/releves/:id/lignes/:ligneId
 * @access  Private
 */
const updateLigneReleve = asyncHandler(async (req, res) => {
  const { prixReleve } = req.body;
  const { id, ligneId } = req.params;

  if (prixReleve === undefined || prixReleve < 0) {
    res.status(400);
    throw new Error("Le prix relevé est requis et doit être positif ou nul");
  }

  const releve = await Releve.findById(id);
  if (!releve) {
    res.status(404);
    throw new Error("Relevé non trouvé");
  }

  if (releve.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce relevé est déjà terminé");
  }

  if (releve.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  const ligne = releve.lignes.id(ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  ligne.prixReleve = parseFloat(prixReleve);
  ligne.scannedAt = new Date();

  releve.calculerTotaux();
  await releve.save();

  const relevePopulated = await Releve.findById(releve._id)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .populate("concurrent", "nom adresse ville type");

  res.json(relevePopulated);
});

/**
 * @desc    Supprimer une ligne du relevé
 * @route   DELETE /api/releves/:id/lignes/:ligneId
 * @access  Private
 */
const deleteLigneReleve = asyncHandler(async (req, res) => {
  const { id, ligneId } = req.params;

  const releve = await Releve.findById(id);
  if (!releve) {
    res.status(404);
    throw new Error("Relevé non trouvé");
  }

  if (releve.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce relevé est déjà terminé");
  }

  if (releve.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  releve.lignes.pull(ligneId);
  releve.calculerTotaux();
  await releve.save();

  const relevePopulated = await Releve.findById(releve._id)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .populate("concurrent", "nom adresse ville type");

  res.json(relevePopulated);
});

/**
 * @desc    Télécharger le fichier Excel du relevé
 * @route   POST /api/releves/:id/download
 * @access  Private
 */
const downloadReleve = asyncHandler(async (req, res) => {
  const { nomReleve } = req.body;

  const releve = await Releve.findById(req.params.id)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .populate("concurrent", "nom adresse ville type")
    .populate("user", "nom prenom");

  if (!releve) {
    res.status(404);
    throw new Error("Relevé non trouvé");
  }

  if (releve.lignes.length === 0) {
    res.status(400);
    throw new Error("Le relevé est vide");
  }

  // Générer le fichier Excel
  const excelBuffer = await genererExcelReleve(releve);

  // Nom du fichier
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const entrepriseNom =
    releve.entreprise.trigramme || releve.entreprise.nomDossierDBF;
  const concurrentNom = releve.concurrent.nom.replace(/[^a-zA-Z0-9]/g, "_");
  const nomFichier = `releve_${entrepriseNom}_${concurrentNom}_${dateStr}.xlsx`;

  // Mettre à jour le relevé
  releve.nom = nomReleve?.trim() || `Relevé ${releve.concurrent.nom}`;
  releve.status = "exporte";
  releve.fichierExport = nomFichier;
  releve.exportedAt = new Date();
  await releve.save();

  // Envoyer le fichier
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}"`);
  res.send(excelBuffer);
});

/**
 * @desc    Supprimer un relevé
 * @route   DELETE /api/releves/:id
 * @access  Private
 */
const deleteReleve = asyncHandler(async (req, res) => {
  const releve = await Releve.findById(req.params.id);

  if (!releve) {
    res.status(404);
    throw new Error("Relevé non trouvé");
  }

  if (
    releve.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  await Releve.deleteOne({ _id: releve._id });

  res.json({ message: "Relevé supprimé" });
});

/**
 * @desc    Obtenir l'historique des relevés de l'utilisateur
 * @route   GET /api/releves/historique
 * @access  Private
 */
const getHistoriqueReleves = asyncHandler(async (req, res) => {
  const { entrepriseId, concurrentId } = req.query;

  const query = { user: req.user._id };

  if (entrepriseId) {
    query.entreprise = entrepriseId;
  }

  if (concurrentId) {
    query.concurrent = concurrentId;
  }

  const releves = await Releve.find(query)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .populate("concurrent", "nom adresse ville type")
    .sort({ createdAt: -1 })
    .limit(50);

  res.json(releves);
});

/**
 * @desc    Obtenir un relevé par ID
 * @route   GET /api/releves/:id
 * @access  Private
 */
const getReleveById = asyncHandler(async (req, res) => {
  const releve = await Releve.findById(req.params.id)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .populate("concurrent", "nom adresse ville type")
    .populate("user", "nom prenom email");

  if (!releve) {
    res.status(404);
    throw new Error("Relevé non trouvé");
  }

  // Vérifier que l'utilisateur a accès
  if (
    releve.user._id.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  res.json(releve);
});

/**
 * @desc    Obtenir les statistiques globales des relevés
 * @route   GET /api/releves/stats
 * @access  Private/Admin
 */
const getRelevesStats = asyncHandler(async (req, res) => {
  const totalReleves = await Releve.countDocuments();
  const relevesEnCours = await Releve.countDocuments({ status: "en_cours" });
  const relevesExportes = await Releve.countDocuments({ status: "exporte" });

  // Relevés par entreprise
  const parEntreprise = await Releve.aggregate([
    {
      $group: {
        _id: "$entreprise",
        count: { $sum: 1 },
      },
    },
    {
      $lookup: {
        from: "entreprises",
        localField: "_id",
        foreignField: "_id",
        as: "entreprise",
      },
    },
    {
      $unwind: "$entreprise",
    },
    {
      $project: {
        _id: 1,
        nom: "$entreprise.nomComplet",
        trigramme: "$entreprise.trigramme",
        count: 1,
      },
    },
    {
      $sort: { count: -1 },
    },
  ]);

  // Relevés par concurrent
  const parConcurrent = await Releve.aggregate([
    {
      $group: {
        _id: "$concurrent",
        count: { $sum: 1 },
      },
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
        count: 1,
      },
    },
    {
      $sort: { count: -1 },
    },
    {
      $limit: 10,
    },
  ]);

  res.json({
    totalReleves,
    relevesEnCours,
    relevesExportes,
    parEntreprise,
    parConcurrent,
  });
});

export {
  createReleve,
  getReleveEnCours,
  getRelevesEnCoursParEntreprise,
  scanArticleReleve,
  addLigneReleve,
  updateLigneReleve,
  deleteLigneReleve,
  downloadReleve,
  deleteReleve,
  getHistoriqueReleves,
  getReleveById,
  getRelevesStats,
};
