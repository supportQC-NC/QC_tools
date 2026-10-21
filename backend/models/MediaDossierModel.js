// backend/models/MediaDossierModel.js
//
// Dossier de classement de la MÉDIATHÈQUE — simple étiquette d'organisation à
// l'écran (un niveau, pas d'arborescence), partagée par tous les utilisateurs
// du module. Le dossier n'entre JAMAIS dans l'URL publique d'un fichier :
// déplacer un média ne casse aucun lien déjà collé dans une signature.

import mongoose from "mongoose";

const mediaDossierSchema = new mongoose.Schema(
  {
    nom: { type: String, required: true, trim: true, unique: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const MediaDossier = mongoose.model("MediaDossier", mediaDossierSchema);

export default MediaDossier;
