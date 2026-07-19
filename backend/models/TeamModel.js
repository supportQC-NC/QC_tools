// backend/models/TeamModel.js
//
// ÉQUIPE (team) : regroupe des MEMBRES (User) sous un RESPONSABLE, au sein d'UNE
// entreprise. Un responsable peut posséder plusieurs équipes ; un même membre
// peut appartenir à plusieurs équipes (N-N), y compris dans des sociétés
// différentes — c'est pourquoi la relation vit ici et NON sur le User.
//
// Le contrôle d'accès (qui peut voir/gérer une équipe) et l'ATTÉNUATION des
// permissions (un responsable ne peut accorder à un membre que ce qu'il possède
// lui-même) sont centralisés dans middleware/accessControl.js.
//
// NB : ce modèle est conçu pour accueillir plus tard les TÂCHES (assignées à un
// membre d'une équipe, avec deadline/statut) sans refonte.

import mongoose from "mongoose";

const teamSchema = new mongoose.Schema(
  {
    nom: {
      type: String,
      required: [true, "Nom de l'équipe requis"],
      trim: true,
    },
    // Société à laquelle l'équipe est rattachée. Le périmètre société des membres
    // reste porté par leur document Permission ; ce champ fixe le contexte de
    // l'équipe (et borne l'atténuation côté responsable).
    entreprise: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Entreprise",
      required: [true, "Entreprise requise"],
    },
    // Le responsable (lead) de l'équipe. C'est lui qui gère les membres et leurs
    // permissions (dans la limite des siennes).
    responsable: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Responsable requis"],
    },
    // Membres de l'équipe (des User de rôle "user" en pratique).
    membres: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    description: {
      type: String,
      default: "",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Qui a créé l'équipe (admin société ou responsable).
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// Un responsable ne peut pas avoir deux équipes du même nom dans la même société.
teamSchema.index({ entreprise: 1, responsable: 1, nom: 1 }, { unique: true });
teamSchema.index({ responsable: 1 });
teamSchema.index({ membres: 1 });

const Team = mongoose.model("Team", teamSchema);

export default Team;
