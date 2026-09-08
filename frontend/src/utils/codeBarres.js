// frontend/src/utils/codeBarres.js
//
// Miroir léger de backend/utils/codeBarres.js — même règle, côté écran.
// L'ERP écrit le même code de plusieurs façons : « 12345 » / « 012345 » pour
// un NART, UPC-A 12 chiffres / EAN-13 13 chiffres pour un code-barres. Un
// rapprochement strict fait sortir l'article en « inconnu » ou « hors
// commande ». On ne retire jamais les zéros d'une valeur affichée : on tolère
// seulement les écritures équivalentes au moment de COMPARER.

const trimCode = (v) => (v === null || v === undefined ? "" : String(v).trim());

/** Racine d'un code-barres : les chiffres sans les zéros de tête (null si ce n'en est pas un). */
export const canoniserCodeBarres = (code) => {
  const brut = trimCode(code);
  if (!/^\d+$/.test(brut) || brut.length < 6) return null;
  const sansZeros = brut.replace(/^0+/, "");
  return sansZeros.length >= 6 ? sansZeros : null;
};

/** Deux codes-barres désignent-ils le même produit ? */
export const memeCodeBarres = (a, b) => {
  const ca = trimCode(a);
  const cb = trimCode(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const na = canoniserCodeBarres(ca);
  return na !== null && na === canoniserCodeBarres(cb);
};

/** Deux codes article désignent-ils le même article ? (« 12345 » / « 012345 ») */
export const memeNart = (a, b) => {
  const ca = trimCode(a).toUpperCase();
  const cb = trimCode(b).toUpperCase();
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (!/^\d+$/.test(ca) || !/^\d+$/.test(cb)) return false;
  return (ca.replace(/^0+/, "") || "0") === (cb.replace(/^0+/, "") || "0");
};
