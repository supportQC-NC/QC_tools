// backend/controllers/notificationController.js
//
// Compteurs de NOTIFICATIONS pour la sidebar (« Espace équipe » + « Mes tâches »).
//
// Sémantique volontairement simple : chaque surface a UN marqueur de dernière
// consultation sur le User (chatSeenAt / tasksSeenAt). Le compteur = nombre
// d'éléments arrivés APRÈS ce marqueur, en ignorant ce que l'utilisateur a
// lui-même produit. « Marquer lu » = repositionner le marqueur à maintenant
// (fait à l'ouverture de l'écran concerné).

import asyncHandler from "../middleware/asyncHandler.js";
import Message from "../models/MessageModel.js";
import Task from "../models/TaskModel.js";
import Team from "../models/TeamModel.js";
import User from "../models/UserModel.js";
import Conversation from "../models/ConversationModel.js";
import {
  isSuperAdmin,
  getAccessibleEntreprises,
} from "../middleware/accessControl.js";

// Salons de chat visibles par l'utilisateur (mêmes règles que EspaceEquipeScreen :
// « global » + une room par équipe accessible). Renvoie la liste des noms de room.
//
// ⚠️ CACHÉE 60 s par utilisateur (27/11/2026) : cette liste coûte ~4 requêtes
// Mongo et /counts est appelé par TOUS les utilisateurs connectés, en poll ET
// à chaque message socket — c'était le bruit de fond permanent de la base.
// Les équipes/conversations changent rarement : une room toute neuve entre
// dans le compteur en ≤ 60 s, et les compteurs des rooms connues restent
// exacts à la seconde (le countDocuments, lui, n'est pas caché).
const TTL_ROOMS = 60 * 1000;
const cacheRooms = new Map(); // userId -> { at, rooms }
const accessibleChatRooms = async (user) => {
  const cle = String(user._id);
  const hit = cacheRooms.get(cle);
  if (hit && Date.now() - hit.at < TTL_ROOMS) return hit.rooms;

  let teamFilter;
  if (await isSuperAdmin(user)) {
    teamFilter = {};
  } else if (user.role === "admin") {
    const { all, ids } = await getAccessibleEntreprises(user);
    teamFilter = all ? {} : { entreprise: { $in: ids } };
  } else {
    // Responsable / membre : ses équipes (dirigées ou dont il est membre).
    teamFilter = { $or: [{ responsable: user._id }, { membres: user._id }] };
  }

  const teams = await Team.find(teamFilter).select("_id");
  // Convs où je suis participant + convs RATTACHÉES à une de mes équipes
  // (même règle que getConversations — à garder synchronisés).
  const convs = await Conversation.find({
    $or: [
      { participants: user._id },
      { equipe: { $in: teams.map((t) => t._id) } },
    ],
  }).select("_id");
  const rooms = [
    "global",
    ...teams.map((t) => `team:${t._id}`),
    ...convs.map((c) => `conv:${c._id}`),
  ];
  cacheRooms.set(cle, { at: Date.now(), rooms });
  return rooms;
};

// @desc    Compteurs de notifications (messages non lus + tâches non vues)
// @route   GET /api/notifications/counts
// @access  Privé
const getCounts = asyncHandler(async (req, res) => {
  const user = req.user;

  // --- Messages non lus (tous salons accessibles confondus) ---
  const rooms = await accessibleChatRooms(user);
  const messages = await Message.countDocuments({
    room: { $in: rooms },
    auteur: { $ne: user._id },
    createdAt: { $gt: user.chatSeenAt || new Date(0) },
  });

  // --- Tâches non vues (assignées à l'utilisateur, non archivées, pas les siennes) ---
  const taches = await Task.countDocuments({
    assignes: user._id,
    creePar: { $ne: user._id },
    archive: { $ne: true },
    createdAt: { $gt: user.tasksSeenAt || new Date(0) },
  });

  res.json({ messages, taches });
});

// @desc    Marquer les messages (chat) comme lus
// @route   POST /api/notifications/chat/seen
// @access  Privé
const markChatSeen = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { chatSeenAt: new Date() });
  res.json({ ok: true });
});

// @desc    Marquer les tâches comme vues
// @route   POST /api/notifications/tasks/seen
// @access  Privé
const markTasksSeen = asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { tasksSeenAt: new Date() });
  res.json({ ok: true });
});

export { getCounts, markChatSeen, markTasksSeen };
