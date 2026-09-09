// backend/services/preparationService.js
//
// Couche « données » du module Préparation de commande (P1) :
//  - lecture de la proforma (proforma.dbf / prodet.dbf) via proformaCacheService ;
//  - répartition automatique DOCK (S2) / MAGASIN (S1) pour chaque ligne ;
//  - ordonnancement du parcours, chacun sur le gisement de SA zone :
//      * DOCK    : GISM2 -> priorité du fichier Excel, puis articles sans
//                  gisement par ordre de la proforma (NL) ;
//      * MAGASIN : GISM1 -> priorité du fichier Excel, puis articles
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
import {
  buildIndexRayons,
  lookupRayon,
} from "./dictionnaireRayonsService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Identité du commercial d'un document (proforma.REPRES) via le dictionnaire de
 * la fiche société. `vendeurs[].code` est une chaîne (« 05 ») et REPRES un
 * numérique : la comparaison DOIT être numérique. Nom vide quand l'onglet
 * Vendeurs de la société n'est pas renseigné — on garde alors le code seul.
 */
export const resolveVendeur = (entreprise, repres) => {
  const brut = safeTrim(repres);
  const code = Number(repres);
  if (!Number.isFinite(code)) return { code: brut, nom: "" };
  const v = (entreprise?.vendeurs || []).find((x) => Number(x.code) === code);
  const nom = v ? [v.prenom, v.nom].filter(Boolean).join(" ").trim() : "";
  return { code: brut || String(code), nom };
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
        comparerCodeGisement(a.gism1, b.gism1) ||
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
 * Comparateur de CODES DE GISEMENT, pour ranger une zone dans l'ordre du
 * parcours physique.
 *
 * Le code se lit en deux parties séparées par le PREMIER « _ » : ce qui
 * précède est l'allée (A, B, I, A2…), ce qui suit le repère dans l'allée
 * (1, 2d, 10, 12g…). Chaque partie est comparée en ordre NATUREL — lettres
 * dans l'ordre alphabétique, nombres dans l'ordre numérique.
 *
 * ⚠️ Un `localeCompare` sur le code entier (l'ancien tri) donne
 * « A_1, A_10, A_11, A_12d, A_2d » : l'agent redescend l'allée au lieu de la
 * parcourir. Ici on obtient « A_1, A_2d, A_9, A_10, A_11, A_12d ».
 */
const segmentsNaturels = (v) =>
  String(v || "")
    .toUpperCase()
    .split(/(\d+)/)
    .filter((x) => x !== "")
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x));

const comparerNaturel = (a, b) => {
  const sa = segmentsNaturels(a);
  const sb = segmentsNaturels(b);
  for (let i = 0; i < Math.max(sa.length, sb.length); i += 1) {
    const x = sa[i];
    const y = sb[i];
    if (x === undefined) return -1; // « A » avant « A2 »
    if (y === undefined) return 1;
    const xNum = typeof x === "number";
    const yNum = typeof y === "number";
    if (xNum && yNum) {
      if (x !== y) return x - y;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1; // un nombre avant une lettre à rang égal
    } else if (x !== y) {
      return x.localeCompare(y, "fr", { sensitivity: "base" });
    }
  }
  return 0;
};

export const comparerCodeGisement = (a, b) => {
  const couper = (v) => {
    const s = String(v || "").trim();
    const i = s.indexOf("_");
    return i === -1 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
  };
  const [alleeA, repereA] = couper(a);
  const [alleeB, repereB] = couper(b);
  return (
    comparerNaturel(alleeA, alleeB) || comparerNaturel(repereA, repereB)
  );
};

/**
 * Gisement de la zone DOCK d'une ligne : GISM2 et la priorité qui en découle.
 * Repli sur les champs GISM1 pour les sessions enregistrées avant l'ajout du
 * gisement dock (elles n'ont pas `aGisementDock`) : leur ordre reste celui
 * qu'avait vu l'opérateur.
 */
