// backend/utils/codeBarres.js
//
// Normalisation des codes-barres (GENCOD).
//
// ⚠️ POURQUOI CE FICHIER — l'ERP stocke le MÊME code-barres sous plusieurs
// écritures, selon l'opérateur ou l'import qui l'a saisi :
//   - UPC-A à 12 chiffres  « 088381121620 »   et son EAN-13 « 0088381121620 »
//   - EAN-8  à  8 chiffres « 25927818 »       et sa forme padée « 0000025927818 »
// Mesuré sur article.dbf de QC (100 976 articles, 86 293 gencods) : 2 456 codes
// commencent par un zéro et 1 341 existent sous DEUX écritures qui ne diffèrent
// que par le nombre de zéros de tête.
//
// La douchette, elle, n'envoie qu'UNE forme (12 ou 13 chiffres selon son
// paramétrage). Une comparaison stricte faisait donc sortir « article inconnu »
// tous les articles dont le gencod commence par 0 ou 00 (constaté en contrôle
// de commande). Les zéros ne sont JAMAIS supprimés d'une valeur affichée,
// exportée ou stockée : ils font partie du code. On se contente d'essayer les
// écritures équivalentes au moment de la RECHERCHE.

// Longueurs de code-barres standard essayées lors d'une recherche.
// Ordre volontaire : les formats les plus courants d'abord.
const LONGUEURS_STANDARD = [13, 12, 14, 8];

// En deçà, un code numérique n'est pas un code-barres (NART, compteur…) :
// on ne lui invente pas de variantes, au risque de rapprocher deux articles
// qui n'ont rien à voir.
const LONGUEUR_MINI = 6;

/**
 * Trim défensif : le DBF peut renvoyer autre chose qu'une chaîne.
 */
export const trimCode = (valeur) => {
  if (valeur === null || valeur === undefined) return "";
  return String(valeur).trim();
};

/**
 * Forme canonique d'un code-barres : les chiffres sans les zéros de tête.
 * Renvoie null si ce n'est pas un code-barres exploitable (non numérique,
 * ou trop court une fois les zéros retirés).
 *
 * « 0088381121620 » → « 88381121620 »
 * « 088381121620 »  → « 88381121620 »   (même canonique : c'est le même code)
 * « 000009 »        → null              (trop court, c'est un NART)
 */
export const canoniserCodeBarres = (code) => {
  const brut = trimCode(code);
  if (!/^\d+$/.test(brut)) return null;
  if (brut.length < LONGUEUR_MINI) return null;
  const sansZeros = brut.replace(/^0+/, "");
  if (sansZeros.length < LONGUEUR_MINI) return null;
  return sansZeros;
};

/**
 * Écritures équivalentes d'un code, de la plus probable à la moins probable.
 * La première est TOUJOURS le code tel qu'il a été saisi/scanné : une
 * correspondance exacte reste prioritaire sur toute tolérance.
 *
 * « 088381121620 » → ["088381121620", "0088381121620", "00088381121620",
 *                     "88381121620"]
 */
export const variantesCodeBarres = (code) => {
  const brut = trimCode(code);
  if (!brut) return [];

  const canon = canoniserCodeBarres(brut);
  if (!canon) return [brut];

  const formes = [brut];
  const ajouter = (v) => {
    if (v && !formes.includes(v)) formes.push(v);
  };

  for (const n of LONGUEURS_STANDARD) {
    if (canon.length <= n) ajouter(canon.padStart(n, "0"));
  }
  ajouter(canon);

  return formes;
};

/**
 * Deux codes désignent-ils le même code-barres ? Utilisé pour retrouver une
 * ligne dans une liste déjà chargée (commande, réappro, préparation), où l'on
 * ne dispose pas d'un index.
 */
export const memeCodeBarres = (a, b) => {
  const ca = trimCode(a);
  const cb = trimCode(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const na = canoniserCodeBarres(ca);
  const nb = canoniserCodeBarres(cb);
  return na !== null && na === nb;
};


// ── NART ─────────────────────────────────────────────────────────────────────
//
// Même maladie sur le code article : `article.NART` est un `C(6)` et l'ERP y
// mélange « 012345 » et « 12345 » selon l'écran qui a servi à la saisie. Un
// NART reste comparé en MAJUSCULES (il peut être alphanumérique : « 99A713 ») ;
// on n'essaie les écritures zéro-padées que s'il est purement numérique.

// Longueur du champ NART dans le DBF.
const LONGUEUR_NART = 6;

/**
 * Écritures équivalentes d'un code article, forme saisie en premier.
 * « 12345 » → ["12345", "012345"] ; « 012345 » → ["012345", "12345"]
 * « 99A713 » → ["99A713"] (alphanumérique : aucune variante)
 */
export const variantesNart = (nart) => {
  const brut = trimCode(nart).toUpperCase();
  if (!brut) return [];
  if (!/^\d+$/.test(brut)) return [brut];

  const formes = [brut];
  const ajouter = (v) => {
    if (v && v !== brut && !formes.includes(v)) formes.push(v);
  };

  const sansZeros = brut.replace(/^0+/, "") || "0";
  if (brut.length < LONGUEUR_NART) ajouter(brut.padStart(LONGUEUR_NART, "0"));
  if (sansZeros.length <= LONGUEUR_NART) {
    ajouter(sansZeros.padStart(LONGUEUR_NART, "0"));
  }
  ajouter(sansZeros);

  return formes;
};

export default {
  trimCode,
  canoniserCodeBarres,
  variantesCodeBarres,
  memeCodeBarres,
  variantesNart,
};
