// backend/services/ftpDocumentsService.js
//
// Synchronisation des documents du serveur FTPS « robot-documents » vers un
// cache local, pour les modules Analyse CA (jour) et Analyse CA mensuelle.
// Les services de parsing continuent de lire des fichiers LOCAUX : ce module
// ne fait que tenir le cache à jour.
//
// Serveur (mis en place le 29/10/2026, remplace la lecture directe du Rcommun) :
//   - FTPS EXPLICITE (TLS obligatoire, les connexions en clair sont refusées),
//     mode passif, certificat AUTO-SIGNÉ (d'où rejectUnauthorized: false).
//   - Hôte LAN 192.168.0.252, hôte internet 202.22.228.91 (le VPS de prod
//     n'est pas sur le LAN) — on essaie dans l'ordre, le premier qui répond
//     est mémorisé pour la session.
//   - Dossiers : analyse_CA_jour/ (17 fichiers, régénérés chaque soir 19h30
//     lun-sam, le dossier est VIDÉ puis rempli) et analyse_CA_mensuelle/
//     (15 fichiers, le 1er du mois à 04h00 pour le mois précédent).
//
// ⚠️ Identifiants EN DUR, comme les chemins (décision client : « ça doit
// marcher en prod » sans toucher au .env). Compte limité en droits au seul
// dossier robot-documents.
//
// Politique de cache :
//   - une synchro au plus toutes les SYNC_TTL_MS par dossier (verrou anti
//     synchros concurrentes) ; un fichier n'est retéléchargé que si sa taille
//     ou sa date distante a changé (manifeste .manifest.json) ;
//   - les fichiers locaux ABSENTS du serveur ne sont PAS supprimés : le FTP ne
//     garde que la dernière génération, le cache accumule donc l'historique
//     (années précédentes côté jour, mois précédents côté mensuelle) ;
//   - si le FTP est injoignable, on sert le cache existant (données
//     potentiellement datées valent mieux qu'un écran vide).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "basic-ftp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FTP_HOTES = ["192.168.0.252", "202.22.228.91"]; // LAN d'abord, puis internet
const FTP_PORT = 2121;
const FTP_USER = "robot-documents";
const FTP_PASSWORD = "6838_ROBOT_DOC_84";
const FTP_TIMEOUT_MS = 15000;

const SYNC_TTL_MS = 5 * 60 * 1000; // au plus une synchro toutes les 5 min / dossier

// Cache local : backend/.cache-ftp/<dossier> (ignoré par git).
const RACINE_CACHE = path.join(__dirname, "..", ".cache-ftp");

// Hôte qui a répondu en dernier (évite de repayer le timeout LAN sur le VPS).
let hoteConnu = null;

// État par dossier distant : { derniereSync, enCours (promesse), erreur }
const etats = new Map();

function cheminCache(dossierDistant) {
  return path.join(RACINE_CACHE, dossierDistant);
}

function lireManifeste(dossierLocal) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(dossierLocal, ".manifest.json"), "utf8"),
    );
  } catch {
    return {};
  }
}

function ecrireManifeste(dossierLocal, manifeste) {
  fs.writeFileSync(
    path.join(dossierLocal, ".manifest.json"),
    JSON.stringify(manifeste, null, 2),
  );
}

// Ouvre une connexion FTPS sur le premier hôte qui répond.
async function connecter() {
  const hotes = hoteConnu
    ? [hoteConnu, ...FTP_HOTES.filter((h) => h !== hoteConnu)]
    : FTP_HOTES;
  let derniereErreur = null;
  for (const host of hotes) {
    const client = new Client(FTP_TIMEOUT_MS);
    try {
      await client.access({
        host,
        port: FTP_PORT,
        user: FTP_USER,
        password: FTP_PASSWORD,
        secure: true, // FTPS explicite (AUTH TLS)
        secureOptions: { rejectUnauthorized: false }, // certificat auto-signé
      });
      hoteConnu = host;
      return client;
    } catch (err) {
      client.close();
      derniereErreur = err;
      if (host === hoteConnu) hoteConnu = null;
    }
  }
  throw derniereErreur || new Error("Aucun hôte FTP joignable");
}

/**
 * Ouvre une connexion FTPS authentifiée sur robot-documents (LAN puis internet)
 * pour les services qui ÉCRIVENT sur le serveur (ex. miroir des inventaires).
 * L'appelant est responsable du `client.close()`.
 */
export async function ouvrirConnexionFtp() {
  return connecter();
}

// Synchronise un dossier distant vers le cache local. Ne lève JAMAIS : en cas
// d'échec on sert le cache existant.
async function synchroniser(dossierDistant) {
  const dossierLocal = cheminCache(dossierDistant);
  fs.mkdirSync(dossierLocal, { recursive: true });

  const manifeste = lireManifeste(dossierLocal);
  let client;
  try {
    client = await connecter();
    const fichiers = await client.list(`/${dossierDistant}`);
    for (const f of fichiers) {
      if (!f.isFile) continue;
      const cle = f.name;
      const distant = {
        taille: f.size,
        modifie: f.modifiedAt ? f.modifiedAt.toISOString() : f.rawModifiedAt || "",
      };
      const local = manifeste[cle];
      const cheminLocal = path.join(dossierLocal, f.name);
      const dejaAJour =
        local &&
        local.taille === distant.taille &&
        local.modifie === distant.modifie &&
        fs.existsSync(cheminLocal);
      if (dejaAJour) continue;
      await client.downloadTo(cheminLocal, `/${dossierDistant}/${f.name}`);
      manifeste[cle] = distant;
    }
    ecrireManifeste(dossierLocal, manifeste);
    return { ok: true };
  } catch (err) {
    return { ok: false, erreur: err?.message || String(err) };
  } finally {
    client?.close();
  }
}

/**
 * Garantit que le cache local d'un dossier FTP est raisonnablement frais
 * (synchro au plus toutes les 5 min, verrouillée contre les appels
 * concurrents) et renvoie son chemin local.
 *
 * @param {string} dossierDistant  "analyse_CA_jour" | "analyse_CA_mensuelle"
 * @param {{force?: boolean}} [options]
 * @returns {Promise<{dossier: string, ok: boolean, erreur?: string}>}
 */
export async function assurerCacheFtp(dossierDistant, { force = false } = {}) {
  let etat = etats.get(dossierDistant);
  if (!etat) {
    etat = { derniereSync: 0, enCours: null, erreur: null };
    etats.set(dossierDistant, etat);
  }

  const perime = Date.now() - etat.derniereSync > SYNC_TTL_MS;
  if ((perime || force) && !etat.enCours) {
    etat.enCours = synchroniser(dossierDistant)
      .then((r) => {
        etat.derniereSync = Date.now();
        etat.erreur = r.ok ? null : r.erreur;
        return r;
      })
      .finally(() => {
        etat.enCours = null;
      });
  }
  if (etat.enCours) await etat.enCours;

  return {
    dossier: cheminCache(dossierDistant),
    ok: !etat.erreur,
    erreur: etat.erreur || undefined,
  };
}

export default { assurerCacheFtp };
