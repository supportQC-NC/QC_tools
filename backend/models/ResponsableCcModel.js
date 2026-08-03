// backend/models/ResponsableCcModel.js
//
// Adresses mises en copie (CC) de tous les envois d'une société — équivalent de
// la table Access MAIL_RESPONSABLE. Une seule fiche par société.
import mongoose from "mongoose";

const responsableCcSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      unique: true,
    },
    nom: { type: String, default: "", trim: true },
    // Adresses en copie de chaque commande envoyée.
    emails: { type: [String], default: [] },
  },
  { timestamps: true },
);

const ResponsableCc = mongoose.model("ResponsableCc", responsableCcSchema);

export default ResponsableCc;
