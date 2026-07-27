// backend/socket/chatSocket.js
//
// Serveur temps réel (Socket.IO) pour le chat. Authentification via le cookie
// JWT `token` (même origine que le REST). Salons : global / team:<id> / task:<id>.

import jwt from "jsonwebtoken";
import User from "../models/UserModel.js";
import Message from "../models/MessageModel.js";
import RoomRead from "../models/RoomReadModel.js";
import { canAccessRoom, roomRecipients } from "../utils/chatAccess.js";

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

    // Salon PERSONNEL (stable, jamais quitté) : reçoit les notifications ciblées
    // (message non lu, nouvelle tâche) pour rafraîchir les badges de la sidebar
    // même quand l'utilisateur n'est pas sur l'écran de chat.
    socket.join(`user:${user._id}`);

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
          .populate("auteur", "nom prenom photo photoUpdatedAt")
          .lean();
        io.to(room).emit("message:new", populated);

        // Notification « message non lu » : poussée sur le salon personnel de
        // chaque destinataire (hors auteur) pour mettre à jour le badge sidebar.
        const recipients = await roomRecipients(room);
        for (const uid of recipients) {
          if (uid === user._id.toString()) continue;
          io.to(`user:${uid}`).emit("notif:message", { room });
        }

        if (typeof ack === "function") ack({ ok: true });
      } catch {
        if (typeof ack === "function") ack({ ok: false, error: "Envoi échoué" });
      }
    });

    // Indicateur « en train d'écrire » : rediffusé aux AUTRES membres du salon.
    socket.on("typing", async ({ room, actif } = {}) => {
      try {
        if (!room || !(await canAccessRoom(user, room))) return;
        socket.to(room).emit("typing", {
          room,
          actif: actif !== false,
          user: { _id: user._id, prenom: user.prenom, nom: user.nom },
        });
      } catch {
        /* silencieux */
      }
    });

    // Accusé de lecture : l'utilisateur a lu le salon jusqu'à maintenant.
    // Pas d'accusés sur « global » (concerne tout le monde -> inutile).
    socket.on("room:read", async (room) => {
      try {
        if (!room || room === "global") return;
        if (!(await canAccessRoom(user, room))) return;
        const now = new Date();
        await RoomRead.findOneAndUpdate(
          { user: user._id, room },
          { lastReadAt: now },
          { upsert: true },
        );
        socket.to(room).emit("room:read", {
          room,
          lastReadAt: now,
          user: {
            _id: user._id,
            prenom: user.prenom,
            nom: user.nom,
            photo: user.photo || null,
            photoUpdatedAt: user.photoUpdatedAt || null,
          },
        });
      } catch {
        /* silencieux */
      }
    });
  });
};

export default initChat;
