// backend/utils/codeGisement.js
//
// Lecture des CODES DE GISEMENT / de zone (« A_1 », « A_2d », « B22 »,
// « DOCK_DQ »…), extraite de `services/preparationService.js` le 27/11/2026
// pour que la localisation inventaire range ses zones EXACTEMENT comme la
// préparation de commande range son parcours. Un seul comparateur : deux
// implémentations finiraient par diverger, et l'ordre d'un rayon est la
// chose qu'un agent remarque immédiatement.
//
// Helpers PURS, sans aucune dépendance (ni DBF, ni Mongo).

/**
 * Découpe un code en segments alternés texte / nombre, pour un tri NATUREL :
 * « A_12d » → ["A_", 12, "D"].
 */
const segmentsNaturels = (v) =>
  String(v || "")
    .toUpperCase()
    .split(/(\d+)/)
    .filter((x) => x !== "")
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x));

const comparerNaturel = (a, b) => {
  const sa = segmentsNaturels(a);
  const sb = segmentsNaturels(b);
  for (let i = 0; i < Math.max(sa.length, sb.length); i += 1) {
    const x = sa[i];
    const y = sb[i];
    if (x === undefined) return -1; // « A » avant « A2 »
    if (y === undefined) return 1;
    const xNum = typeof x === "number";
    const yNum = typeof y === "number";
    if (xNum && yNum) {
      if (x !== y) return x - y;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1; // un nombre avant une lettre à rang égal
    } else if (x !== y) {
      return x.localeCompare(y, "fr", { sensitivity: "base" });
    }
  }
  return 0;
};

/**
 * Découpe un code de gisement en ALLÉE + REPÈRE, au PREMIER « _ » :
 * « A_12d » → { allee: "A", repere: "12d" } ; « B22 » → { allee: "B22",
 * repere: "" } (pas de séparateur : tout le code est l'allée).
 */
export const decouperCodeGisement = (code) => {
  const s = String(code || "").trim();
  const i = s.indexOf("_");
  return i === -1
    ? { allee: s, repere: "" }
    : { allee: s.slice(0, i), repere: s.slice(i + 1) };
};

/**
 * Comparateur de CODES DE GISEMENT, pour ranger une zone dans l'ordre du
 * parcours physique.
 *
 * Le code se lit en deux parties séparées par le PREMIER « _ » : ce qui
 * précède est l'allée (A, B, I, A2…), ce qui suit le repère dans l'allée
 * (1, 2d, 10, 12g…). Chaque partie est comparée en ordre NATUREL — lettres
 * dans l'ordre alphabétique, nombres dans l'ordre numérique.
 *
 * ⚠️ Un `localeCompare` sur le code entier (l'ancien tri) donne
 * « A_1, A_10, A_11, A_12d, A_2d » : l'agent redescend l'allée au lieu de la
 * parcourir. Ici on obtient « A_1, A_2d, A_9, A_10, A_11, A_12d ».
 */
export const comparerCodeGisement = (a, b) => {
  const { allee: alleeA, repere: repereA } = decouperCodeGisement(a);
  const { allee: alleeB, repere: repereB } = decouperCodeGisement(b);
  return comparerNaturel(alleeA, alleeB) || comparerNaturel(repereA, repereB);
};
