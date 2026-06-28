// backend/models/LigneBipageModel.js
import mongoose from "mongoose";

/**
 * Une ligne bipée (issue d'un .DAT), stockée pour l'écran "Détail des bipages".
 * Éditable par l'admin : qteScan, nart, observation.
 * Champs dérivés (re-résolus si nart change) : designation, stock, found.
 */
const ligneBipageSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      index: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InventaireZoneSession",
      required: true,
      index: true,
    },
    datFileName: { type: String, default: "" },
    zoneCode: { type: String, default: "", index: true },
    ordre: { type: Number, default: 0 },

    // Code brut scanné, tel quel dans le .DAT
    eanArticle: { type: String, default: "" },

    // Éditables par l'admin
    qteScan: { type: Number, default: 0 },
    nart: { type: String, default: "" },
    observation: { type: String, default: "" },

    // Dérivés (article.DBF)
    designation: { type: String, default: "" },
    stock: { type: Number, default: null },
    found: { type: Boolean, default: false },
  },
  { timestamps: true },
);

ligneBipageSchema.index({ session: 1, zoneCode: 1 });
ligneBipageSchema.index({ session: 1, datFileName: 1 });

const LigneBipage = mongoose.model("LigneBipage", ligneBipageSchema);

export default LigneBipage;