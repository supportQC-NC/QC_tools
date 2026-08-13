// backend/models/EvenementSpecialModel.js
//
// ÉVÉNEMENTS SPÉCIAUX saisis à la main (grève, blocage, cyclone, jour férié,
// opération commerciale…) : ils expliquent les creux et les pics de
// fréquentation du magasin.
//
// Un événement peut être global (toutes les sociétés) ou limité à certaines
// sociétés (un blocage de route ne concerne pas tous les magasins).
import mongoose from "mongoose";

export const EVENEMENT_TYPES = [
  "greve",
  "blocage",
  "cyclone",
  "intemperies",
  "ferie",
  "operation",
  "travaux",
  "autre",
];

// Libellés affichés (UI / Excel).
export const EVENEMENT_TYPE_LABELS = {
  greve: "Grève",
  blocage: "Blocage",
  cyclone: "Cyclone",
  intemperies: "Intempéries",
  ferie: "Jour férié",
  operation: "Opération commerciale",
  travaux: "Travaux",
  autre: "Autre",
};

export const EVENEMENT_IMPACTS = ["fermeture", "perturbation", "hausse", "aucun"];

const evenementSchema = new mongoose.Schema(
  {
    libelle: { type: String, required: true, trim: true },
    type: { type: String, enum: EVENEMENT_TYPES, default: "autre" },
    // Bornes INCLUSES, au format "AAAA-MM-JJ".
    dateDebut: { type: String, required: true, trim: true },
    dateFin: { type: String, required: true, trim: true },
    // Créneau horaire optionnel ("HH:MM"). Vide = journées entières.
    // La fenêtre est CONTINUE : de dateDebut/heureDebut à dateFin/heureFin
    // (un blocage du 12 à 10:00 au 13 à 09:00 couvre la nuit intermédiaire —
    // sans effet puisque le magasin est fermé).
    heureDebut: { type: String, default: "", trim: true },
    heureFin: { type: String, default: "", trim: true },
    // Effet attendu (aide à la lecture des écarts).
    impact: { type: String, enum: EVENEMENT_IMPACTS, default: "perturbation" },
    // EXCLURE de l'analyse : les ventes de cette fenêtre ne comptent plus dans
    // les moyennes, les tranches horaires ni la carte de chaleur. Elles restent
    // mesurées à part, dans le récapitulatif des événements. Indispensable pour
    // que les références (« un mardi normal ») ne soient pas polluées par une
    // journée de grève ou de cyclone.
    exclure: { type: Boolean, default: false },
    // Sociétés concernées ; tableau VIDE = toutes les sociétés.
    entreprises: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Entreprise" },
    ],
    commentaire: { type: String, default: "" },
    creePar: { type: String, default: "" },
  },
  { timestamps: true },
);

evenementSchema.index({ dateDebut: 1, dateFin: 1 });

const EvenementSpecial = mongoose.model("EvenementSpecial", evenementSchema);

export default EvenementSpecial;
