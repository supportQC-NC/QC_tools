// backend/services/receptionExportService.js
//
// Génère, en fin de réception, deux fichiers CSV destinés aux Achats et déposés
// dans le dossier d'export inventaire de l'entreprise (collect_sec =
// entreprise.cheminExportInventaire), AVEC une copie dans le dossier de la
// commande (celui du PDF + photos de signalement,
// <collecteur>/controle_cmd/<TRIG>/<commande>/) :
//
//   1) regul_<NUMCDE>.csv   — régularisation d'inventaire (écarts définitifs)
//        Format : "NART;quantité" (quantité SIGNÉE), une ligne par article.
//        - surplus (reçu > commandé)   -> NART ; quantité NÉGATIVE
//        - manquant (reçu < commandé)  -> NART ; quantité POSITIVE
//        - article inconnu (hors base) -> gencode ; quantité NÉGATIVE (surplus)
//        Règle unifiée pour les articles de la commande : quantité = -(reçu - commandé).
//
//   2) renvoi_<NUMCDE>.csv  — switch de gencode pour les articles bipés via un
//        renvoi GENDOUBL. Format : "NART;GENECODE" (2 lignes par renvoi) :
//        - <NART_article_cible> ; <gencode_bipé>        (le code physique devient principal)
//        - <NART_de_la_fiche_renvoi> ; <ancien_gencode_de_l_article_cible>
//
// IMPORTANT — nommage volontairement HORS motif "stock.dat …" : le watcher
// d'inventaire (inventaireWatchService) importe automatiquement tout fichier
// "stock.dat <suffixe>" présent dans le dossier surveillé. En nommant ces
// fichiers "regul_…"/"renvoi_…", ils sont IGNORÉS par le watcher et restent
// disponibles pour les Achats (qui les appliquent manuellement).
//
// NB (format régul) : format CSV simple pour l'instant (les quantités négatives
// ne rentrent pas dans le format .dat historique). À affiner ultérieurement si
// Stock XL attend un gabarit précis.

import fs from "fs";
import path from "path";
import { buildControleCmdDir } from "../utils/receptionPaths.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Nettoie un numéro de commande pour un nom de fichier valide.
const sanitizeFileSegment = (s) =>
  safeTrim(s).replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "sans_num";

// Dossier d'export inventaire (collect_sec) de l'entreprise. Le getter du modèle
// Entreprise a déjà traduit dev/prod. Repli prod par défaut.
const resoudreDossierCollectSec = (entreprise) =>
  safeTrim(entreprise?.cheminExportInventaire) ||
  "/mnt/rcommun/STOCK/collect_sec";

// Écrit un contenu texte (CRLF) dans <dossier>/<fichier>, crée le dossier au besoin.
const ecrireFichier = (dossier, fichier, contenu) => {
  if (!fs.existsSync(dossier)) fs.mkdirSync(dossier, { recursive: true });
  const chemin = path.join(dossier, fichier);
  fs.writeFileSync(chemin, contenu, "utf8");
  return chemin;
};

/**
 * Construit les lignes de la régularisation d'inventaire.
 * @returns {Array<{code:string, quantite:number, type:string}>}
 */
export const construireLignesRegul = (reception) => {
  const lignesCommande = reception.lignesCommande || [];
  const comptages = reception.comptages || [];
  const lignes = [];

  // Index des comptages "dans la commande" par NART.
  const norm = (s) => safeTrim(s).toUpperCase();
  const comptageByNart = new Map();
  comptages.forEach((c) => {
    if (c.nart && !c.isInconnu) comptageByNart.set(norm(c.nart), c);
  });

  // Articles de la commande : quantité régul = -(reçu - commandé).
  //   reçu = qteValidee ?? qteComptee ; non compté -> reçu = 0.
  lignesCommande.forEach((l) => {
    const c = comptageByNart.get(norm(l.nart));
    const recu = c ? (c.qteValidee != null ? c.qteValidee : c.qteComptee) : 0;
    const ecart = recu - (l.qteCommandee || 0);
    if (ecart === 0) return;
    lignes.push({
      code: safeTrim(l.nart),
      quantite: -ecart, // surplus -> négatif ; manquant -> positif
      type: ecart > 0 ? "surplus" : "manquant",
    });
  });

  // Comptages hors commande / inconnus : surplus (reçu, non commandé).
  comptages.forEach((c) => {
    const horsCommande = !c.dansCommande || c.isInconnu;
    if (!horsCommande) return;
    const recu = c.qteValidee != null ? c.qteValidee : c.qteComptee;
    if (!recu) return;
    if (c.isInconnu || !safeTrim(c.nart)) {
      // Article inconnu -> code = gencode scanné, quantité négative (surplus).
      lignes.push({
        code: safeTrim(c.gencodeScanne) || safeTrim(c.gencod),
        quantite: -Math.abs(recu),
        type: "inconnu",
      });
    } else {
      // Hors commande identifié -> NART, quantité négative (surplus).
      lignes.push({
        code: safeTrim(c.nart),
        quantite: -Math.abs(recu),
        type: "surplus",
      });
    }
  });

  return lignes.filter((l) => l.code);
};

/**
 * Construit les lignes du switch de gencode (renvois GENDOUBL).
 * @returns {Array<{nart:string, gencode:string}>}
 */
