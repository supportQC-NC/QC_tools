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
// La « base collecteur » est lue depuis entreprise.cheminRapportReception
// (getter du modèle Entreprise qui traduit dev/prod automatiquement). En prod,
// le getter conserve le dernier segment sous RCOMMON_STOCK_ROOT
// (ex: "\\...\STOCK\collecteur" -> "<root>/collecteur"). Le reste de
// l'arborescence (controle_cmd/<trig>/<commande>) est ajouté ici en JS, donc
// il fonctionne aussi bien en dev (UNC Windows) qu'en prod (montage Linux).

import path from "path";

// Sous-dossier fixe créé dans la base « collecteur ».
export const CONTROLE_CMD_DIR = "controle_cmd";

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
 * @param {object} entreprise  Document Entreprise (getter cheminRapportReception + trigramme)
 * @param {object} reception   Document Reception (numcde + commandeInfo)
 * @returns {string} chemin du dossier (NON créé — voir ensureDir)
 * @throws si la base collecteur n'est pas configurée
 */
export const buildControleCmdDir = (entreprise, reception) => {
  const base = safeTrim(entreprise?.cheminRapportReception);
  if (!base) {
    throw new Error(
      "Chemin de dépôt (cheminRapportReception / base collecteur) non configuré pour cette entreprise.",
    );
  }
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
  SIGNALEMENT_TYPES,
  SIGNALEMENT_VALUES,
  signalementLabel,
  sanitizeSegment,
  buildBaseName,
  buildPdfFileName,
  buildControleCmdDir,
  buildSignalementFileName,
};