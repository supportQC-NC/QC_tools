// backend/models/MailEventModel.js
//
// Événements de suivi d'une campagne : OUVERTURE (pixel 1×1) et CLIC (redirection
// des liens). `rid` = index du destinataire dans le snapshot de la campagne
// (permet de compter les ouvertures/clics UNIQUES via distinct(rid)).
import mongoose from "mongoose";

const mailEventSchema = new mongoose.Schema(
  {
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MailCampaign",
      required: true,
    },
    kind: { type: String, enum: ["open", "click"], required: true },
    rid: { type: Number, default: -1 }, // index destinataire (unicité)
    url: { type: String, default: "" }, // pour les clics
    at: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

mailEventSchema.index({ campaign: 1, kind: 1 });
mailEventSchema.index({ campaign: 1, kind: 1, rid: 1 });

const MailEvent = mongoose.model("MailEvent", mailEventSchema);
export default MailEvent;
