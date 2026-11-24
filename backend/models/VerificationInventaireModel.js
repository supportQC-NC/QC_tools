// backend/models/VerificationInventaireModel.js
//
// JOURNAL DE LA VÉRIFICATION POINT ROUGE (24/11/2026) : en fin d'inventaire,
// un agent repère les scotchs SANS point rouge dans une allée contrôlée, bipe
// l'article, et le système croise avec les bipages de l'ALLÉE. Chaque bip de
// vérification est tracé ici (décision client : le « conforme » se trace
// aussi), qu'il ait ou non produit une ligne de bipage.
//
//   conforme : l'article était bien bipé dans l'allée à la bonne quantité —
//              l'agent de bipage avait juste oublié le point rouge ;
//   ajout    : article jamais bipé dans l'allée → ligne créée (qté du scotch) ;
//   ecart    : bipé mais pas à la quantité du scotch → ligne de DELTA créée
//              (le scotch fait foi, delta négatif accepté).

import mongoose from "mongoose";

const verificationInventaireSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
      index: true,
    },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InventaireZoneSession",
      required: true,
      index: true,
    },
    // Allée vérifiée = PREMIÈRE lettre du code de zone (convention du récap).
    allee: { type: String, default: "" },

    // Ce que l'agent a réellement bipé, sans interprétation.
    codeScanne: { type: String, default: "" },
    // Résolution catalogue (renvois GENDOUBL suivis) au moment du bip.
    nart: { type: String, default: "" },
    designation: { type: String, default: "" },

    verdict: {
      type: String,
      enum: ["conforme", "ajout", "ecart"],
      required: true,
    },
    // Quantité lue sur le scotch (absente pour un « conforme » constaté à
    // l'œil), total trouvé dans l'allée au moment du bip, et delta écrit.
    qteScotch: { type: Number, default: null },
    qteTrouvee: { type: Number, default: 0 },
    delta: { type: Number, default: 0 },

    // Zone choisie pour l'ajout (la ligne créée, le cas échéant).
    zoneCode: { type: String, default: "" },
    zoneType: { type: String, default: "" },
    ligneBipage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LigneBipage",
      default: null,
    },

    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    agentNom: { type: String, default: "" },
  },
  { timestamps: true },
);

verificationInventaireSchema.index({ session: 1, allee: 1 });

const VerificationInventaire = mongoose.model(
  "VerificationInventaire",
  verificationInventaireSchema,
);

export default VerificationInventaire;
