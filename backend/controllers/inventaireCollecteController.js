// backend/controllers/inventaireCollecteController.js
import asyncHandler from "../middleware/asyncHandler.js";
import InventaireCollecte from "../models/InventaireCollecteModel.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import Zone from "../models/ZoneModel.js";
import articleCacheService from "../services/articleService.js";
import path from "path";
import fs from "fs";

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ===========================================
// GÉNÉRATION DU FICHIER .DAT
// ===========================================
// Format IDENTIQUE à celui des réappros / inventaires :
//   CODE(13, justifié à gauche, complété par des espaces) | QTE(8, zéros à gauche) | 000
//   fin de ligne CRLF (\r\n)
// Le CODE écrit est le GENCOD (code-barres) si l'article en a un, sinon le NART.
// Un NART de 6 caractères (ex. "550460") est donc bien suivi de 7 espaces.
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

// Nom de fichier déposé : "stock.dat <codeZone>" (reconnu par le watcher).
const nomFichierZone = (zoneCode) =>
  `stock.dat ${String(zoneCode).trim().replace(/[\\/:*?"<>|]/g, "_")}`;

/**
 * Détermine le dossier de dépôt du .DAT :
 *  - en prod (RCOMMON_COLLECT_PATH défini), le montage prime : on ignore le
 *    dossierDat de session s'il est en chemin Windows (\\...), car les "\"
 *    cassent l'écriture sous Linux. Dépôt dans "<parent>/inventaire_<annee>".
 *  - en dev (env non défini) : si une session est active → son dossierDat,
 *    sinon repli sur "<parent de cheminExportInventaire>/inventaire_<annee>".
 * Crée le dossier si nécessaire.
 */
const resoudreDossierDepot = async (entreprise) => {
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  const collectEnv = process.env.RCOMMON_COLLECT_PATH;

  // En dev uniquement : le dossier de session (chemin Windows) reste prioritaire.
  if (
    !collectEnv &&
    session &&
    session.dossierDat &&
    session.dossierDat.trim()
  ) {
    return {
      dossier: session.dossierDat.trim(),
      mode: "session",
      session,
    };
  }

  // Repli : dossier "inventaire_<annee>" au même niveau que l'export réappro.
  // En prod, base = RCOMMON_COLLECT_PATH (le montage), donc le dépôt est
  // "<parent>/inventaire_<annee>" sous /mnt/rcommun/STOCK.
  const base =
    collectEnv ||
    entreprise.cheminExportInventaire ||
    "/mnt/rcommun/STOCK/collect_sec";
  const annee = new Date().getFullYear();
  const dossier = path.join(path.dirname(base), `inventaire_${annee}`);

  return { dossier, mode: "annee", session: session || null };
};

/**
 * Suit la chaîne de renvois GENDOUBL via le cache (recherches O(1)).
 * Identique à la logique réappro / inventaire.
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

// Résumé léger d'une collecte (pour les listes de reprise)
const collecteResume = (c) => ({
  _id: c._id,
  zoneCode: c.zoneCode,
  zoneLibelle: c.zoneLibelle,
  zoneType: c.zoneType,
  status: c.status,
  totalArticles: c.totalArticles,
  totalQuantite: c.totalQuantite,
  updatedAt: c.updatedAt,
});

// ===========================================
// RÉSOLUTION D'UNE ZONE PAR EAN PRINCIPAL
// ===========================================
/**
 * @desc    Identifier une zone à partir d'un code-barres bipé (EAN principal)
 * @route   POST /api/inventaires-collecte/resoudre-zone
 * @access  Private
 * @body    { entrepriseId, code }
 */
