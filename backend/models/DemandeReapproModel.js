// backend/models/DemandeReapproModel.js
//
// Demande de réappro MAGASIN (rayon vide, stock en réserve), créée depuis
// l'analyse web et destinée aux agents (app mobile). Une demande = UN gisement
// (GISM1) figé au moment de la création (snapshot des articles à réassortir).
import mongoose from "mongoose";

const articleSnapSchema = new mongoose.Schema(
  {
    nart: String,
    design: String,
    fourn: String,
    fournNom: String,
    s1: Number,
    stock: Number, // stock en réserve (S2..S5)
    vteMoyMois: Number,
  },
  { _id: false },
);

const demandeReapproSchema = new mongoose.Schema(
  {
    entreprise: { type: String, index: true }, // nomDossierDBF
    type: { type: String, default: "magasin" }, // magasin (seul type pour l'instant)
    gisement: { type: String, index: true }, // GISM1
    priorite: {
      type: String,
      enum: ["urgent", "a_faire", "normal"],
      default: "a_faire",
    },
    statut: {
      type: String,
      enum: ["en_attente", "en_cours", "realisee"],
      default: "en_attente",
      index: true,
    },
    articles: [articleSnapSchema],
    nbArticles: { type: Number, default: 0 },
    commentaire: { type: String, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByNom: { type: String, default: "" },

    realisedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    realisedByNom: { type: String, default: "" },
    realisedAt: { type: Date },
  },
  { timestamps: true },
);

// Une demande est "active" (bloque un doublon) tant qu'elle n'est pas réalisée.
demandeReapproSchema.statics.ACTIVE_STATUTS = ["en_attente", "en_cours"];

const DemandeReappro = mongoose.model("DemandeReappro", demandeReapproSchema);
export default DemandeReappro;