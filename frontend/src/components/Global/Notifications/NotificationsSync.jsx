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
  applyPresenceState,
  applyPresenceUpdate,
  resetPresence,
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

  // Active le polling tant qu'un utilisateur est connecté.
  useGetNotificationCountsQuery(undefined, {
    pollingInterval: POLL_MS,
    skip: !userInfo,
  });

  // Connexion socket + écoute, PILOTÉES PAR L'IDENTITÉ de l'utilisateur.
  // Le socket est (re)créé quand l'utilisateur change et FERMÉ au changement de
  // compte / démontage (resetSocket) — sinon la connexion garderait l'identité
  // du compte précédent (cookie du handshake), d'où messages attribués au mauvais
  // auteur et auto-notifications. C'est le point d'entrée unique du socket applicatif.
  useEffect(() => {
    if (!userInfo?._id) return undefined;
    const socket = getSocket();

    const onMessage = () => {
      if (pathRef.current === "/espace-equipe") markChatSeen();
      else dispatch(apiSlice.util.invalidateTags(["Notif"]));
    };
    const onTask = () => {
      if (pathRef.current === "/mes-taches") markTasksSeen();
      else dispatch(apiSlice.util.invalidateTags(["Notif"]));
    };

    // Présence : snapshot initial + deltas (qui est connecté à l'app).
    const onPresenceState = (ids) => applyPresenceState(ids);
    const onPresenceUpdate = ({ userId, online }) =>
      applyPresenceUpdate(userId, online);

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

  return null;
};

export default NotificationsSync;
