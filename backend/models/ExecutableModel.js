// backend/models/ExecutableModel.js
//
// Catalogue GLOBAL d'exécutables internes téléchargeables (outils métier).
// Le binaire .exe et les documents (PDF/images) sont stockés dans MongoDB via
// GridFS (voir utils/gridfsBucket.js) ; ce document ne garde que les métadonnées
// + les références (fileId) vers GridFS.
//
// Règle : une nouvelle version = un NOUVEAU document (on n'écrase jamais la
// précédente). Un "produit" est identifié par son `name` ; ses versions sont
// autant de documents distincts.

import mongoose from "mongoose";

// Pièce de documentation attachée (plusieurs possibles) : PDF ou image.
const documentAttachmentSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true }, // ref GridFS
    fileName: { type: String, required: true },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    kind: {
      type: String,
      enum: ["pdf", "image", "autre"],
      default: "autre",
    },
  },
  { timestamps: true },
);

const executableSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    version: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    githubLink: { type: String, default: "", trim: true },

    // Binaire principal (dans GridFS).
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },

    // Documentation (PDF / images), plusieurs possibles.
    documents: { type: [documentAttachmentSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// Une seule entrée par (nom, version) : empêche les doublons de version.
executableSchema.index({ name: 1, version: 1 }, { unique: true });

const Executable = mongoose.model("Executable", executableSchema);

export default Executable;
