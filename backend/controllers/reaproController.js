// // backend/controllers/reapproController.js
// import asyncHandler from "../middleware/asyncHandler.js";
// import Reappro from "../models/ReaproModel.js";
// import Entreprise from "../models/EntrepriseModel.js";
// import articleCacheService from "../services/articleService.js";
// import path from "path";
// import fs from "fs";

// /**
//  * @desc    Créer un nouveau réappro
//  * @route   POST /api/reappros
//  * @access  Private
//  */
// const createReappro = asyncHandler(async (req, res) => {
//   const { entrepriseId } = req.body;

//   const entreprise = await Entreprise.findById(entrepriseId);
//   if (!entreprise) {
//     res.status(404);
//     throw new Error("Entreprise non trouvée");
//   }

//   // Vérifier si un réappro est déjà en cours pour cet utilisateur et cette entreprise
//   const reapproEnCours = await Reappro.findOne({
//     entreprise: entrepriseId,
//     user: req.user._id,
//     status: "en_cours",
//   });

//   if (reapproEnCours) {
//     return res.json(reapproEnCours);
//   }

//   const reappro = await Reappro.create({
//     entreprise: entrepriseId,
//     nomDossierDBF: entreprise.nomDossierDBF,
//     user: req.user._id,
//     lignes: [],
//   });

//   // Précharger le cache des articles pour cette entreprise (en arrière-plan)
//   articleCacheService.preload(entreprise).catch((err) => {
//     console.error("Erreur préchargement cache:", err);
//   });

//   res.status(201).json(reappro);
// });

// /**
//  * @desc    Obtenir le réappro en cours de l'utilisateur pour une entreprise
//  * @route   GET /api/reappros/en-cours/:entrepriseId
//  * @access  Private
//  */
// const getReapproEnCours = asyncHandler(async (req, res) => {
//   const { entrepriseId } = req.params;

//   const reappro = await Reappro.findOne({
//     entreprise: entrepriseId,
//     user: req.user._id,
//     status: "en_cours",
//   }).populate(
//     "entreprise",
//     "nomDossierDBF trigramme nomComplet cheminExportInventaire cheminBase mappingEntrepots",
//   );

//   // Si réappro existe, précharger le cache en arrière-plan
//   if (reappro?.entreprise) {
//     articleCacheService.preload(reappro.entreprise).catch((err) => {
//       console.error("Erreur préchargement cache:", err);
//     });
//   }

//   res.json(reappro);
// });

// /**
//  * @desc    Fonction utilitaire pour suivre la chaîne de renvois via GENDOUBL
//  *          Utilise le cache pour des recherches O(1)
//  */
// const suivreChaineRenvois = async (entreprise, article) => {
//   const MAX_ITERATIONS = 10;
//   let currentArticle = article;
//   let iterations = 0;
//   const chaineRenvois = [];

//   const articleOriginal = {
//     nart: article.NART ? article.NART.trim() : "",
//     gencod: article.GENCOD ? article.GENCOD.trim() : "",
//     designation: article.DESIGN ? article.DESIGN.trim() : "",
//   };

//   while (currentArticle && iterations < MAX_ITERATIONS) {
//     const gendoubl = currentArticle.GENDOUBL
//       ? currentArticle.GENDOUBL.trim()
//       : "";

//     if (!gendoubl) {
//       break;
//     }

//     chaineRenvois.push({
//       nart: currentArticle.NART ? currentArticle.NART.trim() : "",
//       gencod: currentArticle.GENCOD ? currentArticle.GENCOD.trim() : "",
//       designation: currentArticle.DESIGN ? currentArticle.DESIGN.trim() : "",
//       renvoisVers: gendoubl,
//     });

//     // Recherche O(1) via le cache
//     const nextArticle = await articleCacheService.findByNart(
//       entreprise,
//       gendoubl,
//     );

//     if (!nextArticle) {
//       console.warn(`Renvoi vers article inexistant (NART): ${gendoubl}`);
//       break;
//     }

//     currentArticle = nextArticle;
//     iterations++;
//   }

//   const isRenvoi = chaineRenvois.length > 0;

//   return {
//     articleFinal: currentArticle,
//     isRenvoi,
//     articleOriginal: isRenvoi ? articleOriginal : null,
//     chaineRenvois: isRenvoi ? chaineRenvois : null,
//     nombreRenvois: chaineRenvois.length,
//   };
// };

