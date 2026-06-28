// backend/models/ConcurrentModel.js
import mongoose from "mongoose";

const concurrentSchema = new mongoose.Schema(
  {
    nom: {
      type: String,
      required: [true, "Nom du concurrent requis"],
      trim: true,
    },
    adresse: {
      type: String,
      default: "",
      trim: true,
    },
    ville: {
      type: String,
      default: "",
      trim: true,
    },
    codePostal: {
      type: String,
      default: "",
      trim: true,
    },
    telephone: {
      type: String,
      default: "",
      trim: true,
    },
    type: {
      type: String,
      enum: ["grande_surface", "specialise", "grossiste", "en_ligne", "autre"],
      default: "autre",
    },
    notes: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
);

// Index pour recherche rapide par nom
concurrentSchema.index({ nom: 1 });
concurrentSchema.index({ isActive: 1 });

const Concurrent = mongoose.model("Concurrent", concurrentSchema);

export default Concurrent;
