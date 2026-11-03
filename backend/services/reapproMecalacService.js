// backend/services/reapproMecalacService.js
//
// RÉAPPRO « MÉCALAC » — descendre au MAGASIN (S1) ce qui dort dans un ENTREPÔT
// (S2..S5). Le nom vient du client (l'entrepôt MECALAC de QC) ; le module est
// générique : l'utilisateur choisit l'entrepôt source dans la liste de la
// société (fiche société, onglet Entrepôts -> `mappingEntrepots`).
//
// ⚠️ MÊME règle de sélection que partout ailleurs dans l'application
// (`estAReapprovisionner` de bipageSelectionService), simplement RESTREINTE à
// l'entrepôt choisi : rien en rayon (S1 = 0) alors qu'il reste du stock dans
// CET entrepôt (Sx > 0). Les exclusions maison valent ici aussi — articles
// techniques (NART < 100000), renvois GENDOUBL, gisements hors rayon
// (SAV/DOCK/STOP chez QC). Faire diverger ce critère afficherait deux nombres
// contradictoires pour la même question.
//
// Le module est SANS ÉTAT : rien n'est écrit en base. L'analyse propose une
// liste, l'utilisateur la retouche à l'écran, puis demande le fichier .dat —
// exactement comme le « réappro rayon » du collecteur (décision client du
// 23/10/2026).

import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";
import { buildIndexRayons, lookupRayon } from "./dictionnaireRayonsService.js";
import { fmtQteDat } from "../utils/qteDat.js";
import {
  ventes12Mois,
  estTechnique,
  estRenvoi,
  estHorsRayon,
} from "./bipageSelectionService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const round3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

// Entrepôts proposés : S1 est le MAGASIN (la destination), jamais une source.
export const DEPOTS_SOURCE = ["S2", "S3", "S4", "S5"];

export const estDepotValide = (d) => DEPOTS_SOURCE.includes(String(d || "").toUpperCase());

// Vente moyenne MENSUELLE corrigée des ruptures — MÊME formule que l'analyse
// réappro, le réappro local et le réappro rayon :
//   vte_moy_mois = (Σ|V1..V12| × 30) / (360 − Σ|RUP1..RUP12|), repli vAn/12.
const joursRupture = (a) => {
  let s = 0;
  for (let i = 1; i <= 12; i += 1) s += Math.abs(num(a[`RUP${i}`]));
  return s;
};
const vteMoyMois = (a) => {
  const vAn = ventes12Mois(a);
  const denom = 360 - joursRupture(a);
  const v = denom > 0 ? (vAn * 30) / denom : vAn / 12;
  return Math.round(v * 100) / 100;
};

// Gisements de la fiche article : GISM1 = rayon (magasin), GISM2 = dock.
const gisementMagasin = (a) => safeTrim(a.GISM1) || safeTrim(a.EMPLACE);

// Quantité proposée (décision client) : couvrir ~1 mois de ventes sans
// promettre plus que ce que l'entrepôt contient — MÊME formule que le réappro
// rayon du collecteur : min(stock entrepôt, max(1, arrondi sup. de vte/mois)).
export const qteProposee = (stockDepot, vmm) =>
  round3(Math.min(stockDepot, Math.max(1, Math.ceil(vmm))));

// Index { code fournisseur -> fiche }.
const indexFournisseurs = (fourCache) => {
  const m = new Map();
  (fourCache.records || []).forEach((r) => {
    if (r.FOURN !== undefined && r.FOURN !== null) {
      m.set(String(r.FOURN).trim(), r);
    }
  });
  return m;
};

// Une ligne telle que l'écran l'affiche.
const ligne = (a, depot, fournByCode, rayons) => {
  const fournM = a.FOURN != null ? fournByCode.get(String(a.FOURN).trim()) : null;
  const gis = gisementMagasin(a);
  const gisD = safeTrim(a.GISM2);
  // Libellés du dictionnaire des rayons, chacun cherché à SON emplacement :
  // chez QC le même code porte souvent deux noms différents.
  const rMag = rayons ? lookupRayon(rayons, gis, "MAGASIN") : null;
  const rDock = rayons ? lookupRayon(rayons, gisD, "DOCK") : null;
  const stockDepot = num(a[depot]);
  const vmm = vteMoyMois(a);
  return {
    nart: safeTrim(a.NART),
    design: safeTrim(a.DESIGN),
    // ⚠️ GENCOD laissé tel quel, zéros de tête compris (utils/codeBarres.js).
    gencod: safeTrim(a.GENCOD),
    refer: safeTrim(a.REFER),
    fourn: a.FOURN != null ? String(a.FOURN).trim() : "",
    fournNom: fournM ? safeTrim(fournM.NOM) : "",
    gism1: gis,
    rayonMagasin: rMag ? rMag.libelle : "",
    gism2: gisD,
    rayonDock: rDock ? rDock.libelle : "",
    s1: num(a.S1),
    s2: num(a.S2),
    s3: num(a.S3),
    s4: num(a.S4),
    s5: num(a.S5),
    stockDepot,
    ventes12: ventes12Mois(a),
    vteMoyMois: vmm,
    qteProposee: qteProposee(stockDepot, vmm),
  };
};

