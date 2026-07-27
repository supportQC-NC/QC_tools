// src/socketClient.js
//
// Client Socket.IO unique (singleton). Même origine que l'API : le cookie JWT
// httpOnly est envoyé au handshake (auth côté serveur). En dev, le proxy CRA
// relaie /socket.io vers le backend (polling au minimum, cookie conservé).
import { io } from "socket.io-client";

let socket = null;

export const getSocket = () => {
  if (!socket) {
    // Pas de forçage de transport : socket.io démarre en POLLING (compatible
    // avec le proxy CRA en dev) puis tente une montée en WebSocket si possible.
    socket = io({ withCredentials: true });
  }
  return socket;
};

// Ferme et détruit la connexion courante. INDISPENSABLE au changement de compte :
// le serveur authentifie le socket via le cookie JWT du HANDSHAKE ; sans reset,
// un utilisateur qui se reconnecte réutiliserait l'identité socket du compte
// précédent (messages attribués au mauvais auteur, auto-notifications, etc.).
// Le prochain getSocket() rétablit une connexion propre avec le bon cookie.
export const resetSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export default getSocket;
