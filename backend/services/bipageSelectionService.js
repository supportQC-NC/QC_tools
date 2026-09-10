// backend/services/bipageSelectionService.js
//
// Sélection d'articles à biper à partir d'un critère de RANGEMENT de la fiche
// article. Utilisé par les demandes de bipage créées depuis le web.
//
// ⚠️ Ne pas confondre avec `getMagasinArticlesByGisements` d'analyseReapproService,
// que le module réappro utilise pour les GISEMENTS : celui-là ne retient que les
// articles absents du rayon mais présents en stock (S1 = 0 et stock > 0), ce qui
// est la question du réappro. Ici la question est le COMPTAGE : on veut tous les
// articles du groupe, éventuellement bornés à ceux qui ont du stock.
import articleService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";
import {
  buildIndexRayons,
  lookupRayon,
} from "./dictionnaireRayonsService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Stock total, tous dépôts : la fiche article porte S1..S5.
const stockTotal = (a) =>
  num(a.S1) + num(a.S2) + num(a.S3) + num(a.S4) + num(a.S5);

// Stock des RÉSERVES seules (S2 à S5) : le rayon, c'est S1.
const stockReserves = (a) => num(a.S2) + num(a.S3) + num(a.S4) + num(a.S5);

// Ventes des 12 derniers mois : Σ|V1..V12|, exactement la formule du réappro
// local et de l'analyse réappro (`venteAnnuelle`). Valeur absolue : l'ERP écrit
// des quantités négatives sur certains mois (retours).
const ventes12Mois = (a) => {
  let s = 0;
  for (let i = 1; i <= 12; i += 1) s += Math.abs(num(a[`V${i}`]));
  return s;
};

// ⚠️ La fiche article porte DEUX codes d'emplacement, un par zone :
//     GISM1 = MAGASIN (le rayon)   ·   GISM2 = DOCK (la réserve).
// Leur libellé vient du DICTIONNAIRE DES RAYONS, interrogé sur le couple
// **code + emplacement** : chez QC, 53 codes existent aux deux endroits et 34 y
// portent un libellé DIFFÉRENT (`A_1` = « Ventilateurs muraux » au magasin,
// « EPI GANTS » au dock). Chercher par code seul renvoie donc le mauvais nom.
const gisementArticle = (a) => safeTrim(a.GISM1) || safeTrim(a.EMPLACE);
const gisementDock = (a) => safeTrim(a.GISM2);

// Emplacement de travail : MAGASIN pour le bipage (on va compter le rayon),
// DOCK pour le réappro (on va chercher en réserve ce qui manque en rayon).
const normEmplacementTravail = (v) =>
  String(v || "").toUpperCase() === "DOCK" ? "DOCK" : "MAGASIN";

// ⚠️ RENVOIS : un article dont GENDOUBL est rempli est « renvoyé » vers un autre
// code — c'est l'autre qui est vivant. Le faire biper n'a pas de sens (le
// collecteur compterait un code que l'ERP n'utilise plus), on l'écarte donc des
// listes de sélection en le comptant à part. Le code cible, lui, apparaît de
// lui-même s'il appartient au même fournisseur.
const estRenvoi = (a) => safeTrim(a.GENDOUBL) !== "";

// Articles techniques de l'ERP (« ARTICLE TGC 11 % », frais de port…) : NART
// sous 100000, jamais en rayon.
const estTechnique = (a) => {
  const n = parseInt(safeTrim(a.NART), 10);
  return !Number.isNaN(n) && n < 100000;
};

// Emplacements qui NE SONT PAS un rayon : un article rangé là n'a par
// définition rien en rayon, il ne doit pas être signalé comme « rayon vide ».
// Propre à QC (SAV et DOCK), comme dans le service réappro.
const estHorsRayon = (gis, isQC) =>
  isQC && ["SAV", "DOCK"].includes(String(gis || "").toUpperCase());

