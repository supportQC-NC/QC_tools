// src/utils/format.js
//
// Formatteurs d'affichage CENTRALISÉS (locale fr-FR, franc Pacifique « F »).
// But : une seule source pour les formats répétés dans les écrans, au lieu de
// redéclarer `Intl.NumberFormat` / `fF` / `fmtMoney` / `fmtInt` / … dans chaque
// fichier (motif présent dans ~17 écrans).
//
// ⚠️ IMPORTANT : ces fonctions reproduisent EXACTEMENT le rendu des
// implémentations historiques qu'elles remplacent (mêmes arrondis, même
// séparateur de milliers, mêmes suffixes). Ne pas modifier un format sans
// vérifier tous ses appelants — l'affichage doit rester inchangé.

// Instance réutilisée (créer un Intl.NumberFormat est coûteux ; on le fait une fois).
const NF_FR = new Intl.NumberFormat("fr-FR");

/**
 * Arrondi entier robuste : `null`/`undefined`/`NaN` → 0.
 * @param {*} n
 * @returns {number}
 */
export const roundInt = (n) => Math.round(Number(n) || 0);

/**
 * Entier avec séparateur de milliers. Ex. `12345` → `"12 345"`.
 * @param {*} n
 * @returns {string}
 */
export const fmtQty = (n) => NF_FR.format(roundInt(n));

/**
 * Montant en francs Pacifique (entier, suffixe « F »). Ex. `12345` → `"12 345 F"`.
 * @param {*} n
 * @returns {string}
 */
export const fmtFranc = (n) => `${fmtQty(n)} F`;

/**
 * Pourcentage à N décimales (1 par défaut). `null`/`undefined` → `"—"`.
 * Ex. `fmtPct(33.333)` → `"33.3 %"`.
 * @param {*} n
 * @param {number} [decimals=1]
 * @returns {string}
 */
export const fmtPct = (n, decimals = 1) =>
  n === null || n === undefined ? "—" : `${Number(n).toFixed(decimals)} %`;

/**
 * Coefficient multiplicateur (PV / PR), 2 décimales, virgule française.
 * `null`/`undefined` → `"—"`. Ex. `fmtCoef(1.6666)` → `"1,67"`.
 * @param {*} n
 * @returns {string}
 */
export const fmtCoef = (n) =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "—"
    : Number(n).toLocaleString("fr-FR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

/**
 * Date courte fr-FR. Ex. `"05/08/2026"`. Entrée vide/invalide → `"—"`.
 * Accepte une `Date`, une chaîne ISO ou un timestamp.
 * @param {Date|string|number} value
 * @returns {string}
 */
export const fmtDate = (value) => {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
};
