// backend/models/FournisseurEmailModel.js
//
// Base des emails fournisseurs — équivalent de la table Access MAIL_FOURNISSEUR.
// Scopée par entreprise (société) : un même code fournisseur (FOURN_ID de l'ERP)
// peut avoir des coordonnées différentes selon la société.
//
// Utilisée par le module « Envoi Commande Fournisseur » pour résoudre, à partir
// du FOURN de la commande DBF (cmdref.FOURN), les adresses d'envoi + la langue
// du modèle de message.
import mongoose from "mongoose";

const fournisseurEmailSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    // Code fournisseur de l'ERP (fourniss.FOURN / cmdref.FOURN).
    fournId: { type: Number, required: true },
    // Libellé fournisseur (informatif, MAIL_FOURNISSEUR.FOURN_LBL).
    fournLbl: { type: String, default: "", trim: true },
    // Langue du modèle de message à utiliser : F (français) ou A (anglais).
    langue: { type: String, enum: ["F", "A"], default: "F" },
    // Destinataires principaux (fournisseur).
    emails: { type: [String], default: [] },
    // Adresses du transitaire (mises en copie).
    emailsTransitaire: { type: [String], default: [] },
    // Copies supplémentaires (MAILCCi).
    emailsCC: { type: [String], default: [] },
    actif: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Un seul enregistrement par (société, code fournisseur).
fournisseurEmailSchema.index({ entreprise: 1, fournId: 1 }, { unique: true });

const FournisseurEmail = mongoose.model(
  "FournisseurEmail",
  fournisseurEmailSchema,
);

export default FournisseurEmail;
