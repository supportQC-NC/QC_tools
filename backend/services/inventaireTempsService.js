// backend/services/inventaireTempsService.js
//
// TEMPS DE TRAVAIL D'UNE COLLECTE D'INVENTAIRE — extrait du contrôleur
// (suivi bipage) pour être partagé avec le bilan de clôture : un seul
// calcul, une seule vérité sur les durées affichées partout.

// Au-delà de ce silence entre deux scans, on considère que l'agent a fait autre
// chose (pause, appel, réappro) : l'intervalle n'entre pas dans le temps de
// bipage EFFECTIF. Même seuil et même raisonnement que le module réappro
// (`PAUSE_MS`), abaissé de 5 à 3 minutes le 11/09/2026 — les deux doivent
// rester égaux, sinon les temps effectifs des deux suivis ne se comparent plus.
export const PAUSE_BIPAGE_MS = 3 * 60 * 1000;

/**
 * Temps d'un bipage, reconstitué a posteriori depuis les horodatages.
 *
 * - `brut`   : entrée dans la zone (createdAt) → dépôt (exportedAt). Il inclut
 *              les pauses et les reprises : une zone ouverte le matin et
 *              déposée le soir affiche 8 h de brut pour 20 min de travail.
 * - `actif`  : somme des intervalles entre événements consécutifs, ceux de plus
 *              de PAUSE_BIPAGE_MS exclus. La chaîne part de l'entrée dans la
 *              zone et va jusqu'au dépôt : un bipage d'un seul article n'est
 *              donc pas compté 0.
 *
 * ⚠️ `lignes[].scannedAt` porte la date du DERNIER scan de la ligne (rescanner
 * un article déjà compté cumule la quantité et rafraîchit la date) : le nombre
 * d'événements est donc un minorant du nombre réel de scans.
 */
export const calculerTempsBipage = (collecte) => {
  const scans = (collecte.lignes || [])
    .map((l) => (l.scannedAt ? new Date(l.scannedAt).getTime() : null))
    .filter((t) => t && !isNaN(t))
    .sort((a, b) => a - b);

  const debut = collecte.createdAt ? new Date(collecte.createdAt).getTime() : null;
  const fin = collecte.exportedAt ? new Date(collecte.exportedAt).getTime() : null;

  // Chaîne complète des événements : entrée → scans → dépôt. Le tri est une
  // sécurité : les horloges du serveur et du collecteur peuvent diverger, et un
  // jalon dans le désordre produirait un intervalle négatif silencieux.
  const jalons = [debut, ...scans, fin]
    .filter((t) => t && !isNaN(t))
    .sort((a, b) => a - b);
  let actifMs = 0;
  for (let i = 1; i < jalons.length; i += 1) {
    const delta = jalons[i] - jalons[i - 1];
    if (delta > 0 && delta <= PAUSE_BIPAGE_MS) actifMs += delta;
  }

  const dernierEvenement = fin || (scans.length ? scans[scans.length - 1] : null);
  const brutMs = debut && dernierEvenement ? Math.max(0, dernierEvenement - debut) : 0;

  return {
    premierScanAt: scans.length ? new Date(scans[0]) : null,
    dernierScanAt: scans.length ? new Date(scans[scans.length - 1]) : null,
    nbScans: scans.length,
    tempsActifMs: actifMs,
    tempsBrutMs: brutMs,
  };
};
