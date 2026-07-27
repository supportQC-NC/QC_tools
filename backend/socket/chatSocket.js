// backend/socket/chatSocket.js
//
// Serveur temps réel (Socket.IO) pour le chat. Authentification via le cookie
// JWT `token` (même origine que le REST). Salons : global / team:<id> / task:<id>.

import jwt from "jsonwebtoken";
import User from "../models/UserModel.js";
import Message from "../models/MessageModel.js";
import { canAccessRoom } from "../utils/chatAccess.js";

// Extrait un cookie nommé depuis l'entête brut "a=1; b=2".
const readCookie = (raw = "", name) => {
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
};

// Authentifie une connexion socket à partir du cookie JWT du handshake.
const authenticateSocket = async (socket, next) => {
  try {
    const rawCookie = socket.handshake.headers?.cookie || "";
    const token = readCookie(rawCookie, "token");
    if (!token) return next(new Error("Non authentifié"));
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) return next(new Error("Utilisateur introuvable"));
    socket.user = user;
    next();
  } catch {
    next(new Error("Token invalide"));
  }
};

export const initChat = (io) => {
  io.use(authenticateSocket);

  io.on("connection", (socket) => {
    const user = socket.user;

    // Rejoindre un salon (après contrôle d'accès).
    socket.on("room:join", async (room, ack) => {
      try {
        if (!(await canAccessRoom(user, room))) {
          if (typeof ack === "function") ack({ ok: false, error: "Accès refusé" });
          return;
        }
        socket.join(room);
        if (typeof ack === "function") ack({ ok: true });
      } catch {
        if (typeof ack === "function") ack({ ok: false, error: "Erreur" });
      }
    });

    socket.on("room:leave", (room) => {
      socket.leave(room);
    });

    // Envoi d'un message : contrôle d'accès -> persistance -> diffusion au salon.
    socket.on("message:send", async ({ room, texte } = {}, ack) => {
      try {
        const contenu = (texte || "").trim();
        if (!room || !contenu) {
          if (typeof ack === "function") ack({ ok: false, error: "Message vide" });
          return;
        }
        if (!(await canAccessRoom(user, room))) {
          if (typeof ack === "function") ack({ ok: false, error: "Accès refusé" });
          return;
        }
        const created = await Message.create({
          room,
          auteur: user._id,
          texte: contenu.slice(0, 4000),
        });
        const populated = await Message.findById(created._id)
          .populate("auteur", "nom prenom")
          .lean();
        io.to(room).emit("message:new", populated);
        if (typeof ack === "function") ack({ ok: true });
      } catch {
        if (typeof ack === "function") ack({ ok: false, error: "Envoi échoué" });
      }
    });
  });
};

export default initChat;
