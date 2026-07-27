// src/config/chatIcons.js
//
// Mapping clé d'icône → composant react-icons pour les discussions. Doit rester
// synchronisé avec backend/config/chatIcons.js (mêmes clés).
import {
  HiChatAlt2,
  HiUserGroup,
  HiBriefcase,
  HiTruck,
  HiCube,
  HiClipboardList,
  HiStar,
  HiFire,
  HiBell,
  HiFlag,
  HiCog,
  HiCalendar,
  HiHeart,
  HiLightningBolt,
  HiGlobeAlt,
  HiFolder,
} from "react-icons/hi";

export const CHAT_ICONS = {
  chat: HiChatAlt2,
  users: HiUserGroup,
  briefcase: HiBriefcase,
  truck: HiTruck,
  cube: HiCube,
  clipboard: HiClipboardList,
  star: HiStar,
  fire: HiFire,
  bell: HiBell,
  flag: HiFlag,
  wrench: HiCog,
  calendar: HiCalendar,
  heart: HiHeart,
  lightning: HiLightningBolt,
  globe: HiGlobeAlt,
  folder: HiFolder,
};

export const CHAT_ICON_KEYS = Object.keys(CHAT_ICONS);

export const chatIcon = (key) => CHAT_ICONS[key] || CHAT_ICONS.chat;
