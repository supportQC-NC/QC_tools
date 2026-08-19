// backend/models/VeilleConfigModel.js
//
// Une « veille » = une tâche récurrente PERSONNELLE : chaque semaine, à un jour
// et une heure choisis, l'IA prépare un récap des actualités du domaine suivi
// et le livre sous forme de page HTML autonome.
//
// La trame du prompt est FIXE (constante VEILLE_PROMPT_TEMPLATE du service) ;
// ce document ne stocke que les parties personnalisables par l'utilisateur.
// `promptPersonnalise` permet à un habitué de réécrire la trame entière.
import mongoose from "mongoose";

// 0 = dimanche … 6 = samedi (convention Date.getDay()).
export const JOURS = [
  "dimanche",
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
];

// La Nouvelle-Calédonie est à UTC+11 toute l'année (pas d'heure d'été) :
// on peut convertir avec un décalage fixe sans dépendance de fuseau.
const OFFSET_NC_MINUTES = 11 * 60;

// Prochaine occurrence (jour, heure) en heure de Nouméa, STRICTEMENT après `depuis`.
export const calculerProchainRun = (jour, heure, depuis = new Date()) => {
  const j = Number.isInteger(jour) ? jour : 1;
  const [h, m] = String(heure || "08:00")
    .split(":")
    .map((x) => parseInt(x, 10) || 0);

  // Date/heure locale Nouméa correspondant à `depuis`.
  const nc = new Date(depuis.getTime() + OFFSET_NC_MINUTES * 60000);
  const cible = new Date(nc);
  cible.setUTCHours(h, m, 0, 0);
  // Décale au bon jour de la semaine.
  const delta = (j - cible.getUTCDay() + 7) % 7;
  cible.setUTCDate(cible.getUTCDate() + delta);
  // Si l'occurrence est déjà passée, on prend celle de la semaine suivante.
  if (cible.getTime() <= nc.getTime()) cible.setUTCDate(cible.getUTCDate() + 7);

  return new Date(cible.getTime() - OFFSET_NC_MINUTES * 60000);
};

const veilleConfigSchema = new mongoose.Schema(
  {
    // Une veille appartient à UN utilisateur : personne d'autre ne la voit.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    nom: { type: String, default: "Ma veille hebdomadaire", trim: true },
    actif: { type: Boolean, default: true },

    // ── Planification ────────────────────────────────────────────────────
    jour: { type: Number, min: 0, max: 6, default: 1 }, // lundi
    heure: { type: String, default: "08:00" }, // "HH:MM", heure de Nouméa
    // Prochaine exécution planifiée — sert de VERROU au planificateur.
    prochainRunAt: { type: Date, default: null },
    dernierRunAt: { type: Date, default: null },

    // ── Champs personnalisables du prompt ────────────────────────────────
    domaine: { type: String, default: "", trim: true },
    // Liste fermée : voir ZONES dans services/veilleService.js (pas d'import
    // ici, ce serait un cycle — le service importe déjà ce modèle). Le contrôleur
    // ramène toute valeur inconnue sur l'une des zones connues.
    zone: { type: String, default: "Nouvelle-Calédonie", trim: true },
    // Une thématique par ligne (le prompt les reprend telles quelles).
    thematiques: { type: String, default: "" },
    activite: { type: String, default: "", trim: true },
    topX: { type: Number, min: 1, max: 20, default: 5 },

    // ── Mise en forme du rendu HTML ──────────────────────────────────────
    style: { type: String, default: "sobre et premium", trim: true },
    reference: { type: String, default: "newsletter premium", trim: true },
    couleurs: { type: [String], default: ["#0F172A", "#6366F1", "#F8FAFC"] },
    typoTexte: { type: String, default: "Inter", trim: true },
    typoTitres: { type: String, default: "Playfair Display", trim: true },

    // ── Avancé ───────────────────────────────────────────────────────────
    // Trame complète réécrite par l'utilisateur (vide = trame par défaut).
    promptPersonnalise: { type: String, default: "" },
    // "standard" (rapide/économique) ou "qualite" (modèle plus capable).
    qualite: { type: String, enum: ["standard", "qualite"], default: "standard" },
  },
  { timestamps: true },
);

// Le planificateur balaye sur ces deux champs.
veilleConfigSchema.index({ actif: 1, prochainRunAt: 1 });

// Recalcule la prochaine occurrence après `depuis`.
veilleConfigSchema.methods.calculerProchainRun = function (depuis = new Date()) {
  return calculerProchainRun(this.jour, this.heure, depuis);
};

const VeilleConfig = mongoose.model("VeilleConfig", veilleConfigSchema);

export default VeilleConfig;
