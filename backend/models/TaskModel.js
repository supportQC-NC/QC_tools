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
    equipe: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Team",
      required: [true, "Équipe requise"],
    },
    // Membre à qui la tâche est assignée.
    assigneA: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Assigné requis"],
    },
    // Auteur (responsable ou admin).
    creePar: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Société de rattachement (dénormalisée depuis l'équipe).
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: true,
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
  },
  {
    timestamps: true,
  },
);

taskSchema.index({ assigneA: 1, statut: 1 });
taskSchema.index({ equipe: 1 });
taskSchema.index({ entreprise: 1 });

const Task = mongoose.model("Task", taskSchema);

export default Task;
