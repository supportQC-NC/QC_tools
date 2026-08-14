// backend/models/PrimeCommercialModel.js
//
// Paramètres de PRIME d'un commercial, par société — portage du .pbix
// « pbi_QC_stats_<COMMERCIAL> », où le taux était codé en dur dans une colonne
// calculée (`IF(NOM="CAMELIA", 0.015, 0)`) : un fichier Power BI par personne.
// Ici chaque commercial saisit son propre paramétrage.
//
// Formules reproduites (voir services/commercialAnalyseService.js) :
//   prime portefeuille = Σ (CA HT net − coût de revient) × taux   [assiette marge]
//   prime fournisseur  = palier atteint par la marge brute du fournisseur primé
//   prime totale       = prime portefeuille + prime fournisseur
//
// ⚠️ Outil de SUIVI/simulation pour le commercial : ce n'est pas la paie.

import mongoose from "mongoose";

// Palier : à partir de `seuil` de marge, la prime vaut `montant` (en F).
const palierSchema = new mongoose.Schema(
  {
    seuil: { type: Number, required: true },
    montant: { type: Number, required: true },
  },
  { _id: false },
);

const primeCommercialSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    // Taux appliqué à l'assiette (0.015 = 1,5 %, comme le fichier de Camelia).
    taux: { type: Number, default: 0 },
    // Assiette du calcul : la marge (fichier d'origine) ou le CA HT net.
    assiette: {
      type: String,
      enum: ["marge", "ca"],
      default: "marge",
    },
    // Prime additionnelle sur un fournisseur (le « BLUM » du rapport, FOURN=24).
    fournisseurPrime: {
      // Code FOURN dans article.dbf ; vide = pas de prime fournisseur.
      code: { type: String, default: "" },
      libelle: { type: String, default: "" },
      // La marge du fournisseur est-elle mesurée sur TOUTE la société
      // (comportement du fichier d'origine, via ALL(catClient)) ou sur le seul
      // portefeuille du commercial ?
      surTouteLaSociete: { type: Boolean, default: true },
      // Paliers continus, triés par seuil croissant.
      paliers: {
        type: [palierSchema],
        default: () => [
          { seuil: 1300000, montant: 20000 },
          { seuil: 1400000, montant: 30000 },
          { seuil: 1600000, montant: 40000 },
          { seuil: 1800000, montant: 60000 },
          { seuil: 2000000, montant: 80000 },
          { seuil: 2200000, montant: 120000 },
        ],
      },
    },
  },
  { timestamps: true },
);

primeCommercialSchema.index({ user: 1, entreprise: 1 }, { unique: true });

const PrimeCommercial = mongoose.model(
  "PrimeCommercial",
  primeCommercialSchema,
);

export default PrimeCommercial;
