// backend/models/MailAutomationModel.js
//
// AUTOMATISATION façon Brevo : un déclencheur + une SÉQUENCE d'emails (chacun
// avec un délai). Ex. « email de bienvenue » = déclencheur « nouveau client »,
// étape 1 immédiate + étape 2 à J+3.
//
// SÉCURITÉ : `active=false` par défaut. À l'activation, on SEED le référentiel des
// contacts connus (MailKnownContact) SANS enrôler les clients existants → seuls
// les clients apparaissant APRÈS activation reçoivent la séquence (jamais un
// envoi massif rétroactif à toute la base).
import mongoose from "mongoose";

const stepSchema = new mongoose.Schema(
  {
    subject: { type: String, default: "" },
    replyTo: { type: String, default: "" },
    design: { type: mongoose.Schema.Types.Mixed, default: () => ({ blocks: [] }) },
    // Délai (en jours) AVANT l'envoi de cette étape (0 = immédiat à l'entrée / après l'étape précédente).
    delayDays: { type: Number, default: 0, min: 0, max: 365 },
  },
  { _id: false },
);

const mailAutomationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nom: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    active: { type: Boolean, default: false },
    trigger: {
      // nouveau_client = détection auto dans le DBF ;
      // liste = contacts ajoutés/importés (CSV/Excel) → email de bienvenue.
      type: {
        type: String,
        enum: ["nouveau_client", "liste"],
        default: "nouveau_client",
      },
    },
    steps: { type: [stepSchema], default: [] },
    // Date de constitution du référentiel de contacts (à l'activation).
    baselineSeededAt: { type: Date, default: null },
    enrolledCount: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

mailAutomationSchema.index({ entreprise: 1, updatedAt: -1 });

const MailAutomation = mongoose.model("MailAutomation", mailAutomationSchema);
export default MailAutomation;
