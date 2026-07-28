// backend/models/MailCampaignModel.js
//
// Campagne de mailing. Le DESIGN (blocs) est un blob JSON libre (Mixed). Les
// destinataires sont SNAPSHOTÉS au lancement (le DBF change sous nous, cache TTL
// 5 min) puis envoyés PAR LOTS avec pause — l'avancement (cursor/sentCount) est
// persistant pour que l'envoi soit REPRENABLE après un redémarrage.

import mongoose from "mongoose";

const recipientSchema = new mongoose.Schema(
  // variant = "" (pas d'A/B) | "A" | "B" (assigné au lancement si A/B activé).
  { email: String, nom: String, variant: { type: String, default: "" } },
  { _id: false },
);

const mailCampaignSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    nom: { type: String, required: true, trim: true },
    subject: { type: String, default: "" },
    replyTo: { type: String, default: "" },
    // { blocks: [...], settings: { bg, contentWidth, fontFamily } }
    design: { type: mongoose.Schema.Types.Mixed, default: () => ({ blocks: [] }) },
    // Cible des destinataires.
    scope: {
      type: {
        type: String,
        enum: ["tous", "categorie", "profes", "csv", "segment"],
        default: "tous",
      },
      categories: { type: [String], default: [] },
      profes: { type: [String], default: [] },
      csvEmails: { type: [String], default: [] },
      segmentId: { type: mongoose.Schema.Types.ObjectId, ref: "MailSegment" },
    },
    testEmails: { type: [String], default: [] },
    // A/B TESTING de l'objet : 50% reçoivent subject, 50% subjectB.
    abTest: {
      enabled: { type: Boolean, default: false },
      subjectB: { type: String, default: "" },
    },
    // Snapshot figé au lancement.
    recipients: { type: [recipientSchema], default: [] },
    recipientsTotal: { type: Number, default: 0 }, // = recipients.length (pour la liste, sans charger le tableau)
    batchSize: { type: Number, default: 25, min: 1, max: 500 },
    pauseMinutes: { type: Number, default: 60, min: 0, max: 1440 },
    status: {
      type: String,
      enum: ["brouillon", "test_envoye", "en_cours", "pause", "termine", "erreur"],
      default: "brouillon",
    },
    cursor: { type: Number, default: 0 }, // index du prochain destinataire à traiter
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    nextBatchAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

mailCampaignSchema.index({ user: 1, updatedAt: -1 });
mailCampaignSchema.index({ status: 1, nextBatchAt: 1 });

const MailCampaign = mongoose.model("MailCampaign", mailCampaignSchema);

export default MailCampaign;