// /**
//  * @desc    Scanner un article pour réappro - Affiche les infos et stocks
//  * @route   POST /api/reappros/:id/scan
//  * @access  Private
//  */
// const scanArticleReappro = asyncHandler(async (req, res) => {
//   const { code } = req.body;
//   const startTime = Date.now();

//   const reappro = await Reappro.findById(req.params.id);
//   if (!reappro) {
//     res.status(404);
//     throw new Error("Réappro non trouvé");
//   }

//   if (reappro.status !== "en_cours") {
//     res.status(400);
//     throw new Error("Ce réappro est déjà terminé");
//   }

//   const entreprise = await Entreprise.findById(reappro.entreprise);
//   const dbfPath = path.join(
//     entreprise.cheminBase,
//     entreprise.nomDossierDBF,
//     "article.dbf",
//   );

//   // Labels personnalisés par entreprise (mapping)
//   const stocksLabels = entreprise.mappingEntrepots || {
//     S1: "Magasin",
//     S2: "S2",
//     S3: "S3",
//     S4: "S4",
//     S5: "S5",
//   };

//   let articleInfo = {
//     nart: code,
//     gencod: "",
//     designation: "Article inconnu",
//     refer: "",
//     stocks: {
//       S1: 0,
//       S2: 0,
//       S3: 0,
//       S4: 0,
//       S5: 0,
//     },
//     stocksLabels,
//     isUnknown: true,
//     isRenvoi: false,
//     articleOriginal: null,
//     chaineRenvois: null,
//     nombreRenvois: 0,
//   };

//   if (fs.existsSync(dbfPath)) {
//     try {
//       // Recherche O(1) via le cache
//       const article = await articleCacheService.findByCode(
//         entreprise,
//         code.trim(),
//       );

//       if (article) {
//         // Suivre la chaîne de renvois si nécessaire
//         const resultatRenvoi = await suivreChaineRenvois(entreprise, article);
//         const articleFinal = resultatRenvoi.articleFinal;

//         articleInfo = {
//           nart: articleFinal.NART ? articleFinal.NART.trim() : code,
//           gencod: articleFinal.GENCOD ? articleFinal.GENCOD.trim() : "",
//           designation: articleFinal.DESIGN ? articleFinal.DESIGN.trim() : "",
//           refer: articleFinal.REFER ? articleFinal.REFER.trim() : "",
//           stocks: {
//             S1: parseFloat(articleFinal.S1) || 0,
//             S2: parseFloat(articleFinal.S2) || 0,
//             S3: parseFloat(articleFinal.S3) || 0,
//             S4: parseFloat(articleFinal.S4) || 0,
//             S5: parseFloat(articleFinal.S5) || 0,
//           },
//           stocksLabels,
//           isUnknown: false,
//           isRenvoi: resultatRenvoi.isRenvoi,
//           articleOriginal: resultatRenvoi.articleOriginal,
//           chaineRenvois: resultatRenvoi.chaineRenvois,
//           nombreRenvois: resultatRenvoi.nombreRenvois,
//         };
//       }
//     } catch (error) {
//       console.error("Erreur recherche article:", error);
//     }
//   }

//   const queryTime = Date.now() - startTime;

//   res.json({
//     reapproId: reappro._id,
//     articleInfo,
//     _queryTime: `${queryTime}ms`,
//   });
// });

// /**
//  * @desc    Ajouter une ligne au réappro (après confirmation de l'opérateur)
//  * @route   POST /api/reappros/:id/lignes
//  * @access  Private
//  */
// const addLigneReappro = asyncHandler(async (req, res) => {
//   const {
//     nart,
//     gencod,
//     designation,
//     refer,
//     quantite,
//     stocks,
//     isUnknown,
//     isRenvoi,
//     articleOriginal,
//   } = req.body;

//   const reappro = await Reappro.findById(req.params.id);
//   if (!reappro) {
//     res.status(404);
//     throw new Error("Réappro non trouvé");
//   }

//   if (reappro.status !== "en_cours") {
//     res.status(400);
//     throw new Error("Ce réappro est déjà terminé");
//   }

//   // Vérifier si l'article existe déjà dans le réappro
//   const ligneExistante = reappro.lignes.find(
//     (l) => l.nart === nart || (gencod && l.gencod === gencod),
//   );

