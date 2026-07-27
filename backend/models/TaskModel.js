// backend/models/TaskModel.js
//
// TÂCHE assignée à un MEMBRE d'une équipe, avec échéance, statut et priorité.
// Créée/gérée par le RESPONSABLE de l'équipe (ou un admin de la société).
// Le MEMBRE assigné peut consulter ses tâches et en faire évoluer le STATUT.
//
// `entreprise` est dénormalisée depuis l'équipe pour permettre un filtrage
// efficace par société côté admin (évite un join systématique).

import mongoose from "mongoose";

export const TASK_STATUTS = ["a_faire", "en_cours", "termine", "bloque"];
export const TASK_PRIORITES = ["basse", "normale", "haute", "urgente"];

// Pièce jointe d'une tâche (PDF / Excel / image…), stockée dans GridFS.
const taskDocumentSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true }, // ref GridFS
    fileName: { type: String, required: true },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    kind: {
      type: String,
      enum: ["pdf", "image", "tableur", "autre"],
      default: "autre",
    },
    // Qui a déposé le document (créateur OU assigné).
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const taskSchema = new mongoose.Schema(
  {
    titre: {
      type: String,
      required: [true, "Titre requis"],
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    // Type de tâche :
    //   - "equipe" : assignée par un responsable/admin à un membre d'une équipe.
    //   - "perso"  : créée par un utilisateur pour lui-même (sans équipe).
    type: {
      type: String,
      enum: ["equipe", "perso"],
      default: "equipe",
    },
    // Équipe (requise pour les tâches d'équipe ; null pour les tâches perso).
    equipe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      default: null,
    },
    // Membres à qui la tâche est assignée (1..n ; pour une tâche perso = l'auteur).
    assignes: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: [],
    },
    // Auteur (responsable/admin pour une tâche d'équipe, ou l'utilisateur lui-même).
    creePar: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Société de rattachement (dénormalisée depuis l'équipe ; null si perso).
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      default: null,
    },
    deadline: {
      type: Date,
      default: null,
    },
    statut: {
      type: String,
      enum: TASK_STATUTS,
      default: "a_faire",
    },
    priorite: {
      type: String,
      enum: TASK_PRIORITES,
      default: "normale",
    },
    // Horodatage du passage en "termine" (null sinon).
    completedAt: {
      type: Date,
      default: null,
    },
    // Documents joints (PDF/Excel/images), déposés par le créateur ou l'assigné.
    documents: {
      type: [taskDocumentSchema],
      default: [],
    },
    // Archivage : une tâche passée en "termine" est archivée pour ne pas
    // encombrer le tableau de travail.
    archive: {
      type: Boolean,
      default: false,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

taskSchema.index({ assignes: 1, statut: 1 });
taskSchema.index({ equipe: 1 });
taskSchema.index({ entreprise: 1 });

const Task = mongoose.model("Task", taskSchema);

export default Task;
