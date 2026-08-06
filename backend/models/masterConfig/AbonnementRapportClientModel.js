// backend/models/masterConfig/AbonnementRapportClientModel.js
//
// Abonnements clients aux rapports — équivalent de la table Access tblDataClients.
// Scopé par entreprise (société ET) ; un client (TIERS) peut avoir plusieurs
// adresses email abonnées. Pilote l'envoi automatique des rapports.
import mongoose from "mongoose";

const abonnementRapportClientSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    // Code client de l'ERP (clients.TIERS).
    tiers: { type: Number, required: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    newsletter: { type: Boolean, default: false },
    facturePdf: { type: Boolean, default: false },
    rapportTgc: { type: Boolean, default: false },
    xlsExterne: { type: Boolean, default: false },
    xlsInterne: { type: Boolean, default: false },
    baseCollecteur: { type: String, default: "" },
    bloquer: { type: Boolean, default: false },
    // Rattachement OPTIONNEL à un utilisateur de l'app (facultatif).
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

abonnementRapportClientSchema.index(
  { entreprise: 1, tiers: 1, email: 1 },
  { unique: true },
);

export default mongoose.model(
  "AbonnementRapportClient",
  abonnementRapportClientSchema,
);
