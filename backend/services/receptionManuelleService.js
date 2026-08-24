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
import { getReservationsIndexes } from "./resaEntreesService.js";

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

// Les lignes de la fiche papier sont TOUJOURS classées par DÉSIGNATION, jamais
// par NL : l'agent contrôle en parcourant les articles par nom, pas dans
// l'ordre de saisie de la commande.
// Comparateur alphabétique FR, insensible casse/accents, chiffres en ordre
// naturel (« BOULON 2 » avant « BOULON 10 »). Les lignes sans désignation
// partent en fin de liste ; à désignation égale on retombe sur le NL.
const comparerParDesignation = (a, b) => {
  const da = safeTrim(a.designation);
  const db = safeTrim(b.designation);
  if (!da || !db) {
    if (da !== db) return da ? -1 : 1;
  } else {
    const cmp = da.localeCompare(db, "fr", {
      sensitivity: "base",
      numeric: true,
    });
    if (cmp !== 0) return cmp;
  }
  return a.nl - b.nl;
};

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

// ──────────────────────── Réservations (repère « R ») ───────────────────────
// Un article porte un « R » quand il est réservé pour un client (facture.dbf
// TYPFACT="R" × detail.dbf) : à la réception, la marchandise doit être mise de
// côté et non rangée en rayon.
//
// ⚠️ L'ERP ne purge JAMAIS ces tables : sans borne on remonterait à 2019 et
// presque toutes les lignes seraient marquées. On ne retient donc que les
// réservations des 12 derniers mois — même convention que l'espace commercial.
const FENETRE_RESA_MOIS = 12;

// L'index des réservations est partagé avec l'espace commercial (qui le
// préchauffe en tâche de fond) mais son scan à froid dure plusieurs dizaines de
// secondes. On ne fait jamais attendre une impression : passé ce délai la fiche
// sort SANS les « R », le scan continue et alimente le cache pour la suivante.
const RESA_ATTENTE_MS = 8000;

const borneResaYmd = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - FENETRE_RESA_MOIS);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

/**
 * NART (majuscules) ayant au moins une réservation récente.
 * @returns {Promise<Set<string>|null>} null = information indisponible
 *          (index pas encore chaud ou DBF illisible) — on n'affiche alors
 *          aucun « R » plutôt que de faux négatifs silencieux ligne à ligne.
 */
const getNartsReserves = async (entreprise) => {
  let timer = null;
  const attente = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), RESA_ATTENTE_MS);
    if (typeof timer.unref === "function") timer.unref();
  });

  try {
    const index = await Promise.race([
      getReservationsIndexes(entreprise).catch((e) => {
        console.warn(
          `[ReceptionManuelle] Réservations indisponibles (${entreprise.nomDossierDBF}) : ${e.message}`,
        );
        return null;
      }),
      attente,
    ]);
    if (!index?.parNart) return null;

    const limite = borneResaYmd();
    const set = new Set();
    for (const [nart, resas] of index.parNart) {
      // Date illisible : on garde la réservation (un « R » en trop se voit au
      // quai, une réservation ratée part en rayon et le client ne l'a pas).
      if (resas.some((r) => !r.datfact || r.datfact >= limite)) set.add(nart);
    }
    return set;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
 * gencode (repère visuel pour l'agent) et flags « nouveauté » / « réservé ».
 * Les lignes de commentaire (NART contenant "!") sont séparées des articles.
 *
 * @returns {Promise<{entete, commentaires, lignes, resaDisponible}>}
 *          entete = null si introuvable ; resaDisponible = false quand l'index
 *          des réservations n'a pas répondu à temps (aucun « R » sur la fiche).
 */
export const getCommandeComplete = async (entreprise, numcde) => {
  const record = await commandeCacheService.findByNumcde(entreprise, numcde);
  if (!record) {
    return {
      entete: null,
      commentaires: [],
      lignes: [],
      resaDisponible: true,
    };
  }

  const lignesBrutes = await commandeCacheService.getDetailsByNumcde(
    entreprise,
    numcde,
  );
  const [artCache, nartsReserves] = await Promise.all([
    articleCacheService.getArticles(entreprise),
    getNartsReserves(entreprise),
  ]);

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
    const cle = nart.toUpperCase();
    const idx = artCache.indexByNart.get(cle);
    const art = idx !== undefined ? artCache.records[idx] : null;

    lignes.push({
      nl: parseFloat(l.NL) || 0,
      nart,
      designation: safeTrim(l.DESIGN) || safeTrim(art?.DESIGN),
      refer: safeTrim(l.REFER) || safeTrim(art?.REFER),
      gencod: safeTrim(art?.GENCOD),
      qteCommandee: parseFloat(l.QTE) || 0,
      estNouveau: estNouveauArticle(art),
      estReserve: nartsReserves ? nartsReserves.has(cle) : false,
      inconnu: !art, // article absent de la base (à signaler au contrôle)
    });
  }

  lignes.sort(comparerParDesignation);

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
    resaDisponible: nartsReserves !== null,
  };
};

export default {
  ETAT_MIN_RECEPTION,
  checkCommandeFiles,
  listerCommandes,
  getCommandeComplete,
};
