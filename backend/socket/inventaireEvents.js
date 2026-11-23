// backend/socket/inventaireEvents.js
//
// ÉVÉNEMENTS TEMPS RÉEL DE L'INVENTAIRE PAR ZONES.
//
// Un seul événement, `inventaire:maj`, diffusé à TOUS les sockets connectés
// (pas de salon par société : le payload ne porte AUCUNE donnée — juste
// « quelque chose a bougé sur l'inventaire de telle société » — et c'est le
// client qui filtre sur la société qu'il affiche). Les écrans de suivi
// (mur « Suivi inventaire » en tête) s'en servent pour rafraîchir leurs
// requêtes à la seconde au lieu d'attendre le prochain tour de polling ;
// le polling reste en place comme filet (reconnexion socket, et surtout
// PROD : le watcher tourne dans le process print-agent, qui n'a pas de
// socket vers les navigateurs — ses coches de phase n'arrivent que par le
// polling).
//
// `type` ∈ "session" (init / annulation) · "phase" (coupon, coche manuelle,
// watcher, import) · "zone" (neutralisation) · "collecte" (ouverture /
// suppression) · "scan" (ligne bipée — fréquent : le client doit le
// DÉBOUNCER avant de relancer ses requêtes) · "depot" (collecte déposée).
//
// Les contrôleurs pourraient lire `req.app.get("io")`, mais les SERVICES
// (watcher, import bipage) n'ont pas de `req` : tout le monde passe par ce
// registre, renseigné une fois par server.js. Dans un process sans io
// (print-agent, scripts CLI), l'émission est un no-op silencieux.

let ioRef = null;

/** Appelé une fois par server.js, après la création du serveur Socket.IO. */
export const setInventaireIo = (io) => {
  ioRef = io;
};

/**
 * Signale un changement sur l'inventaire d'une société.
 * Jamais bloquant, jamais d'exception : le temps réel est un confort,
 * il ne doit faire échouer aucune écriture métier.
 */
export const emitInventaireMaj = (entrepriseId, type) => {
  if (!ioRef || !entrepriseId) return;
  try {
    ioRef.emit("inventaire:maj", {
      entrepriseId: String(entrepriseId),
      type: type || "maj",
      at: Date.now(),
    });
  } catch {
    // no-op : un socket en vrac ne doit pas casser la requête métier.
  }
};
