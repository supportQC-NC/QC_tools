// backend/models/InventaireModel.js
import mongoose from "mongoose";

const ligneInventaireSchema = new mongoose.Schema({
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
  quantite: {
    type: Number,
    required: true,
    min: 0,
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

const inventaireSchema = new mongoose.Schema(
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
    status: {
      type: String,
      enum: ["en_cours", "termine", "exporte"],
      default: "en_cours",
    },
    lignes: [ligneInventaireSchema],
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
inventaireSchema.index({ entreprise: 1, user: 1, status: 1 });
inventaireSchema.index({ nomDossierDBF: 1 });

// Méthode pour calculer les totaux
inventaireSchema.methods.calculerTotaux = function () {
  this.totalArticles = this.lignes.length;
  this.totalQuantite = this.lignes.reduce((sum, l) => sum + l.quantite, 0);
};

const Inventaire = mongoose.model("Inventaire", inventaireSchema);

export default Inventaire;
