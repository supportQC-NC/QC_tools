// backend/models/DemandeBipageModel.js
//
// Demande de BIPAGE créée depuis le web (admin) et destinée aux agents (app
// mobile — module Bipage). Une demande = une LISTE d'articles à biper, sourcée
// depuis une proforma, un gisement, ou saisie manuellement. À la réalisation,
// l'agent bipe les articles et un fichier .dat de bipage est déposé.
// (Calque de DemandeReapproModel.)
import mongoose from "mongoose";

const articleSnapSchema = new mongoose.Schema(
  {
    nart: String,
    design: String,
    fourn: String,
    fournNom: String,
    gencod: String,
    stock: Number, // stock total indicatif (peut être 0/absent)
    quantiteDemandee: Number, // quantité attendue (ex. qté commandée proforma) — indicatif
  },
  { _id: false },
);

// Ligne réellement bipée par l'agent (quantité comptée).
const ligneRealiseeSchema = new mongoose.Schema(
  { nart: String, gencod: String, quantite: Number },
  { _id: false },
);

const demandeBipageSchema = new mongoose.Schema(
  {
    entreprise: { type: String, index: true }, // nomDossierDBF
    source: {
      type: String,
      enum: ["proforma", "gisement", "manuel"],
      default: "manuel",
      index: true,
    },
    sourceRef: { type: String, default: "" }, // numpro (proforma) ou libellé gisement
    libelle: { type: String, default: "" }, // libellé affiché (client proforma, gisement…)
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
    lignesRealisees: [ligneRealiseeSchema],
    transfertFichier: { type: String, default: "" },
  },
  { timestamps: true },
);

// Une demande est "active" (bloque un doublon) tant qu'elle n'est pas réalisée.
demandeBipageSchema.statics.ACTIVE_STATUTS = ["en_attente", "en_cours"];

const DemandeBipage = mongoose.model("DemandeBipage", demandeBipageSchema);
export default DemandeBipage;
