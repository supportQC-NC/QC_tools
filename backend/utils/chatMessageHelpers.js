// backend/utils/chatMessageHelpers.js
//
// Aides partagées par le socket (message:send) ET le REST (POST /messages) pour
// construire une CITATION (replyTo) et NETTOYER les mentions @ d'un message.
import Message from "../models/MessageModel.js";
import { roomRecipients } from "./chatAccess.js";

// Construit le snapshot d'un message cité (texte court + auteur). Renvoie null si
// le message n'existe pas ou n'appartient pas au même salon (anti-triche).
export const buildReplySnapshot = async (replyToId, room) => {
  if (!replyToId) return null;
  let src;
  try {
    src = await Message.findById(replyToId)
      .populate("auteur", "prenom nom")
      .lean();
  } catch {
    return null;
  }
  if (!src || src.room !== room) return null;
  const txt = src.texte || (src.attachments?.length ? "📎 Pièce jointe" : "");
  return {
    message: src._id,
    texte: String(txt).slice(0, 140),
    auteurPrenom: src.auteur?.prenom || "",
    auteurNom: src.auteur?.nom || "",
  };
};

// Ne garde que les mentions dont l'utilisateur fait bien partie du salon.
// `mentions` = [{ user, display }]. Renvoie une liste propre (dédupliquée).
export const sanitizeMentions = async (mentions, room) => {
  const arr = Array.isArray(mentions) ? mentions : [];
  if (arr.length === 0) return [];
  const allowed = new Set(await roomRecipients(room));
  const seen = new Set();
  const out = [];
  for (const m of arr) {
    const uid = String(m?.user || "");
    if (!uid || !allowed.has(uid) || seen.has(uid)) continue;
    seen.add(uid);
    out.push({ user: uid, display: String(m.display || "").slice(0, 60) });
  }
  return out;
};

// Ids des utilisateurs mentionnés (pour pousser une notification ciblée).
export const mentionUserIds = (mentions) =>
  (mentions || []).map((m) => String(m.user)).filter(Boolean);
