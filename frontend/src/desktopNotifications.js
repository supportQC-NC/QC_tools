// src/desktopNotifications.js
//
// Notifications BUREAU natives (bandeau système de l'OS) via l'API Web
// Notifications. Elles s'affichent même quand l'onglet du site est en
// arrière-plan / minimisé, TANT QUE le navigateur reste ouvert.
//
// Contraintes navigateur (non contournables) :
//   - Origine sécurisée requise : HTTPS, ou `localhost` en dev. Sur une IP de
//     LAN en http:// (ex. http://192.168.x.x), l'API est indisponible → no-op.
//   - L'utilisateur doit avoir ACCEPTÉ le prompt de permission. S'il refuse
//     ou bloque, tout ceci devient silencieusement inactif.

const isSupported = () =>
  typeof window !== "undefined" && "Notification" in window;

// Demande la permission une seule fois (si l'état est encore « default »).
// Idempotent : ne redemande pas si déjà accordée ou refusée.
export const requestNotificationPermission = () => {
  if (!isSupported()) return;
  try {
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  } catch {
    /* certains navigateurs lèvent sur des origines non sécurisées */
  }
};

// Affiche un bandeau UNIQUEMENT si :
//   - l'API est dispo et la permission accordée, ET
//   - l'onglet n'est PAS visible (document.hidden) — inutile de notifier
//     quelqu'un qui regarde déjà l'écran.
// `tag` regroupe les notifs successives (elles se remplacent au lieu de
// s'empiler). Un clic ramène la fenêtre du navigateur au premier plan.
export const showDesktopNotification = (
  title,
  { body, tag = "chat-equipe" } = {},
) => {
  if (!isSupported()) return;
  if (Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && !document.hidden) return;
  try {
    const notif = new Notification(title, {
      body,
      tag,
      renotify: true,
      icon: "/logo192.png",
    });
    notif.onclick = () => {
      try {
        window.focus();
        notif.close();
      } catch {
        /* non bloquant */
      }
    };
  } catch {
    /* non bloquant */
  }
};
