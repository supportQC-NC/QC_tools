// backend/utils/texteDos.js
//
// Décodage D'AFFICHAGE des textes DOS de l'ERP.
//
// ⚠️ La règle globale ne change pas : les DBF sont restitués TELS QUELS dans
// toute l'application (corriger un service isolé désalignerait les champs —
// cf. CLAUDE.md). Ce helper ne sert QU'AUX LIBELLÉS destinés à un humain :
// menus déroulants artplus (étiquettes, feuille d'écarts), bandeaux de groupe,
// titres de PDF. JAMAIS aux valeurs qui servent de clé de filtrage, d'index ou
// d'écriture — elles doivent rester l'écriture exacte du DBF.
//
// L'ERP (Stock XL) COMPOSE certains caractères : lettre de base + octet
// d'accent. Table EMPIRIQUE, relevée sur les données réelles de QC le
// 17/11/2026 (octets lus en latin1 par dbffile) :
//   « A 0xFF » (« Aÿ »)  → « À »   (≈50 libellés artplus : « OUTILLAGE Aÿ MAIN »)
//   « A 0xF5 » (« Aõ »)  → « Ç »   (« MARQUAGE ET TRAAõAGE » = TRAÇAGE)
//   « 0xF8 »   (« ø »)   → « ° »   (« N° » → « Nø », documenté dans CLAUDE.md)
// Compléter la table ICI quand un nouveau cas est constaté — pas dans un écran.

const REMPLACEMENTS = [
  ["Aÿ", "À"],
  ["aÿ", "à"],
  ["Aõ", "Ç"],
  ["ø", "°"],
];

/** Libellé lisible d'un texte DOS de l'ERP (affichage seulement). */
export const libelleDos = (v) => {
  let s = v == null ? "" : String(v);
  for (const [seq, rep] of REMPLACEMENTS) {
    if (s.includes(seq)) s = s.split(seq).join(rep);
  }
  return s;
};

export default { libelleDos };