const resoudreZone = asyncHandler(async (req, res) => {
  const { entrepriseId, code } = req.body;

  const c = String(code || "").trim();
  if (!c) {
    res.status(400);
    throw new Error("Code-barres requis");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  // Recherche prioritaire par EAN principal, puis repli sur les autres EAN
  // (bipage / papillonnage / contrôle) pour rester tolérant à un mauvais bip.
  const rx = new RegExp(`^${escapeRegex(c)}$`);
  let zone = await Zone.findOne({
    entreprise: entreprise._id,
    eanPrincipal: rx,
  });

  let viaEan = "principal";
  if (!zone) {
    zone = await Zone.findOne({
      entreprise: entreprise._id,
      $or: [
        { eanBipage: rx },
        { eanPapillonnage: rx },
        { eanControle: rx },
      ],
    });
    if (zone) {
      viaEan =
        zone.eanBipage?.trim() === c
          ? "bipage"
          : zone.eanPapillonnage?.trim() === c
            ? "papillonnage"
            : "controle";
    }
  }

  if (!zone) {
    return res.json({
      found: false,
      message: "Aucune zone ne correspond à ce code",
    });
  }

  // Une collecte est-elle déjà en cours pour cette zone et cet agent ?
  const enCours = await InventaireCollecte.findOne({
    entreprise: entreprise._id,
    user: req.user._id,
    zoneCode: zone.code,
    status: "en_cours",
  });

  res.json({
    found: true,
    viaEan,
    zone: {
      code: zone.code,
      libelle: zone.libelle,
      type: zone.type,
      eanPrincipal: zone.eanPrincipal,
    },
    enCours: enCours ? collecteResume(enCours) : null,
  });
});

// ===========================================
// CRÉER / REPRENDRE UNE COLLECTE
// ===========================================
/**
 * @desc    Démarrer (ou reprendre) la collecte d'une zone
 * @route   POST /api/inventaires-collecte
 * @access  Private
 * @body    { entrepriseId, zoneCode }
 */
const createCollecte = asyncHandler(async (req, res) => {
  const { entrepriseId, zoneCode } = req.body;

  if (!zoneCode || !String(zoneCode).trim()) {
    res.status(400);
    throw new Error("Code zone requis");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  const zone = await Zone.findOne({
    entreprise: entreprise._id,
    code: String(zoneCode).trim(),
  });
  if (!zone) {
    res.status(404);
    throw new Error("Zone non trouvée");
  }

  // Reprise si une collecte est déjà en cours pour cette zone
  const enCours = await InventaireCollecte.findOne({
    entreprise: entreprise._id,
    user: req.user._id,
    zoneCode: zone.code,
    status: "en_cours",
  });
  if (enCours) {
    articleCacheService.preload(entreprise).catch(() => {});
    return res.json(enCours);
  }

  // Session active éventuelle (pour mémoriser le dossier de dépôt)
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  const collecte = await InventaireCollecte.create({
    entreprise: entreprise._id,
    nomDossierDBF: entreprise.nomDossierDBF,
    user: req.user._id,
    session: session ? session._id : null,
    sessionNom: session ? session.nom : "",
    zoneCode: zone.code,
    zoneLibelle: zone.libelle,
    zoneType: zone.type,
    eanPrincipal: zone.eanPrincipal,
    lignes: [],
  });

  // Préchargement du cache article en arrière-plan
  articleCacheService.preload(entreprise).catch((err) => {
    console.error("Erreur préchargement cache:", err);
  });

  res.status(201).json(collecte);
});

// ===========================================
// LISTE DES COLLECTES EN COURS (reprise)
// ===========================================
/**
 * @desc    Zones en cours de collecte pour l'agent (pour reprise)
 * @route   GET /api/inventaires-collecte/en-cours/:entrepriseId
 * @access  Private
 */
const getCollectesEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;

  const collectes = await InventaireCollecte.find({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  }).sort({ updatedAt: -1 });

  res.json(collectes.map(collecteResume));
});

/**
 * @desc    Obtenir une collecte par ID
 * @route   GET /api/inventaires-collecte/:id
 * @access  Private
 */
const getCollecteById = asyncHandler(async (req, res) => {
  const collecte = await InventaireCollecte.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire cheminBase",
  );

  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (
    collecte.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  res.json(collecte);
});

// ===========================================
// SCAN D'UN ARTICLE
// ===========================================
/**
 * @desc    Scanner un article (résout l'article + chaîne de renvois)
 * @route   POST /api/inventaires-collecte/:id/scan
 * @access  Private
 * @body    { code }
 */
const scanArticleCollecte = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const startTime = Date.now();

  const collecte = await InventaireCollecte.findById(req.params.id);
  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.status !== "en_cours") {
    res.status(400);
    throw new Error("Cette zone est déjà déposée");
  }

  const entreprise = await Entreprise.findById(collecte.entreprise);
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

  res.json({
    collecteId: collecte._id,
    articleInfo,
    _queryTime: `${Date.now() - startTime}ms`,
  });
});

// ===========================================
// LIGNES
// ===========================================
/**
 * @desc    Ajouter une ligne (après saisie de la quantité)
 * @route   POST /api/inventaires-collecte/:id/lignes
 * @access  Private
 */
const addLigneCollecte = asyncHandler(async (req, res) => {
  const {
    nart,
    gencod,
    designation,
    quantite,
    isUnknown,
    isRenvoi,
    articleOriginal,
  } = req.body;

  const collecte = await InventaireCollecte.findById(req.params.id);
  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.status !== "en_cours") {
    res.status(400);
    throw new Error("Cette zone est déjà déposée");
  }

  // Cumul si l'article est déjà présent dans la zone
  const ligneExistante = collecte.lignes.find(
    (l) => l.nart === nart || (gencod && l.gencod === gencod),
  );

  if (ligneExistante) {
    ligneExistante.quantite += parseInt(quantite, 10);
    ligneExistante.scannedAt = new Date();
  } else {
    collecte.lignes.push({
      nart,
      gencod: gencod || "",
      designation: designation || "",
      quantite: parseInt(quantite, 10),
      isUnknown: isUnknown || false,
      isRenvoi: isRenvoi || false,
      articleOriginal: articleOriginal || null,
    });
  }

  collecte.calculerTotaux();
  await collecte.save();

  res.json(collecte);
});

