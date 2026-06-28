// backend/controllers/controleCommandeController.js
import asyncHandler from "../middleware/asyncHandler.js";
import commandeCacheService from "../services/commandeService.js";
import articleCacheService from "../services/articleService.js";
import ControleCommande from "../models/ControleCommandeModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import path from "path";
import fs from "fs";

// ===========================================
// HELPERS
// ===========================================

/**
 * Vérifie la présence des fichiers DBF nécessaires (cmdref + cmdetail)
 */
const checkCommandeFiles = (entreprise) => {
  const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
  const cmdrefPath = path.join(basePath, "cmdref.dbf");
  const cmdetailPath = path.join(basePath, "cmdetail.dbf");

  if (!fs.existsSync(cmdrefPath)) {
    return {
      exists: false,
      error: `Fichier cmdref.dbf non trouvé pour ${entreprise.nomComplet}`,
    };
  }
  if (!fs.existsSync(cmdetailPath)) {
    return {
      exists: false,
      error: `Fichier cmdetail.dbf non trouvé pour ${entreprise.nomComplet}`,
    };
  }
  return { exists: true };
};

const formatEntreprise = (entreprise) => ({
  _id: entreprise._id,
  nomDossierDBF: entreprise.nomDossierDBF,
  trigramme: entreprise.trigramme,
  nomComplet: entreprise.nomComplet,
});

const safeTrim = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
};

// Fuseau horaire métier : Pacifique / Nouméa
const TIMEZONE = "Pacific/Noumea";

/**
 * Date du jour à Nouméa, sous forme d'entier comparable YYYYMMDD.
 * On travaille en entier "calendaire" pour éviter tout décalage de fuseau.
 */
const getTodayIntNoumea = () => {
  // en-CA => format "YYYY-MM-DD"
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [y, m, d] = ymd.split("-");
  return parseInt(`${y}${m}${d}`, 10);
};

/**
 * Extrait une date au format MM/DD/YYYY depuis le champ BATEAU.
 * - Le champ peut contenir du texte autour de la date.
 * - Si aucune date n'est trouvée (texte seul / champ vide) => null.
 * - Si la date est calendairement invalide (ex: 02/30/2026) => null.
 *
 * @returns {{ int: number, iso: string } | null}
 *   int = YYYYMMDD (pour comparaison), iso = "YYYY-MM-DD" (pour affichage)
 */
const parseBateauDate = (bateauValue) => {
  const str = safeTrim(bateauValue);
  if (!str) return null;

  // Format attendu MM/DD/YYYY (tolérant sur 1 ou 2 chiffres pour MM/DD)
  const match = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;

  const mm = parseInt(match[1], 10);
  const dd = parseInt(match[2], 10);
  const yyyy = parseInt(match[3], 10);

  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;

  // Validation calendaire stricte (rejette 02/30, 04/31, etc.)
  const dateObj = new Date(yyyy, mm - 1, dd);
  if (
    dateObj.getFullYear() !== yyyy ||
    dateObj.getMonth() !== mm - 1 ||
    dateObj.getDate() !== dd
  ) {
    return null;
  }

  const pad = (n) => String(n).padStart(2, "0");
  return {
    int: parseInt(`${yyyy}${pad(mm)}${pad(dd)}`, 10),
    iso: `${yyyy}-${pad(mm)}-${pad(dd)}`,
  };
};

/**
 * Une ligne de détail est un commentaire si son NART contient "!"
 * (peu importe la position du "!").
 */
const estCommentaire = (record) => safeTrim(record.NART).includes("!");

/**
 * Suit la chaîne de renvois d'articles via GENDOUBL (recherche O(1) via cache).
 * Identique à la logique du module réappro.
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
 * Génère le contenu du fichier d'export.
 * Format STRICTEMENT identique à reapro :
 *   CODE(13)|QTE(8 chiffres, zéros à gauche)|000\r\n
 * où CODE = GENCOD si présent, sinon NART (padEnd 13).
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

// ===========================================
// LECTURE — COMMANDES À CONTRÔLER (DBF)
// ===========================================

/**
 * @desc    Liste paginée des commandes.
 *
 *          ⚠️ Filtre date DÉSACTIVÉ par défaut : on renvoie TOUTES les commandes
 *          avec leur champ BATEAU (brut + parsé), pour pouvoir afficher/valider
 *          le format des données.
 *
 *          Pour ne garder que les commandes À CONTRÔLER (BATEAU = date valide
 *          >= aujourd'hui à Nouméa), passer ?filtreDate=1.
 *
 *          Champs ajoutés à chaque commande :
 *            - _bateauRaw       : valeur brute trimée de BATEAU
 *            - _bateauDate      : "YYYY-MM-DD" si une date a été parsée, sinon null
 *            - _bateauDateInt   : YYYYMMDD si parsée, sinon null
 *            - _bateauDateValide: true si une date a été extraite et est valide
 *
 * @route   GET /api/controle-commandes/a-controler/:nomDossierDBF
 * @query   page, limit, filtreDate(0|1)
 * @access  Private (module ctr_commande, read)
 */
