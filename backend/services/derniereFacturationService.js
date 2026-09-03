// backend/services/derniereFacturationService.js
// -----------------------------------------------------------------------------
// DERNIÈRE FACTURATION — liste des clients d'une société avec la date de leur
// dernière facture, triée du plus ancien au plus récent (repérage des clients
// qui ne sont plus venus).
//
// Deux sources, toutes deux DÉJÀ en cache — ce service ne lit aucun DBF :
//   - clientCacheService.getClients()      -> clients.dbf (TTL 5 min + mtime) ;
//   - commercialService.getIndexFactures() -> index colonnaire de facture.dbf,
//     construit en UNE passe pour tout l'espace commercial (TTL 10 min, préchauffé
//     par startCommercialIndexWarmer). On y lit `dernieresFactures`, calculée
//     pendant le scan : aucune lecture supplémentaire de facture.dbf.
//
// ⚠️ Ne PAS remplacer getIndexFactures par factureCacheService : ce dernier charge
// aussi detail.dbf (6,2 M lignes chez QC) dont on n'a aucun besoin ici.
//
// Seules les factures (TYPFACT="F") comptent : un avoir n'est pas une
// facturation, il ne doit pas « rajeunir » un client qui n'achète plus.
//
// Les clients jamais facturés sortent avec `derniereFacture: null` : ils sont
// placés en FIN de liste (le tri par défaut demandé commence par la date la plus
// ancienne, or « jamais » n'est pas une date) et comptés à part dans les totaux.
// -----------------------------------------------------------------------------

import clientCacheService from "./clientCacheService.js";
import { getIndexFactures } from "./commercialService.js";

const safeTrim = (v) => (v === null || v === undefined ? "" : String(v).trim());

const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

// Clé secondaire : le TIERS est tantôt numérique (clients.dbf, N:4.0) tantôt
// texte zéro-préfixé selon les sociétés — on tolère les deux formes.
const cleNumerique = (t) => {
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? String(n) : "";
};

// 20260814 -> "2026-08-14"
const ymdToIso = (ymd) => {
  const s = String(ymd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

// Nombre de jours entiers écoulés depuis un ymd (0 = aujourd'hui).
const joursDepuis = (ymd, aujourdhui) => {
  const s = String(ymd);
  const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  return Math.floor((aujourdhui - d) / 86400000);
};

// Seuils d'ancienneté (jours) — pastilles de l'écran et compteurs des KPI.
export const SEUIL_RECENT = 90;
export const SEUIL_DORMANT = 365;

const statutAnciennete = (jours) => {
  if (jours === null) return "jamais";
  if (jours <= SEUIL_RECENT) return "recent";
  if (jours <= SEUIL_DORMANT) return "veille";
  return "dormant";
};

/** Map code vendeur (REPRES) -> nom, tolérante au zéro de tête ("08" / "8"). */
const construireVendeurs = (entreprise) => {
  const map = new Map();
  for (const v of entreprise?.vendeurs || []) {
    const code = safeTrim(v.code);
    if (!code) continue;
    const nom = [safeTrim(v.prenom), safeTrim(v.nom)].filter(Boolean).join(" ");
    if (!nom) continue;
    map.set(code, nom);
    const n = cleNumerique(code);
    if (n) map.set(n, nom);
  }
  return map;
};

/**
 * Rapport « dernière facturation » d'une société.
 *
 * @param {Object} entreprise - document Entreprise (getters de chemins actifs)
 * @returns {Promise<{ rows: Array, totaux: Object, genereLe: string }>}
 */
export const getDerniereFacturation = async (entreprise) => {
  const [cacheClients, idx] = await Promise.all([
    clientCacheService.getClients(entreprise),
    getIndexFactures(entreprise),
  ]);

  const clients = cacheClients?.records || [];
  const parTiers = idx.dernieresFactures; // tiers -> { ymd, numfact, montant, nb, premiere }
  const vendeurs = construireVendeurs(entreprise);

  // Index secondaire sur la forme numérique du TIERS (voir cleNumerique).
  const parTiersNum = new Map();
  parTiers.forEach((v, k) => {
    const n = cleNumerique(k);
    if (n && !parTiersNum.has(n)) parTiersNum.set(n, v);
  });

  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);

  const rows = [];
  let nbJamais = 0;
  let nbRecent = 0;
  let nbVeille = 0;
  let nbDormant = 0;
  let plusAncien = null; // ymd de la plus vieille « dernière facture »

  for (const c of clients) {
    const tiers = safeTrim(c.TIERS);
    if (!tiers) continue;

    const info = parTiers.get(tiers) || parTiersNum.get(cleNumerique(tiers)) || null;
    const jours = info ? joursDepuis(info.ymd, aujourdhui) : null;
    const statut = statutAnciennete(jours);

    if (statut === "jamais") nbJamais += 1;
    else if (statut === "recent") nbRecent += 1;
    else if (statut === "veille") nbVeille += 1;
    else nbDormant += 1;

    if (info && (plusAncien === null || info.ymd < plusAncien)) plusAncien = info.ymd;

    const repres = safeTrim(c.REPRES);

    rows.push({
      tiers,
      nom: safeTrim(c.NOM),
      adresse: safeTrim(c.AD1),
      tel: safeTrim(c.TEL),
      mail: safeTrim(c.ADMAIL),
      categorie: safeTrim(c.CATEGORIE),
      type: safeTrim(c.TYPE),
      groupe: safeTrim(c.GROUPE),
      repres,
      vendeur:
        vendeurs.get(repres) || vendeurs.get(cleNumerique(repres)) || "",
      derniereFacture: info ? ymdToIso(info.ymd) : null,
      // Clé de tri numérique : 0 pour « jamais facturé », que le front range
      // en fin de liste (tri croissant par défaut).
      ymd: info ? info.ymd : 0,
      joursDepuis: jours,
      statut,
      numfact: info ? info.numfact : "",
      montant: info ? num(info.montant) : null,
      nbFactures: info ? info.nb : 0,
      premiereFacture: info ? ymdToIso(info.premiere) : null,
    });
  }

  // Tri par défaut demandé : la date de facturation la plus ANCIENNE en tête,
  // les clients jamais facturés relégués en fin (ils n'ont pas de date).
  rows.sort((a, b) => {
    if (a.ymd === 0 && b.ymd === 0) return a.nom.localeCompare(b.nom, "fr");
    if (a.ymd === 0) return 1;
    if (b.ymd === 0) return -1;
    if (a.ymd !== b.ymd) return a.ymd - b.ymd;
    return a.nom.localeCompare(b.nom, "fr");
  });

  return {
    rows,
    totaux: {
      nbClients: rows.length,
      nbFactures: nbRecent + nbVeille + nbDormant,
      nbJamais,
      nbRecent,
      nbVeille,
      nbDormant,
      seuilRecent: SEUIL_RECENT,
      seuilDormant: SEUIL_DORMANT,
      plusAncienne: plusAncien ? ymdToIso(plusAncien) : null,
    },
    genereLe: new Date().toISOString(),
  };
};

export default { getDerniereFacturation };
