// backend/config/chatReactions.js
//
// Réactions autorisées sur un message (jeu « pro »). On stocke la CLÉ ; le rendu
// (emoji/label) vit côté frontend (frontend/src/config/chatReactions.js).
// Garder les deux listes synchronisées.

export const REACTION_KEYS = [
  "like", // 👍 J'aime
  "love", // ❤️ J'adore
  "clap", // 👏 Bravo
  "check", // ✅ Validé
  "idea", // 💡 Idée
  "fire", // 🔥 Top
];

export const isValidReaction = (key) => REACTION_KEYS.includes(key);

export default REACTION_KEYS;
