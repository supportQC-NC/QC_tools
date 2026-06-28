// backend/models/InventaireCollecteModel.js
import mongoose from "mongoose";

/**
 * Collecte d'inventaire "terrain" = un agent qui compte UNE zone.
 *
 * Parcours :
 *   1. l'agent bipe l'EAN principal d'une zone  → on identifie la zone
 *   2. il bipe les articles (code-barres ou NART) + quantité
 *   3. quand la zone est terminée, on dépose un fichier .DAT
 *      (stock.dat <codeZone>) dans le dossier de la session active.
 *
 * Une collecte est rattachée à une entreprise, un utilisateur et une zone.
 * On garde l'historique : après dépôt, status passe de "en_cours" à "exporte".
 */
const ligneCollecteSchema = new mongoose.Schema({
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
  isRenvoi: {
    type: Boolean,
    default: false,
  },
  articleOriginal: {
    type: Object,
    default: null,
  },
  scannedAt: {
    type: Date,
    default: Date.now,
  },
});

const inventaireCollecteSchema = new mongoose.Schema(
  {
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

    // Session d'inventaire active au moment de la création (sert à connaître
    // le dossier de dépôt). Peut rester null : l'agent peut travailler dès que
    // des zones existent, même sans session initialisée par un admin.
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InventaireZoneSession",
      default: null,
    },
    sessionNom: {
      type: String,
      default: "",
    },

    // Zone (snapshot des infos utiles à l'affichage et au nom de fichier)
    zoneCode: {
      type: String,
      required: true,
      trim: true,
    },
    zoneLibelle: {
      type: String,
      default: "",
    },
    zoneType: {
      type: String,
      default: "",
    },
    eanPrincipal: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: ["en_cours", "exporte"],
      default: "en_cours",
    },

    lignes: [ligneCollecteSchema],

    totalArticles: {
      type: Number,
      default: 0,
    },
    totalQuantite: {
      type: Number,
      default: 0,
    },

    // Dépôt du fichier .DAT
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
      enum: ["", "session", "annee"],
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

// Reprise rapide d'une collecte en cours (agent + entreprise + zone)
inventaireCollecteSchema.index({
  entreprise: 1,
  user: 1,
  zoneCode: 1,
  status: 1,
});
inventaireCollecteSchema.index({ nomDossierDBF: 1 });

// Recalcul des totaux (nb d'articles distincts + nb d'unités)
inventaireCollecteSchema.methods.calculerTotaux = function () {
  this.totalArticles = this.lignes.length;
  this.totalQuantite = this.lignes.reduce((sum, l) => sum + l.quantite, 0);
};

const InventaireCollecte = mongoose.model(
  "InventaireCollecte",
  inventaireCollecteSchema,
);

export default InventaireCollecte;