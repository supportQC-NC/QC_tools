// backend/models/EnvoiCdeArModel.js
//
// Suivi des ACCUSÉS DE RÉCEPTION (AR) fournisseur, commande par commande.
//
// Une commande envoyée est « en attente d'AR » tant que le fournisseur n'a pas
// confirmé. Quand il confirme (par mail, par téléphone…), un utilisateur marque
// l'AR comme reçu depuis l'onglet « Accusés de réception » : on mémorise ici qui
// a confirmé, quand, et pour quel MONTANT TOTAL — et un mail de confirmation
// part au fournisseur (modèle de message de type "ar").
//
// Il n'y a AUCUNE écriture DBF : l'ERP reste en lecture seule, l'état AR ne vit
// que dans Mongo.
import mongoose from "mongoose";

const envoiCdeArSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nomDossierDBF: { type: String, default: "" },

    // Commande concernée (cmdref.NUMCDE) + fournisseur, dénormalisés pour que la
    // liste reste lisible même si la commande a disparu des DBF (archivage annuel).
    numcde: { type: String, required: true },
    fournId: { type: Number, default: null },
    fournNom: { type: String, default: "" },

    statut: {
      type: String,
      enum: ["en_attente", "confirme"],
      default: "en_attente",
    },

    // Montant total RETENU pour cet AR (celui qui part dans le mail).
    montantTotal: { type: Number, default: 0 },
    // Montant recalculé depuis les lignes (Σ QTE × prix d'achat) au moment de la
    // confirmation : sert à tracer un éventuel écart avec le montant retenu.
    montantCalcule: { type: Number, default: 0 },
    // true si l'opérateur a corrigé le montant proposé (prix révisé, rupture…).
    montantCorrige: { type: Boolean, default: false },
    // Devise de la commande (cmdref.CDVISE) — aucune conversion n'est faite.
    devise: { type: String, default: "" },

    dateConfirmation: { type: Date, default: null },
    confirmePar: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Le mail de confirmation est-il parti (il peut être volontairement omis) ?
    mailEnvoye: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Un seul suivi d'AR par commande et par société.
envoiCdeArSchema.index({ entreprise: 1, numcde: 1 }, { unique: true });

const EnvoiCdeAr = mongoose.model("EnvoiCdeAr", envoiCdeArSchema);

export default EnvoiCdeAr;
