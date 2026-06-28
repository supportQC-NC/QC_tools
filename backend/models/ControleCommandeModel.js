// backend/models/ControleCommandeModel.js
import mongoose from "mongoose";

/**
 * Ligne d'un contrôle de commande.
 * Structure identique à une ligne de réappro (scan code + quantité),
 * avec snapshot des stocks au moment du scan (pour historique).
 */
const ligneControleSchema = new mongoose.Schema({
  nart: {
    type: String,
    required: true,
  },
  gencod: {
    type: String,
    default: "",
  },
  designation: {
    type: String,
    default: "",
  },
  refer: {
    type: String,
    default: "",
  },
  quantite: {
    type: Number,
    required: true,
    min: 1,
  },
  // Stocks au moment du scan (pour historique)
  stocksSnapshot: {
    magasin: { type: Number, default: 0 }, // STOCK (S1)
    docks: { type: Number, default: 0 }, // STLOC2 (S2)
    bureau: { type: Number, default: 0 }, // STLOC3 (S3)
    s4: { type: Number, default: 0 }, // STLOC4 (S4)
    s5: { type: Number, default: 0 }, // STLOC5 (S5)
  },
  isUnknown: {
    type: Boolean,
    default: false,
  },
  scannedAt: {
    type: Date,
    default: Date.now,
  },
});

const controleCommandeSchema = new mongoose.Schema(
  {
    nom: {
      type: String,
      default: "",
    },
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nomDossierDBF: {
      type: String,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Commande contrôlée (lien sur cmdref.NUMCDE)
    numcde: {
      type: String,
      required: true,
      trim: true,
    },
    // Snapshot contextuel de l'entête de commande (cmdref) au moment du contrôle
    commandeInfo: {
      fourn: { type: Number, default: null },
      bateau: { type: String, default: "" },
      datcde: { type: Date, default: null },
      observ: { type: String, default: "" },
    },
    status: {
      type: String,
      enum: ["en_cours", "termine", "exporte"],
      default: "en_cours",
    },
    lignes: [ligneControleSchema],
    totalArticles: {
      type: Number,
      default: 0,
    },
    totalQuantite: {
      type: Number,
      default: 0,
    },
    fichierExport: {
      type: String,
      default: "",
    },
    cheminExport: {
      type: String,
      default: "",
    },
    modeExport: {
      type: String,
      enum: ["serveur", "telechargement", ""],
      default: "",
    },
    exportedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Index pour recherche rapide
controleCommandeSchema.index({ entreprise: 1, user: 1, status: 1 });
controleCommandeSchema.index({ nomDossierDBF: 1 });
controleCommandeSchema.index({ entreprise: 1, user: 1, numcde: 1, status: 1 });

// Méthode pour calculer les totaux
controleCommandeSchema.methods.calculerTotaux = function () {
  this.totalArticles = this.lignes.length;
  this.totalQuantite = this.lignes.reduce((sum, l) => sum + l.quantite, 0);
};

const ControleCommande = mongoose.model(
  "ControleCommande",
  controleCommandeSchema,
);

export default ControleCommande;