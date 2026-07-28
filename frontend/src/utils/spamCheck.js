// src/utils/spamCheck.js
//
// Analyse un objet d'email (ou un nom) et repère les mots / caractères qui
// augmentent le risque de finir en SPAM. Renvoie les plages à surligner en rouge
// + des raisons lisibles pour le bandeau d'avertissement.

// Mots / expressions déclencheurs (FR + EN), en minuscules.
const SPAM_WORDS = [
  "gratuit", "gratuitement", "100% gratuit", "gagnez", "gagner", "gagnant", "gagné",
  "cadeau", "offert", "argent", "cash", "remboursement", "remboursé", "bonus",
  "promo", "promotion", "soldes", "réduction", "prix cassés", "meilleur prix",
  "offre exceptionnelle", "offre limitée", "dernière chance", "ne manquez pas",
  "urgent", "agissez maintenant", "maintenant", "cliquez ici", "cliquez",
  "achetez maintenant", "sans engagement", "sans frais", "félicitations",
  "loterie", "million", "millions", "crédit", "prêt", "casino", "viagra",
  "bitcoin", "crypto", "investissez", "revenu garanti", "revenus", "profitez",
  "économisez", "bon plan", "exclusif", "garanti", "satisfait ou remboursé",
  "super promo", "0€", "affaire", "incroyable",
  // EN courants
  "free", "winner", "prize", "click here", "buy now", "act now",
  "limited time", "congratulations", "guaranteed", "risk-free", "cheap",
  "discount", "income", "earn money",
];

const isBoundary = (ch) => ch === undefined || /[^a-zà-ÿ0-9]/i.test(ch);

const mergeRanges = (ranges) => {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i].start <= last.end) last.end = Math.max(last.end, sorted[i].end);
    else out.push({ ...sorted[i] });
  }
  return out;
};

export const analyzeSpam = (text) => {
  const s = String(text || "");
  if (!s.trim()) return { ranges: [], reasons: [], level: "ok" };
  const lower = s.toLowerCase();
  const ranges = [];
  const reasons = new Set();

  // Mots / expressions
  for (const w of SPAM_WORDS) {
    let idx = 0;
    while ((idx = lower.indexOf(w, idx)) !== -1) {
      const before = idx === 0 ? undefined : lower[idx - 1];
      const after = lower[idx + w.length];
      if (w.includes(" ") || (isBoundary(before) && isBoundary(after))) {
        ranges.push({ start: idx, end: idx + w.length });
        reasons.add(`mot à risque « ${w} »`);
      }
      idx += w.length;
    }
  }

  // Règles de format
  const addRe = (re, reason) => {
    let m;
    while ((m = re.exec(s)) !== null) {
      ranges.push({ start: m.index, end: m.index + m[0].length });
      reasons.add(reason);
      if (m[0].length === 0) re.lastIndex++;
    }
  };
  addRe(/!{2,}/g, "trop de points d'exclamation");
  addRe(/\?{2,}/g, "trop de points d'interrogation");
  addRe(/[$€£]{2,}/g, "symboles monétaires répétés");
  addRe(/100\s?%/gi, "« 100% » à risque");
  addRe(/\b[A-ZÀ-ÖØ-Þ]{4,}\b/g, "mot tout en MAJUSCULES");

  // Ratio de majuscules
  const letters = (s.match(/[a-zà-ÿA-ZÀ-Þ]/g) || []).length;
  const uppers = (s.match(/[A-ZÀ-Þ]/g) || []).length;
  if (letters >= 8 && uppers / letters > 0.6) reasons.add("trop de majuscules");

  // Emojis multiples
  const emojis = (s.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emojis >= 3) reasons.add("trop d'emojis");

  const merged = mergeRanges(ranges);
  const level =
    reasons.size === 0 ? "ok" : reasons.size >= 3 || merged.length >= 3 ? "danger" : "warn";
  return { ranges: merged, reasons: [...reasons], level };
};

export default analyzeSpam;