// Ligne telle que l'écran l'affiche. `prioritaire` = rayon vide alors qu'il
// reste du stock en réserve : c'est CE cas qu'on veut voir en premier. La règle
// est la MÊME que celle de la liste « rayon vide » — SAV/DOCK compris — pour
// que les deux écrans ne se contredisent pas.
const ligneArticle = (a, fournByCode, isQC = false, rayons = null) => {
  const fournM = a.FOURN != null ? fournByCode.get(String(a.FOURN).trim()) : null;
  const reserves = stockReserves(a);
  const s1 = num(a.S1);
  const gis = gisementArticle(a);
  const gisD = gisementDock(a);
  // Libellés du dictionnaire, chacun cherché à SON emplacement.
  const rMag = rayons ? lookupRayon(rayons, gis, "MAGASIN") : null;
  const rDock = rayons ? lookupRayon(rayons, gisD, "DOCK") : null;
  return {
    nart: safeTrim(a.NART),
    design: safeTrim(a.DESIGN),
    fourn: a.FOURN != null ? String(a.FOURN).trim() : "",
    fournNom: fournM ? safeTrim(fournM.NOM) : "",
    // ⚠️ GENCOD laissé tel quel, zéros de tête compris (utils/codeBarres.js).
    gencod: safeTrim(a.GENCOD),
    // Compatibilité : `gisement` reste le code MAGASIN (GISM1).
    gisement: gis,
    gism1: gis,
    gism2: gisD,
    rayonMagasin: rMag ? rMag.libelle : "",
    rayonDock: rDock ? rDock.libelle : "",
    s1,
    s2: num(a.S2),
    s3: num(a.S3),
    s4: num(a.S4),
    s5: num(a.S5),
    stock: stockTotal(a),
    stockReserves: reserves,
    // Réserve du DOCK seule : c'est elle qui alimente le rayon en réappro.
    stockDock: num(a.S2),
    ventes12: ventes12Mois(a),
    prioritaire: s1 === 0 && reserves > 0 && !estHorsRayon(gis, isQC),
  };
};

// Index { code fournisseur -> fiche } (nom du fournisseur).
const indexFournisseurs = (fourCache) => {
  const m = new Map();
  (fourCache.records || []).forEach((r) => {
    if (r.FOURN !== undefined && r.FOURN !== null) {
      m.set(String(r.FOURN).trim(), r);
    }
  });
  return m;
};

/**
 * Fournisseurs ayant au moins un article exploitable, avec le nombre
 * d'articles et combien sont « rayon vide ». Servi par le module bipage
 * lui-même : pas de dépendance au module `stock`, qu'un opérateur n'a pas
 * forcément.
 */
export const getFournisseursAvecArticles = async (entreprise) => {
  const [artCache, fourCache] = await Promise.all([
    articleService.getArticles(entreprise),
    fournissCacheService.getFournisseurs(entreprise),
  ]);
  const fournByCode = indexFournisseurs(fourCache);
  const isQC = String(entreprise.nomDossierDBF).toLowerCase() === "qc";

  const par = new Map();
  (artCache.records || []).forEach((a) => {
    if (!safeTrim(a.NART) || estTechnique(a) || estRenvoi(a)) return;
    const code = a.FOURN != null ? String(a.FOURN).trim() : "";
    if (!code) return;
    if (!par.has(code)) {
      const f = fournByCode.get(code);
      par.set(code, {
        code,
        nom: f ? safeTrim(f.NOM) : "",
        nbArticles: 0,
        nbRayonVide: 0,
      });
    }
    const e = par.get(code);
    e.nbArticles += 1;
    if (
      num(a.S1) === 0 &&
      stockReserves(a) > 0 &&
      !estHorsRayon(gisementArticle(a), isQC)
    ) {
      e.nbRayonVide += 1;
    }
  });

  return [...par.values()].sort((x, y) =>
    (x.nom || x.code).localeCompare(y.nom || y.code, "fr", {
      numeric: true,
      sensitivity: "base",
    }),
  );
};

/**
 * TOUS les articles d'un fournisseur, prêts à cocher.
 *
 * Ordre : les « rayon vide » (S1 = 0 et réserve > 0) d'abord — c'est ce qu'on
 * cherche —, puis les meilleures ventes. Les articles renvoyés vers un autre
 * code sont écartés et comptés à part (`renvoyes`).
 */
