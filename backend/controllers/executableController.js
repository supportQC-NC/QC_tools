// backend/controllers/executableController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Executable from "../models/ExecutableModel.js";
import {
  uploadBufferToGridFS,
  deleteFromGridFS,
  findGridFSFile,
  openDownloadStream,
} from "../utils/gridfsBucket.js";

// multer décode le nom de fichier multipart en latin1 : les accents et
// caractères spéciaux ressortent cassés (« é » -> « Ã© »). On rétablit l'UTF-8.
const decodeName = (name = "") => {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
};

// Détermine la catégorie d'un document depuis son type MIME.
const kindFromMime = (mime = "") => {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  return "autre";
};

// Envoie un buffer de document vers GridFS et renvoie l'objet attachment.
const storeDocument = async (file) => {
  const fileName = decodeName(file.originalname);
  const fileId = await uploadBufferToGridFS(
    file.buffer,
    fileName,
    file.mimetype,
  );
  return {
    fileId,
    fileName,
    mimeType: file.mimetype,
    size: file.size || file.buffer.length || 0,
    kind: kindFromMime(file.mimetype),
  };
};

/**
 * @desc    Liste des exécutables (métadonnées uniquement, sans binaires)
 * @route   GET /api/executables
 * @access  Private/Admin
 */
const getExecutables = asyncHandler(async (req, res) => {
  const executables = await Executable.find()
    .sort({ name: 1, createdAt: -1 })
    .populate("createdBy", "nom prenom email")
    .lean();
  res.json(executables);
});

/**
 * @desc    Créer un exécutable (nouvelle version = nouveau document)
 * @route   POST /api/executables
 * @access  Private/SuperAdmin
 *
 * multipart/form-data :
 *  - executable : le binaire (1 fichier, requis)
 *  - documents  : 0..n fichiers PDF/images
 *  - champs texte : name, version, description, githubLink
 */
const createExecutable = asyncHandler(async (req, res) => {
  const { name, version, description, githubLink } = req.body;
  const exeFile = req.files?.executable?.[0];
  const docFiles = req.files?.documents || [];

  if (!name || !version) {
    res.status(400);
    throw new Error("Le nom et la version sont requis");
  }
  if (!exeFile) {
    res.status(400);
    throw new Error("Le fichier exécutable est requis");
  }

  // Refuse une (nom, version) déjà existante (on ne veut pas écraser).
  const existing = await Executable.findOne({
    name: name.trim(),
    version: version.trim(),
  });
  if (existing) {
    res.status(409);
    throw new Error(
      `La version « ${version} » existe déjà pour « ${name} ». Utilisez une autre version.`,
    );
  }

  // Uploads GridFS : binaire puis documents. En cas d'échec, nettoyage.
  const uploadedIds = [];
  try {
    const exeFileName = decodeName(exeFile.originalname);
    const exeFileId = await uploadBufferToGridFS(
      exeFile.buffer,
      exeFileName,
      exeFile.mimetype || "application/octet-stream",
    );
    uploadedIds.push(exeFileId);

    const documents = [];
    for (const f of docFiles) {
      const doc = await storeDocument(f);
      uploadedIds.push(doc.fileId);
      documents.push(doc);
    }

    const executable = await Executable.create({
      name: name.trim(),
      version: version.trim(),
      description: (description || "").trim(),
      githubLink: (githubLink || "").trim(),
      fileId: exeFileId,
      fileName: exeFileName,
      mimeType: exeFile.mimetype || "application/octet-stream",
      size: exeFile.size || exeFile.buffer.length || 0,
      documents,
      createdBy: req.user?._id,
    });

    res.status(201).json(executable);
  } catch (err) {
    // Rollback des fichiers GridFS déjà écrits.
    await Promise.all(uploadedIds.map((id) => deleteFromGridFS(id)));
    if (err?.code === 11000) {
      res.status(409);
      throw new Error("Cette version existe déjà");
    }
    throw err;
  }
});

/**
 * @desc    Mettre à jour les métadonnées d'un exécutable
 * @route   PATCH /api/executables/:id
 * @access  Private/SuperAdmin
 */
const updateExecutable = asyncHandler(async (req, res) => {
  const executable = await Executable.findById(req.params.id);
  if (!executable) {
    res.status(404);
    throw new Error("Exécutable non trouvé");
  }

  const { name, version, description, githubLink } = req.body;
  if (name !== undefined) executable.name = name.trim();
  if (version !== undefined) executable.version = version.trim();
  if (description !== undefined) executable.description = description.trim();
  if (githubLink !== undefined) executable.githubLink = githubLink.trim();

  const updated = await executable.save();
  res.json(updated);
});

