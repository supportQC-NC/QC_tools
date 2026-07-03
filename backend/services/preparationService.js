// backend/services/preparationService.js
//
// Couche « données » du module Préparation de commande (P1) :
//  - lecture de la proforma (proforma.dbf / prodet.dbf) via proformaCacheService ;
//  - répartition automatique DOCK (S2) / MAGASIN (S1) pour chaque ligne ;
//  - ordonnancement du parcours :
//      * DOCK    : ordre de la proforma (NL) ;
//      * MAGASIN : gisement (GISM1 -> priorité du fichier Excel), puis articles
//                  sans gisement (famille = 2 1ers car. du NART, puis fournisseur,
//                  puis désignation).
//
// Ne fait AUCUNE écriture (analyse pure). La création de la session Preparation
// et le workflow (scan, quantités, reliquats, rapport, transfert) relèvent des
// phases suivantes.

import proformaCacheService from "./proformaCacheService.js";
import articleCacheService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";
import gisementsService, { lookupGisement } from "./gisementsService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Résout le nom du fournisseur (best-effort, repli silencieux).
const resolveFournisseurNom = async (entreprise, fourn) => {
  if (fourn === undefined || fourn === null || fourn === "") return "";
  try {
    const f = await fournissCacheService.findByFourn(entreprise, fourn);
    return f ? safeTrim(f.NOM) : "";
  } catch {
    return "";
  }
};

