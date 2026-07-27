// backend/socket/chatSocket.js
//
// Serveur temps réel (Socket.IO) pour le chat. Authentification via le cookie
// JWT `token` (même origine que le REST). Salons : global / team:<id> / task:<id>.

import jwt from "jsonwebtoken";
import User from "../models/UserModel.js";
import Message from "../models/MessageModel.js";
import Team from "../models/TeamModel.js";
import Task from "../models/TaskModel.js";
import { canAccessRoom } from "../utils/chatAccess.js";

// Destinataires d'un message : ids des users concernés par le salon (pour
// pousser une notification « message non lu » sur leur salon personnel).
//   - global    -> tous les utilisateurs actifs
//   - team:<id> -> membres + responsable de l'équipe
//   - task:<id> -> assignés + auteur de la tâche
const roomRecipients = async (room) => {
  if (room === "global") {
    const users = await User.find({ isActive: true }).select("_id");
    return users.map((u) => u._id.toString());
  }
  const sep = room.indexOf(":");
  if (sep === -1) return [];
  const kind = room.slice(0, sep);
  const id = room.slice(sep + 1);
  if (kind === "team") {
    const team = await Team.findById(id).select("membres responsable");
    if (!team) return [];
    return [...(team.membres || []), team.responsable]
      .filter(Boolean)
      .map((x) => x.toString());
  }
  if (kind === "task") {
    const task = await Task.findById(id).select("assignes creePar");
    if (!task) return [];
    return [...(task.assignes || []), task.creePar]
      .filter(Boolean)
      .map((x) => x.toString());
  }
  return [];
};

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
          .populate("auteur", "nom prenom")
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
  });
};

export default initChat;
