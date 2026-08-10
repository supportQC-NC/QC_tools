// backend/models/masterConfig/GroupePrioritaireModel.js
//
// Groupes prioritaires pour le réappro — équivalent Access tblGroupePrioritaire.
// Liste PROPRE À CHAQUE SOCIÉTÉ : un document par couple (entreprise, groupe).
// Les codes GROUPE viennent de article.dbf de la société (bouton « Compléter
// depuis les articles » de la config entreprise).
//
// MIGRATION : la version précédente était un référentiel global avec un index
// unique `groupe_1`. Cet index empêche deux sociétés d'avoir le même code et
// DOIT être supprimé — voir backend/migrations/groupesPrioritairesParEntreprise.js
// (`npm run migrate:groupes-prioritaires`).
import mongoose from "mongoose";

const groupePrioritaireSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      index: true,
    },
    groupe: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    description: { type: String, default: "" },
    // Nombre d'articles portant ce GROUPE dans article.dbf de la société,
    // relevé au dernier scan. Informatif : jamais utilisé comme filtre.
    nbArticles: { type: Number, default: 0 },
    scanneLe: { type: Date, default: null },
  },
  { timestamps: true },
);

// Un code GROUPE est unique DANS une société, pas entre sociétés.
groupePrioritaireSchema.index({ entreprise: 1, groupe: 1 }, { unique: true });

export default mongoose.model("GroupePrioritaire", groupePrioritaireSchema);
