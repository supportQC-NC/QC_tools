// src/utils/progressionInventaire.js
//
// Règles d'avancement d'un inventaire par zones, partagées entre les écrans
// de suivi (Suivi inventaire, Récap par zone…). Mêmes règles que
// `computeProgress` côté serveur : une zone = 3 phases, et les zones
// NEUTRALISÉES (rayon qui n'existe plus physiquement) ne comptent pas.

export const PHASES = ["papillonnage", "bipage", "controle"];

export const PHASE_META = {
  papillonnage: { label: "Papillonnage", color: "#8b5cf6" },
  bipage: { label: "Comptage", color: "#4da6ff" },
  controle: { label: "Contrôle", color: "#4ade80" },
};

// Statut d'avancement d'une zone (évalué de haut en bas) : 3 phases → complet ;
// bipage → comptage ; papillonnage seul → papillonnage ; sinon pas commencé.
export const STATUTS = {
  complet: { label: "Complet", color: "#4ade80" },
  comptage: { label: "Comptage", color: "#8b5cf6" },
  papillonnage: { label: "Papillonnage", color: "#f59e0b" },
  todo: { label: "Pas commencé", color: "#ff6b6b" },
};
export const ORDRE_STATUTS = ["todo", "papillonnage", "comptage", "complet"];

export const zoneStatut = (z) => {
  if (z?.neutralisee) return "neutralisee";
  const pap = !!z?.papillonnage?.fait;
  const bip = !!z?.bipage?.fait;
  const ctrl = !!z?.controle?.fait;
  if (pap && bip && ctrl) return "complet";
  if (bip) return "comptage";
  if (pap) return "papillonnage";
  return "todo";
};

/**
 * Avancement d'un lot de zones : total de phases faites, pourcentage, détail
 * par phase et compteur de zones par statut.
 */
export const calculerProgression = (lot) => {
  const compteurs = { papillonnage: 0, bipage: 0, controle: 0 };
  const parStatut = { todo: 0, papillonnage: 0, comptage: 0, complet: 0 };
  const actives = lot.filter((z) => !z.neutralisee);
  actives.forEach((z) => {
    PHASES.forEach((ph) => {
      if (z[ph]?.fait) compteurs[ph] += 1;
    });
    parStatut[zoneStatut(z)] += 1;
  });
  const totalZones = actives.length;
  const zonesNeutralisees = lot.length - actives.length;
  const totalPhases = totalZones * PHASES.length;
  const faites = PHASES.reduce((t, ph) => t + compteurs[ph], 0);
  const parPhase = {};
  PHASES.forEach((ph) => {
    parPhase[ph] = {
      faites: compteurs[ph],
      total: totalZones,
      pct: totalZones ? Math.round((compteurs[ph] / totalZones) * 100) : 0,
    };
  });
  return {
    totalZones,
    totalPhases,
    faites,
    pct: totalPhases ? Math.round((faites / totalPhases) * 100) : 0,
    zonesNeutralisees,
    parPhase,
    parStatut,
  };
};

/**
 * Ventilation d'un lot de zones par EMPLACEMENT (zone.type, valeur libre des
 * fiches d'inventaire — magasin, dock, réserve, SAV…). Les zones sans type
 * sont regroupées sous la clé "" (à libeller « Sans emplacement » à
 * l'affichage). Renvoie [{ key, ...progression }] trié par nom.
 */
export const progressionParEmplacement = (zones) => {
  const groupes = new Map();
  zones.forEach((z) => {
    const key = String(z?.type || "").trim();
    if (!groupes.has(key)) groupes.set(key, []);
    groupes.get(key).push(z);
  });
  return [...groupes.entries()]
    .map(([key, lot]) => ({ key, ...calculerProgression(lot) }))
    .sort((a, b) => a.key.localeCompare(b.key, "fr", { numeric: true }));
};
