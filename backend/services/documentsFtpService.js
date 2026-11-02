// backend/services/documentsFtpService.js
//
// MIROIR FTP DES DOCUMENTS GÉNÉRÉS, par société (demande client du 02/11/2026,
// d'abord pour DQ). Quand la fiche société porte un `dossierFtpDocuments`
// (ex. « SEDQ »), chaque document produit par l'application (.dat collecteurs,
// rapports de réception/préparation, fiches de contrôle) est AUSSI déposé sur
// le FTPS robot-documents sous :
//
//   /<dossierFtpDocuments>/<categorie>/<AAAA-MM>/<nomFichier>
//
// Le sous-dossier mensuel évite d'accumuler des milliers de fichiers au même
// niveau. Catégories utilisées : reappro, preparation, bipage, reception,
// fiches_controle.
//
// ⚠️ Comme le miroir inventaire (inventaireFtpService), c'est une COPIE DE
// RÉFÉRENCE, jamais le flux opérationnel : collect_sec / partage STOCK restent
// le canal de Stock XL et du watcher. Tous les dépôts sont BEST-EFFORT — un
// FTP injoignable ne doit JAMAIS bloquer le terrain ni faire échouer la
// requête appelante (les appels se font en fire-and-forget).
//
// La consultation/le téléchargement depuis l'outil passent par
// listerDocumentsFtp / telechargerDocumentFtp (écran Documents FTP).

import fs from "fs";
import { Readable } from "stream";
import { ouvrirConnexionFtp } from "./ftpDocumentsService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Un segment de chemin FTP sûr (pas de séparateur, pas de « .. »).
const sanitizeSegment = (s) =>
  safeTrim(s)
    .replace(/[\\/]+/g, "_")
    .replace(/\.\.+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .trim();

/** Le miroir documents est-il actif pour cette société ? */
export const miroirDocumentsActif = (entreprise) =>
  !!safeTrim(entreprise?.dossierFtpDocuments);

/** Racine FTP de la société (ex. « SEDQ »), "" si miroir inactif. */
export const racineDocumentsFtp = (entreprise) =>
  sanitizeSegment(entreprise?.dossierFtpDocuments);

const sousDossierMensuel = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Dépose un document sur le miroir FTP de la société. BEST-EFFORT : ne lève
 * JAMAIS (no-op si le miroir est inactif), renvoie { ok, chemin?, erreur? }.
 * À appeler en fire-and-forget après l'écriture locale réussie :
 *   deposerDocumentFtp(entreprise, "reappro", nom, chemin).catch(() => {});
 *
 * @param {object} entreprise  Document Entreprise (dossierFtpDocuments)
 * @param {string} categorie   reappro | preparation | bipage | reception | fiches_controle
 * @param {string} nomFichier  Nom du fichier tel que déposé
 * @param {string|Buffer} contenu  Chemin local à téléverser, ou contenu direct
 */
export async function deposerDocumentFtp(entreprise, categorie, nomFichier, contenu) {
  const racine = racineDocumentsFtp(entreprise);
  if (!racine) return { ok: false, erreur: "miroir inactif" };

  const dossier = `${racine}/${sanitizeSegment(categorie) || "autres"}/${sousDossierMensuel()}`;
  const nom = sanitizeSegment(nomFichier);
  let client;
  try {
    client = await ouvrirConnexionFtp();
    await client.ensureDir(`/${dossier}`); // laisse le cwd dans le dossier
    const source = Buffer.isBuffer(contenu)
      ? Readable.from(contenu)
      : fs.createReadStream(contenu);
    await client.uploadFrom(source, nom);
    return { ok: true, chemin: `${dossier}/${nom}` };
  } catch (err) {
    const erreur = err?.message || String(err);
    console.error(`[DocumentsFTP] dépôt ${dossier}/${nom} : ${erreur}`);
    return { ok: false, erreur };
  } finally {
    client?.close();
  }
}

// Chemin relatif sûr sous la racine de la société (navigation de l'écran).
const resoudreChemin = (entreprise, cheminRelatif) => {
  const racine = racineDocumentsFtp(entreprise);
  if (!racine) throw new Error("Miroir FTP non configuré pour cette société.");
  const segments = safeTrim(cheminRelatif)
    .split("/")
    .map(sanitizeSegment)
    .filter(Boolean);
  return { racine, chemin: [racine, ...segments].join("/") };
};

/**
 * Liste un dossier du miroir de la société (écran Documents FTP).
 * LÈVE en cas d'erreur de connexion ; un dossier absent renvoie [].
 * @returns {Promise<Array<{nom, type:"dossier"|"fichier", taille, modifieLe}>>}
 */
export async function listerDocumentsFtp(entreprise, cheminRelatif = "") {
  const { chemin } = resoudreChemin(entreprise, cheminRelatif);
  const client = await ouvrirConnexionFtp();
  try {
    const entrees = await client.list(`/${chemin}`).catch(() => []);
    return entrees
      .filter((e) => e.name !== "." && e.name !== "..")
      .map((e) => ({
        nom: e.name,
        type: e.isDirectory ? "dossier" : "fichier",
        taille: e.isDirectory ? null : e.size,
        modifieLe: e.modifiedAt ? e.modifiedAt.toISOString() : null,
      }))
      .sort((a, b) =>
        a.type === b.type
          ? b.nom.localeCompare(a.nom) // récents d'abord (noms horodatés)
          : a.type === "dossier"
            ? -1
            : 1,
      );
  } finally {
    client.close();
  }
}

/**
 * Télécharge UN fichier du miroir vers un flux Writable (la réponse HTTP).
 * LÈVE en cas d'erreur — l'utilisateur attend le contenu.
 */
export async function telechargerDocumentFtp(entreprise, cheminRelatif, writable) {
  const { chemin } = resoudreChemin(entreprise, cheminRelatif);
  const client = await ouvrirConnexionFtp();
  try {
    await client.downloadTo(writable, `/${chemin}`);
  } finally {
    client.close();
  }
}

export default {
  miroirDocumentsActif,
  racineDocumentsFtp,
  deposerDocumentFtp,
  listerDocumentsFtp,
  telechargerDocumentFtp,
};
