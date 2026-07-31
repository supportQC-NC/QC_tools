// backend/utils/ean13.js
//
// Util EAN-13 autonome, rendu VECTORIEL directement en pdfkit (origine haut-gauche,
// mêmes conventions que gisementLabelService.drawCode128/drawQrCode). Distinct des
// copies de etiquetteService.js/ficheArticleService.js (couplées au wrapper « RL »)
// afin de ne rien casser à l'existant.
//
// Fournit aussi genererEanInterne() : un EAN-13 INTERNE déterministe (préfixe « 2 »,
// usage magasin/distribution restreinte selon GS1) dérivé de façon stable d'une graine
// → reproductible à la réimpression, pas de collision en pratique.

// ── Tables EAN-13 ────────────────────────────────────────────────────────────
const EAN_L = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
];
const EAN_G = [
  "0100111", "0110011", "0011011", "0100001", "0011101",
  "0111001", "0000101", "0010001", "0001001", "0010111",
];
const EAN_R = [
  "1110010", "1100110", "1101100", "1000010", "1011100",
  "1001110", "1010000", "1000100", "1001000", "1110100",
];
const EAN_PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

// Chiffre de contrôle EAN-13 à partir des 12 premiers chiffres.
export const ean13CheckDigit = (d12) => {
  let s = 0;
  for (let i = 0; i < 12; i++) s += parseInt(d12[i], 10) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (s % 10)) % 10);
};

// Motif binaire (95 modules) d'un EAN-13. Accepte 12 chiffres (clé ajoutée) ou 13.
// Renvoie { bits, full } ou null si invalide.
export const ean13Bits = (code) => {
  let d = String(code == null ? "" : code).replace(/\D/g, "");
  if (d.length === 12) d += ean13CheckDigit(d);
  if (d.length !== 13) return null;
  const first = parseInt(d[0], 10);
  const left = d.slice(1, 7);
  const right = d.slice(7, 13);
  const par = EAN_PARITY[first];
  let bits = "101";
  for (let i = 0; i < 6; i++) {
    const n = parseInt(left[i], 10);
    bits += par[i] === "L" ? EAN_L[n] : EAN_G[n];
  }
  bits += "01010";
  for (let i = 0; i < 6; i++) bits += EAN_R[parseInt(right[i], 10)];
  bits += "101";
  return { bits, full: d };
};

// Dessine un code-barres EAN-13 (barres noires) dans le rectangle (x,y,w,h),
// avec le numéro en clair centré sous les barres. Coords pdfkit natives.
export const drawEAN13Pdf = (doc, code, x, y, w, h) => {
  const res = ean13Bits(code);
  if (!res) return false;
  const textH = Math.min(11, h * 0.22);
  const barsH = h - textH;
  const mw = w / 95;
  doc.save().fillColor("#000000");
  for (let i = 0; i < 95; i++) {
    if (res.bits[i] === "1") {
      doc.rect(x + i * mw, y, mw, barsH).fill();
    }
  }
  doc.restore();
  doc.save().fillColor("#000000").font("Helvetica").fontSize(Math.min(9, textH));
  doc.text(res.full, x, y + barsH + 1, { width: w, align: "center", lineBreak: false });
  doc.restore();
  return true;
};

// EAN-13 INTERNE déterministe à partir d'une graine texte.
//   base = "2" (préfixe interne) + 11 chiffres issus d'un hash BigInt stable → clé.
export const genererEanInterne = (seed) => {
  const s = String(seed == null ? "" : seed);
  // Hash déterministe djb2 en BigInt, réduit à 11 chiffres.
  let h = 5381n;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33n + BigInt(s.charCodeAt(i))) % 100000000000n; // mod 1e11
  }
  const onze = h.toString().padStart(11, "0");
  const base12 = "2" + onze; // 12 chiffres (préfixe interne « 2 »)
  return base12 + ean13CheckDigit(base12);
};

export default { ean13CheckDigit, ean13Bits, drawEAN13Pdf, genererEanInterne };
