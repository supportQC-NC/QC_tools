// backend/controllers/bipageCollecteController.js
// Clone du contrôleur Réappro pour le BIPAGE terminal.
// Même logique (scan/quantité/lignes/export), sessions et .dat propres.
// .dat : "stock.dat bipage <nom>" écrit dans entreprise.cheminExportInventaire.
import asyncHandler from "../middleware/asyncHandler.js";
import BipageCollecte from "../models/BipageCollecteModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import articleCacheService from "../services/articleService.js";
import path from "path";
import fs from "fs";

// @desc  Créer un nouveau bipage
// @route POST /api/bipage-collecte
const createBipage = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.body;

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  const enCours = await BipageCollecte.findOne({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  });
  if (enCours) return res.json(enCours);

  const bipage = await BipageCollecte.create({
    entreprise: entrepriseId,
    nomDossierDBF: entreprise.nomDossierDBF,
    user: req.user._id,
    lignes: [],
  });

  articleCacheService.preload(entreprise).catch((err) => {
    console.error("Erreur préchargement cache:", err);
  });

  res.status(201).json(bipage);
});

// @desc  Bipage en cours de l'utilisateur pour une entreprise
// @route GET /api/bipage-collecte/en-cours/:entrepriseId
const getBipageEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;

  const bipage = await BipageCollecte.findOne({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  }).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire cheminBase mappingEntrepots",
  );

  if (bipage?.entreprise) {
    articleCacheService.preload(bipage.entreprise).catch((err) => {
      console.error("Erreur préchargement cache:", err);
    });
  }

  res.json(bipage);
});

// Suivre la chaîne de renvois via GENDOUBL (identique reappro)
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
    if (!gendoubl) break;

    chaineRenvois.push({
      nart: currentArticle.NART ? currentArticle.NART.trim() : "",
      gencod: currentArticle.GENCOD ? currentArticle.GENCOD.trim() : "",
      designation: currentArticle.DESIGN ? currentArticle.DESIGN.trim() : "",
      renvoisVers: gendoubl,
    });

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

// @desc  Scanner un article (infos + stocks)
// @route POST /api/bipage-collecte/:id/scan
const scanArticleBipage = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const startTime = Date.now();

  const bipage = await BipageCollecte.findById(req.params.id);
  if (!bipage) {
    res.status(404);
    throw new Error("Bipage non trouvé");
  }
  if (bipage.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce bipage est déjà terminé");
  }

  const entreprise = await Entreprise.findById(bipage.entreprise);
  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

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
    stocks: { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 },
    stocksLabels,
    isUnknown: true,
    isRenvoi: false,
    articleOriginal: null,
    chaineRenvois: null,
    nombreRenvois: 0,
  };

  if (fs.existsSync(dbfPath)) {
    try {
      const article = await articleCacheService.findByCode(
        entreprise,
        code.trim(),
      );
      if (article) {
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
    bipageId: bipage._id,
    articleInfo,
    _queryTime: `${queryTime}ms`,
  });
});

// @desc  Ajouter une ligne
// @route POST /api/bipage-collecte/:id/lignes
const addLigneBipage = asyncHandler(async (req, res) => {
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

  const bipage = await BipageCollecte.findById(req.params.id);
  if (!bipage) {
    res.status(404);
    throw new Error("Bipage non trouvé");
  }
  if (bipage.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce bipage est déjà terminé");
  }

  const ligneExistante = bipage.lignes.find(
    (l) => l.nart === nart || (gencod && l.gencod === gencod),
  );

  if (ligneExistante) {
    ligneExistante.quantite += parseInt(quantite);
    ligneExistante.scannedAt = new Date();
  } else {
    bipage.lignes.push({
      nart,
      gencod: gencod || "",
      designation: designation || "",
      refer: refer || "",
      quantite: parseInt(quantite),
      stocksSnapshot: stocks || { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 },
      isUnknown: isUnknown || false,
      isRenvoi: isRenvoi || false,
      articleOriginal: articleOriginal || null,
    });
  }

  bipage.calculerTotaux();
  await bipage.save();

  res.json(bipage);
});