//   if (ligneExistante) {
//     // Ajouter la quantité à la ligne existante
//     ligneExistante.quantite += parseInt(quantite);
//     ligneExistante.scannedAt = new Date();
//   } else {
//     // Créer une nouvelle ligne
//     reappro.lignes.push({
//       nart,
//       gencod: gencod || "",
//       designation: designation || "",
//       refer: refer || "",
//       quantite: parseInt(quantite),
//       stocksSnapshot: stocks || {
//         S1: 0,
//         S2: 0,
//         S3: 0,
//         S4: 0,
//         S5: 0,
//       },
//       isUnknown: isUnknown || false,
//       isRenvoi: isRenvoi || false,
//       articleOriginal: articleOriginal || null,
//     });
//   }

//   reappro.calculerTotaux();
//   await reappro.save();

//   res.json(reappro);
// });

// /**
//  * @desc    Modifier une ligne du réappro
//  * @route   PUT /api/reappros/:id/lignes/:ligneId
//  * @access  Private
//  */
// const updateLigneReappro = asyncHandler(async (req, res) => {
//   const { quantite } = req.body;
//   const { id, ligneId } = req.params;

//   const reappro = await Reappro.findById(id);
//   if (!reappro) {
//     res.status(404);
//     throw new Error("Réappro non trouvé");
//   }

//   if (reappro.status !== "en_cours") {
//     res.status(400);
//     throw new Error("Ce réappro est déjà terminé");
//   }

//   const ligne = reappro.lignes.id(ligneId);
//   if (!ligne) {
//     res.status(404);
//     throw new Error("Ligne non trouvée");
//   }

//   ligne.quantite = parseInt(quantite);
//   reappro.calculerTotaux();
//   await reappro.save();

//   res.json(reappro);
// });

// /**
//  * @desc    Supprimer une ligne du réappro
//  * @route   DELETE /api/reappros/:id/lignes/:ligneId
//  * @access  Private
//  */
// const deleteLigneReappro = asyncHandler(async (req, res) => {
//   const { id, ligneId } = req.params;

//   const reappro = await Reappro.findById(id);
//   if (!reappro) {
//     res.status(404);
//     throw new Error("Réappro non trouvé");
//   }

//   if (reappro.status !== "en_cours") {
//     res.status(400);
//     throw new Error("Ce réappro est déjà terminé");
//   }

//   reappro.lignes.pull(ligneId);
//   reappro.calculerTotaux();
//   await reappro.save();

//   res.json(reappro);
// });

// /**
//  * @desc    Générer le contenu du fichier réappro (même format que inventaire)
//  */
// const genererContenuFichier = (lignes) => {
//   let contenu = "";
//   lignes.forEach((ligne) => {
//     let code = "";
//     if (ligne.gencod && ligne.gencod.trim()) {
//       code = ligne.gencod.trim().padEnd(13, " ");
//     } else {
//       code = ligne.nart.trim().padEnd(13, " ");
//     }
//     const quantiteFormatee = ligne.quantite.toString().padStart(8, "0");
//     const suffixe = "000";
//     contenu += `${code}|${quantiteFormatee}|${suffixe}\r\n`;
//   });
//   return contenu;
// };

// /**
//  * @desc    Télécharger le fichier réappro (sur le poste)
//  * @route   POST /api/reappros/:id/download
//  * @access  Private
//  */
// const downloadReappro = asyncHandler(async (req, res) => {
//   const { nomReappro } = req.body;

//   if (!nomReappro || !nomReappro.trim()) {
//     res.status(400);
//     throw new Error("Le nom du réappro est requis");
//   }

//   const reappro = await Reappro.findById(req.params.id).populate(
//     "entreprise",
//     "nomDossierDBF trigramme nomComplet",
//   );

//   if (!reappro) {
//     res.status(404);
//     throw new Error("Réappro non trouvé");
//   }

//   if (reappro.lignes.length === 0) {
//     res.status(400);
//     throw new Error("Le réappro est vide");
//   }

//   // Générer le contenu
//   const contenu = genererContenuFichier(reappro.lignes);

//   // Nom du fichier : "stock.dat reappro nom_reappro"
//   const nomFichier = `stock.dat reappro ${nomReappro.trim().replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

