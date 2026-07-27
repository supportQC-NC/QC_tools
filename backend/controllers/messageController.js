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

// Diffuse un message au salon + pousse la notif « non lu » aux destinataires.
const broadcastMessage = async (io, populated, authorId) => {
  if (!io) return;
  io.to(populated.room).emit("message:new", populated);
  const recipients = await roomRecipients(populated.room);
  for (const uid of recipients) {
    if (uid !== String(authorId)) {
      io.to(`user:${uid}`).emit("notif:message", { room: populated.room });
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

  const created = await Message.create({
    room,
    auteur: req.user._id,
    texte: texte.slice(0, 4000),
    attachments,
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
  sendMessage,
  downloadMessageFile,
  deleteMessage,
  reactToMessage,
  getReads,
};
