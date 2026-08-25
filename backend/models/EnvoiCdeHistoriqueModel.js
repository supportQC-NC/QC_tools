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

    // Type d'envoi : commande fournisseur, relance d'une ou plusieurs commandes,
    // confirmation d'accusé de réception, demande de facture (après confirmation
    // du fournisseur), ou message groupé (vœux/annonces).
    type: {
      type: String,
      enum: ["commande", "relance", "ar", "facture", "masse"],
      default: "commande",
    },
    // Pour un envoi en masse : nombre de destinataires réels concernés.
    nbDestinataires: { type: Number, default: 0 },

    // Commande envoyée (cmdref.NUMCDE) + fournisseur (cmdref.FOURN).
    // Une relance regroupe les commandes d'un même fournisseur : `numcde` porte
    // alors la liste lisible ("12345, 12346") et `numcdes` le détail exploitable.
    numcde: { type: String, required: true },
    numcdes: { type: [String], default: [] },
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
    // Total « coût achat prévisionnel » de l'ERP (cmdetail.PACHAT = coût rendu) :
    // il vaut 0 tant que la commande n'est pas réceptionnée. Conservé pour les
    // anciens documents — c'est `montantTotal` qui porte la valeur exploitable.
    montantPrev: { type: Number, default: 0 },
    // Montant total de la commande = Σ (QTE × prix d'achat de la ligne), dans la
    // devise de la commande. C'est ce montant qui est annoncé dans le mail d'AR.
    montantTotal: { type: Number, default: 0 },
    devise: { type: String, default: "" },

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
