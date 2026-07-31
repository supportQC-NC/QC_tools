// backend/socket/chatSocket.js
//
// Serveur temps réel (Socket.IO) pour le chat. Authentification via le cookie
// JWT `token` (même origine que le REST). Salons : global / team:<id> / task:<id>.

import jwt from "jsonwebtoken";
import User from "../models/UserModel.js";
import Message from "../models/MessageModel.js";
import RoomRead from "../models/RoomReadModel.js";
import { canAccessRoom, roomRecipients } from "../utils/chatAccess.js";
import {
  buildReplySnapshot,
  sanitizeMentions,
  mentionUserIds,
} from "../utils/chatMessageHelpers.js";

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

// ── PRÉSENCE ──────────────────────────────────────────────────────────────
// Qui est connecté à l'application ? On compte les sockets par utilisateur
// (multi-onglets = plusieurs sockets pour un même user). En ligne = compteur > 0.
// Le STATUT (actif / absent / occupe) est transitoire, gardé en mémoire.
const onlineCounts = new Map(); // userId -> nb de sockets ouverts
const userStatus = new Map(); // userId -> "actif" | "absent" | "occupe"
const STATUSES = ["actif", "absent", "occupe"];

export const getOnlineUserIds = () => [...onlineCounts.keys()];

// Snapshot des utilisateurs en ligne avec leur statut.
const presenceSnapshot = () =>
  [...onlineCounts.keys()].map((id) => ({
    userId: id,
    status: userStatus.get(id) || "actif",
  }));

// Authentifie une connexion socket : token dans le handshake (app mobile, qui ne
// peut pas relire le cookie httpOnly) OU cookie JWT (web same-origin).
const authenticateSocket = async (socket, next) => {
  try {
    const rawCookie = socket.handshake.headers?.cookie || "";
    const token =
      socket.handshake.auth?.token || readCookie(rawCookie, "token");
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
    const uid = user._id.toString();

    // Salon PERSONNEL (stable, jamais quitté) : reçoit les notifications ciblées
    // (message non lu, nouvelle tâche) pour rafraîchir les badges de la sidebar
    // même quand l'utilisateur n'est pas sur l'écran de chat.
    socket.join(`user:${uid}`);

    // Présence : incrémente le compteur ; si c'était la 1re socket de ce user,
    // on l'annonce à tout le monde (statut par défaut « actif »). Puis on envoie
    // au nouvel arrivant le SNAPSHOT complet (users en ligne + statut).
    const prevCount = onlineCounts.get(uid) || 0;
    onlineCounts.set(uid, prevCount + 1);
    if (prevCount === 0) {
      if (!userStatus.has(uid)) userStatus.set(uid, "actif");
      io.emit("presence:update", {
        userId: uid,
        online: true,
        status: userStatus.get(uid) || "actif",
      });
    }
    socket.emit("presence:state", presenceSnapshot());

    // Le client peut redemander le snapshot (ex. reconnexion).
    socket.on("presence:get", (ack) => {
      const snap = presenceSnapshot();
      if (typeof ack === "function") ack(snap);
      else socket.emit("presence:state", snap);
    });

    // Changement de statut (manuel ou auto-absent) → rediffusé à tous.
    socket.on("presence:status", (status) => {
      const s = STATUSES.includes(status) ? status : "actif";
      userStatus.set(uid, s);
      io.emit("presence:update", { userId: uid, online: true, status: s });
    });

    // Déconnexion : décrémente ; si plus aucune socket, l'utilisateur passe
    // hors ligne pour tout le monde et on mémorise « vu à » (lastSeenAt).
    socket.on("disconnect", async () => {
      const c = (onlineCounts.get(uid) || 1) - 1;
      if (c <= 0) {
        onlineCounts.delete(uid);
        userStatus.delete(uid);
        io.emit("presence:update", { userId: uid, online: false });
        try {
          await User.updateOne({ _id: uid }, { lastSeenAt: new Date() });
        } catch {
          /* non bloquant */
        }
      } else {
        onlineCounts.set(uid, c);
      }
    });

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
    // Accepte une CITATION (replyTo = id du message cité) et des MENTIONS @.
    socket.on("message:send", async ({ room, texte, replyTo, mentions } = {}, ack) => {
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
        const reply = await buildReplySnapshot(replyTo, room);
        const cleanMentions = await sanitizeMentions(mentions, room);
        const created = await Message.create({
          room,
          auteur: user._id,
          texte: contenu.slice(0, 4000),
          replyTo: reply || undefined,
          mentions: cleanMentions,
        });
        const populated = await Message.findById(created._id)
          .populate("auteur", "nom prenom photo photoUpdatedAt")
          .lean();
        io.to(room).emit("message:new", populated);

        // Notification « message non lu » : poussée sur le salon personnel de
        // chaque destinataire (hors auteur) pour le badge sidebar. Les personnes
        // MENTIONNÉES reçoivent en plus `notif:mention` (signal plus fort).
        const recipients = await roomRecipients(room);
        const mentioned = new Set(mentionUserIds(cleanMentions));
        for (const uid of recipients) {
          if (uid === user._id.toString()) continue;
          io.to(`user:${uid}`).emit("notif:message", { room });
          if (mentioned.has(uid)) {
            io.to(`user:${uid}`).emit("notif:mention", { room });
          }
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
    // On enregistre la position de lecture pour TOUS les salons (y compris
    // « global ») afin de calculer les non-lus PAR conversation dans le rail.
    // En revanche, on ne DIFFUSE l'accusé « vu par » que hors « global »
    // (sinon bruit inutile : global concerne tout le monde).
    socket.on("room:read", async (room) => {
      try {
        if (!room) return;
        if (!(await canAccessRoom(user, room))) return;
        const now = new Date();
        await RoomRead.findOneAndUpdate(
          { user: user._id, room },
          { lastReadAt: now },
          { upsert: true },
        );
        if (room !== "global") {
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
        }
      } catch {
        /* silencieux */
      }
    });
  });
};

export default initChat;
