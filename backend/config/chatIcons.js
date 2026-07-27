// backend/config/chatIcons.js
//
// Liste des clés d'icônes autorisées pour une discussion. Le mapping clé →
// composant visuel vit côté frontend (frontend/src/config/chatIcons.js) ; ici on
// ne garde que les clés valides pour la VALIDATION (création/mise à jour).
// Garder les deux fichiers synchronisés.

export const CHAT_ICON_KEYS = [
  "chat",
  "users",
  "briefcase",
  "truck",
  "cube",
  "clipboard",
  "star",
  "fire",
  "bell",
  "flag",
  "wrench",
  "calendar",
  "heart",
  "lightning",
  "globe",
  "folder",
];

export const isValidChatIcon = (key) => CHAT_ICON_KEYS.includes(key);

export default CHAT_ICON_KEYS;
