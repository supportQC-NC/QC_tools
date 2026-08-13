// backend/models/MeteoJourModel.js
//
// Météo QUOTIDIENNE d'un lieu, utilisée pour croiser la fréquentation du
// magasin avec le temps qu'il a fait (module « Fréquentation magasin »).
//
// Une ligne = un jour × un lieu. Alimentée automatiquement par le job
// quotidien (services/meteoService.js) et corrigeable à la main depuis
// l'onglet « Météo » de l'écran d'analyse.
import mongoose from "mongoose";

// Catégories utilisées pour l'analyse (dérivées de la pluie et du soleil).
export const METEO_CATEGORIES = ["beau", "mitige", "pluvieux"];

const meteoJourSchema = new mongoose.Schema(
  {
    // Lieu (slug) : une société de brousse n'a pas la météo de Nouméa.
    lieu: { type: String, required: true, trim: true, lowercase: true },

    // Jour au format "AAAA-MM-JJ" (clé de jointure avec l'analyse).
    date: { type: String, required: true, trim: true },

    // Mesures du jour.
    pluieMm: { type: Number, default: 0 },
    pluieHeures: { type: Number, default: 0 },
    soleilHeures: { type: Number, default: 0 },
    tMin: { type: Number, default: null },
    tMax: { type: Number, default: null },

    // Code temps WMO + libellé lisible (« Pluie modérée »…).
    code: { type: Number, default: null },
    libelle: { type: String, default: "" },

    // Catégorie retenue pour les regroupements de l'analyse.
    categorie: { type: String, enum: METEO_CATEGORIES, default: "beau" },

    // Provenance : "open-meteo" (job automatique) ou "manuel" (corrigé à la main).
    source: { type: String, default: "open-meteo" },
    // Valeur encore susceptible de bouger : les 3 derniers jours sont publiés
    // par le modèle avant d'être consolidés par la réanalyse. La collecte
    // nocturne repasse dessus et lève le drapeau.
    provisoire: { type: Boolean, default: false },
    // Une correction manuelle n'est JAMAIS écrasée par le job automatique.
    verrouille: { type: Boolean, default: false },
    modifiePar: { type: String, default: "" },
  },
  { timestamps: true },
);

meteoJourSchema.index({ lieu: 1, date: 1 }, { unique: true });

const MeteoJour = mongoose.model("MeteoJour", meteoJourSchema);

export default MeteoJour;
