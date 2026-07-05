// // backend/utils/preparationPaths.js
// //
// // Chemins de dépôt du module Préparation de commande, sur le MÊME principe que
// // la réception (controle_cmd) : sous la base « collecteur ».
// //
// //   <collecteur>/prepa_cmd/<TRIGRAMME>/<NUMPRO>_<AAAA-MM-JJ>_<client>/
// //       Prepa_cde_<client>_<NUMPRO>.pdf        (rapport de préparation)
// //
// // La base « collecteur » est dérivée du chemin de dépôt de l'entreprise
// // (deriveCollecteurBase), identique à la réception -> pas de config supplémentaire.

// import path from "path";
// import { deriveCollecteurBase, sanitizeSegment } from "./receptionPaths.js";

// export const PREPA_CMD_DIR = "prepa_cmd";

// const safeTrim = (v) => (v == null ? "" : String(v)).trim();
// const pad2 = (n) => String(n).padStart(2, "0");

// const dateToYmd = (d) => {
//   if (!d) return "";
//   const dd = d instanceof Date ? d : new Date(d);
//   if (isNaN(dd.getTime())) return "";
//   return `${dd.getFullYear()}-${pad2(dd.getMonth() + 1)}-${pad2(dd.getDate())}`;
// };

// /**
//  * Nom du sous-dossier de la proforma : "<NUMPRO>_<AAAA-MM-JJ>_<client>".
//  * Date : date de la proforma -> début de préparation -> aujourd'hui.
//  */
// export const buildPrepaBaseName = (preparation) => {
//   const numpro =
//     safeTrim(preparation?.numpro) ||
//     safeTrim(preparation?.proformaInfo?.numfact) ||
//     "proforma";
//   const dateStr =
//     dateToYmd(preparation?.proformaInfo?.datfact) ||
//     dateToYmd(preparation?.preparationDebutAt) ||
//     dateToYmd(new Date());
//   const client = safeTrim(preparation?.proformaInfo?.clientNom) || "client";
//   return sanitizeSegment(`${numpro}_${dateStr}_${client}`);
// };

// /**
//  * Dossier ABSOLU de la proforma :
//  *   <collecteur>/prepa_cmd/<TRIGRAMME>/<NUMPRO>_<date>_<client>
//  */
// export const buildPrepaCmdDir = (entreprise, preparation) => {
//   const base = deriveCollecteurBase(entreprise?.cheminRapportReception);
//   const trigramme = sanitizeSegment(
//     safeTrim(entreprise?.trigramme).toUpperCase() || "XXX",
//   );
//   return path.join(base, PREPA_CMD_DIR, trigramme, buildPrepaBaseName(preparation));
// };

// /** Nom du fichier PDF du rapport : "Prepa_cde_<client>_<NUMPRO>.pdf". */
// export const buildPrepaPdfFileName = (preparation) => {
//   const numpro = safeTrim(preparation?.numpro) || "proforma";
//   const client = safeTrim(preparation?.proformaInfo?.clientNom) || "client";
//   return `${sanitizeSegment(`Prepa_cde_${client}_${numpro}`)}.pdf`;
// };

// export default {
//   PREPA_CMD_DIR,
//   buildPrepaBaseName,
//   buildPrepaCmdDir,
//   buildPrepaPdfFileName,
// };

// backend/utils/preparationPaths.js
//
// Chemins de dépôt du module Préparation de commande, sur le MÊME principe que
// la réception : sous la base « collecteur », dans le dossier du TRIGRAMME de
// l'entreprise (qui regroupe controle_cmd ET prepa_cmd, pour plus de lisibilité).
//
//   <collecteur>/<TRIGRAMME>/prepa_cmd/<NUMPRO>_<AAAA-MM-JJ>_<client>/
//       Prepa_cde_<client>_<NUMPRO>.pdf        (rapport de préparation)
//
// La base « collecteur » est dérivée du chemin de dépôt de l'entreprise
// (deriveCollecteurBase), identique à la réception -> pas de config supplémentaire.

import path from "path";
import { deriveCollecteurBase, sanitizeSegment } from "./receptionPaths.js";

export const PREPA_CMD_DIR = "prepa_cmd";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const pad2 = (n) => String(n).padStart(2, "0");

const dateToYmd = (d) => {
  if (!d) return "";
  const dd = d instanceof Date ? d : new Date(d);
  if (isNaN(dd.getTime())) return "";
  return `${dd.getFullYear()}-${pad2(dd.getMonth() + 1)}-${pad2(dd.getDate())}`;
};

/**
 * Nom du sous-dossier de la proforma : "<NUMPRO>_<AAAA-MM-JJ>_<client>".
 * Date : date de la proforma -> début de préparation -> aujourd'hui.
 */
export const buildPrepaBaseName = (preparation) => {
  const numpro =
    safeTrim(preparation?.numpro) ||
    safeTrim(preparation?.proformaInfo?.numfact) ||
    "proforma";
  const dateStr =
    dateToYmd(preparation?.proformaInfo?.datfact) ||
    dateToYmd(preparation?.preparationDebutAt) ||
    dateToYmd(new Date());
  const client = safeTrim(preparation?.proformaInfo?.clientNom) || "client";
  return sanitizeSegment(`${numpro}_${dateStr}_${client}`);
};

/**
 * Dossier ABSOLU de la proforma (TRIGRAMME en premier) :
 *   <collecteur>/<TRIGRAMME>/prepa_cmd/<NUMPRO>_<date>_<client>
 */
export const buildPrepaCmdDir = (entreprise, preparation) => {
  const base = deriveCollecteurBase(entreprise?.cheminRapportReception);
  const trigramme = sanitizeSegment(
    safeTrim(entreprise?.trigramme).toUpperCase() || "XXX",
  );
  return path.join(base, trigramme, PREPA_CMD_DIR, buildPrepaBaseName(preparation));
};

/** Nom du fichier PDF du rapport : "Prepa_cde_<client>_<NUMPRO>.pdf". */
export const buildPrepaPdfFileName = (preparation) => {
  const numpro = safeTrim(preparation?.numpro) || "proforma";
  const client = safeTrim(preparation?.proformaInfo?.clientNom) || "client";
  return `${sanitizeSegment(`Prepa_cde_${client}_${numpro}`)}.pdf`;
};

export default {
  PREPA_CMD_DIR,
  buildPrepaBaseName,
  buildPrepaCmdDir,
  buildPrepaPdfFileName,
};