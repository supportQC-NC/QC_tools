// backend/controllers/conversationController.js
//
// DISCUSSIONS de l'Espace équipe. La liste unifiée regroupe TROIS familles :
//   - « global »   : canal de toute l'entreprise (bleu) — toujours présent ;
//   - « team:<id> »: une discussion par équipe accessible (vert) — DÉRIVÉE des
//                     Team, visible par les MEMBRES (corrige la limite où seul
//                     le responsable voyait l'équipe) ;
//   - « conv:<id> »: discussions libres créées par les users (violet), 1:1 ou
//                     groupe — persistées via ConversationModel.
// Le code couleur est porté par le champ `type` renvoyé au front.

import asyncHandler from "../middleware/asyncHandler.js";
import Conversation from "../models/ConversationModel.js";
import Team from "../models/TeamModel.js";
import Message from "../models/MessageModel.js";
import User from "../models/UserModel.js";
import {
  isSuperAdmin,
  getAccessibleEntreprises,
  canChatWith,
  canAccessTeam,
} from "../middleware/accessControl.js";
import { isValidChatIcon } from "../config/chatIcons.js";
import {
  uploadBufferToGridFS,
  deleteFromGridFS,
  findGridFSFile,
  openDownloadStream,
} from "../utils/gridfsBucket.js";

const CHAT_FILES_BUCKET = "chatfiles";
const CONV_PHOTOS_BUCKET = "convphotos";

const isParticipant = (conv, userId) =>
  (conv.participants || []).some((p) => String(p) === String(userId));

const userLite = "nom prenom email photo photoUpdatedAt";

// Nudge temps réel : demande aux participants de rafraîchir leur liste de convs.
const notifyConvRefresh = (req, userIds) => {
  const io = req.app.get("io");
  if (!io) return;
  for (const uid of userIds) io.to(`user:${uid}`).emit("conv:refresh");
};

// @desc    Liste unifiée des discussions visibles par l'utilisateur
// @route   GET /api/conversations
// @access  Privé
const getConversations = asyncHandler(async (req, res) => {
  const user = req.user;
  const out = [];

  const superA = await isSuperAdmin(user);

  // 1) Canal général (bleu). Modération réservée au super-admin.
  out.push({
    room: "global",
    type: "global",
    nom: "Général",
    sub: "Toute l'entreprise",
    icone: "globe",
    membresCount: null,
    isModerator: superA,
  });

  // 2) Équipes accessibles (vert) — membre OU responsable ; admin = ses sociétés.
  let teamFilter;
  if (await isSuperAdmin(user)) {
    teamFilter = {};
  } else if (user.role === "admin") {
    const { all, ids } = await getAccessibleEntreprises(user);
    teamFilter = all ? {} : { entreprise: { $in: ids } };
  } else {
    teamFilter = { $or: [{ responsable: user._id }, { membres: user._id }] };
  }
  const teams = await Team.find(teamFilter)
    .populate("entreprise", "trigramme")
    .select("nom icone membres entreprise responsable");
  for (const t of teams) {
    const nb = (t.membres || []).length;
    out.push({
      room: `team:${t._id}`,
      type: "team",
      id: String(t._id),
      nom: t.nom,
      sub: `${nb} membre${nb > 1 ? "s" : ""}${
        t.entreprise?.trigramme ? ` · ${t.entreprise.trigramme}` : ""
      }`,
      icone: t.icone || "users",
      membresCount: nb,
      // Modérateur = responsable de l'équipe / admin de la société / super-admin.
      isModerator: await canAccessTeam(user, t),
    });
  }

  // 3) Discussions créées par les users (violet) — où je suis participant.
  const convs = await Conversation.find({ participants: user._id })
    .populate("participants", userLite)
    .sort({ updatedAt: -1 });
  for (const c of convs) {
    let nom = c.nom;
    if (c.type === "direct") {
      const other = c.participants.find(
        (p) => String(p._id) !== String(user._id),
      );
      nom = other ? `${other.prenom} ${other.nom}` : "Discussion";
    }
    out.push({
      room: `conv:${c._id}`,
      type: c.type, // "direct" | "group"
      id: String(c._id),
      nom,
      sub:
        c.type === "direct"
          ? "Discussion privée"
          : `${c.participants.length} participants`,
      icone: c.icone || "chat",
      photo: c.photo || null,
      photoUpdatedAt: c.photoUpdatedAt || null,
      participants: c.participants.map((p) => ({
        _id: p._id,
        prenom: p.prenom,
        nom: p.nom,
        photo: p.photo || null,
        photoUpdatedAt: p.photoUpdatedAt || null,
      })),
      createdBy: String(c.createdBy),
      isOwner: String(c.createdBy) === String(user._id),
      // Modérateur d'une conv = son créateur.
      isModerator: String(c.createdBy) === String(user._id),
      membresCount: c.participants.length,
    });
  }

  res.json(out);
});