//   // Mettre à jour le réappro
//   reappro.nom = nomReappro.trim();
//   reappro.status = "exporte";
//   reappro.fichierExport = nomFichier;
//   reappro.exportedAt = new Date();
//   reappro.modeExport = "telechargement";
//   await reappro.save();

//   // Envoyer le fichier
//   res.setHeader("Content-Type", "text/plain; charset=utf-8");
//   res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}"`);
//   res.send(contenu);
// });

// /**
//  * @desc    Exporter le réappro sur serveur
//  * @route   POST /api/reappros/:id/export
//  * @access  Private
//  */
// const exportReappro = asyncHandler(async (req, res) => {
//   const { nomReappro, cheminDestination } = req.body;

//   if (!nomReappro || !nomReappro.trim()) {
//     res.status(400);
//     throw new Error("Le nom du réappro est requis");
//   }

//   const reappro = await Reappro.findById(req.params.id).populate(
//     "entreprise",
//     "nomDossierDBF trigramme nomComplet cheminExportInventaire",
//   );

//   if (!reappro) {
//     res.status(404);
//     throw new Error("Réappro non trouvé");
//   }

//   if (reappro.lignes.length === 0) {
//     res.status(400);
//     throw new Error("Le réappro est vide");
//   }

//   // Générer le contenu
//   const contenu = genererContenuFichier(reappro.lignes);

//   // Nom du fichier : "stock.dat reappro nom_reappro"
//   const nomFichier = `stock.dat reappro ${nomReappro.trim().replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

//   // Chemin de destination : utiliser celui fourni ou celui de l'entreprise par défaut
//   let cheminExport = cheminDestination?.trim();
//   if (!cheminExport) {
//     cheminExport =
//       reappro.entreprise.cheminExportInventaire ||
//       "\\\\192.168.0.250\\Rcommun\\STOCK\\collect_sec";
//   }

//   // Vérifier et créer le dossier
//   try {
//     if (!fs.existsSync(cheminExport)) {
//       fs.mkdirSync(cheminExport, { recursive: true });
//     }
//   } catch (error) {
//     res.status(400);
//     throw new Error(
//       `Impossible d'accéder au chemin: ${cheminExport}. Vérifiez les droits d'accès. (${error.message})`,
//     );
//   }

//   const cheminFichier = path.join(cheminExport, nomFichier);

//   // Écrire le fichier
//   try {
//     fs.writeFileSync(cheminFichier, contenu, "utf8");
//   } catch (error) {
//     res.status(400);
//     throw new Error(`Impossible d'écrire le fichier: ${error.message}`);
//   }

//   // Mettre à jour le réappro
//   reappro.nom = nomReappro.trim();
//   reappro.status = "exporte";
//   reappro.fichierExport = nomFichier;
//   reappro.cheminExport = cheminFichier;
//   reappro.exportedAt = new Date();
//   reappro.modeExport = "serveur";
//   await reappro.save();

//   res.json({
//     message: "Réappro exporté avec succès",
//     reappro,
//     fichier: {
//       nom: nomFichier,
//       chemin: cheminFichier,
//       lignes: reappro.lignes.length,
//       totalQuantite: reappro.totalQuantite,
//     },
//   });
// });

// /**
//  * @desc    Annuler/Supprimer un réappro en cours
//  * @route   DELETE /api/reappros/:id
//  * @access  Private
//  */
// const deleteReappro = asyncHandler(async (req, res) => {
//   const reappro = await Reappro.findById(req.params.id);

//   if (!reappro) {
//     res.status(404);
//     throw new Error("Réappro non trouvé");
//   }

//   if (reappro.user.toString() !== req.user._id.toString()) {
//     res.status(403);
//     throw new Error("Non autorisé");
//   }

//   await Reappro.deleteOne({ _id: reappro._id });

//   res.json({ message: "Réappro supprimé" });
// });

// /**
//  * @desc    Historique des réappros de l'utilisateur
//  * @route   GET /api/reappros/historique
//  * @access  Private
//  */
// const getHistoriqueReappro = asyncHandler(async (req, res) => {
//   const { entrepriseId } = req.query;

//   const query = { user: req.user._id };
//   if (entrepriseId) {
//     query.entreprise = entrepriseId;
//   }

