// backend/models/ReleveModel.js
import mongoose from "mongoose";

const ligneReleveSchema = new mongoose.Schema({
  nart: {
    type: String,
    required: true,
  },
  gencod: {
    type: String,
    required: true,
  },
  designation: {
    type: String,
    default: "",
  },
  groupe: {
    type: String,
    default: "",
  },
  // Prix de vente TTC de notre entreprise
  pvtettc: {
    type: Number,
    required: true,
    default: 0,
  },
  // Prix relevé chez le concurrent
  prixReleve: {
    type: Number,
    required: true,
    min: 0,
  },
  // Différence calculée (PVTETTC - PRIX_RELEVE)
  difference: {
    type: Number,
    default: 0,
  },
  // Pourcentage de différence
  pourcentageDiff: {
    type: Number,
    default: 0,
  },
  scannedAt: {
    type: Date,
    default: Date.now,
  },
});

// Calculer automatiquement la différence et le pourcentage avant save
ligneReleveSchema.pre("save", function (next) {
  this.difference = this.pvtettc - this.prixReleve;
  if (this.pvtettc > 0) {
    this.pourcentageDiff = ((this.difference / this.pvtettc) * 100).toFixed(2);
  } else {
    this.pourcentageDiff = 0;
  }
  next();
});

const releveSchema = new mongoose.Schema(
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
    concurrent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Concurrent",
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
    lignes: [ligneReleveSchema],
    totalArticles: {
      type: Number,
      default: 0,
    },
    // Statistiques du relevé
    stats: {
      // Nombre d'articles moins chers chez nous
      moinsCherChezNous: {
        type: Number,
        default: 0,
      },
      // Nombre d'articles plus chers chez nous
      plusCherChezNous: {
        type: Number,
        default: 0,
      },
      // Nombre d'articles au même prix
      memePrix: {
        type: Number,
        default: 0,
      },
      // Différence moyenne en pourcentage
      diffMoyennePourcent: {
        type: Number,
        default: 0,
      },
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
releveSchema.index({ entreprise: 1, user: 1, status: 1 });
releveSchema.index({ concurrent: 1 });
releveSchema.index({ nomDossierDBF: 1 });

// Méthode pour calculer les totaux et statistiques
releveSchema.methods.calculerTotaux = function () {
  this.totalArticles = this.lignes.length;

  if (this.lignes.length === 0) {
    this.stats = {
      moinsCherChezNous: 0,
      plusCherChezNous: 0,
      memePrix: 0,
      diffMoyennePourcent: 0,
    };
    return;
  }

  let moinsCher = 0;
  let plusCher = 0;
  let memePrix = 0;
  let totalPourcent = 0;

  this.lignes.forEach((ligne) => {
    // Recalculer la différence
    ligne.difference = ligne.pvtettc - ligne.prixReleve;
    if (ligne.pvtettc > 0) {
      ligne.pourcentageDiff = parseFloat(
        ((ligne.difference / ligne.pvtettc) * 100).toFixed(2),
      );
    } else {
      ligne.pourcentageDiff = 0;
    }

    totalPourcent += ligne.pourcentageDiff;

    if (ligne.difference > 0) {
      moinsCher++; // Notre prix est plus élevé, concurrent moins cher
    } else if (ligne.difference < 0) {
      plusCher++; // Notre prix est plus bas, concurrent plus cher
    } else {
      memePrix++;
    }
  });

  this.stats = {
    moinsCherChezNous: plusCher, // Inversé car différence = nous - concurrent
    plusCherChezNous: moinsCher,
    memePrix,
    diffMoyennePourcent: parseFloat(
      (totalPourcent / this.lignes.length).toFixed(2),
    ),
  };
};

const Releve = mongoose.model("Releve", releveSchema);

export default Releve;
