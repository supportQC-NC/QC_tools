// backend/models/ZoneModel.js
import mongoose from "mongoose";

/**
 * Zone d'inventaire = une fiche rayon.
 * Issue du CSV généré par le programme externe, rattachée à une entreprise.
 * Chaque zone porte 4 codes-barres (principal / papillonnage / bipage / contrôle)
 * qui serviront ensuite à piloter l'inventaire au scan.
 */
const zoneSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
    },
    libelle: {
      type: String,
      default: "",
      trim: true,
    },
    type: {
      type: String,
      default: "",
      trim: true,
    },
    metreLineaire: {
      type: Number,
      default: 0,
    },
    eanPrincipal: {
      type: String,
      default: "",
      trim: true,
    },
    eanPapillonnage: {
      type: String,
      default: "",
      trim: true,
    },
    eanBipage: {
      type: String,
      default: "",
      trim: true,
    },
    eanControle: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

// Code unique par entreprise (sensible à la casse : B_5d ≠ B_5g)
zoneSchema.index({ entreprise: 1, code: 1 }, { unique: true });

// Index pour retrouver une zone par n'importe lequel de ses codes-barres
// (utile pour la future gestion d'inventaire au scan)
zoneSchema.index({ entreprise: 1, eanPrincipal: 1 });
zoneSchema.index({ entreprise: 1, eanPapillonnage: 1 });
zoneSchema.index({ entreprise: 1, eanBipage: 1 });
zoneSchema.index({ entreprise: 1, eanControle: 1 });

const Zone = mongoose.model("Zone", zoneSchema);

export default Zone;