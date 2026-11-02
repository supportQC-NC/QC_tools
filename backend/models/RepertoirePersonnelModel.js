// backend/models/RepertoirePersonnelModel.js
//
// RÉPERTOIRE DU PERSONNEL d'une société (module « Dictionnaires »).
// Version applicative du répertoire papier affiché en magasin : une entrée par
// personne (nom, service, n° de poste interne, téléphone extérieur, portable,
// email), plus l'en-tête standard/permanence. UN document par société.
//
// ⚠️ Décision client (02/11/2026) : AUCUNE restriction inter-sociétés — tout
// utilisateur ayant le module voit les répertoires de TOUTES les sociétés
// (les routes n'utilisent pas checkEntrepriseAccess, c'est voulu).

import mongoose from "mongoose";

const entreeSchema = new mongoose.Schema(
  {
    // Nom affiché (prénom ou « Caisse 1 », « SAV », « Salle Réunion »…).
    nom: { type: String, required: true, trim: true },
    // Service / zone : Dock, Magasin, Commerciaux, Import, Responsable,
    // Support, Comptabilité… — libre, sert au regroupement à l'affichage.
    service: { type: String, default: "", trim: true },
    // N° de poste interne (ex. « 15 », « 27.04.19 »).
    poste: { type: String, default: "", trim: true },
    // Ligne directe extérieure.
    telExterieur: { type: String, default: "", trim: true },
    // Portable.
    portable: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    // Ordre d'affichage dans son service.
    ordre: { type: Number, default: 0 },
  },
  { _id: false },
);

const repertoirePersonnelSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      unique: true,
    },
    // En-tête du répertoire (ex. « 27.47.22 - 27.27.00 (n°9) »).
    standard: { type: String, default: "", trim: true },
    // Note libre (ex. « Permanence Midi et Samedi : n°64 · info@… »).
    note: { type: String, default: "", trim: true },
    entrees: { type: [entreeSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const RepertoirePersonnel = mongoose.model(
  "RepertoirePersonnel",
  repertoirePersonnelSchema,
);

export default RepertoirePersonnel;