/**
 * @desc    Ajouter des documents (PDF/images) à un exécutable existant
 * @route   POST /api/executables/:id/documents
 * @access  Private/SuperAdmin
 */
const addDocuments = asyncHandler(async (req, res) => {
  const executable = await Executable.findById(req.params.id);
  if (!executable) {
    res.status(404);
    throw new Error("Exécutable non trouvé");
  }

  const docFiles = req.files || [];
  if (!docFiles.length) {
    res.status(400);
    throw new Error("Aucun document fourni");
  }

  for (const f of docFiles) {
    const doc = await storeDocument(f);
    executable.documents.push(doc);
  }

  const updated = await executable.save();
  res.json(updated);
});

/**
 * @desc    Supprimer un document d'un exécutable
 * @route   DELETE /api/executables/:id/documents/:docId
 * @access  Private/SuperAdmin
 */
const deleteDocument = asyncHandler(async (req, res) => {
  const executable = await Executable.findById(req.params.id);
  if (!executable) {
    res.status(404);
    throw new Error("Exécutable non trouvé");
  }

  const doc = executable.documents.id(req.params.docId);
  if (!doc) {
    res.status(404);
    throw new Error("Document non trouvé");
  }

  await deleteFromGridFS(doc.fileId);
  doc.deleteOne();
  const updated = await executable.save();
  res.json(updated);
});

/**
 * @desc    Supprimer un exécutable (et ses fichiers GridFS)
 * @route   DELETE /api/executables/:id
 * @access  Private/SuperAdmin
 */
const deleteExecutable = asyncHandler(async (req, res) => {
  const executable = await Executable.findById(req.params.id);
  if (!executable) {
    res.status(404);
    throw new Error("Exécutable non trouvé");
  }

  await deleteFromGridFS(executable.fileId);
  await Promise.all(
    (executable.documents || []).map((d) => deleteFromGridFS(d.fileId)),
  );
  await executable.deleteOne();

  res.json({ message: "Exécutable supprimé", _id: req.params.id });
});

/**
 * @desc    Télécharger le binaire d'un exécutable
 * @route   GET /api/executables/:id/download
 * @access  Private/Admin
 */
const downloadExecutable = asyncHandler(async (req, res) => {
  const executable = await Executable.findById(req.params.id).lean();
  if (!executable) {
    res.status(404);
    throw new Error("Exécutable non trouvé");
  }

  const gridFile = await findGridFSFile(executable.fileId);
  if (!gridFile) {
    res.status(404);
    throw new Error("Fichier binaire introuvable dans GridFS");
  }

  const safeName = encodeURIComponent(executable.fileName || "executable");
  res.setHeader("Content-Type", executable.mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`,
  );
  if (gridFile.length) res.setHeader("Content-Length", gridFile.length);

  const stream = openDownloadStream(executable.fileId);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  stream.pipe(res);
});

/**
 * @desc    Télécharger / afficher un document d'un exécutable
 * @route   GET /api/executables/:id/documents/:docId
 * @access  Private/Admin
 */
const downloadDocument = asyncHandler(async (req, res) => {
  const executable = await Executable.findById(req.params.id).lean();
  if (!executable) {
    res.status(404);
    throw new Error("Exécutable non trouvé");
  }

  const doc = (executable.documents || []).find(
    (d) => d._id.toString() === req.params.docId,
  );
  if (!doc) {
    res.status(404);
    throw new Error("Document non trouvé");
  }

  const gridFile = await findGridFSFile(doc.fileId);
  if (!gridFile) {
    res.status(404);
    throw new Error("Document introuvable dans GridFS");
  }

  const safeName = encodeURIComponent(doc.fileName || "document");
  // PDF/images : affichage inline dans le navigateur ; sinon téléchargement.
  const inline = doc.kind === "pdf" || doc.kind === "image";
  res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${safeName}`,
  );
  if (gridFile.length) res.setHeader("Content-Length", gridFile.length);

  const stream = openDownloadStream(doc.fileId);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  stream.pipe(res);
});

export {
  getExecutables,
  createExecutable,
  updateExecutable,
  addDocuments,
  deleteDocument,
  deleteExecutable,
  downloadExecutable,
  downloadDocument,
};
