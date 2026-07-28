// backend/models/EtiquetteTemplateModel.js
//
// TEMPLATE d'étiquette PERSONNALISÉE, enregistré PAR SOCIÉTÉ. Tout utilisateur
// ayant accès à la société + le module « etiquettes » peut le lister et l'utiliser
// (collaboration), quel que soit le créateur. `config` = layout émis par le
// designer custom ({ widthPx, heightPx, copies, elements }).
import mongoose from "mongoose";

const etiquetteTemplateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nom: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // Template conçu avec des données article (champ/code-barres/logo) ?
    dataMode: { type: Boolean, default: false },
    // Layout du designer custom (px) : { widthPx, heightPx, copies, elements }.
    config: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true },
);

etiquetteTemplateSchema.index({ entreprise: 1, updatedAt: -1 });

const EtiquetteTemplate = mongoose.model(
  "EtiquetteTemplate",
  etiquetteTemplateSchema,
);
export default EtiquetteTemplate;