const getCommandesAControler = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const check = checkCommandeFiles(entreprise);
  if (!check.exists) {
    res.status(404);
    throw new Error(check.error);
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;

    // Filtre date désactivé par défaut (affichage de toutes les commandes).
    const filtreDate =
      req.query.filtreDate === "1" || req.query.filtreDate === "true";

    // Toutes les entêtes (chargées/cachées par le service commande existant)
    const cache = await commandeCacheService.getCmdRef(entreprise);
    const todayInt = getTodayIntNoumea();

    const resultats = [];
    for (const record of cache.records) {
      const bateauRaw = safeTrim(record.BATEAU);
      const bateauDate = parseBateauDate(record.BATEAU);

      // Quand le filtre est actif : on exclut sans date valide / date passée
      if (filtreDate) {
        if (!bateauDate) continue;
        if (bateauDate.int < todayInt) continue;
      }

      resultats.push({
        ...record,
        _bateauRaw: bateauRaw,
        _bateauDate: bateauDate ? bateauDate.iso : null,
        _bateauDateInt: bateauDate ? bateauDate.int : null,
        _bateauDateValide: !!bateauDate,
      });
    }

    // Tri : filtre actif => par date BATEAU croissante ; sinon ordre du fichier.
    if (filtreDate) {
      resultats.sort(
        (a, b) => (a._bateauDateInt || 0) - (b._bateauDateInt || 0),
      );
    }

    // Pagination
    const totalRecords = resultats.length;
    const totalPages = Math.ceil(totalRecords / limit);
    const startIndex = (page - 1) * limit;
    const paginated = resultats.slice(startIndex, startIndex + limit);

    res.json({
      entreprise: formatEntreprise(entreprise),
      filtreDate, // indique si le filtre date est appliqué
      todayInt, // date "du jour" calculée côté serveur (Nouméa), pour debug
      pagination: {
        page,
        limit,
        totalRecords,
        totalPages,
        hasNextPage: startIndex + limit < totalRecords,
        hasPrevPage: page > 1,
      },
      _queryTime: `${Date.now() - startTime}ms`,
      commandes: paginated,
    });
  } catch (error) {
    console.error("Erreur contrôle commandes:", error);
    res.status(500);
    throw new Error(
      `Erreur lors de la lecture des commandes à contrôler: ${error.message}`,
    );
  }
});

/**
 * @desc    Détails (lignes) d'une commande, chargés à la demande.
 *          Commentaires (NART contient "!") affichés EN TÊTE, puis articles
 *          triés par NL croissant.
 * @route   GET /api/controle-commandes/a-controler/:nomDossierDBF/:numcde/details
 * @access  Private (module ctr_commande, read)
 */
const getDetailsCommande = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { numcde } = req.params;
  const startTime = Date.now();

  const check = checkCommandeFiles(entreprise);
  if (!check.exists) {
    res.status(404);
    throw new Error(check.error);
  }

  try {
    // Entête (contexte) — null si NUMCDE inconnu
    const entete = await commandeCacheService.findByNumcde(entreprise, numcde);

    // Lignes de détail (déjà triées par NL asc par le service)
    const lignesBrutes = await commandeCacheService.getDetailsByNumcde(
      entreprise,
      numcde,
    );

    const commentaires = [];
    const articles = [];

    for (const ligne of lignesBrutes) {
      const isComment = estCommentaire(ligne);
      const formatted = {
        NL: ligne.NL,
        NART: safeTrim(ligne.NART),
        DESIGN: safeTrim(ligne.DESIGN),
        REFER: safeTrim(ligne.REFER),
        isCommentaire: isComment,
      };
      if (isComment) {
        commentaires.push(formatted);
      } else {
        articles.push(formatted);
      }
    }

    // Sécurité : articles triés par NL croissant
    articles.sort((a, b) => (parseFloat(a.NL) || 0) - (parseFloat(b.NL) || 0));

    // Commentaires en tête, puis articles
    const lignes = [...commentaires, ...articles];

    res.json({
      entreprise: formatEntreprise(entreprise),
      numcde: safeTrim(numcde),
      entete: entete || null,
      totalLignes: lignes.length,
      totalArticles: articles.length,
      totalCommentaires: commentaires.length,
      _queryTime: `${Date.now() - startTime}ms`,
      lignes,
    });
  } catch (error) {
    console.error("Erreur détails commande à contrôler:", error);
    res.status(500);
    throw new Error(`Erreur lors de la lecture des détails: ${error.message}`);
  }
});

