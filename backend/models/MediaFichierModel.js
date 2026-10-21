// backend/models/MediaFichierModel.js
//
// MÉDIATHÈQUE — banque GLOBALE de fichiers mis en ligne (images + pages HTML),
// pensée pour les signatures mail : chaque fichier a un LIEN PUBLIC permanent
// (/api/mediatheque/public/<slug>) que l'on colle dans Gmail/Outlook. Le binaire
// vit dans GridFS (bucket "mediatheque", voir utils/gridfsBucket.js) ; ce
// document ne garde que les métadonnées + la référence fileId.
//
// ⚠️ Le `slug` est l'URL publique : il est figé À LA CRÉATION et ne change
// JAMAIS, même si l'utilisateur renomme le fichier (`nom`) — sinon toutes les
// signatures déjà en place dans les boîtes mail pointeraient dans le vide.

import mongoose from "mongoose";

const mediaFichierSchema = new mongoose.Schema(
  {
    // Nom d'affichage, librement modifiable (n'impacte pas le lien).
    nom: { type: String, required: true, trim: true },

    // Identifiant public du fichier, extension comprise ("logo-qc.png").
    // Unique, immuable : c'est lui qui fait l'URL publique.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

    // Catégorie simple pour le filtrage à l'écran.
    type: { type: String, enum: ["image", "html"], required: true },

    // Référence GridFS + métadonnées du binaire.
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true }, // nom du fichier d'origine
    mimeType: { type: String, required: true },
    size: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const MediaFichier = mongoose.model("MediaFichier", mediaFichierSchema);

export default MediaFichier;
