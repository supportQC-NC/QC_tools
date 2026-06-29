// backend/controllers/photoController.js
import asyncHandler from "../middleware/asyncHandler.js";
import path from "path";
import fs from "fs";
import Entreprise from "../models/EntrepriseModel.js";

/**
 * Extensions d'images supportées (ordre de priorité)
 */
const SUPPORTED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];

/**
 * Mapping prod : trigramme -> sous-dossier photos local (sous PHOTOS_BASE_PATH).
 * En prod, les photos sont synchronisées localement sur le VPS :
 *   \\192.168.0.250\Rcommun\STOCK\photos    -> <PHOTOS_BASE_PATH>/photos    (QC)
 *   \\192.168.0.250\Rcommun\STOCK\photo_LD  -> <PHOTOS_BASE_PATH>/photo_LD  (LD)
 * Ajouter ici toute nouvelle entité disposant de photos.
 */
const PHOTOS_DOSSIER_PAR_TRIGRAMME = {
  QC: "photos",
  LD: "photo_LD",
};

/**
 * Récupère le chemin photos pour une entreprise.
 * - En prod (PHOTOS_BASE_PATH défini) : <PHOTOS_BASE_PATH>/<dossier> selon le
 *   trigramme (mapping ci-dessus). Indépendant de la valeur en base.
 * - En dev (PHOTOS_BASE_PATH non défini) : valeur cheminPhotos stockée en base.
 * @param {string} trigramme - Trigramme de l'entreprise
 * @returns {Promise<string|null>} - Chemin photos ou null
 */
const getPhotoPathForEntreprise = async (trigramme) => {
  const trig = String(trigramme || "").toUpperCase();

  // Prod : chemin local piloté par PHOTOS_BASE_PATH + mapping par trigramme
  const photosBase = process.env.PHOTOS_BASE_PATH;
  if (photosBase) {
    const dossier = PHOTOS_DOSSIER_PAR_TRIGRAMME[trig];
    if (!dossier) {
      // Pas de photos configurées pour cette entité
      return null;
    }
    return path.join(photosBase, dossier);
  }

  // Dev : on lit la valeur stockée en base (comportement d'origine)
  const entreprise = await Entreprise.findOne({
    trigramme: trig,
    isActive: true,
  });

  if (!entreprise || !entreprise.cheminPhotos) {
    return null;
  }

  return entreprise.cheminPhotos;
};

/**
 * Cherche un fichier photo avec différentes extensions et casses
 * @param {string} basePath - Chemin de base
 * @param {string} nartClean - Code article nettoyé
 * @returns {object|null} - { photoPath, extension } ou null
 */
const findPhotoFile = (basePath, nartClean) => {
  for (const ext of SUPPORTED_EXTENSIONS) {
    // Essayer le nom tel quel
    const testPath = path.join(basePath, `${nartClean}.${ext}`);
    if (fs.existsSync(testPath)) {
      return { photoPath: testPath, extension: ext };
    }

    // Essayer en majuscules
    const testPathUpper = path.join(
      basePath,
      `${nartClean.toUpperCase()}.${ext}`,
    );
    if (fs.existsSync(testPathUpper)) {
      return { photoPath: testPathUpper, extension: ext };
    }

    // Essayer avec extension en majuscules
    const testPathExtUpper = path.join(
      basePath,
      `${nartClean}.${ext.toUpperCase()}`,
    );
    if (fs.existsSync(testPathExtUpper)) {
      return { photoPath: testPathExtUpper, extension: ext };
    }

    // Essayer tout en majuscules
    const testPathAllUpper = path.join(
      basePath,
      `${nartClean.toUpperCase()}.${ext.toUpperCase()}`,
    );
    if (fs.existsSync(testPathAllUpper)) {
      return { photoPath: testPathAllUpper, extension: ext };
    }
  }

  return null;
};

/**
 * @desc    Obtenir la photo d'un article
 * @route   GET /api/photos/:trigramme/:nart
 * @access  Private
 */
const getArticlePhoto = asyncHandler(async (req, res) => {
  const { trigramme, nart } = req.params;

  // Récupérer le chemin photos depuis la BDD
  const basePath = await getPhotoPathForEntreprise(trigramme);

  if (!basePath) {
    res.status(404);
    throw new Error(
      `Pas de configuration photo pour l'entreprise ${trigramme}. Configurez le chemin photos dans l'administration.`,
    );
  }

  // Vérifier que le dossier existe
  if (!fs.existsSync(basePath)) {
    res.status(404);
    throw new Error(
      `Le dossier photos n'existe pas ou n'est pas accessible: ${basePath}`,
    );
  }

  // Nettoyer le code article
  const nartClean = nart.trim().replace(/[^a-zA-Z0-9_\-]/g, "");

  // Chercher le fichier photo
  const photoResult = findPhotoFile(basePath, nartClean);

  if (!photoResult) {
    res.status(404);
    throw new Error(`Photo non trouvée pour l'article ${nart}`);
  }

  const { photoPath, extension } = photoResult;

  // Déterminer le type MIME
  const mimeTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
  };

  const mimeType = mimeTypes[extension.toLowerCase()] || "image/jpeg";

  // Obtenir les stats du fichier pour le cache
  const stats = fs.statSync(photoPath);
  const lastModified = stats.mtime.toUTCString();
  const etag = `"${stats.size}-${stats.mtime.getTime()}"`;

  // Vérifier le cache côté client
  const ifNoneMatch = req.headers["if-none-match"];
  const ifModifiedSince = req.headers["if-modified-since"];

  if (ifNoneMatch === etag || ifModifiedSince === lastModified) {
    return res.status(304).end();
  }

  // Headers de cache
  res.setHeader("Content-Type", mimeType);
  res.setHeader("Cache-Control", "public, max-age=3600"); // Cache 1 heure
  res.setHeader("Last-Modified", lastModified);
  res.setHeader("ETag", etag);

  // Envoyer le fichier
  const stream = fs.createReadStream(photoPath);
  stream.pipe(res);
});

/**
 * @desc    Vérifier si une photo existe
 * @route   HEAD /api/photos/:trigramme/:nart
 * @access  Private
 */
const checkPhotoExists = asyncHandler(async (req, res) => {
  const { trigramme, nart } = req.params;

  // Récupérer le chemin photos depuis la BDD
  const basePath = await getPhotoPathForEntreprise(trigramme);

  if (!basePath || !fs.existsSync(basePath)) {
    return res.status(404).end();
  }

  const nartClean = nart.trim().replace(/[^a-zA-Z0-9_\-]/g, "");

  const photoResult = findPhotoFile(basePath, nartClean);

  if (photoResult) {
    return res.status(200).end();
  }

  res.status(404).end();
});

export { getArticlePhoto, checkPhotoExists };