// backend/models/EnvoiCdeHistoriqueModel.js
//
// Journal des envois de commandes aux fournisseurs (nouveau vs Access) : trace
// qui a envoyé quoi, à qui, quand, et si l'envoi a été fait en mode test.
import mongoose from "mongoose";

const envoiCdeHistoriqueSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nomDossierDBF: { type: String, default: "" },

    // Commande envoyée (cmdref.NUMCDE) + fournisseur (cmdref.FOURN).
    numcde: { type: String, required: true },
    fournId: { type: Number, default: null },
    fournNom: { type: String, default: "" },

    sujet: { type: String, default: "" },
    langue: { type: String, default: "F" },

    // Destinataires RÉELLEMENT utilisés (déjà après redirection éventuelle).
    destinataires: { type: [String], default: [] },
    cc: { type: [String], default: [] },

    // Destinataires « théoriques » (fournisseur réel) avant redirection test —
    // utile pour vérifier ce qui aurait été envoyé en production.
    destinatairesReels: { type: [String], default: [] },

    nbLignes: { type: Number, default: 0 },
    montantPrev: { type: Number, default: 0 },

    // Envoi effectué en mode test (redirigé vers les adresses de test).
    testMode: { type: Boolean, default: false },

    envoyePar: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    statut: { type: String, enum: ["envoye", "erreur"], default: "envoye" },
    erreur: { type: String, default: "" },
  },
  { timestamps: true },
);

envoiCdeHistoriqueSchema.index({ entreprise: 1, createdAt: -1 });

const EnvoiCdeHistorique = mongoose.model(
  "EnvoiCdeHistorique",
  envoiCdeHistoriqueSchema,
);

export default EnvoiCdeHistorique;
