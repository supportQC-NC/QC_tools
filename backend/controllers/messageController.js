// backend/controllers/messageController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Message from "../models/MessageModel.js";
import RoomRead from "../models/RoomReadModel.js";
import { isValidReaction } from "../config/chatReactions.js";
import {
  canAccessRoom,
  canModerateRoom,
  roomRecipients,
} from "../utils/chatAccess.js";
import {
  buildReplySnapshot,
  sanitizeMentions,
  mentionUserIds,
} from "../utils/chatMessageHelpers.js";
import {
  uploadBufferToGridFS,
  deleteFromGridFS,
  findGridFSFile,
  openDownloadStream,
} from "../utils/gridfsBucket.js";

const CHAT_FILES_BUCKET = "chatfiles";

// multer décode le nom en latin1 : on rétablit l'UTF-8 (accents/spéciaux).
const decodeName = (name = "") => {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
};

const kindFromMime = (mime = "") => {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.includes("spreadsheet") || mime.includes("excel") || mime === "text/csv")
    return "tableur";
  return "autre";
};

const AUTEUR_FIELDS = "nom prenom photo photoUpdatedAt";

// Diffuse un message au salon + pousse la notif « non lu » aux destinataires
// (et `notif:mention` aux personnes mentionnées).
const broadcastMessage = async (io, populated, authorId) => {
  if (!io) return;
  io.to(populated.room).emit("message:new", populated);
  const recipients = await roomRecipients(populated.room);
  const mentioned = new Set(mentionUserIds(populated.mentions));
  for (const uid of recipients) {
    if (uid !== String(authorId)) {
      io.to(`user:${uid}`).emit("notif:message", { room: populated.room });
      if (mentioned.has(uid)) {
        io.to(`user:${uid}`).emit("notif:mention", { room: populated.room });
      }
    }
  }
};

// @desc    Historique d'un salon de chat
// @route   GET /api/messages?room=global|team:<id>|task:<id>|conv:<id>&limit=100
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

  const messages = await Message.find({ room })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("auteur", AUTEUR_FIELDS)
    .populate("reactions.user", "prenom nom")
    .lean();

  res.json(messages.reverse());
});

// @desc    Fichiers & médias partagés d'un salon (galerie du panneau latéral)
// @route   GET /api/messages/media?room=...
// @access  Privé (accès au salon vérifié)
const getRoomMedia = asyncHandler(async (req, res) => {
  const { room } = req.query;
  if (!room) {
    res.status(400);
    throw new Error("Salon (room) requis");
  }
  if (!(await canAccessRoom(req.user, room))) {
    res.status(403);
    throw new Error("Accès à ce salon refusé");
  }
  // Messages porteurs d'au moins une pièce jointe, du plus récent au plus ancien.
  const msgs = await Message.find({ room, "attachments.0": { $exists: true } })
    .select("attachments auteur createdAt")
    .populate("auteur", "prenom nom")
    .sort({ createdAt: -1 })
    .limit(400)
    .lean();

  // Aplatit en une liste de fichiers (l'ordre = messages récents d'abord).
  const items = [];
  for (const m of msgs) {
    for (const a of m.attachments || []) {
      items.push({
        messageId: String(m._id),
        fileId: String(a._id),
        fileName: a.fileName,
        kind: a.kind,
        size: a.size,
        at: m.createdAt,
        auteurPrenom: m.auteur?.prenom || "",
      });
    }
  }
  res.json(items);
});

// @desc    Envoyer un message AVEC fichiers (le texte pur passe par le socket)
// @route   POST /api/messages   (multipart, champ "files")
// @access  Privé (accès au salon vérifié)
const sendMessage = asyncHandler(async (req, res) => {
  const { room } = req.body;
  const texte = (req.body.texte || "").trim();
  const files = req.files || [];

  if (!room) {
    res.status(400);
    throw new Error("Salon (room) requis");
  }
  if (!(await canAccessRoom(req.user, room))) {
    res.status(403);
    throw new Error("Accès à ce salon refusé");
  }
  if (!texte && files.length === 0) {
    res.status(400);
    throw new Error("Message vide");
  }

  const attachments = [];
  for (const f of files) {
    const fileName = decodeName(f.originalname);
    const fileId = await uploadBufferToGridFS(
      f.buffer,
      fileName,
      f.mimetype || "application/octet-stream",
      CHAT_FILES_BUCKET,
    );
    attachments.push({
      fileId,
      fileName,
      mimeType: f.mimetype || "application/octet-stream",
      size: f.size || f.buffer.length || 0,
      kind: kindFromMime(f.mimetype),
      uploadedBy: req.user._id,
    });
  }

  // Citation + mentions (mentions transmises en JSON dans le multipart).
  const reply = await buildReplySnapshot(req.body.replyTo, room);
  let rawMentions = [];
  try {
    rawMentions = req.body.mentions ? JSON.parse(req.body.mentions) : [];
  } catch {
    rawMentions = [];
  }
  const cleanMentions = await sanitizeMentions(rawMentions, room);

  const created = await Message.create({
    room,
    auteur: req.user._id,
    texte: texte.slice(0, 4000),
    attachments,
    replyTo: reply || undefined,
    mentions: cleanMentions,
  });
  const populated = await Message.findById(created._id)
    .populate("auteur", AUTEUR_FIELDS)
    .populate("reactions.user", "prenom nom")
    .lean();

  await broadcastMessage(req.app.get("io"), populated, req.user._id);
  res.status(201).json(populated);
});

