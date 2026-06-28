import asyncHandler from "../middleware/asyncHandler.js";
import Inventaire from "../models/InventaireModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import articleCacheService from "../services/articleService.js";
import path from "path";
import fs from "fs";

/**
 * @desc    Créer un nouvel inventaire
 * @route   POST /api/inventaires
 * @access  Private
 */
const createInventaire = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.body;

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  const inventaireEnCours = await Inventaire.findOne({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  });

  if (inventaireEnCours) {
    return res.json(inventaireEnCours);
  }

  const inventaire = await Inventaire.create({
    entreprise: entrepriseId,
    nomDossierDBF: entreprise.nomDossierDBF,
    user: req.user._id,
    lignes: [],
  });

  // Précharger le cache des articles pour cette entreprise (en arrière-plan)
  articleCacheService.preload(entreprise).catch((err) => {
    console.error("Erreur préchargement cache:", err);
  });

  res.status(201).json(inventaire);
});

/**
 * @desc    Obtenir l'inventaire en cours de l'utilisateur pour une entreprise
 * @route   GET /api/inventaires/en-cours/:entrepriseId
 * @access  Private
 */
const getInventaireEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;

  const inventaire = await Inventaire.findOne({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  }).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire cheminBase",
  );

  // Si inventaire existe, précharger le cache en arrière-plan
  if (inventaire?.entreprise) {
    articleCacheService.preload(inventaire.entreprise).catch((err) => {
      console.error("Erreur préchargement cache:", err);
    });
  }

  res.json(inventaire);
});

/**
 * @desc    Fonction utilitaire pour suivre la chaîne de renvois via GENDOUBL (OPTIMISÉE)
 *          Utilise le cache pour des recherches O(1) au lieu de parcourir tous les records
 */
const suivreChaineRenvois = async (entreprise, article) => {
  const MAX_ITERATIONS = 10;
  let currentArticle = article;
  let iterations = 0;
  const chaineRenvois = [];

  const articleOriginal = {
    nart: article.NART ? article.NART.trim() : "",
    gencod: article.GENCOD ? article.GENCOD.trim() : "",
    designation: article.DESIGN ? article.DESIGN.trim() : "",
  };

  while (currentArticle && iterations < MAX_ITERATIONS) {
    const gendoubl = currentArticle.GENDOUBL
      ? currentArticle.GENDOUBL.trim()
      : "";

    if (!gendoubl) {
      break;
    }

    chaineRenvois.push({
      nart: currentArticle.NART ? currentArticle.NART.trim() : "",
      gencod: currentArticle.GENCOD ? currentArticle.GENCOD.trim() : "",
      designation: currentArticle.DESIGN ? currentArticle.DESIGN.trim() : "",
      renvoisVers: gendoubl,
    });

    // Recherche O(1) via le cache au lieu de parcourir tous les records
    const nextArticle = await articleCacheService.findByNart(
      entreprise,
      gendoubl,
    );

    if (!nextArticle) {
      console.warn(`Renvoi vers article inexistant (NART): ${gendoubl}`);
      break;
    }

    currentArticle = nextArticle;
    iterations++;
  }

  const isRenvoi = chaineRenvois.length > 0;

  return {
    articleFinal: currentArticle,
    isRenvoi,
    articleOriginal: isRenvoi ? articleOriginal : null,
    chaineRenvois: isRenvoi ? chaineRenvois : null,
    nombreRenvois: chaineRenvois.length,
  };
};

/**
 * @desc    Scanner/Ajouter un article à l'inventaire (OPTIMISÉ avec cache)
 * @route   POST /api/inventaires/:id/scan
 * @access  Private
 */
