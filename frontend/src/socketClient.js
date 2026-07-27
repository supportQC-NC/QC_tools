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

export default getSocket;