//   const reappros = await Reappro.find(query)
//     .populate("entreprise", "nomDossierDBF trigramme nomComplet")
//     .sort({ createdAt: -1 })
//     .limit(50);

//   res.json(reappros);
// });

// /**
//  * @desc    Obtenir un réappro par ID
//  * @route   GET /api/reappros/:id
//  * @access  Private
//  */
// const getReapproById = asyncHandler(async (req, res) => {
//   const reappro = await Reappro.findById(req.params.id).populate(
//     "entreprise",
//     "nomDossierDBF trigramme nomComplet cheminExportInventaire mappingEntrepots",
//   );

//   if (!reappro) {
//     res.status(404);
//     throw new Error("Réappro non trouvé");
//   }

//   // Vérifier que l'utilisateur a accès
//   if (
//     reappro.user.toString() !== req.user._id.toString() &&
//     req.user.role !== "admin"
//   ) {
//     res.status(403);
//     throw new Error("Non autorisé");
//   }

//   res.json(reappro);
// });

// export {
//   createReappro,
//   getReapproEnCours,
//   scanArticleReappro,
//   addLigneReappro,
//   updateLigneReappro,
//   deleteLigneReappro,
//   exportReappro,
//   downloadReappro,
//   deleteReappro,
//   getHistoriqueReappro,
//   getReapproById,
// };


// backend/controllers/reapproController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Reappro from "../models/ReaproModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import articleCacheService from "../services/articleService.js";
import path from "path";
import fs from "fs";

/**
 * @desc    Créer un nouveau réappro
 * @route   POST /api/reappros
 * @access  Private
 */
const createReappro = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.body;

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  // Vérifier si un réappro est déjà en cours pour cet utilisateur et cette entreprise
  const reapproEnCours = await Reappro.findOne({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  });

  if (reapproEnCours) {
    return res.json(reapproEnCours);
  }

  const reappro = await Reappro.create({
    entreprise: entrepriseId,
    nomDossierDBF: entreprise.nomDossierDBF,
    user: req.user._id,
    lignes: [],
  });

  // Précharger le cache des articles pour cette entreprise (en arrière-plan)
  articleCacheService.preload(entreprise).catch((err) => {
    console.error("Erreur préchargement cache:", err);
  });

  res.status(201).json(reappro);
});

/**
 * @desc    Obtenir le réappro en cours de l'utilisateur pour une entreprise
 * @route   GET /api/reappros/en-cours/:entrepriseId
 * @access  Private
 */
const getReapproEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;

  const reappro = await Reappro.findOne({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  }).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire cheminBase mappingEntrepots",
  );

  // Si réappro existe, précharger le cache en arrière-plan
  if (reappro?.entreprise) {
    articleCacheService.preload(reappro.entreprise).catch((err) => {
      console.error("Erreur préchargement cache:", err);
    });
  }

  res.json(reappro);
});

/**
 * @desc    Fonction utilitaire pour suivre la chaîne de renvois via GENDOUBL
 *          Utilise le cache pour des recherches O(1)
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

    // Recherche O(1) via le cache
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
 * @desc    Scanner un article pour réappro - Affiche les infos et stocks
 * @route   POST /api/reappros/:id/scan
 * @access  Private
 */
const scanArticleReappro = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const startTime = Date.now();

  const reappro = await Reappro.findById(req.params.id);
  if (!reappro) {
    res.status(404);
    throw new Error("Réappro non trouvé");
  }

  if (reappro.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce réappro est déjà terminé");
  }

  const entreprise = await Entreprise.findById(reappro.entreprise);
  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  // Labels personnalisés par entreprise (mapping)
  const stocksLabels = entreprise.mappingEntrepots || {
    S1: "Magasin",
    S2: "S2",
    S3: "S3",
    S4: "S4",
    S5: "S5",
  };

  let articleInfo = {
    nart: code,
    gencod: "",
    designation: "Article inconnu",
    refer: "",
    stocks: {
      S1: 0,
      S2: 0,
      S3: 0,
      S4: 0,
      S5: 0,
    },
    stocksLabels,
    isUnknown: true,
    isRenvoi: false,
    articleOriginal: null,
    chaineRenvois: null,
    nombreRenvois: 0,
  };

  if (fs.existsSync(dbfPath)) {
    try {
      // Recherche O(1) via le cache
      const article = await articleCacheService.findByCode(
        entreprise,
        code.trim(),
      );

      if (article) {
        // Suivre la chaîne de renvois si nécessaire
        const resultatRenvoi = await suivreChaineRenvois(entreprise, article);
        const articleFinal = resultatRenvoi.articleFinal;

        articleInfo = {
          nart: articleFinal.NART ? articleFinal.NART.trim() : code,
          gencod: articleFinal.GENCOD ? articleFinal.GENCOD.trim() : "",
          designation: articleFinal.DESIGN ? articleFinal.DESIGN.trim() : "",
          refer: articleFinal.REFER ? articleFinal.REFER.trim() : "",
          stocks: {
            S1: parseFloat(articleFinal.S1) || 0,
            S2: parseFloat(articleFinal.S2) || 0,
            S3: parseFloat(articleFinal.S3) || 0,
            S4: parseFloat(articleFinal.S4) || 0,
            S5: parseFloat(articleFinal.S5) || 0,
          },
          stocksLabels,
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
    reapproId: reappro._id,
    articleInfo,
    _queryTime: `${queryTime}ms`,
  });
});