// ===========================================
// WORKFLOW DE CONTRÔLE (sessions persistées en Mongo)
// ===========================================

/**
 * @desc    Créer (ou reprendre) une session de contrôle pour une commande
 * @route   POST /api/controle-commandes
 * @body    { entrepriseId, numcde }
 * @access  Private (module ctr_commande, write)
 */
const createControleCommande = asyncHandler(async (req, res) => {
  const { entrepriseId, numcde } = req.body;

  if (!numcde || !numcde.trim()) {
    res.status(400);
    throw new Error("Le numéro de commande (numcde) est requis");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  const numcdeTrim = numcde.trim();

  // Vérifier que les fichiers DBF existent
  const checkFiles = checkCommandeFiles(entreprise);
  if (!checkFiles.exists) {
    res.status(404);
    throw new Error(checkFiles.error);
  }

  // Vérifier que la commande existe (cmdref) et récupérer le snapshot d'entête
  const entete = await commandeCacheService.findByNumcde(
    entreprise,
    numcdeTrim,
  );
  if (!entete) {
    res.status(404);
    throw new Error(`Commande ${numcdeTrim} non trouvée`);
  }

  // Reprendre la session en cours si elle existe déjà (même user/entreprise/numcde)
  const controleEnCours = await ControleCommande.findOne({
    entreprise: entrepriseId,
    user: req.user._id,
    numcde: numcdeTrim,
    status: "en_cours",
  });

  if (controleEnCours) {
    return res.json(controleEnCours);
  }

  const commandeInfo = {
    fourn:
      entete.FOURN !== undefined && entete.FOURN !== null ? entete.FOURN : null,
    bateau: safeTrim(entete.BATEAU),
    datcde: entete.DATCDE instanceof Date ? entete.DATCDE : null,
    observ: safeTrim(entete.OBSERV),
  };

  const controle = await ControleCommande.create({
    entreprise: entrepriseId,
    nomDossierDBF: entreprise.nomDossierDBF,
    user: req.user._id,
    numcde: numcdeTrim,
    commandeInfo,
    lignes: [],
  });

  // Précharger le cache des articles pour cette entreprise (arrière-plan)
  articleCacheService.preload(entreprise).catch((err) => {
    console.error("Erreur préchargement cache:", err);
  });

  res.status(201).json(controle);
});

/**
 * @desc    Toutes les sessions de contrôle EN COURS pour une entreprise (user courant)
 * @route   GET /api/controle-commandes/en-cours/:entrepriseId
 * @access  Private (module ctr_commande, read)
 */
const getControlesEnCoursParEntreprise = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;

  const controles = await ControleCommande.find({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  })
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .sort({ updatedAt: -1 });

  res.json(controles);
});

/**
 * @desc    Session de contrôle EN COURS pour une commande précise (user courant)
 * @route   GET /api/controle-commandes/en-cours/:entrepriseId/:numcde
 * @access  Private (module ctr_commande, read)
 */
const getControleEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId, numcde } = req.params;

  const controle = await ControleCommande.findOne({
    entreprise: entrepriseId,
    user: req.user._id,
    numcde: numcde.trim(),
    status: "en_cours",
  }).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire cheminBase mappingEntrepots",
  );

  // Précharger le cache en arrière-plan si une session existe
  if (controle?.entreprise) {
    articleCacheService.preload(controle.entreprise).catch((err) => {
      console.error("Erreur préchargement cache:", err);
    });
  }

  res.json(controle);
});