/**
 * @desc    Modifier la quantité d'une ligne
 * @route   PUT /api/inventaires-collecte/:id/lignes/:ligneId
 * @access  Private
 */
const updateLigneCollecte = asyncHandler(async (req, res) => {
  const { quantite } = req.body;
  const { id, ligneId } = req.params;

  const collecte = await InventaireCollecte.findById(id);
  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.status !== "en_cours") {
    res.status(400);
    throw new Error("Cette zone est déjà déposée");
  }

  const ligne = collecte.lignes.id(ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  ligne.quantite = parseInt(quantite, 10);
  collecte.calculerTotaux();
  await collecte.save();

  res.json(collecte);
});

/**
 * @desc    Supprimer une ligne
 * @route   DELETE /api/inventaires-collecte/:id/lignes/:ligneId
 * @access  Private
 */
const deleteLigneCollecte = asyncHandler(async (req, res) => {
  const { id, ligneId } = req.params;

  const collecte = await InventaireCollecte.findById(id);
  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.status !== "en_cours") {
    res.status(400);
    throw new Error("Cette zone est déjà déposée");
  }

  collecte.lignes.pull(ligneId);
  collecte.calculerTotaux();
  await collecte.save();

  res.json(collecte);
});

// ===========================================
// DÉPÔT DU FICHIER .DAT
// ===========================================
/**
 * @desc    Valider la zone : écrire "stock.dat <codeZone>" dans le dossier de dépôt
 * @route   POST /api/inventaires-collecte/:id/export
 * @access  Private
 */
const exportCollecte = asyncHandler(async (req, res) => {
  const collecte = await InventaireCollecte.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire",
  );

  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.status !== "en_cours") {
    res.status(400);
    throw new Error("Cette zone est déjà déposée");
  }
  if (collecte.lignes.length === 0) {
    res.status(400);
    throw new Error("La zone est vide");
  }

  const contenu = genererContenuFichier(collecte.lignes);
  const nomFichier = nomFichierZone(collecte.zoneCode);

  // Dossier de dépôt (en prod : montage ; en dev : session active sinon repli)
  const { dossier, mode, session } = await resoudreDossierDepot(
    collecte.entreprise,
  );

  try {
    if (!fs.existsSync(dossier)) {
      fs.mkdirSync(dossier, { recursive: true });
    }
  } catch (error) {
    res.status(400);
    throw new Error(
      `Impossible d'accéder au dossier de dépôt : ${dossier}. Vérifiez les droits d'accès. (${error.message})`,
    );
  }

  const cheminFichier = path.join(dossier, nomFichier);

  try {
    fs.writeFileSync(cheminFichier, contenu, "utf8");
  } catch (error) {
    res.status(400);
    throw new Error(`Impossible d'écrire le fichier : ${error.message}`);
  }

  collecte.status = "exporte";
  collecte.fichierExport = nomFichier;
  collecte.cheminExport = cheminFichier;
  collecte.modeExport = mode;
  collecte.exportedAt = new Date();
  if (session) {
    collecte.session = session._id;
    collecte.sessionNom = session.nom;
  }
  await collecte.save();

  res.json({
    message: "Zone déposée avec succès",
    collecte: collecteResume(collecte),
    fichier: {
      nom: nomFichier,
      chemin: cheminFichier,
      dossier,
      mode, // "session" (impression auto) ou "annee" (repli)
      sessionNom: session ? session.nom : "",
      lignes: collecte.lignes.length,
      totalQuantite: collecte.totalQuantite,
    },
  });
});

// ===========================================
// ANNULER UNE COLLECTE
// ===========================================
/**
 * @desc    Annuler/Supprimer une collecte en cours
 * @route   DELETE /api/inventaires-collecte/:id
 * @access  Private
 */
const deleteCollecte = asyncHandler(async (req, res) => {
  const collecte = await InventaireCollecte.findById(req.params.id);
  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  await InventaireCollecte.deleteOne({ _id: collecte._id });
  res.json({ message: "Collecte supprimée" });
});

export {
  resoudreZone,
  createCollecte,
  getCollectesEnCours,
  getCollecteById,
  scanArticleCollecte,
  addLigneCollecte,
  updateLigneCollecte,
  deleteLigneCollecte,
  exportCollecte,
  deleteCollecte,
};