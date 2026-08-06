// backend/models/masterConfig/MailComptaModel.js
//
// Emails comptabilité par client — équivalent Access tblMailCompta.
// Scopé par entreprise ; contact compta associé à un client (TIERS).
import mongoose from "mongoose";

const mailComptaSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    idClient: { type: Number, required: true },
    nomClient: { type: String, default: "" },
    // Plusieurs emails compta possibles (comme dans l'Access).
    mailCompta: { type: [String], default: [] },
    nomCompta: { type: String, default: "" },
    // Rattachement OPTIONNEL à un utilisateur de l'app (facultatif).
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

mailComptaSchema.index({ entreprise: 1, idClient: 1 }, { unique: true });

export default mongoose.model("MailCompta", mailComptaSchema);