export const getArticlesParFournisseur = async (
  entreprise,
  fourn,
  options = {},
) => {
  const code = safeTrim(fourn);
  const limit = Math.min(parseInt(options.limit, 10) || 1000, 5000);
  const emplacement = normEmplacementTravail(options.emplacement);
  if (!code) return { total: 0, renvoyes: 0, rayonVide: 0, articles: [] };

  const [artCache, fourCache, dico] = await Promise.all([
    articleService.getArticles(entreprise),
    fournissCacheService.getFournisseurs(entreprise),
    buildIndexRayons(entreprise),
  ]);
  const fournByCode = indexFournisseurs(fourCache);
  const isQC = String(entreprise.nomDossierDBF).toLowerCase() === "qc";
  const rayons = dico.index;

  let renvoyes = 0;
  const out = [];
  (artCache.records || []).forEach((a) => {
    if (a.FOURN == null || String(a.FOURN).trim() !== code) return;
    if (!safeTrim(a.NART) || estTechnique(a)) return;
    if (estRenvoi(a)) {
      renvoyes += 1;
      return;
    }
    // ⚠️ MÊME critère des deux côtés (décision client) : rayon vide = S1 à 0
    // avec du stock en RÉSERVE, S2 à S5 confondus. `emplacement` ne change que
    // le gisement AFFICHÉ (GISM1/magasin pour le bipage, GISM2/dock pour le
    // réappro), jamais la sélection.
    out.push(ligneArticle(a, fournByCode, isQC, rayons));
  });

  // Tri : le RÉAPPRO veut voir d'abord ce qui manque en rayon (`prioritaire`) ;
  // le BIPAGE est libre — on compte ce qu'on veut, quel que soit le stock — et
  // se contente des meilleures ventes d'abord.
  const parVentesSeules = String(options.tri || "") === "ventes";
  out.sort((x, y) =>
    parVentesSeules
      ? y.ventes12 - x.ventes12 || x.nart.localeCompare(y.nart)
      : Number(y.prioritaire) - Number(x.prioritaire) ||
        y.ventes12 - x.ventes12 ||
        x.nart.localeCompare(y.nart),
  );

  return {
    emplacement,
    total: out.length,
    renvoyes,
    rayonVide: out.filter((a) => a.prioritaire).length,
    articles: out.slice(0, limit),
  };
};

/**
 * Articles ABSENTS DU RAYON mais présents en réserve : S1 = 0 et S2..S5 > 0.
 *
 * C'est la liste de ceux qu'il faut aller compter en priorité — soit le rayon
 * est réellement vide et il y a du stock à descendre, soit le stock ERP est
 * faux. Le tri met en tête les MEILLEURES VENTES (Σ|V1..V12|) : à 3 000 lignes,
 * l'ordre alphabétique ne sert à rien, ce qui compte c'est ce qui se vend et
 * qui manque en rayon.
 *
 * @param {object} entreprise
 * @param {object} [options]
 * @param {number} [options.limit=500]  nombre de lignes renvoyées
 * @param {string} [options.fourn]      ne garder qu'un fournisseur
 * @param {string} [options.emplacement] MAGASIN (défaut, bipage) | DOCK (réappro)
 * @returns {Promise<{total, articles, fournisseurs}>}
 */
export const getArticlesRayonVide = async (entreprise, options = {}) => {
  const limit = Math.min(parseInt(options.limit, 10) || 500, 3000);
  const fournFiltre = safeTrim(options.fourn);
  // `emplacement` ne sert QU'À l'affichage (quel gisement montrer) : le
  // critère de sélection est le même pour le bipage et le réappro.
  const emplacement = normEmplacementTravail(options.emplacement);

  const [artCache, fourCache, dico] = await Promise.all([
    articleService.getArticles(entreprise),
    fournissCacheService.getFournisseurs(entreprise),
    buildIndexRayons(entreprise),
  ]);
  const rayons = dico.index;
  const fournByCode = new Map();
  (fourCache.records || []).forEach((r) => {
    if (r.FOURN !== undefined && r.FOURN !== null) {
      fournByCode.set(String(r.FOURN).trim(), r);
    }
  });

  // Chez QC, GISM1 « SAV » et « DOCK » ne sont pas des rayons : un article
  // rangé là n'a par définition rien en rayon, il n'a rien à faire dans cette
  // liste. Même exclusion que le service réappro.
  const isQC = String(entreprise.nomDossierDBF).toLowerCase() === "qc";

  const out = [];
  // Fournisseurs présents dans la liste COMPLÈTE (avant le filtre fournisseur
  // et avant la limite) : sinon le menu déroulant se viderait au premier choix.
  const parFourn = new Map();
  (artCache.records || []).forEach((a) => {
    const nart = safeTrim(a.NART);
    if (!nart || estTechnique(a)) return;
    // Un article renvoyé vers un autre code n'a pas à être compté.
    if (estRenvoi(a)) return;
    if (num(a.S1) !== 0) return;
    if (stockReserves(a) <= 0) return;
    if (estHorsRayon(gisementArticle(a), isQC)) return;

    const ligne = ligneArticle(a, fournByCode, isQC, rayons);
    const code = ligne.fourn;
    if (!parFourn.has(code)) {
      parFourn.set(code, { code, nom: ligne.fournNom, nb: 0 });
    }
    parFourn.get(code).nb += 1;

    if (fournFiltre && code !== fournFiltre) return;
    out.push(ligne);
  });

  // Meilleures ventes d'abord ; à ventes égales, le NART pour un ordre stable.
  out.sort((x, y) => y.ventes12 - x.ventes12 || x.nart.localeCompare(y.nart));

  const fournisseurs = [...parFourn.values()].sort((x, y) =>
    (x.nom || x.code).localeCompare(y.nom || y.code, "fr", {
      numeric: true,
      sensitivity: "base",
    }),
  );

  return {
    emplacement,
    total: out.length,
    articles: out.slice(0, limit),
    fournisseurs,
  };
};

