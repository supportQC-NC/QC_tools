// src/presenceClient.js
//
// Présence temps réel : qui est connecté à l'application + son STATUT
// (actif / absent / occupe). Petit store externe (useSyncExternalStore) alimenté
// par les évènements socket `presence:state` (snapshot) et `presence:update`
// (delta). Le CÂBLAGE des écouteurs est fait par NotificationsSync (point d'entrée
// socket unique) via applyPresenceState/applyPresenceUpdate/resetPresence.
//
// Modèle : une Map userId(string) -> statut. Présent dans la Map = EN LIGNE ;
// absent de la Map = hors ligne. dsklfdskfkljsdfj
import { useSyncExternalStore } from "react";

let statusMap = new Map(); // id -> "actif" | "absent" | "occupe"
const listeners = new Set();

const notify = () => listeners.forEach((l) => l());
const commit = (next) => {
  statusMap = next;
  notify();
};

export const applyPresenceState = (list = []) => {
  const next = new Map();
  for (const it of list || []) {
    if (it && it.userId) next.set(String(it.userId), it.status || "actif");
  }
  commit(next);
};

export const applyPresenceUpdate = ({ userId, online, status } = {}) => {
  if (!userId) return;
  const id = String(userId);
  const next = new Map(statusMap);
  if (online) next.set(id, status || "actif");
  else next.delete(id);
  commit(next);
};

export const resetPresence = () => {
  if (statusMap.size === 0) return;
  commit(new Map());
};

const subscribe = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => statusMap;

// Hook : renvoie des helpers de présence.
//   isOnline(id)  -> booléen
//   statusOf(id)  -> "actif" | "absent" | "occupe" (en ligne) | "offline"
export const usePresence = () => {
  const map = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    map,
    isOnline: (id) => !!id && map.has(String(id)),
    statusOf: (id) => (id && map.get(String(id))) || "offline",
    onlineCount: map.size,
  };
};

export const isUserOnline = (id) => !!id && statusMap.has(String(id));

// Statut MANUEL choisi par l'utilisateur (null = automatique/actif). Utilisé par
// l'auto-absent pour ne pas écraser un « occupe »/« absent » volontaire.
let myManualStatus = null;
export const setMyManualStatus = (s) => {
  myManualStatus = s || null;
};
export const getMyManualStatus = () => myManualStatus;
