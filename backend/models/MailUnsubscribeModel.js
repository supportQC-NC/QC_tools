// backend/models/MailUnsubscribeModel.js
//
// Liste de DÉSINSCRIPTION (blacklist) par société. Quand un client clique sur
// « se désinscrire » en bas d'un email, on enregistre son adresse ici ; elle est
// alors EXCLUE des futures campagnes de cette société (voir launchCampaign).
import mongoose from "mongoose";

const mailUnsubscribeSchema = new mongoose.Schema(
  {
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    // Campagne qui a déclenché la désinscription (traçabilité, facultatif).
    campaign: { type: mongoose.Schema.Types.ObjectId, ref: "MailCampaign" },
  },
  { timestamps: true },
);

// Une seule entrée par (société, email).
mailUnsubscribeSchema.index({ entreprise: 1, email: 1 }, { unique: true });

const MailUnsubscribe = mongoose.model("MailUnsubscribe", mailUnsubscribeSchema);
export default MailUnsubscribe;