const gisementDock = (l) =>
  l.aGisementDock === undefined
    ? { present: !!l.aGisement, priorite: l.priorite, code: l.gism1 }
    : { present: !!l.aGisementDock, priorite: l.prioriteDock, code: l.gism2 };

/**
 * Ordonne la préparation DOCK sur la base de la quantité dock à préparer.
 * Règle retenue (CDC §4, choix client) :
 *   - d'abord les articles AVEC gisement, par priorité croissante (puis GISM2, NL) ;
 *   - puis les articles SANS gisement, par ordre de la proforma (NL) en fin.
 * ⚠️ Le tri se fait sur le gisement du DOCK (GISM2), pas sur celui du magasin :
 * les deux diffèrent presque toujours (dock J_2 vs rayon C_4 chez QC), et c'est
 * le dock que l'agent parcourt dans cette phase.
 * Remet ordreDock à null pour les lignes sans part dock.
 */
export const ordonnerDock = (lignes) => {
  lignes.forEach((l) => {
    l.ordreDock = null;
  });
  const dock = lignes.filter((l) => (l.qteDockAPreparer || 0) > 0);
  const avecGisement = dock
    .filter((l) => gisementDock(l).present)
    .sort((a, b) => {
      const ga = gisementDock(a);
      const gb = gisementDock(b);
      // La priorité du dictionnaire reste prioritaire quand elle est saisie ;
      // à défaut (cas de QC : aucune renseignée), c'est l'ordre naturel des
      // codes qui range l'allée.
      return (
        (ga.priorite ?? Number.POSITIVE_INFINITY) -
          (gb.priorite ?? Number.POSITIVE_INFINITY) ||
        comparerCodeGisement(ga.code, gb.code) ||
        a.nl - b.nl
      );
    });
  const sansGisement = dock
    .filter((l) => !gisementDock(l).present)
    .sort((a, b) => a.nl - b.nl);
  [...avecGisement, ...sansGisement].forEach((l, i) => {
    l.ordreDock = i + 1;
  });
  return lignes;
};

/**
 * Construit une Map { NART terminal -> Set(gencodes acceptables) } pour toute la
 * base articles, en suivant la chaîne de renvois GENDOUBL EXACTEMENT comme le
 * contrôle de scan (résolution vers l'article final). Un article X dont la
 * chaîne aboutit au NART T fait donc entrer son GENCOD dans l'ensemble de T.
 * Permet d'exposer à l'opérateur « tous les gencodes possibles, y compris les
 * gencodes associés par renvoi » (CDC §5/§8) — coût O(n) calculé une seule fois
 * par analyse, en mémoire (aucun await par ligne).
 */
const construireGencodesParNart = (cacheEntry) => {
  const map = new Map();
  if (!cacheEntry || !Array.isArray(cacheEntry.records)) return map;
  const { records, indexByNart } = cacheEntry;
  const MAX = 10;

  const nartTerminal = (startIdx) => {
    let idx = startIdx;
    let it = 0;
    while (idx !== undefined && it < MAX) {
      const rec = records[idx];
      const gendoubl =
        rec && rec.GENDOUBL ? String(rec.GENDOUBL).trim().toUpperCase() : "";
      if (!gendoubl) break;
      const next = articleCacheService.lookupNart(cacheEntry, gendoubl);
      if (next === undefined) break;
      idx = next;
      it++;
    }
    return idx;
  };

  records.forEach((rec, idx) => {
    const gencod = rec && rec.GENCOD ? String(rec.GENCOD).trim() : "";
    if (!gencod) return;
    const termIdx = nartTerminal(idx);
    if (termIdx === undefined) return;
    const term = String(records[termIdx]?.NART || "").trim().toUpperCase();
    if (!term) return;
    if (!map.has(term)) map.set(term, new Set());
    map.get(term).add(gencod);
  });

  return map;
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
  const proformas = liste.map((p) => {
    // Commercial à l'origine de la demande : l'agent doit savoir à qui
    // s'adresser quand une ligne pose question, sans ouvrir le document.
    const vendeur = resolveVendeur(entreprise, p.REPRES);
    return {
      numfact: safeTrim(p.NUMFACT),
      clientNom: safeTrim(p.NOM),
      clientCode: p.TIERS != null && p.TIERS !== "" ? Number(p.TIERS) : null,
      datfact: toDate(p.DATFACT),
      etat: p.ETAT != null ? Number(p.ETAT) : null,
      texte: safeTrim(p.TEXTE),
      vendeurCode: vendeur.code,
      vendeurNom: vendeur.nom,
    };
  });

  return { pagination: res.pagination || null, proformas };
};