/**
 * @desc    Ajouter une ligne au réappro (après confirmation de l'opérateur)
 * @route   POST /api/reappros/:id/lignes
 * @access  Private
 */
const addLigneReappro = asyncHandler(async (req, res) => {
  const {
    nart,
    gencod,
    designation,
    refer,
    quantite,
    stocks,
    isUnknown,
    isRenvoi,
    articleOriginal,
  } = req.body;

  const reappro = await Reappro.findById(req.params.id);
  if (!reappro) {
    res.status(404);
    throw new Error("Réappro non trouvé");
  }

  if (reappro.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce réappro est déjà terminé");
  }

  // Vérifier si l'article existe déjà dans le réappro
  const ligneExistante = reappro.lignes.find(
    (l) => l.nart === nart || (gencod && l.gencod === gencod),
  );

  if (ligneExistante) {
    // Ajouter la quantité à la ligne existante
    ligneExistante.quantite += parseInt(quantite);
    ligneExistante.scannedAt = new Date();
  } else {
    // Créer une nouvelle ligne
    reappro.lignes.push({
      nart,
      gencod: gencod || "",
      designation: designation || "",
      refer: refer || "",
      quantite: parseInt(quantite),
      stocksSnapshot: stocks || {
        S1: 0,
        S2: 0,
        S3: 0,
        S4: 0,
        S5: 0,
      },
      isUnknown: isUnknown || false,
      isRenvoi: isRenvoi || false,
      articleOriginal: articleOriginal || null,
    });
  }

  reappro.calculerTotaux();
  await reappro.save();

  res.json(reappro);
});

/**
 * @desc    Modifier une ligne du réappro
 * @route   PUT /api/reappros/:id/lignes/:ligneId
 * @access  Private
 */
const updateLigneReappro = asyncHandler(async (req, res) => {
  const { quantite } = req.body;
  const { id, ligneId } = req.params;

  const reappro = await Reappro.findById(id);
  if (!reappro) {
    res.status(404);
    throw new Error("Réappro non trouvé");
  }

  if (reappro.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce réappro est déjà terminé");
  }

  const ligne = reappro.lignes.id(ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  ligne.quantite = parseInt(quantite);
  reappro.calculerTotaux();
  await reappro.save();

  res.json(reappro);
});

/**
 * @desc    Supprimer une ligne du réappro
 * @route   DELETE /api/reappros/:id/lignes/:ligneId
 * @access  Private
 */
const deleteLigneReappro = asyncHandler(async (req, res) => {
  const { id, ligneId } = req.params;

  const reappro = await Reappro.findById(id);
  if (!reappro) {
    res.status(404);
    throw new Error("Réappro non trouvé");
  }

  if (reappro.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce réappro est déjà terminé");
  }

  reappro.lignes.pull(ligneId);
  reappro.calculerTotaux();
  await reappro.save();

  res.json(reappro);
});

/**
 * @desc    Générer le contenu du fichier réappro (même format que inventaire)
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
 * @desc    Télécharger le fichier réappro (sur le poste)
 * @route   POST /api/reappros/:id/download
 * @access  Private
 */
const downloadReappro = asyncHandler(async (req, res) => {
  const { nomReappro } = req.body;

  if (!nomReappro || !nomReappro.trim()) {
    res.status(400);
    throw new Error("Le nom du réappro est requis");
  }

  const reappro = await Reappro.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet",
  );

  if (!reappro) {
    res.status(404);
    throw new Error("Réappro non trouvé");
  }

  if (reappro.lignes.length === 0) {
    res.status(400);
    throw new Error("Le réappro est vide");
  }

  // Générer le contenu
  const contenu = genererContenuFichier(reappro.lignes);

  // Nom du fichier : "stock.dat reappro nom_reappro"
  const nomFichier = `stock.dat reappro ${nomReappro.trim().replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

  // Mettre à jour le réappro
  reappro.nom = nomReappro.trim();
  reappro.status = "exporte";
  reappro.fichierExport = nomFichier;
  reappro.exportedAt = new Date();
  reappro.modeExport = "telechargement";
  await reappro.save();

  // Envoyer le fichier
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}"`);
  res.send(contenu);
});