export const construireLignesRenvoi = (reception) => {
  const comptages = reception.comptages || [];
  const lignes = [];
  const vus = new Set();

  comptages.forEach((c) => {
    if (!c.isRenvoi) return;
    const nartCible = safeTrim(c.nart);
    const gencodeBipe = safeTrim(c.renvoiGencodeBipe) || safeTrim(c.gencodeScanne);
    const nartRenvoi = safeTrim(c.renvoiNartOrigine);
    const ancienGencodeArticle = safeTrim(c.gencod);

    // Dédoublonnage par article cible (1 switch par article).
    const cle = `${nartCible}|${gencodeBipe}`;
    if (!nartCible || !gencodeBipe || vus.has(cle)) return;
    vus.add(cle);

    // Ligne 1 : le gencode physiquement bipé devient celui de la fiche article cible.
    lignes.push({ nart: nartCible, gencode: gencodeBipe });
    // Ligne 2 : l'ancien gencode de l'article part sur la fiche « renvoi » (source).
    if (nartRenvoi) {
      lignes.push({ nart: nartRenvoi, gencode: ancienGencodeArticle });
    }
  });

  return lignes;
};

// Sérialise une régul en CSV "NART;quantité" (CRLF).
const csvRegul = (lignes) => {
  let out = "NART;QUANTITE\r\n";
  lignes.forEach((l) => {
    out += `${l.code};${l.quantite}\r\n`;
  });
  return out;
};

// Sérialise un switch en CSV "NART;GENECODE" (CRLF).
const csvRenvoi = (lignes) => {
  let out = "NART;GENECODE\r\n";
  lignes.forEach((l) => {
    out += `${l.nart};${l.gencode}\r\n`;
  });
  return out;
};

/**
 * Génère et dépose les fichiers CSV (régul + renvoi) :
 *   - dans collect_sec (destination principale pour les Achats / Stock XL) ;
 *   - ET une COPIE dans le dossier de la commande (celui du PDF + photos de
 *     signalement : <collecteur>/controle_cmd/<TRIG>/<commande>/).
 *
 * Ne lève JAMAIS : les erreurs d'écriture sont capturées et remontées dans le
 * résultat (la génération du rapport principal ne doit pas échouer pour autant).
 * L'écriture dans collect_sec est prioritaire ; la copie dans le dossier
 * collecteur est best-effort (une copie ratée n'invalide pas le fichier principal).
 *
 * @param {object} reception  Document Reception
 * @param {object} entreprise Document Entreprise (getters chemins)
 * @returns {{dossierExport, dossierCollecteur, regul, renvoi}}
 */
export const genererFichiersStockXL = (reception, entreprise) => {
  const dossierExport = resoudreDossierCollectSec(entreprise); // collect_sec

  // Dossier de la commande (PDF + photos). Best-effort : si indisponible, on
  // dépose quand même dans collect_sec.
  let dossierCollecteur = null;
  try {
    dossierCollecteur = buildControleCmdDir(entreprise, reception);
  } catch (e) {
    dossierCollecteur = null;
    console.error("[RECEPTION] dossier collecteur indisponible:", e.message);
  }

  const numcde = sanitizeFileSegment(reception.numcde);
  const resultat = { dossierExport, dossierCollecteur, regul: null, renvoi: null };

  // Dépose un fichier dans collect_sec + copie dans le dossier collecteur.
  const deposer = (fichier, contenu) => {
    const chemins = [];
    // 1) collect_sec (principal)
    chemins.push(ecrireFichier(dossierExport, fichier, contenu));
    // 2) copie dans le dossier de la commande (PDF/photos)
    if (dossierCollecteur) {
      try {
        chemins.push(ecrireFichier(dossierCollecteur, fichier, contenu));
      } catch (e) {
        console.error(
          `[RECEPTION] copie ${fichier} dans le dossier collecteur impossible:`,
          e.message,
        );
      }
    }
    return chemins;
  };

  // --- Régul d'inventaire ---
  try {
    const lignesRegul = construireLignesRegul(reception);
    if (lignesRegul.length > 0) {
      const chemins = deposer(`regul_${numcde}.csv`, csvRegul(lignesRegul));
      resultat.regul = { chemins, lignes: lignesRegul.length };
    } else {
      resultat.regul = { chemins: [], lignes: 0 }; // rien à régulariser
    }
  } catch (e) {
    resultat.regul = { error: e.message };
    console.error("[RECEPTION regul] écriture impossible:", e.message);
  }

  // --- Switch de gencode (renvois) ---
  try {
    const lignesRenvoi = construireLignesRenvoi(reception);
    if (lignesRenvoi.length > 0) {
      const chemins = deposer(`renvoi_${numcde}.csv`, csvRenvoi(lignesRenvoi));
      resultat.renvoi = { chemins, lignes: lignesRenvoi.length };
    } else {
      resultat.renvoi = { chemins: [], lignes: 0 }; // aucun renvoi
    }
  } catch (e) {
    resultat.renvoi = { error: e.message };
    console.error("[RECEPTION renvoi] écriture impossible:", e.message);
  }

  return resultat;
};

export default {
  construireLignesRegul,
  construireLignesRenvoi,
  genererFichiersStockXL,
};