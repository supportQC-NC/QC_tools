// backend/services/editionPromoService.js
//
// Module « Édition Promo » — génère un fichier CSV de mise en promotion à partir
// d'une proforma, et le dépose dans le dossier collect_sec de l'entreprise
// (entreprise.cheminExportInventaire, déjà traduit dev/prod par le getter du modèle).
//
// Fichier : promo_<mois_suivant>.csv   (mois suivant relatif à AUJOURD'HUI ;
//           ex. en juillet -> promo_aout.csv)
// Format  : entête + lignes, séparateur ";" :
//           NART;DESIGN;DPROMOD;DPROMOF
//           834172;RADIATEUR ...;01/08/2026;31/08/2026
//   - DPROMOD = date de début saisie par l'utilisateur (JJ/MM/AAAA)
//   - DPROMOF = date de fin saisie par l'utilisateur (JJ/MM/AAAA)

import fs from "fs";
import path from "path";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Noms de mois FR sans accent (sûrs pour un nom de fichier sur partage Windows).
const MOIS_FR = [
  "janvier",
  "fevrier",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "aout",
  "septembre",
  "octobre",
  "novembre",
  "decembre",
];

// Nom du mois SUIVANT relatif à `ref` (par défaut : aujourd'hui).
export const nomMoisSuivant = (ref = new Date()) => {
  const d = ref instanceof Date && !isNaN(ref.getTime()) ? ref : new Date();
  return MOIS_FR[(d.getMonth() + 1) % 12];
};

// Nom de fichier promo pour le mois suivant.
export const nomFichierPromo = (ref = new Date()) =>
  `promo_${nomMoisSuivant(ref)}.csv`;

// "YYYY-MM-DD" (ou Date) -> "JJ/MM/AAAA". Renvoie "" si invalide.
export const formatDateFr = (value) => {
  if (!value) return "";
  let d;
  if (value instanceof Date) {
    d = value;
  } else {
    const s = safeTrim(value);
    // Accepte "YYYY-MM-DD" (input HTML date) ou déjà "JJ/MM/AAAA".
    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (isoMatch) {
      d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
      return s; // déjà au bon format
    } else {
      d = new Date(s);
    }
  }
  if (!d || isNaN(d.getTime())) return "";
  const jj = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${jj}/${mm}/${d.getFullYear()}`;
};

// Nettoie une valeur pour une cellule CSV séparée par ";" : retire ";" et sauts
// de ligne (pas de guillemets pour rester compatible avec l'import ERP simple).
const cellCsv = (v) => safeTrim(v).replace(/[;\r\n]+/g, " ");

/**
 * Construit le contenu CSV (avec entête, séparateur ";", fins de ligne CRLF).
 * @param {Array<{nart:string, design:string}>} articles
 * @param {string} dpromodFr  date début (JJ/MM/AAAA)
 * @param {string} dpromofFr  date fin (JJ/MM/AAAA)
 * @returns {string}
 */
export const construireCsvPromo = (articles, dpromodFr, dpromofFr) => {
  const header = "NART;DESIGN;DPROMOD;DPROMOF";
  const lignes = articles.map(
    (a) => `${cellCsv(a.nart)};${cellCsv(a.design)};${dpromodFr};${dpromofFr}`,
  );
  return [header, ...lignes].join("\r\n") + "\r\n";
};

// Dossier collect_sec de l'entreprise (getter du modèle déjà traduit dev/prod).
const resoudreDossierCollectSec = (entreprise) =>
  safeTrim(entreprise?.cheminExportInventaire) ||
  "/mnt/rcommun/STOCK/collect_sec";

/**
 * Écrit le fichier promo dans collect_sec. Crée le dossier au besoin.
 * @returns {{ fileName:string, filePath:string, dossier:string }}
 */
export const ecrireFichierPromo = (entreprise, contenu, ref = new Date()) => {
  const dossier = resoudreDossierCollectSec(entreprise);
  if (!fs.existsSync(dossier)) {
    fs.mkdirSync(dossier, { recursive: true });
  }
  const fileName = nomFichierPromo(ref);
  const filePath = path.join(dossier, fileName);
  fs.writeFileSync(filePath, contenu, "utf8");
  return { fileName, filePath, dossier };
};

export default {
  nomMoisSuivant,
  nomFichierPromo,
  formatDateFr,
  construireCsvPromo,
  ecrireFichierPromo,
};
