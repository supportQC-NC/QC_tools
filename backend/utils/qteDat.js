// backend/utils/qteDat.js
//
// Champ QTE(8) des fichiers .dat Stock XL — SOURCE UNIQUE pour tous les
// générateurs (inventaire, réappro, bipage, préparation, contrôle…).
//
// Précision client du 29/10/2026 : Stock XL accepte les NÉGATIFS et les
// DÉCIMALES, mais « - » et « . » comptent comme des caractères du champ.
// On complète donc par des zéros à gauche jusqu'à 8 caractères, le signe et
// le point restant collés au nombre :
//   1,5  → "000001.5"
//   -52  → "00000-52"
//   -1,5 → "0000-1.5"
//   10   → "00000010" (entiers inchangés, comme avant)
//
// Les quantités sont bornées à 3 décimales (N(x.3) de l'ERP). Si la forme à
// 3 décimales dépasse 8 caractères (grosse quantité décimale), on RÉDUIT les
// décimales jusqu'à tenir — l'entier tient toujours en pratique (une quantité
// à 9 chiffres n'existe pas ; garde-fou tout de même).

export const fmtQteDat = (qte) => {
  const n = Math.round((Number(qte) || 0) * 1000) / 1000;
  for (let dec = 3; dec >= 0; dec--) {
    const p = 10 ** dec;
    const s = String(Math.round(n * p) / p); // forme minimale ("1.5", "-52")
    if (s.length <= 8) return s.padStart(8, "0");
  }
  // Quantité entière à plus de 8 chiffres : aberrante, tronquée plutôt que de
  // casser l'alignement du fichier.
  return String(Math.trunc(n)).slice(0, 8).padStart(8, "0");
};

export default { fmtQteDat };