/**
 * Articles d'un ou plusieurs GROUPE (famille de la fiche article).
 *
 * @param {object} entreprise            document Entreprise
 * @param {string[]} groupes             codes GROUPE demandés
 * @param {object} [options]
 * @param {boolean} [options.avecStockSeulement=true]
 *        true  : seuls les articles dont le stock total est non nul — le cas
 *                courant, un groupe entier compte souvent des milliers de
 *                références dont la plupart n'ont jamais été en rayon ;
 *        false : tout le groupe (l'agent verra aussi les articles à 0).
 * @returns {Promise<Map<string, Array>>} code GROUPE -> articles à biper
 */
export const getArticlesParGroupes = async (
  entreprise,
  groupes,
  options = {},
) => {
  const { avecStockSeulement = true } = options;
  const voulus = new Set(
    (groupes || []).map((g) => safeTrim(g)).filter(Boolean),
  );
  const parGroupe = new Map();
  if (voulus.size === 0) return parGroupe;

  const [artCache, fourCache] = await Promise.all([
    articleService.getArticles(entreprise),
    fournissCacheService.getFournisseurs(entreprise),
  ]);

  const fournByCode = new Map();
  (fourCache.records || []).forEach((r) => {
    if (r.FOURN !== undefined && r.FOURN !== null) {
      fournByCode.set(String(r.FOURN).trim(), r);
    }
  });

  // L'index par GROUPE existe déjà dans le cache article : on ne balaie pas les
  // 100 000 articles pour trois groupes.
  voulus.forEach((code) => {
    const indices = artCache.indexByGroupe?.get(code) || [];
    const articles = [];
    indices.forEach((i) => {
      const a = artCache.records[i];
      if (!a) return;
      const nart = safeTrim(a.NART);
      if (!nart) return;
      // Articles techniques de l'ERP (« ARTICLE TGC 11 % », frais de port…) :
      // NART sous 100000, jamais en rayon. Même exclusion que le service
      // réappro pour les gisements — sans elle, chaque demande de groupe
      // démarre sur des lignes que personne ne peut biper.
      const nartNum = parseInt(nart, 10);
      if (!Number.isNaN(nartNum) && nartNum < 100000) return;
      const stock = stockTotal(a);
      if (avecStockSeulement && stock === 0) return;
      const fournM =
        a.FOURN != null ? fournByCode.get(String(a.FOURN).trim()) : null;
      articles.push({
        nart,
        design: safeTrim(a.DESIGN),
        fourn: a.FOURN != null ? String(a.FOURN).trim() : "",
        fournNom: fournM ? safeTrim(fournM.NOM) : "",
        // ⚠️ Le GENCOD peut commencer par des zéros : on le laisse tel quel
        // (cf. utils/codeBarres.js) — le retirer rendrait l'article « inconnu »
        // au scan.
        gencod: safeTrim(a.GENCOD),
        stock,
      });
    });
    articles.sort((x, y) => x.nart.localeCompare(y.nart));
    parGroupe.set(code, articles);
  });

  return parGroupe;
};

export default {
  getArticlesParGroupes,
  getArticlesRayonVide,
  getArticlesParFournisseur,
  getFournisseursAvecArticles,
};
