// backend/models/MessageModel.js
//
// Message de chat. Le `room` identifie le salon :
//   - "global"        : chat commun à tous les utilisateurs connectés ;
//   - "team:<teamId>" : chat d'une équipe (membres + responsable + admin) ;
//   - "task:<taskId>" : chat d'une tâche (manager ↔ assigné).

import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    room: { type: String, required: true, index: true, trim: true },
    auteur: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    texte: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  { timestamps: true },
);

messageSchema.index({ room: 1, createdAt: 1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;
