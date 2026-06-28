// backend/models/InventaireZoneSessionModel.js
import mongoose from "mongoose";

/**
 * Session d'inventaire "par zones" (distincte de l'Inventaire article).
 * À l'initialisation, on fige (snapshot) les zones de l'entreprise pour que
 * un ré-import du CSV pendant l'inventaire ne modifie pas une session en cours.
 *
 * Chaque zone comporte 3 phases indépendantes (ordre libre) :
 *   papillonnage / bipage / controle
 * marquées "faites" en bipant le code-barres correspondant de la zone.
 * `eanPrincipal` ne marque aucune phase (sert juste à identifier la zone).
 */

const phaseSchema = new mongoose.Schema(
  {
    fait: { type: Boolean, default: false },
    at: { type: Date, default: null },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { _id: false },
);

const zoneProgressSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true },
    libelle: { type: String, default: "" },
    type: { type: String, default: "" },
    // Snapshot des codes-barres au moment de l'init
    eanPrincipal: { type: String, default: "" },
    eanPapillonnage: { type: String, default: "" },
    eanBipage: { type: String, default: "" },
    eanControle: { type: String, default: "" },
    // Phases
    papillonnage: { type: phaseSchema, default: () => ({}) },
    bipage: { type: phaseSchema, default: () => ({}) },
    controle: { type: phaseSchema, default: () => ({}) },
  },
  { _id: false },
);

const sessionSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      index: true,
    },
    nom: { type: String, default: "" },
    // Dossier réseau (partage STOCK) où le collecteur dépose les .DAT
    dossierDat: { type: String, default: "" },
    statut: {
      type: String,
      enum: ["actif", "archive"],
      default: "actif",
    },
    zones: [zoneProgressSchema],
    totalZones: { type: Number, default: 0 },
    totalPhases: { type: Number, default: 0 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Une seule session ACTIVE par entreprise (index unique partiel)
sessionSchema.index(
  { entreprise: 1, statut: 1 },
  { unique: true, partialFilterExpression: { statut: "actif" } },
);

const InventaireZoneSession = mongoose.model(
  "InventaireZoneSession",
  sessionSchema,
);

export default InventaireZoneSession;