// @desc    Créer une discussion (1:1 ou groupe)
// @route   POST /api/conversations
// @access  Privé
const createConversation = asyncHandler(async (req, res) => {
  const { participants = [], nom = "", icone = "chat" } = req.body;

  // Périmètre : chaque participant doit être dans le périmètre société de l'acteur.
  const ids = [...new Set(participants.map(String))].filter(
    (id) => id !== String(req.user._id),
  );
  if (ids.length === 0) {
    res.status(400);
    throw new Error("Sélectionnez au moins un participant");
  }
  for (const id of ids) {
    // Périmètre CHAT (annuaire société), pas la gestion : tout user peut discuter
    // avec ses collègues de société.
    if (!(await canChatWith(req.user, id))) {
      res.status(403);
      throw new Error("Un des participants est hors de votre société");
    }
    const u = await User.findById(id).select("_id");
    if (!u) {
      res.status(404);
      throw new Error("Participant introuvable");
    }
  }

  const icon = isValidChatIcon(icone) ? icone : "chat";
  const type = ids.length > 1 ? "group" : "direct";

  // Pour un 1:1, réutiliser la conversation existante si elle existe déjà.
  if (type === "direct") {
    const existing = await Conversation.findOne({
      type: "direct",
      participants: { $all: [req.user._id, ids[0]], $size: 2 },
    });
    if (existing) {
      return res.status(200).json({ _id: existing._id, room: `conv:${existing._id}` });
    }
  }

  const conv = await Conversation.create({
    type,
    nom: type === "group" ? (nom || "").trim() : "",
    icone: icon,
    participants: [req.user._id, ...ids],
    createdBy: req.user._id,
  });

  notifyConvRefresh(req, ids);
  res.status(201).json({ _id: conv._id, room: `conv:${conv._id}` });
});

// @desc    Supprimer une discussion (créateur / super-admin) — + ses messages
// @route   DELETE /api/conversations/:id
// @access  Créateur ou super-admin
const deleteConversation = asyncHandler(async (req, res) => {
  const conv = await Conversation.findById(req.params.id);
  if (!conv) {
    res.status(404);
    throw new Error("Discussion introuvable");
  }
  const owner = String(conv.createdBy) === String(req.user._id);
  if (!owner && !(await isSuperAdmin(req.user))) {
    res.status(403);
    throw new Error("Seul le créateur peut supprimer cette discussion");
  }

  // Nettoyer les messages du salon + leurs fichiers GridFS.
  const room = `conv:${conv._id}`;
  const msgs = await Message.find({ room }).select("attachments");
  await Promise.all(
    msgs.flatMap((m) =>
      (m.attachments || []).map((a) =>
        deleteFromGridFS(a.fileId, CHAT_FILES_BUCKET),
      ),
    ),
  );
  await Message.deleteMany({ room });

  const participantIds = (conv.participants || []).map((p) => String(p));
  await Conversation.deleteOne({ _id: conv._id });

  notifyConvRefresh(req, participantIds);
  res.json({ message: "Discussion supprimée" });
});

