// backend/models/VeilleRapportModel.js
//
// Un rapport de veille produit par l'IA : la page HTML autonome livrée à
// l'utilisateur (ouverte dans un nouvel onglet), plus la traçabilité de sa
// génération (sources consultées, modèle, coût, durée).
//
// Le HTML est stocké tel quel — c'est le livrable. Il est servi par une route
// dédiée avec une CSP stricte (aucun script exécuté), voir veilleController.
import mongoose from "mongoose";

const veilleRapportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    config: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VeilleConfig",
      required: true,
      index: true,
    },
    // Recopiés à la génération : un rapport reste lisible même si la veille a
    // été renommée ou supprimée depuis.
    nomVeille: { type: String, default: "" },
    domaine: { type: String, default: "" },

    // Semaine couverte (bornes calculées à la génération).
    periodeDebut: { type: Date, default: null },
    periodeFin: { type: Date, default: null },

    titre: { type: String, default: "" },
    html: { type: String, default: "" },

    // Sources web réellement fournies au modèle (Tavily), pour vérification.
    // `type` : "actualite" (la semaine écoulée) ou "tendance" (analyse de fond,
    // qui alimente la section « Pour aller plus loin » du rapport).
    sources: {
      type: [
        {
          _id: false,
          titre: String,
          url: String,
          date: String,
          type: { type: String, default: "actualite" },
        },
      ],
      default: [],
    },
    // Vrai si aucune recherche web n'a pu être faite : le contenu vient alors
    // des seules connaissances du modèle, donc à prendre avec des pincettes.
    sansRechercheWeb: { type: Boolean, default: false },
    // Vrai si la zone demandée n'a pas donné assez d'actualités et que la
    // recherche a dû être élargie au-delà.
    rechercheElargie: { type: Boolean, default: false },
    // Liens que le modèle a inventés et que la vérification a rendus inertes.
    // Reste à 0 sur un rapport sain : une valeur élevée signale un modèle qui
    // s'écarte de ses sources.
    liensNeutralises: { type: Number, default: 0 },

    statut: {
      type: String,
      enum: ["en_cours", "termine", "erreur"],
      default: "en_cours",
    },
    erreur: { type: String, default: "" },

    declencheur: { type: String, enum: ["auto", "manuel"], default: "auto" },
    modele: { type: String, default: "" },
    tokensPrompt: { type: Number, default: 0 },
    tokensReponse: { type: Number, default: 0 },
    dureeMs: { type: Number, default: 0 },
  },
  { timestamps: true },
);

veilleRapportSchema.index({ user: 1, createdAt: -1 });

const VeilleRapport = mongoose.model("VeilleRapport", veilleRapportSchema);

export default VeilleRapport;