/**
 * @desc    Scanner un article pour un contrôle — affiche infos et stocks
 *          (identique au scan réappro : suit la chaîne de renvois GENDOUBL)
 * @route   POST /api/controle-commandes/:id/scan
 * @body    { code }
 * @access  Private (module ctr_commande, write)
 */
const scanArticleControle = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const startTime = Date.now();

  const controle = await ControleCommande.findById(req.params.id);
  if (!controle) {
    res.status(404);
    throw new Error("Contrôle non trouvé");
  }

  if (controle.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce contrôle est déjà terminé");
  }

  const entreprise = await Entreprise.findById(controle.entreprise);
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
    controleId: controle._id,
    articleInfo,
    _queryTime: `${queryTime}ms`,
  });
});

/**
 * @desc    Ajouter une ligne au contrôle (après confirmation de l'opérateur)
 * @route   POST /api/controle-commandes/:id/lignes
 * @access  Private (module ctr_commande, write)
 */
const addLigneControle = asyncHandler(async (req, res) => {
  const { nart, gencod, designation, refer, quantite, stocks, isUnknown } =
    req.body;

  const controle = await ControleCommande.findById(req.params.id);
  if (!controle) {
    res.status(404);
    throw new Error("Contrôle non trouvé");
  }

  if (controle.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce contrôle est déjà terminé");
  }

  // Vérifier si l'article existe déjà dans le contrôle
  const ligneExistante = controle.lignes.find(
    (l) => l.nart === nart || (gencod && l.gencod === gencod),
  );

  if (ligneExistante) {
    // Ajouter la quantité à la ligne existante
    ligneExistante.quantite += parseInt(quantite);
    ligneExistante.scannedAt = new Date();
  } else {
    // Créer une nouvelle ligne
    controle.lignes.push({
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
    });
  }

  controle.calculerTotaux();
  await controle.save();

  res.json(controle);
});

/**
 * @desc    Modifier la quantité d'une ligne du contrôle
 * @route   PUT /api/controle-commandes/:id/lignes/:ligneId
 * @access  Private (module ctr_commande, write)
 */
const updateLigneControle = asyncHandler(async (req, res) => {
  const { quantite } = req.body;
  const { id, ligneId } = req.params;

  const controle = await ControleCommande.findById(id);
  if (!controle) {
    res.status(404);
    throw new Error("Contrôle non trouvé");
  }

  if (controle.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce contrôle est déjà terminé");
  }

  const ligne = controle.lignes.id(ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  ligne.quantite = parseInt(quantite);
  controle.calculerTotaux();
  await controle.save();

  res.json(controle);
});

/**
 * @desc    Supprimer une ligne du contrôle
 * @route   DELETE /api/controle-commandes/:id/lignes/:ligneId
 * @access  Private (module ctr_commande, delete)
 */
const deleteLigneControle = asyncHandler(async (req, res) => {
  const { id, ligneId } = req.params;

  const controle = await ControleCommande.findById(id);
  if (!controle) {
    res.status(404);
    throw new Error("Contrôle non trouvé");
  }

  if (controle.status !== "en_cours") {
    res.status(400);
    throw new Error("Ce contrôle est déjà terminé");
  }

  controle.lignes.pull(ligneId);
  controle.calculerTotaux();
  await controle.save();

  res.json(controle);
});

/**
 * @desc    Télécharger le fichier de contrôle (sur le poste)
 *          Format et structure identiques à reapro ; nom "stock.dat controle {nom}"
 * @route   POST /api/controle-commandes/:id/download
 * @body    { nomControle }
 * @access  Private (module ctr_commande, write)
 */
const downloadControleCommande = asyncHandler(async (req, res) => {
  const { nomControle } = req.body;

  if (!nomControle || !nomControle.trim()) {
    res.status(400);
    throw new Error("Le nom du contrôle est requis");
  }

  const controle = await ControleCommande.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet",
  );

  if (!controle) {
    res.status(404);
    throw new Error("Contrôle non trouvé");
  }

  if (controle.lignes.length === 0) {
    res.status(400);
    throw new Error("Le contrôle est vide");
  }

  // Générer le contenu (format identique reapro)
  const contenu = genererContenuFichier(controle.lignes);

  // Nom du fichier : "stock.dat controle nom_controle"
  const nomFichier = `stock.dat controle ${nomControle
    .trim()
    .replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

  // Mettre à jour la session
  controle.nom = nomControle.trim();
  controle.status = "exporte";
  controle.fichierExport = nomFichier;
  controle.exportedAt = new Date();
  controle.modeExport = "telechargement";
  await controle.save();

  // Envoyer le fichier
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}"`);
  res.send(contenu);
});

