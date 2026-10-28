// backend/services/inventaireFtpService.js
//
// MIROIR FTP des inventaires par zones (demande client du 29/10/2026).
//
// Chaque inventaire a son dossier de RÉFÉRENCE sur le serveur FTPS
// « robot-documents » : `inventaire/<TRIGRAMME>/<slug de l'inventaire>/`,
// avec un sous-dossier par emplacement (MAGASIN, DOCK…) contenant les .DAT
// déposés et les fiches PDF générées.
//
// ⚠️ Le FTP est un MIROIR DE RÉFÉRENCE, pas le flux opérationnel : le partage
// Rcommun STOCK reste le canal du watcher / de l'agent d'impression de QC
// (c'est lui qui crée FicheControle et LigneBipage depuis les .DAT) — décision
// client : « copie complète pour QC, l'application pointe vers le FTP ».
// Toutes les écritures FTP sont donc BEST-EFFORT : un FTP injoignable ne doit
// JAMAIS bloquer le terrain (init, dépôt d'une zone, impression). Les erreurs
// sont renvoyées à l'appelant (log) mais pas levées — SAUF le téléchargement
// (ZIP), où l'utilisateur attend le contenu.

import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { ouvrirConnexionFtp } from "./ftpDocumentsService.js";
import { sanitizeName } from "./ficheControleService.js";

const RACINE_FTP = "inventaire";

/** Chemin FTP du dossier d'un inventaire : inventaire/<TRIG>/<slug>. */
export function cheminFtpInventaire(trigramme, slug) {
  const trig = sanitizeName(String(trigramme || "").toUpperCase()) || "SANS_TRI";
  return `${RACINE_FTP}/${trig}/${sanitizeName(slug)}`;
}

// Exécute `fn(client)` sur une connexion fraîche, en best-effort : renvoie
// { ok, erreur? } sans jamais lever. `contexte` préfixe le log.
async function avecClient(contexte, fn) {
  let client;
  try {
    client = await ouvrirConnexionFtp();
    const resultat = await fn(client);
    return { ok: true, resultat };
  } catch (err) {
    const erreur = err?.message || String(err);
    console.error(`[InventaireFTP] ${contexte} : ${erreur}`);
    return { ok: false, erreur };
  } finally {
    client?.close();
  }
}

/** Crée le dossier FTP d'un inventaire (à l'initialisation de la session). */
export async function creerDossierInventaireFtp(trigramme, slug) {
  const chemin = cheminFtpInventaire(trigramme, slug);
  const r = await avecClient(`création ${chemin}`, async (client) => {
    await client.ensureDir(`/${chemin}`);
  });
  return { ...r, chemin };
}

/**
 * Dépose un fichier dans le dossier FTP de l'inventaire.
 * @param {string} sousDossier  Sous-dossier d'emplacement ("MAGASIN"…), "" = racine.
 * @param {string|Buffer} contenu  Chemin local à téléverser, ou contenu direct.
 */
export async function deposerFichierInventaireFtp(
  trigramme,
  slug,
  sousDossier,
  nomFichier,
  contenu,
) {
  const base = cheminFtpInventaire(trigramme, slug);
  const dossier = sousDossier ? `${base}/${sanitizeName(sousDossier)}` : base;
  return avecClient(`dépôt ${dossier}/${nomFichier}`, async (client) => {
    await client.ensureDir(`/${dossier}`); // laisse le cwd dans le dossier
    const source = Buffer.isBuffer(contenu)
      ? Readable.from(contenu)
      : fs.createReadStream(contenu);
    await client.uploadFrom(source, nomFichier);
  });
}

/** Supprime (récursivement) le dossier FTP d'un inventaire (action Annuler). */
export async function supprimerDossierInventaireFtp(trigramme, slug) {
  const chemin = cheminFtpInventaire(trigramme, slug);
  return avecClient(`suppression ${chemin}`, async (client) => {
    await client.removeDir(`/${chemin}`);
  });
}

/**
 * Télécharge le dossier FTP d'un inventaire vers un dossier local (pour le
 * ZIP « enregistrer en local »). LÈVE en cas d'erreur de connexion ; un
 * dossier absent du FTP n'est pas une erreur (renvoie false).
 */
export async function telechargerDossierInventaireFtp(trigramme, slug, dirLocal) {
  const chemin = cheminFtpInventaire(trigramme, slug);
  const client = await ouvrirConnexionFtp();
  try {
    // Le dossier peut ne pas exister (inventaire d'avant le miroir FTP).
    const parent = path.posix.dirname(`/${chemin}`);
    const nom = path.posix.basename(chemin);
    const entrees = await client.list(parent).catch(() => []);
    if (!entrees.some((e) => e.isDirectory && e.name === nom)) return false;

    fs.mkdirSync(dirLocal, { recursive: true });
    await client.downloadToDir(dirLocal, `/${chemin}`);
    return true;
  } finally {
    client.close();
  }
}

export default {
  cheminFtpInventaire,
  creerDossierInventaireFtp,
  deposerFichierInventaireFtp,
  supprimerDossierInventaireFtp,
  telechargerDossierInventaireFtp,
};
