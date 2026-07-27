// src/config/chatReactions.js
//
// Réactions « pro » : clé → emoji + libellé. Synchronisé avec
// backend/config/chatReactions.js.

export const CHAT_REACTIONS = {
  like: { emoji: "👍", label: "J'aime" },
  love: { emoji: "❤️", label: "J'adore" },
  clap: { emoji: "👏", label: "Bravo" },
  check: { emoji: "✅", label: "Validé" },
  idea: { emoji: "💡", label: "Idée" },
  fire: { emoji: "🔥", label: "Top" },
};

export const REACTION_KEYS = Object.keys(CHAT_REACTIONS);

export const reactionEmoji = (key) => CHAT_REACTIONS[key]?.emoji || "👍";
export const reactionLabel = (key) => CHAT_REACTIONS[key]?.label || key;
