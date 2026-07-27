// backend/controllers/messageController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Message from "../models/MessageModel.js";
import { canAccessRoom } from "../utils/chatAccess.js";

// @desc    Historique d'un salon de chat
// @route   GET /api/messages?room=global|team:<id>|task:<id>&limit=100
// @access  Privé (accès au salon vérifié)
const getMessages = asyncHandler(async (req, res) => {
  const { room } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 100, 300);

  if (!room) {
    res.status(400);
    throw new Error("Salon (room) requis");
  }
  if (!(await canAccessRoom(req.user, room))) {
    res.status(403);
    throw new Error("Accès à ce salon refusé");
  }

  // Les N derniers messages, renvoyés dans l'ordre chronologique.
  const messages = await Message.find({ room })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("auteur", "nom prenom")
    .lean();

  res.json(messages.reverse());
});

export { getMessages };