// @desc    Quitter une discussion (participant non-créateur)
// @route   POST /api/conversations/:id/leave
// @access  Participant
const leaveConversation = asyncHandler(async (req, res) => {
  const conv = await Conversation.findById(req.params.id);
  if (!conv) {
    res.status(404);
    throw new Error("Discussion introuvable");
  }
  const isParticipant = (conv.participants || []).some(
    (p) => String(p) === String(req.user._id),
  );
  if (!isParticipant) {
    res.status(403);
    throw new Error("Vous ne faites pas partie de cette discussion");
  }

  conv.participants = conv.participants.filter(
    (p) => String(p) !== String(req.user._id),
  );

  // Plus assez de monde => on supprime la conversation et ses messages.
  if (conv.participants.length < 2) {
    const room = `conv:${conv._id}`;
    const msgs = await Message.find({ room }).select("attachments");
    await Promise.all(
      msgs.flatMap((m) =>
        (m.attachments || []).map((a) =>
          deleteFromGridFS(a.fileId, CHAT_FILES_BUCKET),
        ),
      ),
    );
    await Message.deleteMany({ room });
    const participantIds = (conv.participants || []).map((p) => String(p));
    await Conversation.deleteOne({ _id: conv._id });
    notifyConvRefresh(req, participantIds);
  } else {
    await conv.save();
    notifyConvRefresh(req, conv.participants.map((p) => String(p)));
  }

  res.json({ message: "Vous avez quitté la discussion" });
});

// @desc    Définir/remplacer la photo d'un groupe
// @route   POST /api/conversations/:id/photo   (multipart, champ "photo")
// @access  Participant (groupe uniquement)
const uploadConversationPhoto = asyncHandler(async (req, res) => {
  const conv = await Conversation.findById(req.params.id);
  if (!conv) {
    res.status(404);
    throw new Error("Discussion introuvable");
  }
  if (conv.type !== "group") {
    res.status(400);
    throw new Error("Seuls les groupes ont une photo");
  }
  if (!isParticipant(conv, req.user._id)) {
    res.status(403);
    throw new Error("Vous ne faites pas partie de ce groupe");
  }
  if (!req.file || !(req.file.mimetype || "").startsWith("image/")) {
    res.status(400);
    throw new Error("Une image est requise");
  }
  if (conv.photo) await deleteFromGridFS(conv.photo, CONV_PHOTOS_BUCKET);
  const fileId = await uploadBufferToGridFS(
    req.file.buffer,
    `conv-${conv._id}`,
    req.file.mimetype,
    CONV_PHOTOS_BUCKET,
  );
  conv.photo = fileId;
  conv.photoUpdatedAt = new Date();
  await conv.save();

  notifyConvRefresh(req, (conv.participants || []).map((p) => String(p)));
  res.json({ photo: conv.photo, photoUpdatedAt: conv.photoUpdatedAt });
});

// @desc    Servir la photo d'un groupe
// @route   GET /api/conversations/:id/photo
// @access  Participant
const getConversationPhoto = asyncHandler(async (req, res) => {
  const conv = await Conversation.findById(req.params.id).select(
    "participants photo",
  );
  if (!conv || !conv.photo || !isParticipant(conv, req.user._id)) {
    res.status(404);
    throw new Error("Pas de photo");
  }
  const gf = await findGridFSFile(conv.photo, CONV_PHOTOS_BUCKET);
  if (!gf) {
    res.status(404);
    throw new Error("Photo absente du stockage");
  }
  res.setHeader("Content-Type", gf.contentType || "image/jpeg");
  if (gf.length) res.setHeader("Content-Length", gf.length);
  res.setHeader("Cache-Control", "private, max-age=3600");
  const stream = openDownloadStream(conv.photo, CONV_PHOTOS_BUCKET);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  stream.pipe(res);
});

// @desc    Retirer la photo d'un groupe
// @route   DELETE /api/conversations/:id/photo
// @access  Participant
const deleteConversationPhoto = asyncHandler(async (req, res) => {
  const conv = await Conversation.findById(req.params.id);
  if (!conv) {
    res.status(404);
    throw new Error("Discussion introuvable");
  }
  if (!isParticipant(conv, req.user._id)) {
    res.status(403);
    throw new Error("Vous ne faites pas partie de ce groupe");
  }
  if (conv.photo) {
    await deleteFromGridFS(conv.photo, CONV_PHOTOS_BUCKET);
    conv.photo = null;
    conv.photoUpdatedAt = new Date();
    await conv.save();
    notifyConvRefresh(req, (conv.participants || []).map((p) => String(p)));
  }
  res.json({ ok: true });
});

export {
  getConversations,
  createConversation,
  deleteConversation,
  leaveConversation,
  uploadConversationPhoto,
  getConversationPhoto,
  deleteConversationPhoto,
};
