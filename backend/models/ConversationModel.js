// backend/models/ConversationModel.js
//
// CONVERSATION : discussion créée par des UTILISATEURS (1:1 « direct » ou
// « group »). Les salons « global » et « team:<id> » restent DÉRIVÉS (pas de
// document ici) ; seules les discussions libres entre users sont persistées.
// Room associée = `conv:<id>`. Couleur côté UI = violet (voir EspaceEquipeScreen).

import mongoose from "mongoose";

const conversationSchema = new mongoose.Schema(
  {
    // 1 participant (hors créateur) => "direct", sinon "group".
    type: {
      type: String,
      enum: ["direct", "group"],
      required: true,
    },
    // Nom libre (surtout pour les groupes ; un "direct" affiche l'autre membre).
    nom: {
      type: String,
      trim: true,
      default: "",
    },
    // Clé d'icône choisie par le créateur (voir config/chatIcons.js).
    icone: {
      type: String,
      default: "chat",
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Créateur = modérateur (peut supprimer la conv et ses messages).
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Photo de groupe (optionnelle) : id GridFS (bucket "convphotos").
    photo: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    photoUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

conversationSchema.index({ participants: 1 });

const Conversation = mongoose.model("Conversation", conversationSchema);

export default Conversation;
