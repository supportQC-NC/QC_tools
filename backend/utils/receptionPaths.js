// backend/utils/receptionPaths.js
//
// Utilitaire PARTAGÉ entre le controller de réception (dépôt des photos de
// signalement « dès la prise ») et le service de rapport (dépôt du PDF).
// Objectif : garantir que les deux écrivent dans EXACTEMENT le même dossier,
// sans duplication de logique.
//
// Arborescence cible sur RCOMMUN :
//   <base collecteur>/controle_cmd/<TRIGRAMME>/<NUMCDE>_<AAAA-MM-JJ>_<fournisseur>/
//       <NUMCDE>_<AAAA-MM-JJ>_<fournisseur>.pdf         (rapport)
//       signalement_<REF>_<type>.<ext>                  (photos problèmes)
//
// IMPORTANT — Base « collecteur » SANS migration de base de données :
// L'ancien module déposait le PDF directement dans `entreprise.cheminRapportReception`
// (ex: "...\STOCK\controle commande"). Ce chemin RCOMMUN FONCTIONNE DÉJÀ (le serveur
// en ligne y écrivait les PDF). On réutilise donc ce chemin et on remplace simplement
// son DERNIER segment par "collecteur" -> "...\STOCK\collecteur". Ainsi :
//   - aucun changement à faire en base (les entreprises existantes marchent telles quelles) ;
//   - on s'appuie sur le chemin déjà éprouvé pour l'écriture sur le partage ;
//   - c'est idempotent : si le champ vaut déjà "...\STOCK\collecteur", il est conservé.
// La traduction dev/prod (UNC Windows <-> montage Linux) reste gérée par le getter
// du modèle Entreprise ; on travaille ici sur la valeur déjà traduite.

import path from "path";

// Sous-dossier fixe créé dans la base « collecteur ».
export const CONTROLE_CMD_DIR = "controle_cmd";

// Nom du dossier « collecteur » (dernier segment de la base).
export const COLLECTEUR_DIR = "collecteur";

// Base de repli si l'entreprise n'a aucun chemin configuré.
const DEFAULT_BASE_COLLECTEUR = "\\\\192.168.0.250\\Rcommun\\STOCK\\collecteur";

// ---------------------------------------------------------------------------
// TYPES DE SIGNALEMENT (problème article)
// ---------------------------------------------------------------------------
// Valeur "wire" (stable, ASCII, stockée en base et utilisée dans les noms de
// fichiers) -> libellé affiché (UI / PDF / email).
export const SIGNALEMENT_TYPES = {
  avarie: "Avarie",
  cassee: "Cassée",
  manquant: "Manquant",
  abimee: "Abîmée",
};

// Liste des valeurs autorisées (pour l'enum Mongoose et la validation).
export const SIGNALEMENT_VALUES = Object.keys(SIGNALEMENT_TYPES);

// Libellé affichable d'un type (repli sur la valeur brute si inconnue).
export const signalementLabel = (type) =>
  SIGNALEMENT_TYPES[String(type || "").trim()] || String(type || "").trim();

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const pad2 = (n) => String(n).padStart(2, "0");

/** Nettoie une chaîne pour en faire un segment de dossier / nom de fichier valide. */
export const sanitizeSegment = (nom) =>
  String(nom || "")
    .replace(/[\\/:*?"<>|]/g, "_") // caractères interdits Windows
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150) || "sans_nom";

/**
 * Dérive la base « collecteur » à partir du chemin de dépôt existant de
 * l'entreprise (celui qui déposait déjà le PDF sur RCOMMUN).
 * On remplace le DERNIER segment par "collecteur" en conservant le préfixe
 * (UNC "\\serveur\..." ou POSIX "/mnt/..."). Idempotent.
 *
 * Exemples :
 *   "\\192.168.0.250\Rcommun\STOCK\controle commande" -> "...\STOCK\collecteur"
 *   "\\192.168.0.250\Rcommun\STOCK\collecteur"          -> inchangé
 *   "/mnt/rcommun/STOCK/controle commande"              -> "/mnt/rcommun/STOCK/collecteur"
 *   "" (vide)                                            -> DEFAULT_BASE_COLLECTEUR
 */
export const deriveCollecteurBase = (cheminDepot) => {
  const raw = safeTrim(cheminDepot);
  if (!raw) return DEFAULT_BASE_COLLECTEUR;

  const parts = raw.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0) return DEFAULT_BASE_COLLECTEUR;

  // Déjà "collecteur" ? on garde tel quel (idempotent).
  if (parts[parts.length - 1].toLowerCase() === COLLECTEUR_DIR) return raw;

  // Remplace le dernier segment par "collecteur", en préservant le séparateur
  // et l'éventuel préfixe UNC / racine absolue.
  const usesBackslash = raw.includes("\\");
  const sep = usesBackslash ? "\\" : "/";
  let prefix = "";
  if (raw.startsWith("\\\\")) prefix = "\\\\"; // UNC Windows
  else if (raw.startsWith("//")) prefix = "//"; // UNC POSIX
  else if (raw.startsWith("/")) prefix = "/"; // racine POSIX

  parts[parts.length - 1] = COLLECTEUR_DIR;
  return prefix + parts.join(sep);
};

