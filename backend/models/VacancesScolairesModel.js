// backend/models/VacancesScolairesModel.js
//
// Périodes de VACANCES SCOLAIRES saisies à la main (onglet dédié du module
// « Fréquentation magasin »). Sert à mesurer l'impact des vacances sur la
// fréquentation du magasin.
//
// Le calendrier scolaire est commun à toute la Nouvelle-Calédonie : ces
// périodes sont donc GLOBALES (pas de scope société).
import mongoose from "mongoose";

const vacancesSchema = new mongoose.Schema(
  {
    libelle: { type: String, required: true, trim: true }, // « Vacances de juillet »
    // Bornes INCLUSES, au format "AAAA-MM-JJ".
    dateDebut: { type: String, required: true, trim: true },
    dateFin: { type: String, required: true, trim: true },
    // Année scolaire de rattachement, libre (« 2026 »).
    anneeScolaire: { type: String, default: "", trim: true },
    commentaire: { type: String, default: "" },
    creePar: { type: String, default: "" },
  },
  { timestamps: true },
);

vacancesSchema.index({ dateDebut: 1, dateFin: 1 });

const VacancesScolaires = mongoose.model("VacancesScolaires", vacancesSchema);

export default VacancesScolaires;
