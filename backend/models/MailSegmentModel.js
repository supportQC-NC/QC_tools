// backend/models/MailSegmentModel.js
//
// SEGMENT de clients réutilisable pour cibler des campagnes : un nom, une courte
// description, et une définition de la cible = filtres DBF (CATEGORIE / PROFES)
// ET/OU une liste d'emails importée (CSV en masse). Scopé par société.
import mongoose from "mongoose";

const mailSegmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nom: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // Cible : clients DBF filtrés par catégorie/profession…
    categories: { type: [String], default: [] },
    profes: { type: [String], default: [] },
    // …et/ou emails importés en masse (CSV).
    csvEmails: { type: [String], default: [] },
  },
  { timestamps: true },
);

mailSegmentSchema.index({ entreprise: 1, updatedAt: -1 });

const MailSegment = mongoose.model("MailSegment", mailSegmentSchema);
export default MailSegment;