/** Date -> "AAAA-MM-JJ" (ou "" si invalide). */
const dateToYmd = (d) => {
  if (!d) return "";
  const dd = d instanceof Date ? d : new Date(d);
  if (isNaN(dd.getTime())) return "";
  return `${dd.getFullYear()}-${pad2(dd.getMonth() + 1)}-${pad2(dd.getDate())}`;
};

/**
 * Nom de base commun au dossier de commande ET au fichier PDF :
 *   "<NUMCDE>_<AAAA-MM-JJ>_<fournisseur>"
 * La date suit la même priorité que l'ancien nom de fichier :
 *   arrivée commande -> début de contrôle -> aujourd'hui.
 */
export const buildBaseName = (reception) => {
  const numcde = safeTrim(reception?.numcde) || "commande";
  const dateStr =
    dateToYmd(reception?.commandeInfo?.arrivee) ||
    dateToYmd(reception?.controleDebutAt) ||
    dateToYmd(new Date());
  const fournisseur =
    safeTrim(reception?.commandeInfo?.fournisseurNom) ||
    (reception?.commandeInfo?.fourn != null
      ? `fourn${reception.commandeInfo.fourn}`
      : "fournisseur");
  return sanitizeSegment(`${numcde}_${dateStr}_${fournisseur}`);
};

/** Nom du fichier PDF du rapport (base commune + extension). */
export const buildPdfFileName = (reception) => `${buildBaseName(reception)}.pdf`;

/**
 * Construit (et renvoie) le chemin ABSOLU du dossier de la commande :
 *   <base collecteur>/controle_cmd/<TRIGRAMME>/<NUMCDE>_<date>_<fournisseur>
 *
 * La base « collecteur » est DÉRIVÉE du chemin de dépôt existant de l'entreprise
 * (voir deriveCollecteurBase) -> aucune migration de base nécessaire.
 *
 * @param {object} entreprise  Document Entreprise (getter cheminRapportReception + trigramme)
 * @param {object} reception   Document Reception (numcde + commandeInfo)
 * @returns {string} chemin du dossier (NON créé — voir mkdir côté appelant)
 */
export const buildControleCmdDir = (entreprise, reception) => {
  const base = deriveCollecteurBase(entreprise?.cheminRapportReception);
  const trigramme = sanitizeSegment(
    safeTrim(entreprise?.trigramme).toUpperCase() || "XXX",
  );
  const commandeDir = buildBaseName(reception);
  return path.join(base, CONTROLE_CMD_DIR, trigramme, commandeDir);
};

/**
 * Nom de fichier d'une photo de signalement (1 par article max).
 *   signalement_<REF>_<type>.<ext>
 * @param {string} refKey  clé article (NART ou gencode scanné)
 * @param {string} type    valeur de SIGNALEMENT_VALUES
 * @param {string} ext     extension sans point (jpg par défaut)
 */
export const buildSignalementFileName = (refKey, type, ext = "jpg") => {
  const ref = sanitizeSegment(safeTrim(refKey) || "article");
  const t = sanitizeSegment(safeTrim(type) || "probleme");
  const e = sanitizeSegment(safeTrim(ext) || "jpg").toLowerCase();
  return `signalement_${ref}_${t}.${e}`;
};

export default {
  CONTROLE_CMD_DIR,
  COLLECTEUR_DIR,
  SIGNALEMENT_TYPES,
  SIGNALEMENT_VALUES,
  signalementLabel,
  sanitizeSegment,
  deriveCollecteurBase,
  buildBaseName,
  buildPdfFileName,
  buildControleCmdDir,
  buildSignalementFileName,
};