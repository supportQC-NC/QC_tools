// backend/models/AiConversationModel.js
//
// Conversation avec l'ASSISTANT IA, persistée PAR UTILISATEUR et par société.
// `messages` = suite de tours { role: user|assistant, content }. Les tours
// techniques (appels d'outils) ne sont PAS stockés : on ne garde que le dialogue
// lisible. Le titre est dérivé du premier message.
import mongoose from "mongoose";

const aiMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, default: "" },
  },
  { _id: false, timestamps: true },
);

const aiConversationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    titre: { type: String, default: "Nouvelle conversation", trim: true },
    messages: { type: [aiMessageSchema], default: [] },
  },
  { timestamps: true },
);

aiConversationSchema.index({ user: 1, updatedAt: -1 });

const AiConversation = mongoose.model("AiConversation", aiConversationSchema);

export default AiConversation;
