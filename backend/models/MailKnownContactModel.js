// backend/models/MailKnownContactModel.js
//
// Référentiel des emails clients DÉJÀ VUS par société. Sert à détecter les
// NOUVEAUX clients (présents dans le DBF mais absents d'ici) pour déclencher les
// automatisations « nouveau client ». Seedé à l'activation d'une automatisation
// (sans enrôler l'existant) puis complété à chaque détection.
import mongoose from "mongoose";

const knownContactSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
  },
  { timestamps: true },
);

knownContactSchema.index({ entreprise: 1, email: 1 }, { unique: true });

const MailKnownContact = mongoose.model("MailKnownContact", knownContactSchema);
export default MailKnownContact;
