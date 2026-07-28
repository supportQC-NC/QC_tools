// backend/models/MessageModel.js
//
// Message de chat. Le `room` identifie le salon :
//   - "global"        : chat commun à tous les utilisateurs connectés ;
//   - "team:<teamId>" : chat d'une équipe (membres + responsable + admin) ;
//   - "task:<taskId>" : chat d'une tâche (manager ↔ assigné) ;
//   - "conv:<convId>" : discussion libre entre users (1:1 / groupe).
// Un message peut porter du TEXTE et/ou des FICHIERS (attachments, GridFS bucket
// "chatfiles" — même forme que les documents de tâche).

import mongoose from "mongoose";

// Pièce jointe (copie de taskDocumentSchema). `fileId` référence GridFS.
const attachmentSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    kind: {
      type: String,
      enum: ["pdf", "image", "tableur", "autre"],
      default: "autre",
    },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const messageSchema = new mongoose.Schema(
  {
    room: { type: String, required: true, index: true, trim: true },
    auteur: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Texte non requis : un message peut être uniquement des fichiers.
    // La règle « texte OU attachment » est appliquée dans le contrôleur/socket.
    texte: { type: String, trim: true, maxlength: 4000, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
    // Réponse / citation : SNAPSHOT du message cité (résiste à sa suppression).
    replyTo: {
      message: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
      texte: { type: String, default: "" },
      auteurPrenom: { type: String, default: "" },
      auteurNom: { type: String, default: "" },
    },
    // Mentions @ : utilisateurs cités (pour surlignage + notification ciblée).
    mentions: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          display: { type: String, default: "" },
          _id: false,
        },
      ],
      default: [],
    },
    // Édition : horodatage de la dernière modification (affiche « modifié »).
    editedAt: { type: Date, default: null },
    // Épingle : message mis en avant (bandeau en haut du salon).
    pinned: { type: Boolean, default: false },
    pinnedAt: { type: Date, default: null },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // Réactions : une par utilisateur (toggle). `type` = clé (voir chatReactions).
    reactions: {
      type: [
        {
          user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          type: { type: String },
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);

messageSchema.index({ room: 1, createdAt: 1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;
