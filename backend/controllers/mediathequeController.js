// backend/controllers/mediathequeController.js
//
// Médiathèque : banque d'images / pages HTML en ligne pour les signatures mail.
// Upload vers GridFS (bucket "mediatheque"), liste, renommage, suppression,
// et SURTOUT la route publique qui sert le fichier sans authentification —
// les clients mail (Gmail, Outlook…) chargent les images d'une signature sans
// aucun cookie, le lien doit donc être ouvert.

import path from "path";
import asyncHandler from "../middleware/asyncHandler.js";
import MediaFichier from "../models/MediaFichierModel.js";
import {
  uploadBufferToGridFS,
  deleteFromGridFS,
  findGridFSFile,
  openDownloadStream,
} from "../utils/gridfsBucket.js";

const BUCKET = "mediatheque";

// Types acceptés : images web + HTML (signatures). L'extension publique est
// imposée depuis le MIME pour que l'URL reste cohérente avec le contenu servi.
const TYPES_ACCEPTES = {
  "image/png": { ext: ".png", type: "image" },
  "image/jpeg": { ext: ".jpg", type: "image" },
  "image/gif": { ext: ".gif", type: "image" },
  "image/webp": { ext: ".webp", type: "image" },
  "image/svg+xml": { ext: ".svg", type: "image" },
  "text/html": { ext: ".html", type: "html" },
};

// multer décode le nom de fichier multipart en latin1 : les accents ressortent
// cassés (« é » -> « Ã© »). On rétablit l'UTF-8 (même recette que les exécutables).
const decodeName = (name = "") => {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
};

// "Logo QC été.png" -> "logo-qc-ete" (sans accent, sans extension).
// NFD sépare les accents en diacritiques combinants (hors ASCII), que le
// filtre [^\x20-\x7e] élimine avant la mise en forme du slug.
const slugifierNom = (nom = "") =>
  nom
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "fichier";

// Slug unique : "logo-qc.png", puis "logo-qc-2.png", "logo-qc-3.png"…
const slugUnique = async (base, ext) => {
  let slug = `${base}${ext}`;
  let i = 2;
  while (await MediaFichier.exists({ slug })) {
    slug = `${base}-${i}${ext}`;
    i += 1;
  }
  return slug;
};

// Lien public (relatif) d'un média — le front le préfixe par son origine.
const urlPublique = (slug) => `/api/mediatheque/public/${slug}`;

const serialiser = (doc) => ({
  ...doc,
  url: urlPublique(doc.slug),
});

/**
 * @desc    Liste des médias (métadonnées + lien public)
 * @route   GET /api/mediatheque
 * @access  Private (module mediatheque, read)
 */
const getMedias = asyncHandler(async (req, res) => {
  const medias = await MediaFichier.find()
    .sort({ createdAt: -1 })
    .populate("createdBy", "nom prenom email")
    .lean();
  res.json(medias.map(serialiser));
});

/**
 * @desc    Mettre en ligne un ou plusieurs fichiers (images / HTML)
 * @route   POST /api/mediatheque
 * @access  Private (module mediatheque, write)
 *
 * multipart/form-data :
 *  - fichiers : 1..20 fichiers
 *  - noms     : JSON (tableau de noms alignés sur les fichiers, facultatif) —
 *               à défaut, le nom du fichier d'origine sans extension.
 */
