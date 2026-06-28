// backend/models/FicheControleModel.js
import mongoose from "mongoose";

/**
 * Trace chaque fichier .DAT traité et la fiche de contrôle PDF générée.
 * Permet de détecter les .DAT "nouveaux" (non encore traités) et de
 * suivre l'état d'impression / d'archivage.
 */
const ficheControleSchema = new mongoose.Schema(
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
    inventaireNom: { type: String, default: "" },

    // Fichier source
    datFileName: { type: String, required: true },
    datMtimeMs: { type: Number, default: 0 },
    datSize: { type: Number, default: 0 },

    // Zone (depuis le nom du fichier + fiche zone importée)
    zoneCode: { type: String, default: "" },
    zoneLibelle: { type: String, default: "" },
    zoneType: { type: String, default: "" },

    // PDF généré
    pdfFileName: { type: String, default: "" },
    pdfPath: { type: String, default: "" },
    date: { type: Date, default: Date.now },

    // Impression / archivage
    printed: { type: Boolean, default: false },
    printedAt: { type: Date, default: null },
    printError: { type: String, default: "" },
    archived: { type: Boolean, default: false },

    // Statistiques
    stats: {
      total: { type: Number, default: 0 },
      doublons: { type: Number, default: 0 },
      attention: { type: Number, default: 0 },
      excedent: { type: Number, default: 0 },
      nonTrouves: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

// Un .DAT n'est traité qu'une fois par session (sauf si le fichier change : géré par mtime/size)
ficheControleSchema.index({ session: 1, datFileName: 1 }, { unique: true });

const FicheControle = mongoose.model("FicheControle", ficheControleSchema);

export default FicheControle;