// @desc  Modifier une ligne
// @route PUT /api/bipage-collecte/:id/lignes/:ligneId
const updateLigneBipage = asyncHandler(async (req, res) => {
  const { quantite } = req.body;
  const { id, ligneId } = req.params;

  const bipage = await BipageCollecte.findById(id);
  if (!bipage) {
    res.status(404);
    throw new Error("Bipage non trouvé");
  }
  if (bipage.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce bipage est déjà terminé");
  }

  const ligne = bipage.lignes.id(ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  ligne.quantite = parseInt(quantite);
  bipage.calculerTotaux();
  await bipage.save();

  res.json(bipage);
});

// @desc  Supprimer une ligne
// @route DELETE /api/bipage-collecte/:id/lignes/:ligneId
const deleteLigneBipage = asyncHandler(async (req, res) => {
  const { id, ligneId } = req.params;

  const bipage = await BipageCollecte.findById(id);
  if (!bipage) {
    res.status(404);
    throw new Error("Bipage non trouvé");
  }
  if (bipage.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce bipage est déjà terminé");
  }

  bipage.lignes.pull(ligneId);
  bipage.calculerTotaux();
  await bipage.save();

  res.json(bipage);
});

// Contenu .dat (identique reappro/inventaire) : code(13)|qté(8)|000 CRLF
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

// @desc  Télécharger le fichier bipage (sur le poste)
// @route POST /api/bipage-collecte/:id/download
const downloadBipage = asyncHandler(async (req, res) => {
  const { nomBipage } = req.body;
  if (!nomBipage || !nomBipage.trim()) {
    res.status(400);
    throw new Error("Le nom du bipage est requis");
  }

  const bipage = await BipageCollecte.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet",
  );
  if (!bipage) {
    res.status(404);
    throw new Error("Bipage non trouvé");
  }
  if (bipage.lignes.length === 0) {
    res.status(400);
    throw new Error("Le bipage est vide");
  }

  const contenu = genererContenuFichier(bipage.lignes);
  const nomFichier = `stock.dat bipage ${nomBipage
    .trim()
    .replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

  bipage.nom = nomBipage.trim();
  bipage.status = "exporte";
  bipage.fichierExport = nomFichier;
  bipage.exportedAt = new Date();
  bipage.modeExport = "telechargement";
  await bipage.save();

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}"`);
  res.send(contenu);
});

// @desc  Exporter le bipage sur serveur (cheminExportInventaire de l'entreprise)
// @route POST /api/bipage-collecte/:id/export
const exportBipage = asyncHandler(async (req, res) => {
  const { nomBipage, cheminDestination } = req.body;
  if (!nomBipage || !nomBipage.trim()) {
    res.status(400);
    throw new Error("Le nom du bipage est requis");
  }

  const bipage = await BipageCollecte.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire",
  );
  if (!bipage) {
    res.status(404);
    throw new Error("Bipage non trouvé");
  }
  if (bipage.lignes.length === 0) {
    res.status(400);
    throw new Error("Le bipage est vide");
  }

  const contenu = genererContenuFichier(bipage.lignes);
  const nomFichier = `stock.dat bipage ${nomBipage
    .trim()
    .replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

  // Même chemin que reapro : cheminExportInventaire de l'entreprise (traduit
  // vers le montage Linux par le getter du modèle en prod).
  let cheminExport =
    bipage.entreprise.cheminExportInventaire ||
    cheminDestination?.trim() ||
    "/mnt/rcommun/STOCK/collect_sec";

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
  try {
    fs.writeFileSync(cheminFichier, contenu, "utf8");
  } catch (error) {
    res.status(400);
    throw new Error(`Impossible d'écrire le fichier: ${error.message}`);
  }

  bipage.nom = nomBipage.trim();
  bipage.status = "exporte";
  bipage.fichierExport = nomFichier;
  bipage.cheminExport = cheminFichier;
  bipage.exportedAt = new Date();
  bipage.modeExport = "serveur";
  await bipage.save();

  res.json({
    message: "Bipage exporté avec succès",
    bipage,
    fichier: {
      nom: nomFichier,
      chemin: cheminFichier,
      lignes: bipage.lignes.length,
      totalQuantite: bipage.totalQuantite,
    },
  });
});

// @desc  Supprimer un bipage en cours
// @route DELETE /api/bipage-collecte/:id
const deleteBipage = asyncHandler(async (req, res) => {
  const bipage = await BipageCollecte.findById(req.params.id);
  if (!bipage) {
    res.status(404);
    throw new Error("Bipage non trouvé");
  }
  if (bipage.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorisé");
  }
  await BipageCollecte.deleteOne({ _id: bipage._id });
  res.json({ message: "Bipage supprimé" });
});

// @desc  Historique des bipages de l'utilisateur
// @route GET /api/bipage-collecte/historique
const getHistoriqueBipage = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.query;
  const query = { user: req.user._id };
  if (entrepriseId) query.entreprise = entrepriseId;

  const bipages = await BipageCollecte.find(query)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .sort({ createdAt: -1 })
    .limit(50);

  res.json(bipages);
});

// @desc  Obtenir un bipage par ID
// @route GET /api/bipage-collecte/:id
const getBipageById = asyncHandler(async (req, res) => {
  const bipage = await BipageCollecte.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire mappingEntrepots",
  );
  if (!bipage) {
    res.status(404);
    throw new Error("Bipage non trouvé");
  }
  if (
    bipage.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    res.status(403);
    throw new Error("Non autorisé");
  }
  res.json(bipage);
});

export {
  createBipage,
  getBipageEnCours,
  scanArticleBipage,
  addLigneBipage,
  updateLigneBipage,
  deleteLigneBipage,
  exportBipage,
  downloadBipage,
  deleteBipage,
  getHistoriqueBipage,
  getBipageById,
};