/**
 * Liste des réservations / commandes spéciales « à préparer » : proformas dont
 * l'état est INFÉRIEUR à 2 (ETAT <= 1), paginée (CDC §2).
 * @returns proformas légères pour l'écran de sélection (même forme que ci-dessus).
 */
export const getReservationsAPreparer = async (entreprise, options = {}) => {
  const { search = "", page = 1, limit = 100 } = options;
  const res = await proformaCacheService.getPaginated(entreprise, {
    search,
    maxEtat: 1, // état < 2 (resa ou cde spéciale)
    page,
    limit,
  });

  const liste = res.proformas || res.data || res.records || res.items || [];
  const proformas = liste.map((p) => {
    const vendeur = resolveVendeur(entreprise, p.REPRES);
    return {
      numfact: safeTrim(p.NUMFACT),
      clientNom: safeTrim(p.NOM),
      clientCode: p.TIERS != null && p.TIERS !== "" ? Number(p.TIERS) : null,
      datfact: toDate(p.DATFACT),
      etat: p.ETAT != null ? Number(p.ETAT) : null,
      texte: safeTrim(p.TEXTE),
      vendeurCode: vendeur.code,
      vendeurNom: vendeur.nom,
    };
  });

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

  const vendeur = resolveVendeur(entreprise, entete.REPRES);
  const proformaInfo = {
    numfact: safeTrim(entete.NUMFACT) || numfact,
    clientNom: safeTrim(entete.NOM),
    clientCode: entete.TIERS != null && entete.TIERS !== "" ? Number(entete.TIERS) : null,
    datfact: toDate(entete.DATFACT),
    etat: entete.ETAT != null ? Number(entete.ETAT) : null,
    // Commercial demandeur (proforma.REPRES) : affiché à l'opérateur pendant
    // toute la préparation, c'est lui qu'on rappelle en cas de doute.
    vendeurCode: vendeur.code,
    vendeurNom: vendeur.nom,
    mailings,
  };

  const details = await proformaCacheService.getProdetByNumfact(entreprise, numfact);

  // Libellés et priorités de parcours des rayons.
  //
  // SOURCE DE VÉRITÉ : le DICTIONNAIRE DES RAYONS de l'application (écran
  // Données ▸ Dictionnaire des rayons), indexé par CODE + EMPLACEMENT. C'est
  // indispensable : le même code existe au dock et au magasin avec deux
  // libellés différents, et l'ancien fichier `<TRIG>_gissement.xlsx`, indexé
  // par code seul, renvoyait donc un libellé sur deux au mauvais rayon.
  //
  // L'ancien fichier reste en REPLI, pour les sociétés qui n'ont pas encore
  // renseigné leur dictionnaire — jamais en priorité.
  const { index: rayonsIndex } = await buildIndexRayons(entreprise);
  const { map: gisMap } = await gisementsService.getGisements(entreprise);

  // Résolution d'un gisement pour UNE zone donnée : dictionnaire d'abord
  // (code + emplacement), repli sur le fichier gisements (code seul).
  const resoudreRayon = (code, emplacement) => {
    if (!code) return null;
    const duDico = lookupRayon(rayonsIndex, code, emplacement);
    if (duDico) {
      return {
        libelle: duDico.libelle,
        sousRayon: "",
        priorite: duDico.priorite,
        source: "dictionnaire",
      };
    }
    const ancien = lookupGisement(gisMap, code);
    return ancien ? { ...ancien, source: "gissement" } : null;
  };

  // Table { NART -> gencodes acceptables (renvois inclus) } construite une fois.
  let gencodesParNart = new Map();
  try {
    const cacheEntry = await articleCacheService.getArticles(entreprise);
    gencodesParNart = construireGencodesParNart(cacheEntry);
  } catch {
    /* base articles indisponible : on retombe sur le seul gencode principal */
  }

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
    const gism1 = article ? safeTrim(article.GISM1) : ""; // MAGASIN
    const gism2 = article ? safeTrim(article.GISM2) : ""; // DOCK
    const gencod = article ? safeTrim(article.GENCOD) : "";
    const fourn =
      article && article.FOURN != null && article.FOURN !== ""
        ? Number(article.FOURN)
        : null;
    const refer = article ? safeTrim(article.REFER) : "";

    // Répartition : dock d'abord (dans la limite du stock dock), reste au magasin.
    const qteDock = s2 > 0 ? Math.min(qteCommandee, s2) : 0;
    const qteMagasin = qteCommandee - qteDock;

    // Gisement (Excel <TRIG>_gissement.xlsx : code -> libellé + sous-rayon +
    // priorité). Un lookup PAR ZONE : la fiche article porte GISM1 pour le rayon
    // et GISM2 pour le dock, et chaque phase se parcourt dans l'ordre de SA zone.
    // MAGASIN = GISM1, DOCK = GISM2 — chacun cherché à SON emplacement.
    const gis = resoudreRayon(gism1, "MAGASIN");
    const aGisement = !!(gism1 && gis);
    const gisDock = resoudreRayon(gism2, "DOCK");
    const aGisementDock = !!(gism2 && gisDock);

    // Tous les gencodes possibles (renvois inclus) + gencode principal en tête.
    const setGencodes = gencodesParNart.get(nart.toUpperCase());
    const gencodes = [];
    if (gencod) gencodes.push(gencod);
    if (setGencodes) {
      for (const g of setGencodes) if (g && !gencodes.includes(g)) gencodes.push(g);
    }

    lignes.push({
      nl: num(d.NL),
      nart,
      designation: safeTrim(d.DESIGN) || (article ? safeTrim(article.DESIGN) : ""),
      refer,
      fourn,
      fournisseurNom: await resolveFournisseurNom(entreprise, fourn),
      gencod,
      gencodes, // tous les gencodes possibles (renvois inclus) — CDC §5/§8
      gism1,
      gism2,
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
      sousRayon: gis && gis.sousRayon ? gis.sousRayon : "", // étagère (Excel gisements)
      priorite: gis ? gis.priorite : null,
      aGisement,
      // Mêmes informations pour la zone DOCK (lookup sur GISM2).
      rayonDock: gisDock ? gisDock.libelle : "",
      sousRayonDock: gisDock && gisDock.sousRayon ? gisDock.sousRayon : "",
      prioriteDock: gisDock ? gisDock.priorite : null,
      aGisementDock,
      ordreDock: null,
      ordreMagasin: null,
      statutDock: "a_faire",
      statutMagasin: "a_faire",
      introuvable: false,
    });
  }

  // --- Ordonnancement DOCK : gisement GISM2 (priorité) puis sans-gisement par NL ---
  ordonnerDock(lignes);

  // --- Ordonnancement MAGASIN ---
  ordonnerMagasin(lignes);

  return { proformaInfo, lignes };
};

export default {
  resolveVendeur,
  comparerCodeGisement,
  ordonnerDock,
  ordonnerMagasin,
  getProformasAPreparer,
  getReservationsAPreparer,
  analyserProforma,
};