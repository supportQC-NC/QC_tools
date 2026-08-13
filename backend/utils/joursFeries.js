// backend/utils/joursFeries.js
//
// Jours fériés légaux en NOUVELLE-CALÉDONIE, calculés pour une année donnée.
// Sert à pré-remplir les « événements spéciaux » du module Fréquentation
// (un jour férié explique un creux de fréquentation).
//
// Fériés fixes : 1er janvier, 1er mai, 8 mai, 14 juillet, 15 août,
// 24 septembre (fête de la Citoyenneté, propre à la NC), 1er novembre,
// 11 novembre, 25 décembre.
// Fériés mobiles (calés sur Pâques) : lundi de Pâques, Ascension (+39 j),
// lundi de Pentecôte (+50 j).

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Dimanche de Pâques (algorithme de Meeus/Jones/Butcher, calendrier grégorien). */
export const paques = (annee) => {
  const a = annee % 19;
  const b = Math.floor(annee / 100);
  const c = annee % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31); // 3 = mars, 4 = avril
  const jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(annee, mois - 1, jour);
};

const decale = (date, jours) => {
  const d = new Date(date);
  d.setDate(d.getDate() + jours);
  return d;
};

/**
 * Liste des jours fériés d'une année en Nouvelle-Calédonie.
 * @param {number} annee
 * @returns {{date:string, libelle:string}[]} triés par date
 */
export const joursFeriesNC = (annee) => {
  const an = Number(annee);
  const p = paques(an);

  const feries = [
    { date: `${an}-01-01`, libelle: "Jour de l'An" },
    { date: iso(decale(p, 1)), libelle: "Lundi de Pâques" },
    { date: `${an}-05-01`, libelle: "Fête du Travail" },
    { date: `${an}-05-08`, libelle: "Victoire 1945" },
    { date: iso(decale(p, 39)), libelle: "Ascension" },
    { date: iso(decale(p, 50)), libelle: "Lundi de Pentecôte" },
    { date: `${an}-07-14`, libelle: "Fête nationale" },
    { date: `${an}-08-15`, libelle: "Assomption" },
    { date: `${an}-09-24`, libelle: "Fête de la Citoyenneté" },
    { date: `${an}-11-01`, libelle: "Toussaint" },
    { date: `${an}-11-11`, libelle: "Armistice 1918" },
    { date: `${an}-12-25`, libelle: "Noël" },
  ];

  return feries.sort((a, b) => a.date.localeCompare(b.date));
};

export default { joursFeriesNC, paques };
