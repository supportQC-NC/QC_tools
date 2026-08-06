// backend/models/masterConfig/GroupePrioritaireModel.js
//
// Groupes prioritaires pour le réappro — équivalent Access tblGroupePrioritaire.
// Référentiel global (non scopé société) : code GROUPE de l'ERP -> description.
import mongoose from "mongoose";

const groupePrioritaireSchema = new mongoose.Schema(
  {
    groupe: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
    },
    description: { type: String, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("GroupePrioritaire", groupePrioritaireSchema);
