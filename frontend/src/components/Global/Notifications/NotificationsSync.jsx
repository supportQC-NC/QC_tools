// src/components/Global/Notifications/NotificationsSync.jsx
//
// Monté UNE fois (dans App) pour tenir à jour les compteurs de notifications de
// la sidebar. Deux sources :
//   1. Polling (filet de sécurité) : la query se rafraîchit périodiquement.
//   2. Socket temps réel : sur `notif:message` / `notif:task`, on rafraîchit le
//      compteur (badge quasi instantané). Si l'utilisateur est DÉJÀ sur l'écran
//      concerné, on marque directement « vu » pour ne pas afficher de badge.
// Ne rend rien à l'écran.
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { getSocket, resetSocket } from "../../../socketClient";
import {
  requestNotificationPermission,
  showDesktopNotification,
} from "../../../desktopNotifications";
import {
  applyPresenceState,
  applyPresenceUpdate,
  resetPresence,
  getMyManualStatus,
} from "../../../presenceClient";
import { apiSlice } from "../../../slices/apiSlice";
import {
  useGetNotificationCountsQuery,
  useMarkChatSeenMutation,
  useMarkTasksSeenMutation,
} from "../../../slices/notificationApiSlice";

const POLL_MS = 30000;

const NotificationsSync = () => {
  const dispatch = useDispatch();
  const { userInfo } = useSelector((state) => state.auth);
  const { pathname } = useLocation();

  // Route courante lue au moment de l'événement (via ref pour garder les
  // écouteurs socket stables sans re-souscrire à chaque navigation).
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const [markChatSeen] = useMarkChatSeenMutation();
  const [markTasksSeen] = useMarkTasksSeenMutation();

  // Active le polling tant qu'un utilisateur est connecté. On garde `counts`
  // ({ messages, taches }) pour alimenter le titre de l'onglet (compteur).
  const { data: counts } = useGetNotificationCountsQuery(undefined, {
    pollingInterval: POLL_MS,
    skip: !userInfo,
  });

  // Titre de l'onglet : « QC tools (N) » où N = messages non lus + tâches non
  // vues. Permet de voir les notifications en attente sans revenir sur le site.
  useEffect(() => {
    const BASE = "QC tools";
    if (!userInfo) {
      document.title = BASE;
      return;
    }
    const total = (counts?.messages || 0) + (counts?.taches || 0);
    document.title = total > 0 ? `${BASE} (${total})` : BASE;
  }, [counts, userInfo]);

  // Connexion socket + écoute, PILOTÉES PAR L'IDENTITÉ de l'utilisateur.
  // Le socket est (re)créé quand l'utilisateur change et FERMÉ au changement de
  // compte / démontage (resetSocket) — sinon la connexion garderait l'identité
  // du compte précédent (cookie du handshake), d'où messages attribués au mauvais
  // auteur et auto-notifications. C'est le point d'entrée unique du socket applicatif.
  useEffect(() => {
    if (!userInfo?._id) return undefined;
    const socket = getSocket();

    // Demande (une fois) l'autorisation d'afficher des bandeaux bureau natifs.
    requestNotificationPermission();

    const onMessage = () => {
      // Bandeau bureau générique quand l'onglet est en arrière-plan (le helper
      // ne fait rien si l'onglet est visible ou la permission non accordée).
      showDesktopNotification("Nouveau message", {
        body: "Espace équipe — vous avez un nouveau message.",
      });
      if (pathRef.current === "/espace-equipe") markChatSeen();
      else dispatch(apiSlice.util.invalidateTags(["Notif"]));
    };
    const onTask = () => {
      // Bandeau bureau quand une tâche est assignée (onglet en arrière-plan).
      showDesktopNotification("Nouvelle tâche", {
        body: "Une tâche vient de vous être assignée.",
        tag: "tache-assignee",
      });
      if (pathRef.current === "/mes-taches") markTasksSeen();
      else dispatch(apiSlice.util.invalidateTags(["Notif"]));
    };

    // Présence : snapshot initial + deltas (qui est connecté + statut).
    const onPresenceState = (list) => applyPresenceState(list);
    const onPresenceUpdate = (payload) => applyPresenceUpdate(payload);

    socket.on("notif:message", onMessage);
    socket.on("notif:task", onTask);
    socket.on("presence:state", onPresenceState);
    socket.on("presence:update", onPresenceUpdate);
    // Redemande le snapshot à chaque (re)connexion du socket.
    const onConnect = () => socket.emit("presence:get");
    socket.on("connect", onConnect);
    if (socket.connected) socket.emit("presence:get");

    return () => {
      socket.off("notif:message", onMessage);
      socket.off("notif:task", onTask);
      socket.off("presence:state", onPresenceState);
      socket.off("presence:update", onPresenceUpdate);
      socket.off("connect", onConnect);
      resetPresence();
      resetSocket();
    };
  }, [userInfo?._id, dispatch, markChatSeen, markTasksSeen]);

  // Auto-absent : après 5 min sans activité, le statut passe « absent » ; il
  // repasse « actif » à la première interaction. Respecte un statut MANUEL
  // (occupe / absent choisi par l'utilisateur → on ne le touche pas).
  useEffect(() => {
    if (!userInfo?._id) return undefined;
    const socket = getSocket();
    const IDLE_MS = 5 * 60 * 1000;
    let idleTimer = null;
    let away = false;

    const goAway = () => {
      if (getMyManualStatus()) return;
      away = true;
      socket.emit("presence:status", "absent");
    };
    const onActivity = () => {
      if (!getMyManualStatus() && away) {
        away = false;
        socket.emit("presence:status", "actif");
      }
      clearTimeout(idleTimer);
      idleTimer = setTimeout(goAway, IDLE_MS);
    };

    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("click", onActivity);
    idleTimer = setTimeout(goAway, IDLE_MS);
    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("click", onActivity);
    };
  }, [userInfo?._id]);

  return null;
};

export default NotificationsSync;