// Convertit une valeur DBF de date en Date (via le parseur du service proforma).
const toDate = (v) => {
  try {
    if (typeof proformaCacheService.parseDate === "function") {
      return proformaCacheService.parseDate(v) || null;
    }
  } catch {
    /* ignore */
  }
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * (Ré)ordonne la préparation MAGASIN sur la base de la quantité magasin RESTANTE
 * (qteMagasinAPreparer). Utilisé à l'analyse ET après le dock (reliquats).
 * Assigne ordreMagasin (1..n) :
 *   - d'abord les gisements (priorité croissante, puis NL) ;
 *   - puis les sans-gisement (famille 2 car. / fournisseur / désignation).
 * Remet ordreMagasin à null pour les lignes sans part magasin.
 * Fonctionne sur des objets simples OU des sous-documents Mongoose.
 */
export const ordonnerMagasin = (lignes) => {
  lignes.forEach((l) => {
    l.ordreMagasin = null;
  });
  const mag = lignes.filter((l) => (l.qteMagasinAPreparer || 0) > 0);
  const avecGisement = mag
    .filter((l) => l.aGisement)
    .sort(
      (a, b) =>
        (a.priorite ?? Number.POSITIVE_INFINITY) -
          (b.priorite ?? Number.POSITIVE_INFINITY) ||
        String(a.gism1).localeCompare(String(b.gism1), "fr", {
          sensitivity: "base",
        }) ||
        a.nl - b.nl,
    );
  const sansGisement = mag
    .filter((l) => !l.aGisement)
    .sort((a, b) => {
      const fa = String(a.nart).slice(0, 2);
      const fb = String(b.nart).slice(0, 2);
      if (fa !== fb) return fa.localeCompare(fb, "fr", { sensitivity: "base" });
      const na = a.fourn ?? Number.POSITIVE_INFINITY;
      const nb = b.fourn ?? Number.POSITIVE_INFINITY;
      if (na !== nb) return na - nb;
      return String(a.designation).localeCompare(String(b.designation), "fr", {
        sensitivity: "base",
      });
    });
  [...avecGisement, ...sansGisement].forEach((l, i) => {
    l.ordreMagasin = i + 1;
  });
  return lignes;
};

/**
 * Liste des proformas « à préparer » (ETAT = 2), paginée.
 * @returns proformas légères pour l'écran de sélection.
 */
export const getProformasAPreparer = async (entreprise, options = {}) => {
  const { search = "", page = 1, limit = 100 } = options;
  const res = await proformaCacheService.getPaginated(entreprise, {
    search,
    etat: 2,
    page,
    limit,
  });

  // getPaginated renvoie généralement { data|proformas, pagination }. On mappe
  // défensivement quel que soit le nom du tableau.
  const liste = res.proformas || res.data || res.records || res.items || [];
  const proformas = liste.map((p) => ({
    numfact: safeTrim(p.NUMFACT),
    clientNom: safeTrim(p.NOM),
    clientCode: p.TIERS != null && p.TIERS !== "" ? Number(p.TIERS) : null,
    datfact: toDate(p.DATFACT),
    etat: p.ETAT != null ? Number(p.ETAT) : null,
    texte: safeTrim(p.TEXTE),
  }));

  return { pagination: res.pagination || null, proformas };
};

/**
 * Analyse une proforma et construit les lignes de préparation (répartition +
 * ordonnancement). Ne crée pas la session.
 *
 * @param {object} entreprise Document Entreprise
 * @param {string} numpro     NUMFACT de la proforma
 * @returns {Promise<{ proformaInfo, lignes }>}
 * @throws  Error (status 404) si la proforma est introuvable
 */
export const analyserProforma = async (entreprise, numpro) => {
  const numfact = safeTrim(numpro);
  const entete = await proformaCacheService.findByNumfact(entreprise, numfact);
  if (!entete) {
    const e = new Error("Proforma introuvable");
    e.status = 404;
    throw e;
  }

  // Mailings (MAILING1-5 non vides).
  const mailings = [];
  for (let i = 1; i <= 5; i++) {
    const m = safeTrim(entete[`MAILING${i}`]);
    if (m) mailings.push(m);
  }

  const proformaInfo = {
    numfact: safeTrim(entete.NUMFACT) || numfact,
    clientNom: safeTrim(entete.NOM),
    clientCode: entete.TIERS != null && entete.TIERS !== "" ? Number(entete.TIERS) : null,
    datfact: toDate(entete.DATFACT),
    etat: entete.ETAT != null ? Number(entete.ETAT) : null,
    mailings,
  };

  const details = await proformaCacheService.getProdetByNumfact(entreprise, numfact);

  // Fichier des gisements (tri magasin uniquement).
  const { map: gisMap } = await gisementsService.getGisements(entreprise);

  const lignes = [];
  for (const d of details) {
    if (proformaCacheService.isCommentLine(d)) continue;
    const nart = safeTrim(d.NART);
    if (!nart) continue;
    const qteCommandee = num(d.QTE);
    if (qteCommandee <= 0) continue;

    let article = null;
    try {
      article = await articleCacheService.findByNart(entreprise, nart);
    } catch {
      /* article introuvable en base : ligne conservée avec stocks à 0 */
    }

    const s1 = article ? num(article.S1) : 0; // MAGASIN
    const s2 = article ? num(article.S2) : 0; // DOCK
    const gism1 = article ? safeTrim(article.GISM1) : "";
    const gencod = article ? safeTrim(article.GENCOD) : "";
    const fourn =
      article && article.FOURN != null && article.FOURN !== ""
        ? Number(article.FOURN)
        : null;
    const refer = article ? safeTrim(article.REFER) : "";

    // Répartition : dock d'abord (dans la limite du stock dock), reste au magasin.
    const qteDock = s2 > 0 ? Math.min(qteCommandee, s2) : 0;
    const qteMagasin = qteCommandee - qteDock;

    // Gisement (Excel <TRIG>_gissement.xlsx : GISM1 -> libellé + priorité).
    const gis = lookupGisement(gisMap, gism1);
    const aGisement = !!(gism1 && gis);

    lignes.push({
      nl: num(d.NL),
      nart,
      designation: safeTrim(d.DESIGN) || (article ? safeTrim(article.DESIGN) : ""),
      refer,
      fourn,
      fournisseurNom: await resolveFournisseurNom(entreprise, fourn),
      gencod,
      gism1,
      pvttc: num(d.PVTTC),
      qteCommandee,
      stockDock: s2,
      stockMagasin: s1,
      qteDockAPreparer: qteDock,
      qteMagasinAPreparer: qteMagasin,
      qtePrepareeDock: 0,
      qtePrepareeMagasin: 0,
      gencodeBipeDock: "",
      gencodeBipeMagasin: "",
      rayon: gis ? gis.libelle : "", // libellé du gisement affiché à l'opérateur
      sousRayon: "",
      priorite: gis ? gis.priorite : null,
      aGisement,
      ordreDock: null,
      ordreMagasin: null,
      statutDock: "a_faire",
      statutMagasin: "a_faire",
      introuvable: false,
    });
  }

  // --- Ordonnancement DOCK : ordre de la proforma (NL croissant) ---
  lignes
    .filter((l) => l.qteDockAPreparer > 0)
    .sort((a, b) => a.nl - b.nl)
    .forEach((l, i) => {
      l.ordreDock = i + 1;
    });

  // --- Ordonnancement MAGASIN ---
  ordonnerMagasin(lignes);

  return { proformaInfo, lignes };
};

export default {
  ordonnerMagasin,
  getProformasAPreparer,
  analyserProforma,
};