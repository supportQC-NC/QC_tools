// backend/models/PreparationUrgenceModel.js
//
// PRIORITÉ « URGENT » d'une commande à préparer (demande client du 17/11/2026).
//
// La proforma vit dans le DBF (lecture seule) : le drapeau d'urgence est donc
// porté par ce petit document Mongo, clé (entreprise, numpro). PRÉSENCE DU
// DOCUMENT = commande urgente — repasser en priorité normale SUPPRIME le
// document (pas de drapeau à false qui traîne). Posé depuis l'écran web
// « Suivi des préparations » ; lu par les listes « à préparer » de l'app
// mobile (urgentes en tête, affichées en rouge) et par le suivi web.
//
// Aucune purge nécessaire : le drapeau devient simplement sans effet quand la
// proforma quitte l'état « à préparer » (préparée ou facturée), et il est
// supprimé si l'utilisateur repasse la commande en priorité normale.
import mongoose from "mongoose";

const preparationUrgenceSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      index: true,
    },
    // NUMFACT de la proforma (ou réservation), tel que l'ERP l'écrit.
    numpro: { type: String, required: true },

    // Qui a posé l'urgence (trace affichée en infobulle).
    par: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    parNom: { type: String, default: "" },
  },
  { timestamps: true },
);

// Une seule entrée par commande et par société.
preparationUrgenceSchema.index({ entreprise: 1, numpro: 1 }, { unique: true });

const PreparationUrgence = mongoose.model(
  "PreparationUrgence",
  preparationUrgenceSchema,
);

export default PreparationUrgence;
