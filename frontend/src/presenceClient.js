// src/presenceClient.js
//
// Présence temps réel : qui est connecté à l'application. Petit store externe
// (compatible useSyncExternalStore) alimenté par les évènements socket
// `presence:state` (snapshot) et `presence:update` (delta). Le CÂBLAGE des
// écouteurs socket est fait par NotificationsSync (point d'entrée socket unique),
// via wirePresence()/unwirePresence(), pour rester lié au cycle de vie du socket.
import { useSyncExternalStore } from "react";

let onlineSet = new Set(); // ids (string) des utilisateurs en ligne
const listeners = new Set();

const notify = () => listeners.forEach((l) => l());

// getSnapshot doit renvoyer une référence STABLE tant que rien ne change → on ne
// recrée le Set que lors d'une vraie mutation.
const setOnline = (next) => {
  onlineSet = next;
  notify();
};

export const applyPresenceState = (ids = []) => {
  setOnline(new Set((ids || []).map(String)));
};

export const applyPresenceUpdate = (userId, online) => {
  const id = String(userId);
  if (online === onlineSet.has(id)) return; // pas de changement
  const next = new Set(onlineSet);
  if (online) next.add(id);
  else next.delete(id);
  setOnline(next);
};

export const resetPresence = () => {
  if (onlineSet.size === 0) return;
  setOnline(new Set());
};

const subscribe = (cb) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const getSnapshot = () => onlineSet;

// Hook : renvoie le Set des ids en ligne + un test pratique isOnline(id).
export const usePresence = () => {
  const online = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    onlineSet: online,
    isOnline: (id) => !!id && online.has(String(id)),
    onlineCount: online.size,
  };
};

export const isUserOnline = (id) => !!id && onlineSet.has(String(id));
