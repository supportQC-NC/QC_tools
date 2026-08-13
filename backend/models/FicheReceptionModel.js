// backend/models/FicheReceptionModel.js
//
// Module « Contrôle réception MANUEL » (version papier du contrôle de réception).
//
// Aucune donnée de comptage n'est saisie dans l'application : l'utilisateur
// IMPRIME une fiche de contrôle (PDF SANS quantité commandée — comptage
// toujours à l'aveugle) qu'il remplit à la main sur le quai.
// Ce document ne sert donc qu'au SUIVI LÉGER de ces impressions :
//   - qui a imprimé la fiche d'une commande, quand, combien de fois ;
//   - un statut posé manuellement par l'utilisateur (à contrôler / imprimé / contrôlé).
//
// La commande elle-même reste dans le DBF (cmdref / cmdetail) : on ne stocke ici
// qu'un snapshot d'entête pour l'affichage de l'historique.
import mongoose from "mongoose";

// Statuts du suivi (posés à l'impression ou manuellement par l'utilisateur).
export const FICHE_RECEPTION_STATUTS = ["a_controler", "imprime", "controle"];

// Une impression de fiche (trace).
const impressionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    nom: { type: String, default: "" },
    at: { type: Date, default: Date.now },
    nbLignes: { type: Number, default: 0 },
  },
  { _id: false },
);

const ficheReceptionSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nomDossierDBF: { type: String, required: true },

    // Commande contrôlée (cmdref.NUMCDE)
    numcde: { type: String, required: true, trim: true },

    statut: {
      type: String,
      enum: FICHE_RECEPTION_STATUTS,
      default: "a_controler",
    },

    // Snapshot d'entête (affichage de l'historique sans relire le DBF).
    commandeInfo: {
      fourn: { type: mongoose.Schema.Types.Mixed, default: null },
      fournisseurNom: { type: String, default: "" },
      bateau: { type: String, default: "" },
      arrivee: { type: Date, default: null },
      datcde: { type: Date, default: null },
      etat: { type: Number, default: null },
    },

    // Traçabilité des impressions.
    impressions: [impressionSchema],
    nbImpressions: { type: Number, default: 0 },
    dernierePrintAt: { type: Date, default: null },
    dernierePrintPar: { type: String, default: "" },

    // Clôture manuelle (« contrôlé »).
    controleAt: { type: Date, default: null },
    controlePar: { type: String, default: "" },
    commentaire: { type: String, default: "" },
  },
  { timestamps: true },
);

// Un seul document de suivi par (société, commande).
ficheReceptionSchema.index({ entreprise: 1, numcde: 1 }, { unique: true });
ficheReceptionSchema.index({ nomDossierDBF: 1, statut: 1 });

const FicheReception = mongoose.model("FicheReception", ficheReceptionSchema);

export default FicheReception;
