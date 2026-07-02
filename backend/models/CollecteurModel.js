// backend/models/CollecteurModel.js
// Flotte de collecteurs Android (gestion admin).
import mongoose from "mongoose";

export const STATUTS_COLLECTEUR = [
  "stock", // En stock
  "service", // En service
  "panne", // En panne
  "reparation", // En réparation
  "reforme", // Réformé
  "perdu", // Perdu / Volé
];

const collecteurSchema = new mongoose.Schema(
  {
    // Identifiant matériel (ex: HMC62Q260301158) — unique.
    identifiant: {
      type: String,
      required: [true, "Identifiant requis"],
      unique: true,
      uppercase: true,
      trim: true,
    },
    // Nom / libellé du collecteur (paramétrable).
    nom: { type: String, default: "" },
    // Date de réception du matériel.
    recu: { type: Date, default: null },
    // Poignée-pistolet / gâchette physique.
    gachette: { type: Boolean, default: false },
    // Date de mise en service.
    miseEnService: { type: Date, default: null },
    // Entreprise d'affectation.
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      default: null,
    },
    // Agent (utilisateur de l'app) qui détient le collecteur.
    agent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Statut de flotte.
    statut: {
      type: String,
      enum: STATUTS_COLLECTEUR,
      default: "stock",
    },
    // Version de l'app installée sur ce collecteur (ex: "1.0.2").
    versionApp: { type: String, default: "" },
    // Accessoires livrés avec (étui, chargeur, batterie sup., dragonne, poignée…).
    accessoires: { type: [String], default: [] },
    // Emplacement / dépôt où il est rangé.
    emplacement: { type: String, default: "" },
    // Observations libres.
    observations: { type: String, default: "" },
    // Actif (false = archivé, sans suppression).
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const Collecteur = mongoose.model("Collecteur", collecteurSchema);

export default Collecteur;