// backend/models/masterConfig/GroupeSpecialModel.js
//
// Listes spéciales d'articles par société — équivalent Access tblGroupeSpecial.
// Scopé par entreprise ; code de liste -> libellé + format + code visuel.
import mongoose from "mongoose";

const groupeSpecialSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    codeListe: { type: String, required: true, trim: true },
    lblListe: { type: String, default: "" },
    format: { type: String, default: "" },
    codeJpg: { type: String, default: "" },
  },
  { timestamps: true },
);

groupeSpecialSchema.index({ entreprise: 1, codeListe: 1 }, { unique: true });

export default mongoose.model("GroupeSpecial", groupeSpecialSchema);
