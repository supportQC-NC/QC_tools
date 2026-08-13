// backend/services/receptionManuelleService.js
//
// Lecture DBF du module « Contrôle réception MANUEL ».
//
// Même source et même périmètre que le contrôle de réception scanné
// (backend/controllers/receptionController.js) : commandes de cmdref dont
// l'ETAT >= ETAT_MIN_RECEPTION (Bateau / Avion / Local), triées par date
// d'arrivée. Ici on ne fait que LIRE : aucune session, aucun comptage.
import fs from "fs";
import path from "path";
import commandeCacheService from "./commandeService.js";
import fournissCacheService from "./fournissCacheService.js";
import articleCacheService from "./articleService.js";

// Seuil d'état des commandes éligibles au contrôle (identique au module scanné).
export const ETAT_MIN_RECEPTION = 4;

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  return commandeCacheService.parseDbfDate(v);
};

const dateToIso = (d) =>
  d instanceof Date && !isNaN(d.getTime()) ? d.toISOString() : null;

// Une ligne de détail est un commentaire si son NART contient "!".
const estCommentaire = (record) => safeTrim(record?.NART).includes("!");

// Nouveauté : aucune vente sur les 12 derniers mois (V1..V12 tous à 0).
const estNouveauArticle = (art) => {
  if (!art) return false;
  for (let i = 1; i <= 12; i += 1) {
    const v =
      parseFloat(art[`V${i}`] ?? art[`V${String(i).padStart(2, "0")}`]) || 0;
    if (v !== 0) return false;
  }
  return true;
};

// Libellé d'état depuis le mapping personnalisé de l'entreprise (Map ou objet).
const etatLabel = (entreprise, etat) => {
  try {
    const map = entreprise.mappingEtatsCommande;
    if (map && typeof map.get === "function") return map.get(String(etat)) || "";
    if (map && typeof map === "object") return map[String(etat)] || "";
  } catch {
    /* mapping absent */
  }
  return "";
};

// Vérifie la présence des DBF de commandes de la société.
export const checkCommandeFiles = (entreprise) => {
  const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
  for (const fichier of ["cmdref.dbf", "cmdetail.dbf"]) {
    if (!fs.existsSync(path.join(basePath, fichier))) {
      return {
        exists: false,
        error: `Fichier ${fichier} non trouvé pour ${entreprise.nomComplet}`,
      };
    }
  }
  return { exists: true };
};

const resolveFournisseurNom = async (entreprise, fourn) => {
  if (fourn === undefined || fourn === null || fourn === "") return "";
  try {
    const f = await fournissCacheService.findByFourn(entreprise, fourn);
    return f ? safeTrim(f.NOM) : "";
  } catch {
    return "";
  }
};

/**
 * Liste paginée des commandes à contrôler (ETAT >= seuil), triées par date
 * d'arrivée croissante puis par numéro. Le nom du fournisseur n'est résolu que
 * pour la page courante.
 *
 * @param {object} entreprise  document Entreprise
 * @param {object} options     { page, limit, search }
 */