const createMedias = asyncHandler(async (req, res) => {
  const fichiers = req.files || [];
  if (!fichiers.length) {
    res.status(400);
    throw new Error("Aucun fichier fourni");
  }

  let noms = [];
  try {
    noms = JSON.parse(req.body?.noms || "[]");
  } catch {
    noms = [];
  }

  // Tout valider AVANT d'écrire quoi que ce soit dans GridFS.
  for (const f of fichiers) {
    if (!TYPES_ACCEPTES[f.mimetype]) {
      res.status(400);
      throw new Error(
        `Type non accepté : « ${decodeName(f.originalname)} » (${f.mimetype}). ` +
          "Formats autorisés : PNG, JPEG, GIF, WebP, SVG et HTML.",
      );
    }
  }

  const uploadedIds = [];
  try {
    const crees = [];
    for (let i = 0; i < fichiers.length; i++) {
      const f = fichiers[i];
      const { ext, type } = TYPES_ACCEPTES[f.mimetype];
      const fileName = decodeName(f.originalname);
      const nom =
        (typeof noms[i] === "string" && noms[i].trim()) ||
        path.basename(fileName, path.extname(fileName)).trim() ||
        "Fichier";

      const slug = await slugUnique(slugifierNom(nom), ext);
      const fileId = await uploadBufferToGridFS(f.buffer, slug, f.mimetype, BUCKET);
      uploadedIds.push(fileId);

      const media = await MediaFichier.create({
        nom,
        slug,
        type,
        fileId,
        fileName,
        mimeType: f.mimetype,
        size: f.size || f.buffer.length || 0,
        createdBy: req.user?._id,
      });
      crees.push(serialiser(media.toObject()));
    }
    res.status(201).json(crees);
  } catch (err) {
    // Rollback des fichiers GridFS déjà écrits.
    await Promise.all(uploadedIds.map((id) => deleteFromGridFS(id, BUCKET)));
    throw err;
  }
});

/**
 * @desc    Renommer un média (nom d'affichage SEUL — le lien public ne bouge pas)
 * @route   PATCH /api/mediatheque/:id
 * @access  Private (module mediatheque, write)
 */
const updateMedia = asyncHandler(async (req, res) => {
  const media = await MediaFichier.findById(req.params.id);
  if (!media) {
    res.status(404);
    throw new Error("Fichier non trouvé");
  }

  const nom = (req.body?.nom || "").trim();
  if (!nom) {
    res.status(400);
    throw new Error("Le nom est requis");
  }

  media.nom = nom;
  const updated = await media.save();
  res.json(serialiser(updated.toObject()));
});

/**
 * @desc    Supprimer un média (le lien public cesse de fonctionner !)
 * @route   DELETE /api/mediatheque/:id
 * @access  Private (module mediatheque, delete)
 */
const deleteMedia = asyncHandler(async (req, res) => {
  const media = await MediaFichier.findById(req.params.id);
  if (!media) {
    res.status(404);
    throw new Error("Fichier non trouvé");
  }

  await deleteFromGridFS(media.fileId, BUCKET);
  await media.deleteOne();
  res.json({ message: "Fichier supprimé", _id: req.params.id });
});

/**
 * @desc    Servir un fichier par son slug — SANS authentification
 * @route   GET /api/mediatheque/public/:slug
 * @access  Public (les clients mail chargent les images sans cookie)
 */
const serveMediaPublic = asyncHandler(async (req, res) => {
  const media = await MediaFichier.findOne({
    slug: String(req.params.slug || "").toLowerCase(),
  }).lean();
  if (!media) {
    res.status(404);
    throw new Error("Fichier non trouvé");
  }

  const gridFile = await findGridFSFile(media.fileId, BUCKET);
  if (!gridFile) {
    res.status(404);
    throw new Error("Fichier introuvable dans GridFS");
  }

  res.setHeader("Content-Type", media.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (gridFile.length) res.setHeader("Content-Length", gridFile.length);

  if (media.type === "image" && media.mimeType !== "image/svg+xml") {
    // Image de signature : rechargée à chaque mail ouvert, on laisse cacher.
    res.setHeader("Cache-Control", "public, max-age=86400");
  } else {
    // HTML (et SVG, scriptable) servis sur l'origine de l'app : le sandbox CSP
    // isole la page (origine opaque, scripts bloqués) — un HTML déposé par un
    // utilisateur ne peut pas toucher au cookie de session. Les images et
    // styles d'une signature s'affichent normalement.
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("Cache-Control", "public, max-age=300");
  }

  const stream = openDownloadStream(media.fileId, BUCKET);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  stream.pipe(res);
});

export { getMedias, createMedias, updateMedia, deleteMedia, serveMediaPublic };
