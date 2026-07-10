// backend/models/ReportSubscriptionModel.js
//
// Abonnement d'un utilisateur à l'envoi automatique d'un rapport Excel par email.
//
// Sécurité : la permission n'est PAS vérifiée par ce modèle. Elle l'est (a) à la
// config côté controller, et surtout (b) à l'envoi par le scheduler (reportDelivery),
// car les droits peuvent avoir été retirés entre-temps.
//
// Fuseau : serveur à l'heure de Nouméa (sans heure d'été) -> Date locale = OK.

import mongoose from "mongoose";

const FREQUENCES = ["journalier", "hebdomadaire", "mensuel"];
const PERIODES = [
  "jour_precedent",
  "jour_meme",
  "semaine_precedente",
  "semaine_en_cours",
  "mois_precedent",
  "mois_en_cours",
  "actuel",
];
const STATUTS = ["success", "error"];

const reportSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Clé d'entrée dans le registre des rapports (ex. "analyse_ca").
    reportKey: { type: String, required: true, trim: true },

    // Entreprise (dossier DBF) sur laquelle porte le rapport.
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
    },

    // ── Planification ────────────────────────────────────────────────────────
    frequence: { type: String, enum: FREQUENCES, required: true },
    // Utilisé si frequence = "mensuel" (borné à 28 pour éviter les mois courts).
    jourDuMois: { type: Number, min: 1, max: 28 },
    // Utilisé si frequence = "hebdomadaire" (0 = dimanche … 6 = samedi).
    jourDeSemaine: { type: Number, min: 0, max: 6 },
    heure: { type: Number, min: 0, max: 23, default: 12 },
    minute: { type: Number, min: 0, max: 59, default: 0 },

    // Fenêtre de données du rapport (dépend du type de rapport).
    periode: { type: String, enum: PERIODES, default: "mois_precedent" },

    // Destinataire ; par défaut l'email du user (résolu à l'envoi si vide).
    emailDestination: { type: String, trim: true, lowercase: true, default: "" },

    timezone: { type: String, default: "Pacific/Noumea" },
    actif: { type: Boolean, default: true },

    // Prochaine exécution prévue (interrogée par le scheduler).
    nextRunAt: { type: Date, index: true },

    // Trace de la dernière exécution (UI + débogage).
    lastRun: {
      at: { type: Date },
      status: { type: String, enum: STATUTS },
      message: { type: String, default: "" },
    },
  },
  { timestamps: true },
);

// Un même user ne s'abonne qu'une fois à un rapport donné pour une entreprise donnée.
reportSubscriptionSchema.index(
  { user: 1, reportKey: 1, entreprise: 1 },
  { unique: true },
);

// ── Calcul de la prochaine exécution (heure locale serveur) ──────────────────
reportSubscriptionSchema.methods.computeNextRunAt = function (from = new Date()) {
  const h = this.heure ?? 12;
  const min = this.minute ?? 0;

  if (this.frequence === "journalier") {
    let d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), h, min, 0, 0);
    if (d <= from) d.setDate(d.getDate() + 1);
    return d;
  }

  if (this.frequence === "hebdomadaire") {
    const cible = this.jourDeSemaine ?? 1;
    let d = new Date(from.getFullYear(), from.getMonth(), from.getDate(), h, min, 0, 0);
    const delta = (cible - d.getDay() + 7) % 7;
    d.setDate(d.getDate() + delta);
    if (d <= from) d.setDate(d.getDate() + 7);
    return d;
  }

  // mensuel
  const jour = this.jourDuMois ?? 1;
  let d = new Date(from.getFullYear(), from.getMonth(), jour, h, min, 0, 0);
  if (d <= from) d = new Date(from.getFullYear(), from.getMonth() + 1, jour, h, min, 0, 0);
  return d;
};

// Validation : champ « jour » requis selon la fréquence (rien pour journalier).
reportSubscriptionSchema.pre("validate", function (next) {
  if (this.frequence === "mensuel" && this.jourDuMois == null) {
    return next(new Error("jourDuMois est requis pour une fréquence mensuelle."));
  }
  if (this.frequence === "hebdomadaire" && this.jourDeSemaine == null) {
    return next(new Error("jourDeSemaine est requis pour une fréquence hebdomadaire."));
  }
  next();
});

// Recalcule nextRunAt à la création ou quand la planification change.
reportSubscriptionSchema.pre("save", function (next) {
  const planifChange =
    this.isNew ||
    this.isModified("frequence") ||
    this.isModified("jourDuMois") ||
    this.isModified("jourDeSemaine") ||
    this.isModified("heure") ||
    this.isModified("minute") ||
    this.isModified("actif");

  if (planifChange && this.actif) {
    this.nextRunAt = this.computeNextRunAt(new Date());
  }
  next();
});

const ReportSubscription = mongoose.model(
  "ReportSubscription",
  reportSubscriptionSchema,
);

export default ReportSubscription;