export const listerCommandes = async (entreprise, options = {}) => {
  const page = parseInt(options.page, 10) || 1;
  const limit = parseInt(options.limit, 10) || 50;
  const search = safeTrim(options.search).toUpperCase();

  const cache = await commandeCacheService.getCmdRef(entreprise);

  const resultats = cache.records.filter((record) => {
    const etat = parseInt(record.ETAT, 10);
    if (isNaN(etat) || etat < ETAT_MIN_RECEPTION) return false;
    if (search) {
      const numcde = safeTrim(record.NUMCDE).toUpperCase();
      const bateau = safeTrim(record.BATEAU).toUpperCase();
      if (!numcde.includes(search) && !bateau.includes(search)) return false;
    }
    return true;
  });

  resultats.sort((a, b) => {
    const ta = toDate(a.ARRIVEE)?.getTime() ?? Infinity;
    const tb = toDate(b.ARRIVEE)?.getTime() ?? Infinity;
    if (ta !== tb) return ta - tb;
    return safeTrim(a.NUMCDE).localeCompare(safeTrim(b.NUMCDE));
  });

  const totalRecords = resultats.length;
  const startIndex = (page - 1) * limit;
  const paginated = resultats.slice(startIndex, startIndex + limit);

  // Nombre de lignes article par commande (index O(1) du cache de détail).
  const detail = await commandeCacheService.getCmdDetail(entreprise);

  const commandes = [];
  for (const record of paginated) {
    const numcde = safeTrim(record.NUMCDE);
    const fourn =
      record.FOURN !== undefined && record.FOURN !== null ? record.FOURN : null;
    const etat = parseInt(record.ETAT, 10);
    const indices = detail.indexByNumcde.get(numcde.toUpperCase()) || [];
    let nbLignes = 0;
    let totalUnites = 0;
    indices.forEach((i) => {
      const r = detail.records[i];
      if (estCommentaire(r)) return;
      nbLignes += 1;
      totalUnites += parseFloat(r.QTE) || 0;
    });

    commandes.push({
      numcde,
      fourn,
      fournisseurNom: await resolveFournisseurNom(entreprise, fourn),
      bateau: safeTrim(record.BATEAU),
      arrivee: dateToIso(toDate(record.ARRIVEE)),
      datcde: dateToIso(toDate(record.DATCDE)),
      observ: safeTrim(record.OBSERV),
      etat: isNaN(etat) ? null : etat,
      etatLabel: etatLabel(entreprise, etat),
      nbLignes,
      totalUnites: Math.round(totalUnites),
    });
  }

  return {
    etatMin: ETAT_MIN_RECEPTION,
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
      hasNextPage: startIndex + limit < totalRecords,
      hasPrevPage: page > 1,
    },
    commandes,
  };
};

/**
 * Entête + lignes d'une commande, enrichies pour la fiche papier :
 * gencode (repère visuel pour l'agent) et flag « nouveauté ».
 * Les lignes de commentaire (NART contenant "!") sont séparées des articles.
 *
 * @returns {Promise<{entete, commentaires, lignes}>} entete = null si introuvable
 */
export const getCommandeComplete = async (entreprise, numcde) => {
  const record = await commandeCacheService.findByNumcde(entreprise, numcde);
  if (!record) return { entete: null, commentaires: [], lignes: [] };

  const lignesBrutes = await commandeCacheService.getDetailsByNumcde(
    entreprise,
    numcde,
  );
  const artCache = await articleCacheService.getArticles(entreprise);

  const commentaires = [];
  const lignes = [];

  for (const l of lignesBrutes) {
    if (estCommentaire(l)) {
      const texte = [safeTrim(l.DESIGN), safeTrim(l.REFER)]
        .filter(Boolean)
        .join(" ");
      if (texte) commentaires.push(texte);
      continue;
    }

    const nart = safeTrim(l.NART);
    const idx = artCache.indexByNart.get(nart.toUpperCase());
    const art = idx !== undefined ? artCache.records[idx] : null;

    lignes.push({
      nl: parseFloat(l.NL) || 0,
      nart,
      designation: safeTrim(l.DESIGN) || safeTrim(art?.DESIGN),
      refer: safeTrim(l.REFER) || safeTrim(art?.REFER),
      gencod: safeTrim(art?.GENCOD),
      qteCommandee: parseFloat(l.QTE) || 0,
      estNouveau: estNouveauArticle(art),
      inconnu: !art, // article absent de la base (à signaler au contrôle)
    });
  }

  lignes.sort((a, b) => a.nl - b.nl);

  const fourn =
    record.FOURN !== undefined && record.FOURN !== null ? record.FOURN : null;
  const etat = parseInt(record.ETAT, 10);

  return {
    entete: {
      numcde: safeTrim(record.NUMCDE),
      fourn,
      fournisseurNom: await resolveFournisseurNom(entreprise, fourn),
      bateau: safeTrim(record.BATEAU),
      arrivee: toDate(record.ARRIVEE),
      datcde: toDate(record.DATCDE),
      observ: safeTrim(record.OBSERV),
      etat: isNaN(etat) ? null : etat,
      etatLabel: etatLabel(entreprise, etat),
    },
    commentaires,
    lignes,
  };
};

export default {
  ETAT_MIN_RECEPTION,
  checkCommandeFiles,
  listerCommandes,
  getCommandeComplete,
};