/**
 * @desc    Exporter le réappro sur serveur
 * @route   POST /api/reappros/:id/export
 * @access  Private
 */
const exportReappro = asyncHandler(async (req, res) => {
  const { nomReappro, cheminDestination } = req.body;

  if (!nomReappro || !nomReappro.trim()) {
    res.status(400);
    throw new Error("Le nom du réappro est requis");
  }

  const reappro = await Reappro.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire",
  );

  if (!reappro) {
    res.status(404);
    throw new Error("Réappro non trouvé");
  }

  if (reappro.lignes.length === 0) {
    res.status(400);
    throw new Error("Le réappro est vide");
  }

  // Générer le contenu
  const contenu = genererContenuFichier(reappro.lignes);

  // Nom du fichier : "stock.dat reappro nom_reappro"
  const nomFichier = `stock.dat reappro ${nomReappro.trim().replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

  // Chemin de destination : utiliser celui fourni ou celui de l'entreprise par défaut
  let cheminExport = cheminDestination?.trim();
  if (!cheminExport) {
    cheminExport =
      reappro.entreprise.cheminExportInventaire ||
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

  // Mettre à jour le réappro
  reappro.nom = nomReappro.trim();
  reappro.status = "exporte";
  reappro.fichierExport = nomFichier;
  reappro.cheminExport = cheminFichier;
  reappro.exportedAt = new Date();
  reappro.modeExport = "serveur";
  await reappro.save();

  res.json({
    message: "Réappro exporté avec succès",
    reappro,
    fichier: {
      nom: nomFichier,
      chemin: cheminFichier,
      lignes: reappro.lignes.length,
      totalQuantite: reappro.totalQuantite,
    },
  });
});

/**
 * @desc    Annuler/Supprimer un réappro en cours
 * @route   DELETE /api/reappros/:id
 * @access  Private
 */
const deleteReappro = asyncHandler(async (req, res) => {
  const reappro = await Reappro.findById(req.params.id);

  if (!reappro) {
    res.status(404);
    throw new Error("Réappro non trouvé");
  }

  if (reappro.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  await Reappro.deleteOne({ _id: reappro._id });

  res.json({ message: "Réappro supprimé" });
});

/**
 * @desc    Historique des réappros de l'utilisateur
 * @route   GET /api/reappros/historique
 * @access  Private
 */
const getHistoriqueReappro = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.query;

  const query = { user: req.user._id };
  if (entrepriseId) {
    query.entreprise = entrepriseId;
  }

  const reappros = await Reappro.find(query)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .sort({ createdAt: -1 })
    .limit(50);

  res.json(reappros);
});

/**
 * @desc    Obtenir un réappro par ID
 * @route   GET /api/reappros/:id
 * @access  Private
 */
const getReapproById = asyncHandler(async (req, res) => {
  const reappro = await Reappro.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire mappingEntrepots",
  );

  if (!reappro) {
    res.status(404);
    throw new Error("Réappro non trouvé");
  }

  // Vérifier que l'utilisateur a accès
  if (
    reappro.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  res.json(reappro);
});

export {
  createReappro,
  getReapproEnCours,
  scanArticleReappro,
  addLigneReappro,
  updateLigneReappro,
  deleteLigneReappro,
  exportReappro,
  downloadReappro,
  deleteReappro,
  getHistoriqueReappro,
  getReapproById,
};
