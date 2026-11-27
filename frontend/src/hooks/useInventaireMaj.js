// src/hooks/useInventaireMaj.js
//
// Abonnement PARTAGÉ au socket `inventaire:maj` (27/11/2026) : le backend
// l'émet à chaque changement d'inventaire (phase validée, dépôt de collecte,
// init/annulation, neutralisation…). Les écrans de suivi s'en servent comme
// ACCÉLÉRATEUR — refetch à la seconde — et gardent leur polling en filet de
// sécurité (reconnexion socket, watcher tournant dans le print-agent sans
// socket vers les navigateurs).
//
// Même motif que l'abonnement historique d'AdminRecapZonesScreen / du mur
// Suivi inventaire, factorisé pour les autres écrans (Progression, Fiches de
// contrôle, Suivi bipage).
//
// - `evt.type === "scan"` (une ligne bipée) est ignoré : il ne change ni les
//   phases ni les fiches, et dix agents qui bipent déclencheraient une rafale.
// - Les refetchs sont THROTTLÉS (2 s) : un dépôt de zone émet plusieurs
//   événements rapprochés (dépôt + phase + fiche), un seul aller-retour
//   suffit.
import { useEffect, useRef } from "react";
import { getSocket } from "../socketClient";

const THROTTLE_MS = 2000;

/**
 * @param {string} entrepriseId société active ("" = pas d'abonnement)
 * @param {() => void} refetch  relance de la (des) requête(s) de l'écran
 * @param {(connecte: boolean) => void} [onDirect] état du temps réel (badge)
 */
const useInventaireMaj = (entrepriseId, refetch, onDirect) => {
  // Refs : les écouteurs socket restent stables, pas de re-souscription à
  // chaque rendu de l'écran.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const onDirectRef = useRef(onDirect);
  onDirectRef.current = onDirect;
  const dernierRefetch = useRef(0);

  useEffect(() => {
    if (!entrepriseId) return undefined;
    const socket = getSocket();
    const onMaj = (evt) => {
      if (!evt || String(evt.entrepriseId) !== String(entrepriseId)) return;
      if (evt.type === "scan") return;
      const t = Date.now();
      if (t - dernierRefetch.current < THROTTLE_MS) return;
      dernierRefetch.current = t;
      refetchRef.current?.();
    };
    const onConnect = () => onDirectRef.current?.(true);
    const onDisconnect = () => onDirectRef.current?.(false);
    socket.on("inventaire:maj", onMaj);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    onDirectRef.current?.(socket.connected);
    return () => {
      socket.off("inventaire:maj", onMaj);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, [entrepriseId]);
};

export default useInventaireMaj;