/**
 * @desc    Exporter le contrôle sur serveur (même emplacement que reapro)
 * @route   POST /api/controle-commandes/:id/export
 * @body    { nomControle, cheminDestination? }
 * @access  Private (module ctr_commande, write)
 */
const exportControleCommande = asyncHandler(async (req, res) => {
  const { nomControle, cheminDestination } = req.body;

  if (!nomControle || !nomControle.trim()) {
    res.status(400);
    throw new Error("Le nom du contrôle est requis");
  }

  const controle = await ControleCommande.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire",
  );

  if (!controle) {
    res.status(404);
    throw new Error("Contrôle non trouvé");
  }

  if (controle.lignes.length === 0) {
    res.status(400);
    throw new Error("Le contrôle est vide");
  }

  // Générer le contenu (format identique reapro)
  const contenu = genererContenuFichier(controle.lignes);

  // Nom du fichier : "stock.dat controle nom_controle"
  const nomFichier = `stock.dat controle ${nomControle
    .trim()
    .replace(/[^a-zA-Z0-9_\- ]/g, "_")}`;

  // Chemin de destination : celui fourni ou celui de l'entreprise par défaut
  // (même emplacement que reapro : cheminExportInventaire)
  let cheminExport = cheminDestination?.trim();
  if (!cheminExport) {
    cheminExport =
      controle.entreprise.cheminExportInventaire ||
      process.env.RCOMMON_COLLECT_PATH ||
      "/mnt/rcommun/STOCK/collect_sec";
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

  // Mettre à jour la session
  controle.nom = nomControle.trim();
  controle.status = "exporte";
  controle.fichierExport = nomFichier;
  controle.cheminExport = cheminFichier;
  controle.exportedAt = new Date();
  controle.modeExport = "serveur";
  await controle.save();

  res.json({
    message: "Contrôle exporté avec succès",
    controle,
    fichier: {
      nom: nomFichier,
      chemin: cheminFichier,
      lignes: controle.lignes.length,
      totalQuantite: controle.totalQuantite,
    },
  });
});

/**
 * @desc    Annuler/Supprimer une session de contrôle
 * @route   DELETE /api/controle-commandes/:id
 * @access  Private (module ctr_commande, delete)
 */
const deleteControleCommande = asyncHandler(async (req, res) => {
  const controle = await ControleCommande.findById(req.params.id);

  if (!controle) {
    res.status(404);
    throw new Error("Contrôle non trouvé");
  }

  if (controle.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  await ControleCommande.deleteOne({ _id: controle._id });

  res.json({ message: "Contrôle supprimé" });
});

/**
 * @desc    Historique des contrôles de l'utilisateur
 * @route   GET /api/controle-commandes/historique
 * @query   entrepriseId?, numcde?
 * @access  Private (module ctr_commande, read)
 */
const getHistoriqueControle = asyncHandler(async (req, res) => {
  const { entrepriseId, numcde } = req.query;

  const query = { user: req.user._id };
  if (entrepriseId) {
    query.entreprise = entrepriseId;
  }
  if (numcde) {
    query.numcde = numcde.trim();
  }

  const controles = await ControleCommande.find(query)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .sort({ createdAt: -1 })
    .limit(50);

  res.json(controles);
});

/**
 * @desc    Obtenir une session de contrôle par ID
 * @route   GET /api/controle-commandes/:id
 * @access  Private (module ctr_commande, read)
 */
const getControleById = asyncHandler(async (req, res) => {
  const controle = await ControleCommande.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire mappingEntrepots",
  );

  if (!controle) {
    res.status(404);
    throw new Error("Contrôle non trouvé");
  }

  // Vérifier que l'utilisateur a accès
  if (
    controle.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  res.json(controle);
});

export {
  // Lecture (commandes à contrôler depuis les DBF)
  getCommandesAControler,
  getDetailsCommande,
  // Workflow de contrôle (sessions persistées)
  createControleCommande,
  getControlesEnCoursParEntreprise,
  getControleEnCours,
  getControleById,
  scanArticleControle,
  addLigneControle,
  updateLigneControle,
  deleteLigneControle,
  exportControleCommande,
  downloadControleCommande,
  deleteControleCommande,
  getHistoriqueControle,
};