const scanArticle = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const startTime = Date.now();

  const inventaire = await Inventaire.findById(req.params.id);
  if (!inventaire) {
    res.status(404);
    throw new Error("Inventaire non trouvé");
  }

  if (inventaire.status !== "en_cours") {
    res.status(400);
    throw new Error("Cet inventaire est déjà terminé");
  }

  const entreprise = await Entreprise.findById(inventaire.entreprise);
  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  let articleInfo = {
    nart: code,
    gencod: "",
    designation: "Article inconnu",
    isUnknown: true,
    isRenvoi: false,
    articleOriginal: null,
    chaineRenvois: null,
    nombreRenvois: 0,
  };

  if (fs.existsSync(dbfPath)) {
    try {
      // ========== OPTIMISATION : Recherche O(1) via le cache ==========
      // Au lieu de lire tout le fichier DBF à chaque scan (90k articles = 5-10s)
      // On utilise le cache avec index par GENCOD et NART (< 10ms)
      const article = await articleCacheService.findByCode(
        entreprise,
        code.trim(),
      );

      if (article) {
        // Suivre la chaîne de renvois (également optimisé avec le cache)
        const resultatRenvoi = await suivreChaineRenvois(entreprise, article);
        const articleFinal = resultatRenvoi.articleFinal;

        articleInfo = {
          nart: articleFinal.NART ? articleFinal.NART.trim() : code,
          gencod: articleFinal.GENCOD ? articleFinal.GENCOD.trim() : "",
          designation: articleFinal.DESIGN ? articleFinal.DESIGN.trim() : "",
          isUnknown: false,
          isRenvoi: resultatRenvoi.isRenvoi,
          articleOriginal: resultatRenvoi.articleOriginal,
          chaineRenvois: resultatRenvoi.chaineRenvois,
          nombreRenvois: resultatRenvoi.nombreRenvois,
        };
      }
    } catch (error) {
      console.error("Erreur recherche article:", error);
    }
  }

  const queryTime = Date.now() - startTime;

  res.json({
    inventaireId: inventaire._id,
    articleInfo,
    _queryTime: `${queryTime}ms`,
  });
});

/**
 * @desc    Ajouter une ligne à l'inventaire
 * @route   POST /api/inventaires/:id/lignes
 * @access  Private
 */
const addLigne = asyncHandler(async (req, res) => {
  const {
    nart,
    gencod,
    designation,
    quantite,
    isUnknown,
    isRenvoi,
    articleOriginal,
  } = req.body;

  const inventaire = await Inventaire.findById(req.params.id);
  if (!inventaire) {
    res.status(404);
    throw new Error("Inventaire non trouvé");
  }

  if (inventaire.status !== "en_cours") {
    res.status(400);
    throw new Error("Cet inventaire est déjà terminé");
  }

  const ligneExistante = inventaire.lignes.find(
    (l) => l.nart === nart || (gencod && l.gencod === gencod),
  );

  if (ligneExistante) {
    ligneExistante.quantite += parseInt(quantite);
    ligneExistante.scannedAt = new Date();
  } else {
    inventaire.lignes.push({
      nart,
      gencod: gencod || "",
      designation: designation || "",
      quantite: parseInt(quantite),
      isUnknown: isUnknown || false,
      isRenvoi: isRenvoi || false,
      articleOriginal: articleOriginal || null,
    });
  }

  inventaire.calculerTotaux();
  await inventaire.save();

  res.json(inventaire);
});

/**
 * @desc    Modifier une ligne de l'inventaire
 * @route   PUT /api/inventaires/:id/lignes/:ligneId
 * @access  Private
 */
const updateLigne = asyncHandler(async (req, res) => {
  const { quantite } = req.body;
  const { id, ligneId } = req.params;

  const inventaire = await Inventaire.findById(id);
  if (!inventaire) {
    res.status(404);
    throw new Error("Inventaire non trouvé");
  }

  if (inventaire.status !== "en_cours") {
    res.status(400);
    throw new Error("Cet inventaire est déjà terminé");
  }

  const ligne = inventaire.lignes.id(ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  ligne.quantite = parseInt(quantite);
  inventaire.calculerTotaux();
  await inventaire.save();

  res.json(inventaire);
});

/**
 * @desc    Supprimer une ligne de l'inventaire
 * @route   DELETE /api/inventaires/:id/lignes/:ligneId
 * @access  Private
 */
const deleteLigne = asyncHandler(async (req, res) => {
  const { id, ligneId } = req.params;

  const inventaire = await Inventaire.findById(id);
  if (!inventaire) {
    res.status(404);
    throw new Error("Inventaire non trouvé");
  }

  if (inventaire.status !== "en_cours") {
    res.status(400);
    throw new Error("Cet inventaire est déjà terminé");
  }

  inventaire.lignes.pull(ligneId);
  inventaire.calculerTotaux();
  await inventaire.save();

  res.json(inventaire);
});

/**
 * @desc    Générer le contenu du fichier inventaire
 */
const genererContenuFichier = (lignes) => {
  let contenu = "";
  lignes.forEach((ligne) => {
    let code = "";
    if (ligne.gencod && ligne.gencod.trim()) {
      code = ligne.gencod.trim().padEnd(13, " ");
    } else {
      code = ligne.nart.trim().padEnd(13, " ");
    }
    const quantiteFormatee = ligne.quantite.toString().padStart(8, "0");
    const suffixe = "000";
    contenu += `${code}|${quantiteFormatee}|${suffixe}\r\n`;
  });
  return contenu;
};

/**
 * @desc    Télécharger le fichier inventaire (sur le poste)
 * @route   POST /api/inventaires/:id/download
 * @access  Private
 */
const downloadInventaire = asyncHandler(async (req, res) => {
  const { nomInventaire } = req.body;

  if (!nomInventaire || !nomInventaire.trim()) {
    res.status(400);
    throw new Error("Le nom de l'inventaire est requis");
  }

  const inventaire = await Inventaire.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet",
  );

  if (!inventaire) {
    res.status(404);
    throw new Error("Inventaire non trouvé");
  }

  if (inventaire.lignes.length === 0) {
    res.status(400);
    throw new Error("L'inventaire est vide");
  }

  // Générer le contenu
  const contenu = genererContenuFichier(inventaire.lignes);

  // Nom du fichier
  const nomFichier = `stock.dat invent ${nomInventaire.trim().replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

  // Mettre à jour l'inventaire
  inventaire.nom = nomInventaire.trim();
  inventaire.status = "exporte";
  inventaire.fichierExport = nomFichier;
  inventaire.exportedAt = new Date();
  inventaire.modeExport = "telechargement";
  await inventaire.save();

  // Envoyer le fichier
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}"`);
  res.send(contenu);
});

