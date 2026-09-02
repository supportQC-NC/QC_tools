// backend/models/FichePreparationModel.js
//
// Module « Préparation de commande MANUELLE » (version papier de la préparation).
//
// L'application ne saisit AUCUNE quantité préparée : l'utilisateur IMPRIME une
// fiche de préparation (PDF listant, dock puis magasin, la quantité à prendre
// par article) que l'agent remplit à la main dans les allées — la colonne
// « CTRL » lui sert à noter la quantité réellement prise en cas d'écart.
// Ce document ne sert donc qu'au SUIVI LÉGER de ces impressions :
//   - qui a imprimé la fiche d'une proforma, quand, combien de fois ;
//   - un statut posé manuellement (à préparer / imprimée / préparée).
//
// La proforma elle-même reste dans le DBF (proforma / prodet) : on ne stocke
// ici qu'un snapshot d'entête pour l'affichage de l'historique.
import mongoose from "mongoose";

// Statuts du suivi (posés à l'impression ou manuellement par l'utilisateur).
export const FICHE_PREPARATION_STATUTS = ["a_preparer", "imprime", "prepare"];

// Une impression de fiche (trace).
const impressionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    nom: { type: String, default: "" },
    at: { type: Date, default: Date.now },
    nbLignes: { type: Number, default: 0 }, // lignes imprimées (dock + magasin)
  },
  { _id: false },
);

const fichePreparationSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nomDossierDBF: { type: String, required: true },

    // Proforma préparée (proforma.NUMFACT)
    numfact: { type: String, required: true, trim: true },

    statut: {
      type: String,
      enum: FICHE_PREPARATION_STATUTS,
      default: "a_preparer",
    },

    // Snapshot d'entête (affichage de l'historique sans relire le DBF).
    proformaInfo: {
      clientNom: { type: String, default: "" },
      clientCode: { type: Number, default: null },
      vendeurCode: { type: String, default: "" },
      vendeurNom: { type: String, default: "" },
      datfact: { type: Date, default: null },
      etat: { type: Number, default: null },
    },

    // Traçabilité des impressions.
    impressions: [impressionSchema],
    nbImpressions: { type: Number, default: 0 },
    dernierePrintAt: { type: Date, default: null },
    dernierePrintPar: { type: String, default: "" },

    // Clôture manuelle (« préparée »).
    prepareAt: { type: Date, default: null },
    preparePar: { type: String, default: "" },
    commentaire: { type: String, default: "" },
  },
  { timestamps: true },
);

// Un seul document de suivi par (société, proforma).
fichePreparationSchema.index({ entreprise: 1, numfact: 1 }, { unique: true });
fichePreparationSchema.index({ nomDossierDBF: 1, statut: 1 });

const FichePreparation = mongoose.model(
  "FichePreparation",
  fichePreparationSchema,
);

export default FichePreparation;
