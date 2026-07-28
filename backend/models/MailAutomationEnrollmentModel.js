// backend/models/MailAutomationEnrollmentModel.js
//
// INSCRIPTION d'un contact dans une automatisation : suit l'étape courante et la
// date du prochain envoi. Le scheduler traite les inscriptions dues, envoie
// l'étape puis avance jusqu'à la fin de la séquence.
import mongoose from "mongoose";

const enrollmentSchema = new mongoose.Schema(
  {
    automation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MailAutomation",
      required: true,
    },
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    nom: { type: String, default: "" },
    stepIndex: { type: Number, default: 0 }, // prochaine étape à envoyer
    nextRunAt: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["active", "done", "stopped"],
      default: "active",
    },
  },
  { timestamps: true },
);

// Un contact n'est enrôlé qu'une fois par automatisation.
enrollmentSchema.index({ automation: 1, email: 1 }, { unique: true });
enrollmentSchema.index({ status: 1, nextRunAt: 1 });

const MailAutomationEnrollment = mongoose.model(
  "MailAutomationEnrollment",
  enrollmentSchema,
);
export default MailAutomationEnrollment;