/**
 * @desc    Exporter l'inventaire sur serveur
 * @route   POST /api/inventaires/:id/export
 * @access  Private
 */
const exportInventaire = asyncHandler(async (req, res) => {
  const { nomInventaire, cheminDestination } = req.body;

  if (!nomInventaire || !nomInventaire.trim()) {
    res.status(400);
    throw new Error("Le nom de l'inventaire est requis");
  }

  const inventaire = await Inventaire.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire",
  );

  if (!inventaire) {
    res.status(404);
    throw new Error("Inventaire non trouvé");
  }

  if (inventaire.lignes.length === 0) {
    res.status(400);
    throw new Error("L'inventaire est vide");
  }

  // Générer le contenu
  const contenu = genererContenuFichier(inventaire.lignes);

  // Nom du fichier
  const nomFichier = `stock.dat invent ${nomInventaire.trim().replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

  // Chemin de destination : utiliser celui fourni ou celui de l'entreprise par défaut
  let cheminExport = cheminDestination?.trim();
  if (!cheminExport) {
    cheminExport =
      inventaire.entreprise.cheminExportInventaire ||
      "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec";
  }

  // Vérifier et créer le dossier
  try {
    if (!fs.existsSync(cheminExport)) {
      fs.mkdirSync(cheminExport, { recursive: true });
    }
  } catch (error) {
    res.status(400);
    throw new Error(
      `Impossible d'accéder au chemin: ${cheminExport}. Vérifiez les droits d'accès. (${error.message})`,
    );
  }

  const cheminFichier = path.join(cheminExport, nomFichier);

  // Écrire le fichier
  try {
    fs.writeFileSync(cheminFichier, contenu, "utf8");
  } catch (error) {
    res.status(400);
    throw new Error(`Impossible d'écrire le fichier: ${error.message}`);
  }

  // Mettre à jour l'inventaire
  inventaire.nom = nomInventaire.trim();
  inventaire.status = "exporte";
  inventaire.fichierExport = nomFichier;
  inventaire.cheminExport = cheminFichier;
  inventaire.exportedAt = new Date();
  inventaire.modeExport = "serveur";
  await inventaire.save();

  res.json({
    message: "Inventaire exporté avec succès",
    inventaire,
    fichier: {
      nom: nomFichier,
      chemin: cheminFichier,
      lignes: inventaire.lignes.length,
      totalQuantite: inventaire.totalQuantite,
    },
  });
});

/**
 * @desc    Annuler/Supprimer un inventaire en cours
 * @route   DELETE /api/inventaires/:id
 * @access  Private
 */
const deleteInventaire = asyncHandler(async (req, res) => {
  const inventaire = await Inventaire.findById(req.params.id);

  if (!inventaire) {
    res.status(404);
    throw new Error("Inventaire non trouvé");
  }

  if (inventaire.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  await Inventaire.deleteOne({ _id: inventaire._id });

  res.json({ message: "Inventaire supprimé" });
});

/**
 * @desc    Historique des inventaires de l'utilisateur
 * @route   GET /api/inventaires/historique
 * @access  Private
 */
const getHistorique = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.query;

  const query = { user: req.user._id };
  if (entrepriseId) {
    query.entreprise = entrepriseId;
  }

  const inventaires = await Inventaire.find(query)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .sort({ createdAt: -1 })
    .limit(50);

  res.json(inventaires);
});

export {
  createInventaire,
  getInventaireEnCours,
  scanArticle,
  addLigne,
  updateLigne,
  deleteLigne,
  exportInventaire,
  downloadInventaire,
  deleteInventaire,
  getHistorique,
};