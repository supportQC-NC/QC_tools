// backend/models/MessageFournisseurModel.js
//
// Modèles de corps de mail par société + langue — équivalent de la table Access
// tblMessage. Le HTML est envoyé tel quel comme corps de l'email de commande
// (une signature société y est ajoutée à l'envoi).
import mongoose from "mongoose";

const messageFournisseurSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    langue: { type: String, enum: ["F", "A"], required: true },
    // Corps HTML du message.
    message: { type: String, default: "" },
  },
  { timestamps: true },
);

// Un seul modèle par (société, langue).
messageFournisseurSchema.index({ entreprise: 1, langue: 1 }, { unique: true });

const MessageFournisseur = mongoose.model(
  "MessageFournisseur",
  messageFournisseurSchema,
);

export default MessageFournisseur;