// @desc    Télécharger / prévisualiser un fichier attaché à un message
// @route   GET /api/messages/:id/files/:fileId
// @access  Privé (accès au salon vérifié)
const downloadMessageFile = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id).lean();
  if (!message) {
    res.status(404);
    throw new Error("Message introuvable");
  }
  if (!(await canAccessRoom(req.user, message.room))) {
    res.status(403);
    throw new Error("Accès à ce salon refusé");
  }
  const doc = (message.attachments || []).find(
    (a) => a._id.toString() === req.params.fileId,
  );
  if (!doc) {
    res.status(404);
    throw new Error("Fichier introuvable");
  }
  const gridFile = await findGridFSFile(doc.fileId, CHAT_FILES_BUCKET);
  if (!gridFile) {
    res.status(404);
    throw new Error("Fichier absent du stockage");
  }

  const safeName = encodeURIComponent(doc.fileName || "fichier");
  const inline = doc.kind === "pdf" || doc.kind === "image";
  res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${safeName}`,
  );
  if (gridFile.length) res.setHeader("Content-Length", gridFile.length);

  const stream = openDownloadStream(doc.fileId, CHAT_FILES_BUCKET);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  stream.pipe(res);
});

// @desc    Éditer le texte d'un message (auteur uniquement)
// @route   PUT /api/messages/:id   { texte }
// @access  Auteur
const editMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) {
    res.status(404);
    throw new Error("Message introuvable");
  }
  if (String(message.auteur) !== String(req.user._id)) {
    res.status(403);
    throw new Error("Seul l'auteur peut modifier ce message");
  }
  const texte = (req.body.texte || "").trim();
  if (!texte) {
    res.status(400);
    throw new Error("Le message ne peut pas être vide");
  }
  message.texte = texte.slice(0, 4000);
  message.editedAt = new Date();
  await message.save();

  const io = req.app.get("io");
  if (io) {
    io.to(message.room).emit("message:edited", {
      id: String(message._id),
      room: message.room,
      texte: message.texte,
      editedAt: message.editedAt,
    });
  }
  res.json({ id: String(message._id), texte: message.texte, editedAt: message.editedAt });
});

// @desc    Épingler / désépingler un message (auteur ou modérateur du salon)
// @route   POST /api/messages/:id/pin
// @access  Auteur / modérateur
const pinMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) {
    res.status(404);
    throw new Error("Message introuvable");
  }
  const isAuthor = String(message.auteur) === String(req.user._id);
  if (!isAuthor && !(await canModerateRoom(req.user, message.room))) {
    res.status(403);
    throw new Error("Vous ne pouvez pas épingler ce message");
  }
  message.pinned = !message.pinned;
  message.pinnedAt = message.pinned ? new Date() : null;
  message.pinnedBy = message.pinned ? req.user._id : null;
  await message.save();

  const io = req.app.get("io");
  if (io) {
    io.to(message.room).emit("message:pinned", {
      id: String(message._id),
      room: message.room,
      pinned: message.pinned,
    });
  }
  res.json({ id: String(message._id), pinned: message.pinned });
});

// @desc    Messages épinglés d'un salon (bandeau)
// @route   GET /api/messages/pinned?room=...
// @access  Privé (accès au salon vérifié)
const getPinned = asyncHandler(async (req, res) => {
  const { room } = req.query;
  if (!room) {
    res.status(400);
    throw new Error("Salon (room) requis");
  }
  if (!(await canAccessRoom(req.user, room))) {
    res.status(403);
    throw new Error("Accès à ce salon refusé");
  }
  const pinned = await Message.find({ room, pinned: true })
    .sort({ pinnedAt: -1 })
    .limit(10)
    .populate("auteur", AUTEUR_FIELDS)
    .lean();
  res.json(pinned);
});

// @desc    Rechercher dans les messages d'un salon
// @route   GET /api/messages/search?room=...&q=...
// @access  Privé (accès au salon vérifié)
const searchMessages = asyncHandler(async (req, res) => {
  const { room } = req.query;
  const q = (req.query.q || "").trim();
  if (!room) {
    res.status(400);
    throw new Error("Salon (room) requis");
  }
  if (!(await canAccessRoom(req.user, room))) {
    res.status(403);
    throw new Error("Accès à ce salon refusé");
  }
  if (q.length < 2) return res.json([]);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const results = await Message.find({
    room,
    texte: { $regex: escaped, $options: "i" },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("auteur", AUTEUR_FIELDS)
    .lean();
  res.json(results);
});

// @desc    Supprimer un message (auteur, ou modérateur du salon)
// @route   DELETE /api/messages/:id
// @access  Auteur / responsable-admin de la discussion
const deleteMessage = asyncHandler(async (req, res) => {
  const message = await Message.findById(req.params.id);
  if (!message) {
    res.status(404);
    throw new Error("Message introuvable");
  }

  const isAuthor = String(message.auteur) === String(req.user._id);
  if (!isAuthor && !(await canModerateRoom(req.user, message.room))) {
    res.status(403);
    throw new Error("Vous ne pouvez pas supprimer ce message");
  }

  await Promise.all(
    (message.attachments || []).map((a) =>
      deleteFromGridFS(a.fileId, CHAT_FILES_BUCKET),
    ),
  );
  const room = message.room;
  const id = String(message._id);
  await Message.deleteOne({ _id: message._id });

  const io = req.app.get("io");
  if (io) io.to(room).emit("message:deleted", { id, room });

  res.json({ message: "Message supprimé", id });
});

// @desc    (Dé)réagir à un message — une réaction par utilisateur (toggle)
// @route   POST /api/messages/:id/react   { type }
// @access  Privé (accès au salon vérifié)
const reactToMessage = asyncHandler(async (req, res) => {
  const { type } = req.body;
  if (!isValidReaction(type)) {
    res.status(400);
    throw new Error("Réaction invalide");
  }
  const message = await Message.findById(req.params.id);
  if (!message) {
    res.status(404);
    throw new Error("Message introuvable");
  }
  if (!(await canAccessRoom(req.user, message.room))) {
    res.status(403);
    throw new Error("Accès à ce salon refusé");
  }

  const uid = String(req.user._id);
  const existing = message.reactions.find((r) => String(r.user) === uid);
  if (existing) {
    if (existing.type === type) {
      // Même réaction -> on l'enlève (toggle off).
      message.reactions = message.reactions.filter(
        (r) => String(r.user) !== uid,
      );
    } else {
      existing.type = type; // change de réaction
    }
  } else {
    message.reactions.push({ user: req.user._id, type });
  }
  await message.save();

  const populated = await Message.findById(message._id)
    .populate("reactions.user", "prenom nom")
    .lean();

  const io = req.app.get("io");
  if (io) {
    io.to(message.room).emit("message:reaction", {
      id: String(message._id),
      room: message.room,
      reactions: populated.reactions,
    });
  }
  res.json({ reactions: populated.reactions });
});

// @desc    Accusés de lecture d'un salon (qui a lu jusqu'où)
// @route   GET /api/messages/reads?room=...
// @access  Privé (accès au salon vérifié)
const getReads = asyncHandler(async (req, res) => {
  const { room } = req.query;
  if (!room) {
    res.status(400);
    throw new Error("Salon (room) requis");
  }
  if (!(await canAccessRoom(req.user, room))) {
    res.status(403);
    throw new Error("Accès à ce salon refusé");
  }
  const reads = await RoomRead.find({ room })
    .populate("user", "prenom nom photo photoUpdatedAt")
    .lean();
  res.json(
    reads
      .filter((r) => r.user)
      .map((r) => ({ user: r.user, lastReadAt: r.lastReadAt })),
  );
});

export {
  getMessages,
  getRoomMedia,
  sendMessage,
  downloadMessageFile,
  editMessage,
  pinMessage,
  getPinned,
  searchMessages,
  deleteMessage,
  reactToMessage,
  getReads,
};
