// backend/models/RoomReadModel.js
//
// Position de LECTURE d'un utilisateur dans un salon (accusés de lecture « vu par »).
// Un doc par (user, room) : `lastReadAt` = date du dernier message vu. Sert à
// afficher, façon Messenger, qui a lu jusqu'où. Distinct de User.chatSeenAt (qui
// est un marqueur GLOBAL pour le badge de la sidebar).

import mongoose from "mongoose";

const roomReadSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    room: { type: String, required: true, trim: true },
    lastReadAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

roomReadSchema.index({ user: 1, room: 1 }, { unique: true });
roomReadSchema.index({ room: 1 });

const RoomRead = mongoose.model("RoomRead", roomReadSchema);

export default RoomRead;
