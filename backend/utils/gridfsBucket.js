// backend/utils/gridfsBucket.js
//
// Helpers GridFS pour stocker des fichiers volumineux (exécutables, PDF, images)
// DANS MongoDB — au-delà de la limite de 16 Mo d'un document classique.
// On utilise le driver Mongo natif embarqué dans Mongoose (aucune dépendance
// supplémentaire). Le bucket est créé à la volée (la connexion doit être prête).

import mongoose from "mongoose";

const DEFAULT_BUCKET = "executables";

// Retourne un GridFSBucket sur la base courante.
export const getBucket = (bucketName = DEFAULT_BUCKET) => {
  const db = mongoose.connection?.db;
  if (!db) {
    throw new Error("Connexion MongoDB non initialisée (GridFS indisponible)");
  }
  return new mongoose.mongo.GridFSBucket(db, { bucketName });
};

// Écrit un Buffer dans GridFS et résout avec l'ObjectId du fichier créé.
export const uploadBufferToGridFS = (
  buffer,
  filename,
  contentType,
  bucketName = DEFAULT_BUCKET,
) =>
  new Promise((resolve, reject) => {
    const bucket = getBucket(bucketName);
    const stream = bucket.openUploadStream(filename, { contentType });
    stream.on("error", reject);
    stream.on("finish", () => resolve(stream.id));
    stream.end(buffer);
  });

// Supprime un fichier GridFS (silencieux s'il n'existe déjà plus).
export const deleteFromGridFS = async (fileId, bucketName = DEFAULT_BUCKET) => {
  if (!fileId) return;
  const bucket = getBucket(bucketName);
  try {
    await bucket.delete(new mongoose.Types.ObjectId(fileId));
  } catch {
    // fichier déjà absent : on ignore
  }
};

// Vérifie qu'un fichier existe et renvoie ses métadonnées GridFS (ou null).
export const findGridFSFile = async (fileId, bucketName = DEFAULT_BUCKET) => {
  const bucket = getBucket(bucketName);
  const _id = new mongoose.Types.ObjectId(fileId);
  const files = await bucket.find({ _id }).toArray();
  return files[0] || null;
};

// Ouvre un flux de lecture GridFS (à piper vers la réponse HTTP).
export const openDownloadStream = (fileId, bucketName = DEFAULT_BUCKET) => {
  const bucket = getBucket(bucketName);
  return bucket.openDownloadStream(new mongoose.Types.ObjectId(fileId));
};