/**
 * Entrepôts sources d'une société, avec leur nom métier et ce qu'ils pèsent.
 * TOUJOURS les quatre (S2..S5), même vides : un entrepôt à zéro dans l'ERP
 * reste sélectionnable — c'est la même règle que les emplacements spéciaux de
 * l'inventaire, masquer un entrepôt empêcherait justement de le corriger.
 * @returns {Promise<{entrepots: Array<{key,nom,articlesEnStock,aReappro}>}>}
 */
export const getEntrepots = async (entreprise) => {
  const artCache = await articleService.getArticles(entreprise);
  const isQC = String(entreprise.nomDossierDBF).toLowerCase() === "qc";

  const compte = {};
  DEPOTS_SOURCE.forEach((d) => {
    compte[d] = { articlesEnStock: 0, aReappro: 0 };
  });

  (artCache.records || []).forEach((a) => {
    if (!safeTrim(a.NART)) return;
    const exploitable =
      !estTechnique(a) && !estRenvoi(a) && !estHorsRayon(gisementMagasin(a), isQC);
    const rayonVide = num(a.S1) === 0;
    DEPOTS_SOURCE.forEach((d) => {
      const stock = num(a[d]);
      if (stock > 0) {
        compte[d].articlesEnStock += 1;
        if (exploitable && rayonVide) compte[d].aReappro += 1;
      }
    });
  });

  const noms = entreprise.mappingEntrepots || {};
  return {
    entrepots: DEPOTS_SOURCE.map((d) => ({
      key: d,
      nom: safeTrim(noms[d]) || d,
      articlesEnStock: compte[d].articlesEnStock,
      aReappro: compte[d].aReappro,
    })),
    magasin: safeTrim(noms.S1) || "Magasin",
  };
};

/**
 * Articles à descendre de l'entrepôt `depot` vers le rayon (S1).
 *
 * @param {object} entreprise
 * @param {object} options
 * @param {string} options.depot   S2 | S3 | S4 | S5
 * @param {number} [options.limit=2000]
 * @param {string} [options.fourn] ne garder qu'un fournisseur
 * @returns {Promise<{depot, nom, total, articles, fournisseurs, tronque}>}
 */
export const analyserEntrepot = async (entreprise, options = {}) => {
  const depot = String(options.depot || "").toUpperCase();
  if (!estDepotValide(depot)) {
    const e = new Error(
      `Entrepôt invalide. Attendu : ${DEPOTS_SOURCE.join(", ")}.`,
    );
    e.statusCode = 400;
    throw e;
  }
  const limit = Math.min(parseInt(options.limit, 10) || 2000, 5000);
  const fournFiltre = safeTrim(options.fourn);

  const [artCache, fourCache, dico] = await Promise.all([
    articleService.getArticles(entreprise),
    fournissCacheService.getFournisseurs(entreprise),
    buildIndexRayons(entreprise),
  ]);
  const fournByCode = indexFournisseurs(fourCache);
  const rayons = dico.index;
  const isQC = String(entreprise.nomDossierDBF).toLowerCase() === "qc";

  const out = [];
  // Fournisseurs de la liste COMPLÈTE (avant filtre fournisseur et avant la
  // limite) : sinon le menu déroulant se viderait au premier choix.
  const parFourn = new Map();
  let renvoyes = 0;

  (artCache.records || []).forEach((a) => {
    if (!safeTrim(a.NART)) return;
    if (num(a.S1) !== 0) return; // déjà en rayon : rien à descendre
    if (num(a[depot]) <= 0) return; // rien dans CET entrepôt
    if (estTechnique(a)) return;
    if (estRenvoi(a)) {
      renvoyes += 1;
      return;
    }
    if (estHorsRayon(gisementMagasin(a), isQC)) return;

    const l = ligne(a, depot, fournByCode, rayons);
    if (!parFourn.has(l.fourn)) {
      parFourn.set(l.fourn, { code: l.fourn, nom: l.fournNom, nb: 0 });
    }
    parFourn.get(l.fourn).nb += 1;

    if (fournFiltre && l.fourn !== fournFiltre) return;
    out.push(l);
  });

  // Meilleures ventes d'abord (Σ|V1..V12|) : à plusieurs centaines de lignes,
  // l'ordre alphabétique ne sert à rien — ce qui compte, c'est ce qui se vend
  // et qui manque en rayon. NART en départage, pour un ordre stable.
  out.sort((x, y) => y.ventes12 - x.ventes12 || x.nart.localeCompare(y.nart));

  const noms = entreprise.mappingEntrepots || {};
  return {
    depot,
    nom: safeTrim(noms[depot]) || depot,
    total: out.length,
    renvoyes,
    tronque: out.length > limit,
    articles: out.slice(0, limit),
    fournisseurs: [...parFourn.values()].sort((x, y) =>
      (x.nom || x.code).localeCompare(y.nom || y.code, "fr", {
        numeric: true,
        sensitivity: "base",
      }),
    ),
  };
};

