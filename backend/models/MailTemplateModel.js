// backend/models/MailTemplateModel.js
//
// MODÈLE d'email réutilisable, enregistré PAR SOCIÉTÉ et PARTAGÉ : tout utilisateur
// ayant accès à la société + le module « mailing » peut le lister et l'utiliser
// (collaboration), quel que soit le créateur. Même patron que EtiquetteTemplate /
// MailSegment (scope société via entrepriseId, pas de :nomDossierDBF).
//
// `design` = blob émis par le designer de blocs ({ blocks, settings }), identique
// au champ `design` d'une campagne → un modèle se charge tel quel dans l'éditeur.
import mongoose from "mongoose";

const mailTemplateSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nom: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    // Objet d'email pré-rempli (facultatif).
    subject: { type: String, default: "" },
    // { blocks: [...], settings: { bg, contentWidth, fontFamily } }
    design: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({ blocks: [] }),
    },
  },
  { timestamps: true },
);

mailTemplateSchema.index({ entreprise: 1, updatedAt: -1 });

const MailTemplate = mongoose.model("MailTemplate", mailTemplateSchema);

export default MailTemplate;