/**
 * Résout un code saisi à la main (ajout d'une ligne absente de l'analyse) :
 * GENCOD d'abord — zéros de tête tolérés —, puis NART, puis référence
 * fournisseur. Même souplesse que le collecteur. Une fiche RENVOYÉE
 * (GENDOUBL) est suivie vers sa fiche active : les stocks de l'ancienne ne
 * veulent plus rien dire.
 * @returns {Promise<object|null>} la ligne prête à ajouter, ou null
 */
export const resoudreArticle = async (entreprise, code, depot) => {
  const recherche = safeTrim(code);
  if (!recherche) return null;
  const dep = estDepotValide(depot) ? String(depot).toUpperCase() : "S2";

  const [artCache, fourCache, dico] = await Promise.all([
    articleService.getArticles(entreprise),
    fournissCacheService.getFournisseurs(entreprise),
    buildIndexRayons(entreprise),
  ]);

  let article = await articleService.findByCode(entreprise, recherche);
  if (!article) {
    // Repli référence fournisseur (balayage exact, comme les listes de réappro).
    const cible = recherche.toUpperCase();
    article =
      (artCache.records || []).find(
        (x) => safeTrim(x.REFER).toUpperCase() === cible,
      ) || null;
  }
  if (!article) return null;

  // Chaîne de renvois GENDOUBL -> fiche active (bornée, comme ailleurs).
  let actif = article;
  for (let i = 0; i < 10; i += 1) {
    const vers = safeTrim(actif.GENDOUBL);
    if (!vers) break;
    // eslint-disable-next-line no-await-in-loop
    const suivant = await articleService.findByNart(entreprise, vers);
    if (!suivant) break;
    actif = suivant;
  }

  const l = ligne(actif, dep, indexFournisseurs(fourCache), dico.index);
  return {
    ...l,
    // Repères pour l'écran : l'article ajouté à la main ne respecte pas
    // forcément la règle de l'analyse, on le dit plutôt que de le refuser.
    renvoi: actif !== article ? safeTrim(article.NART) : "",
    horsRegle: !(l.s1 === 0 && l.stockDepot > 0),
  };
};

/**
 * Contenu du fichier .dat (format Stock XL FIGÉ) :
 *   CODE(13, NART justifié à gauche, espaces à droite) | QTE(8) | 000 + CRLF
 * ⚠️ `fmtQteDat` est le SEUL formateur de quantité des .dat (décimales et
 * négatifs compris) : ne jamais réintroduire d'arrondi ici.
 */
export const construireContenuDat = (lignes) => {
  let contenu = "";
  (lignes || []).forEach((l) => {
    const q = round3(l.quantite);
    if (q <= 0) return;
    const code = safeTrim(l.nart);
    if (!code) return;
    contenu += `${code.padEnd(13, " ")}|${fmtQteDat(q)}|000\r\n`;
  });
  return contenu;
};

export default {
  DEPOTS_SOURCE,
  estDepotValide,
  getEntrepots,
  analyserEntrepot,
  resoudreArticle,
  construireContenuDat,
  qteProposee,
};
