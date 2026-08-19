// backend/services/artplusService.js
//
// COMPLÉMENTS ARTICLE (artplus.dbf) — attributs libres et regroupement des
// articles en PRODUITS (un produit = plusieurs variantes).
//
// ── Ce que contient artplus.dbf ─────────────────────────────────────────────
// Trois colonnes seulement : { NART, INTITULE, CONTENU }. C'est un magasin
// clé/valeur : une ligne par attribut et par article. L'ERP n'impose AUCUN
// schéma — la liste des INTITULE est propre à chaque société :
//
//   qc    : 01_n_produit, 02_nom_produit, 03_picto_fourniss, 04_position_liste,
//           05_arborescence, 06_groupe, 07_famille, 08_ss_famille,
//           09_num_tetiere, 10_tet1_diametre … 18_tet9_info   (18 intitulés)
//   sitec : 01_DESIGN, 02_DIMENSION, 03_MODELE, 04_INFO, 05_ARBORESCENCE
//
// Ce service ne code donc AUCUNE liste d'attributs en dur : il lit ceux qui
// existent, et leur attribue un RÔLE par convention de nommage (cf. ROLES).
// Une société dont les intitulés changent est prise en compte au rechargement
// du cache, sans modification de code.
//
// ── Pourquoi regrouper en produits ──────────────────────────────────────────
// L'ERP raisonne en références (NART) : « VERROU FENETRE A CLE BOLT » existe en
// 14 lignes (argent/blanc, à l'unité/en blister…). Pour une recherche client —
// un site marchand, un catalogue — ces 14 lignes sont UN produit et 14
// variantes. Le regroupement se fait sur l'identifiant produit quand il existe
// (`01_n_produit` chez qc : 18 234 valeurs, aucune ne porte deux noms
// différents, donc clé fiable), sinon sur le nom du produit.
//
// ── Perf ────────────────────────────────────────────────────────────────────
// artplus.dbf est lu en entier puis indexé en mémoire (qc : 637 000 lignes /
// 73 Mo ; sitec : 28 000 lignes / 3 Mo). Cache par société, TTL + invalidation
// sur mtime/taille, verrou anti-chargements concurrents — même contrat que
// articleService. Le fichier est FACULTATIF : une société sans artplus.dbf
// renvoie un index vide (`present: false`) et jamais une erreur.

import fs from "fs";
import path from "path";
import { DBFFile } from "dbffile";
import articleCacheService from "./articleService.js";

const TTL_MS = 10 * 60 * 1000;
const LOT = 20000;

// Rôles reconnus, par expression sur le nom d'attribut NORMALISÉ (préfixe
// numérique retiré, minuscules). Le premier motif qui accroche gagne, et un
// rôle n'est attribué qu'une fois : les intitulés sont numérotés, donc le
// premier rencontré est le bon (`01_DESIGN` est le nom chez sitec, pas
// `03_MODELE`).
const ROLES = [
  ["produitId", /^(n|num|no|id)_produit$|^produit_id$/],
  ["nom", /nom_produit|^design$|^designation$|^libelle$/],
  ["marque", /picto_fourniss|^marque$|^fournisseur$/],
  ["rang", /position_liste|^position$|^ordre$/],
  ["arborescence", /arborescence|^rayon$/],
  ["groupe", /^groupe$/],
  ["famille", /^famille$/],
  ["sousFamille", /ss_famille|sous_famille|^ssfamille$/],
];

const safeTrim = (v) => (v === null || v === undefined ? "" : String(v).trim());

/**
 * Nom d'attribut exploitable : « 08_ss_famille » -> « ss_famille ».
 * Renvoie "" pour les intitulés corrompus — il y en a dans les vrais fichiers
 * (« ################ », « 04_`ositioN_|ist? »), vestiges d'enregistrements
 * effacés. Les laisser passer polluerait le dictionnaire d'attributs exposé
 * au partenaire.
 */
const normaliserIntitule = (intitule) => {
  const t = safeTrim(intitule);
  if (!t) return "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_ .-]*$/.test(t)) return "";
  return t
    .replace(/^\d+[_-]/, "")
    .trim()
    .toLowerCase()
    .replace(/[ .-]+/g, "_");
};

/** Rang de tri d'un intitulé : le préfixe numérique quand il existe. */
const ordreIntitule = (intitule) => {
  const m = /^(\d+)[_-]/.exec(safeTrim(intitule));
  return m ? parseInt(m[1], 10) : 999;
};

/**
 * Identifiant d'URL dérivé d'un libellé.
 * Les noms de produit sont longs (jusqu'à 90 caractères) : on tronque, mais on
 * ajoute alors une empreinte du nom COMPLET — sans elle, deux produits dont les
 * 80 premiers caractères coïncident seraient fusionnés en un seul.
 */
const slug = (v) => {
  const propre = safeTrim(v)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (propre.length <= 80) return propre;

  let h = 0;
  for (let i = 0; i < propre.length; i++) {
    h = (h * 31 + propre.charCodeAt(i)) | 0;
  }
  return `${propre.slice(0, 80).replace(/-+$/, "")}-${(h >>> 0).toString(36)}`;
};

/** Texte comparable : minuscules, sans accent ni ponctuation. */
const aplatir = (v) =>
  safeTrim(v)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const compter = (map, valeur) => {
  if (!valeur) return;
  map.set(valeur, (map.get(valeur) || 0) + 1);
};

const parMontantDecroissant = (map) =>
  [...map.entries()]
    .map(([valeur, nb]) => ({ valeur, nb }))
    .sort((a, b) => b.nb - a.nb || a.valeur.localeCompare(b.valeur));

class ArtplusService {
  constructor() {
    this.cache = new Map(); // nomDossierDBF -> index
    this.verrous = new Map(); // nomDossierDBF -> Promise
  }

  cheminDbf(entreprise) {
    return path.join(
      entreprise.cheminBase,
      entreprise.nomDossierDBF,
      "artplus.dbf",
    );
  }

  /** Index vide : société sans artplus.dbf (le fichier est facultatif). */
  indexVide(chemin) {
    return {
      present: false,
      dbfInfo: { path: chemin, recordCount: 0, fileSize: 0, lastModified: null },
      roles: {},
      intitules: [],
      parNart: new Map(),
      produits: new Map(),
      produitParNart: new Map(),
      facettes: {
        groupes: [],
        familles: [],
        sousFamilles: [],
        arborescences: [],
      },
      loadedAt: Date.now(),
      lastModified: null,
    };
  }

  cacheValide(entree, chemin) {
    if (!entree) return false;
    if (Date.now() - entree.loadedAt > TTL_MS) return false;
    // Une société sans fichier : on revérifie simplement qu'il n'est pas apparu.
    if (!entree.present) return !fs.existsSync(chemin);
    try {
      const st = fs.statSync(chemin);
      return (
        st.mtime.getTime() === entree.lastModified?.getTime() &&
        st.size === entree.dbfInfo.fileSize
      );
    } catch {
      return false;
    }
  }

  /**
   * Index des compléments article d'une société (chargé/caché à la demande).
   * Ne lève jamais pour cause de fichier absent : voir `present`.
   */
  async getIndex(entreprise) {
    const cle = entreprise.nomDossierDBF;
    const chemin = this.cheminDbf(entreprise);

    const cached = this.cache.get(cle);
    if (this.cacheValide(cached, chemin)) return cached;
    if (this.verrous.has(cle)) return this.verrous.get(cle);

    const promesse = (async () => {
      try {
        const index = await this.construireIndex(entreprise, chemin);
        this.cache.set(cle, index);
        return index;
      } finally {
        this.verrous.delete(cle);
      }
    })();
    this.verrous.set(cle, promesse);
    return promesse;
  }

  async construireIndex(entreprise, chemin) {
    if (!fs.existsSync(chemin)) return this.indexVide(chemin);

    const t0 = Date.now();
    const dbf = await DBFFile.open(chemin, { readMode: "loose" });
    const st = fs.statSync(chemin);

    // 1) Lecture en flux : attributs par article + statistiques par intitulé.
    const parNart = new Map(); // NART -> { attributs }
    const statsIntitule = new Map(); // INTITULE brut -> { cle, nbLignes, nbRemplies }
    let lues = 0;
    let lot;
    while ((lot = await dbf.readRecords(LOT)).length > 0) {
      for (const r of lot) {
        lues += 1;
        const nart = safeTrim(r.NART).toUpperCase();
        const intitule = safeTrim(r.INTITULE);
        if (!nart || !intitule) continue;
        const cleAttr = normaliserIntitule(intitule);
        if (!cleAttr) continue;

        let stat = statsIntitule.get(intitule);
        if (!stat) {
          stat = {
            intitule,
            cle: cleAttr,
            ordre: ordreIntitule(intitule),
            nbLignes: 0,
            nbRemplies: 0,
          };
          statsIntitule.set(intitule, stat);
        }
        stat.nbLignes += 1;

        const contenu = safeTrim(r.CONTENU);
        if (!contenu) continue; // attribut non renseigné : rien à stocker
        stat.nbRemplies += 1;

        let attrs = parNart.get(nart);
        if (!attrs) {
          attrs = {};
          parNart.set(nart, attrs);
        }
        attrs[cleAttr] = contenu;
      }
    }

    // 2) Rôles : première clé (dans l'ordre des intitulés) qui accroche.
    const intitules = [...statsIntitule.values()].sort(
      (a, b) => a.ordre - b.ordre || a.intitule.localeCompare(b.intitule),
    );
    const roles = {};
    for (const it of intitules) {
      for (const [role, motif] of ROLES) {
        if (roles[role]) continue;
        if (motif.test(it.cle)) {
          roles[role] = it.cle;
          it.role = role;
          break;
        }
      }
    }

    // 3) Regroupement en produits.
    const index = {
      present: true,
      dbfInfo: {
        path: chemin,
        recordCount: dbf.recordCount,
        fileSize: st.size,
        lastModified: st.mtime,
      },
      roles,
      intitules,
      parNart,
      loadedAt: Date.now(),
      lastModified: st.mtime,
    };
    this.construireProduits(index);

    console.log(
      `[Artplus] ${entreprise.nomDossierDBF}: ${lues} lignes, ${parNart.size} articles, ` +
        `${index.produits.size} produits, ${intitules.length} attributs en ${Date.now() - t0}ms`,
    );
    return index;
  }

  /**
   * Assemble les produits (regroupement des variantes) et les facettes.
   * Muté sur l'index : appelé une seule fois, au chargement.
   */
  construireProduits(index) {
    const { roles, parNart } = index;
    const cleId = roles.produitId;
    const cleNom = roles.nom;
    const cleRang = roles.rang;

    // L'identifiant produit n'est utilisable comme clé que s'il ne recouvre pas
    // plusieurs noms — vérifié, pas supposé (chez qc : 18 234 ids, 0 ambigu).
    let idFiable = Boolean(cleId);
    if (idFiable && cleNom) {
      const nomsParId = new Map();
      for (const attrs of parNart.values()) {
        const id = attrs[cleId];
        if (!id) continue;
        let noms = nomsParId.get(id);
        if (!noms) {
          noms = new Set();
          nomsParId.set(id, noms);
        }
        noms.add(attrs[cleNom] || "");
        if (noms.size > 1) {
          idFiable = false;
          break;
        }
      }
    }

    const produits = new Map();
    const produitParNart = new Map();
    const groupes = new Map();
    const familles = new Map();
    const sousFamilles = new Map();
    const arborescences = new Map();

    for (const [nart, attrs] of parNart) {
      const id = cleId ? attrs[cleId] : "";
      const nom = cleNom ? attrs[cleNom] : "";
      // Sans identifiant ni nom, l'article est son propre produit : on ne
      // regroupe jamais « au hasard ».
      const cle =
        idFiable && id ? `p${id}` : nom ? `n${slug(nom)}` : `a${nart}`;

      let produit = produits.get(cle);
      if (!produit) {
        produit = {
          cle,
          id: idFiable && id ? id : "",
          nom: nom || "",
          groupe: roles.groupe ? attrs[roles.groupe] || "" : "",
          famille: roles.famille ? attrs[roles.famille] || "" : "",
          sousFamille: roles.sousFamille ? attrs[roles.sousFamille] || "" : "",
          arborescence: roles.arborescence
            ? attrs[roles.arborescence] || ""
            : "",
          marque: roles.marque ? attrs[roles.marque] || "" : "",
          narts: [],
          axes: [],
        };
        produits.set(cle, produit);
        compter(groupes, produit.groupe);
        compter(familles, produit.famille);
        compter(sousFamilles, produit.sousFamille);
        compter(arborescences, produit.arborescence);
      }
      produit.narts.push(nart);
      produitParNart.set(nart, cle);
    }

    // Ordre des variantes + axes de variation (les attributs qui DIFFÈRENT
    // d'une variante à l'autre : couleur, dimension, conditionnement…).
    for (const produit of produits.values()) {
      if (cleRang) {
        produit.narts.sort((a, b) => {
          const ra = parseFloat(parNart.get(a)?.[cleRang]);
          const rb = parseFloat(parNart.get(b)?.[cleRang]);
          const va = Number.isFinite(ra) ? ra : Number.MAX_SAFE_INTEGER;
          const vb = Number.isFinite(rb) ? rb : Number.MAX_SAFE_INTEGER;
          return va - vb || a.localeCompare(b);
        });
      } else {
        produit.narts.sort();
      }

      if (produit.narts.length > 1) {
        const vues = new Map(); // cle -> première valeur rencontrée
        const axes = new Set();
        for (const nart of produit.narts) {
          const attrs = parNart.get(nart) || {};
          for (const [k, v] of Object.entries(attrs)) {
            if (!vues.has(k)) vues.set(k, v);
            else if (vues.get(k) !== v) axes.add(k);
          }
        }
        // Un attribut absent chez certaines variantes varie aussi.
        for (const k of vues.keys()) {
          const presents = produit.narts.filter(
            (n) => (parNart.get(n) || {})[k],
          ).length;
          if (presents !== produit.narts.length) axes.add(k);
        }
        produit.axes = [...axes].filter(
          (k) => k !== cleId && k !== cleNom && k !== cleRang,
        );
      }

      // Texte de recherche : nom, classement, codes article ET valeurs des
      // variantes (« verrou blanc », « corniere 10 mm » doivent trouver).
      const mots = new Set(aplatir(produit.nom).split(" "));
      for (const v of [
        produit.groupe,
        produit.famille,
        produit.sousFamille,
        produit.marque,
        produit.arborescence,
      ]) {
        for (const m of aplatir(v).split(" ")) if (m) mots.add(m);
      }
      for (const nart of produit.narts) {
        mots.add(nart.toLowerCase());
        const attrs = parNart.get(nart) || {};
        for (const [k, val] of Object.entries(attrs)) {
          if (k === cleId || k === cleRang) continue;
          for (const m of aplatir(val).split(" ")) if (m) mots.add(m);
        }
      }
      mots.delete("");
      produit.texte = [...mots].join(" ");
    }

    index.produits = produits;
    index.produitParNart = produitParNart;
    index.facettes = {
      groupes: parMontantDecroissant(groupes),
      familles: parMontantDecroissant(familles),
      sousFamilles: parMontantDecroissant(sousFamilles),
      arborescences: parMontantDecroissant(arborescences),
    };
  }

  // ── Produits (regroupement des variantes) ─────────────────────────────────

  /**
   * Assemble la vue d'un produit : ses variantes, dans l'ordre du catalogue,
   * avec l'enregistrement article.dbf correspondant quand il existe.
   *
   * artplus.dbf et article.dbf ne sont PAS garantis synchrones : un NART peut
   * avoir des compléments sans exister (ou plus) dans le fichier articles. On
   * ne masque pas ces variantes en silence, on les marque `articleTrouve:false`
   * — sinon un produit se met à afficher 3 déclinaisons au lieu de 4 sans que
   * personne ne comprenne pourquoi.
   */
  vueProduit(index, produit, cacheArticles) {
    const variantes = produit.narts.map((nart) => {
      const idx = cacheArticles?.indexByNart?.get(nart);
      const article = idx !== undefined ? cacheArticles.records[idx] : null;
      return {
        nart,
        attributs: index.parNart.get(nart) || {},
        articleTrouve: Boolean(article),
        article,
      };
    });

    return {
      cle: produit.cle,
      id: produit.id,
      nom: produit.nom,
      groupe: produit.groupe,
      famille: produit.famille,
      sousFamille: produit.sousFamille,
      arborescence: produit.arborescence,
      marque: produit.marque,
      axes: produit.axes,
      nbVariantes: produit.narts.length,
      variantes,
    };
  }

  /**
   * Liste paginée des produits, filtrable.
   * @param {Object} opts page, limit, search, groupe, famille, sousFamille,
   *                      arborescence (préfixe accepté), marque, enStock, web
   */
  async listerProduits(entreprise, opts = {}) {
    const {
      page = 1,
      limit = 50,
      search,
      groupe,
      famille,
      sousFamille,
      arborescence,
      marque,
      enStock,
      web,
    } = opts;

    const index = await this.getIndex(entreprise);
    // Le cache articles est nécessaire dans tous les cas : ne serait-ce que
    // pour dire si chaque variante existe encore dans article.dbf. Il est
    // partagé avec le reste de l'application, donc déjà chaud la plupart du
    // temps (premier chargement ~7 s sur les 100 000 articles de qc).
    const cacheArticles = await articleCacheService.getArticles(entreprise);

    const egal = (a, b) => aplatir(a) === aplatir(b);
    const motsRecherche = search ? aplatir(search).split(" ").filter(Boolean) : [];
    const arbo = safeTrim(arborescence).toUpperCase();

    let produits = [...index.produits.values()];

    if (groupe) produits = produits.filter((p) => egal(p.groupe, groupe));
    if (famille) produits = produits.filter((p) => egal(p.famille, famille));
    if (sousFamille) {
      produits = produits.filter((p) => egal(p.sousFamille, sousFamille));
    }
    if (marque) produits = produits.filter((p) => egal(p.marque, marque));
    // Préfixe : « G010 » remonte tout le rayon, « G010J03 » la seule case.
    if (arbo) {
      produits = produits.filter((p) =>
        p.arborescence.toUpperCase().startsWith(arbo),
      );
    }
    if (motsRecherche.length) {
      produits = produits.filter((p) =>
        motsRecherche.every((m) => p.texte.includes(m)),
      );
    }

    if (enStock || web) {
      produits = produits.filter((p) =>
        p.narts.some((nart) => {
          const i = cacheArticles.indexByNart.get(nart);
          if (i === undefined) return false;
          const a = cacheArticles.records[i];
          if (enStock && articleCacheService.calculateStockTotal(a) <= 0) {
            return false;
          }
          if (web && safeTrim(a.WEB).toUpperCase() !== "O") return false;
          return true;
        }),
      );
    }

    // Pertinence : le texte de recherche couvre aussi le classement et les
    // variantes (« verrou » trouve la sous-famille VERROUILLAGE ÉLECTRIQUE).
    // C'est voulu — mais un produit dont le NOM contient les mots cherchés
    // passe devant, sinon la première page ne montre que des à-côtés.
    if (motsRecherche.length) {
      const score = (p) => {
        const nom = aplatir(p.nom);
        return motsRecherche.every((m) => nom.includes(m)) ? 0 : 1;
      };
      produits.sort(
        (a, b) =>
          score(a) - score(b) ||
          a.nom.localeCompare(b.nom, "fr") ||
          a.cle.localeCompare(b.cle),
      );
    } else {
      produits.sort(
        (a, b) =>
          a.nom.localeCompare(b.nom, "fr") || a.cle.localeCompare(b.cle),
      );
    }

    const totalRecords = produits.length;
    const debut = (page - 1) * limit;
    const tranche = produits.slice(debut, debut + limit);

    return {
      present: index.present,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit) || 1,
      page,
      limit,
      hasNextPage: debut + limit < totalRecords,
      hasPrevPage: page > 1,
      produits: tranche.map((p) => this.vueProduit(index, p, cacheArticles)),
    };
  }

  /**
   * Classement du catalogue en arbre : groupe > famille > sous-famille, avec le
   * nombre de produits et de références à chaque niveau. C'est ce qui permet à
   * un site marchand de construire son menu sans parcourir tout le catalogue.
   * Renvoie un tableau vide si la société n'a pas ces attributs (cf. `roles`).
   */
  async getClassement(entreprise) {
    const index = await this.getIndex(entreprise);
    // Aucun attribut de classement (cas de sitec) : un arbre à un seul nœud
    // « (sans groupe) » n'aiderait personne — on le dit franchement.
    if (!index.roles.groupe && !index.roles.famille && !index.roles.sousFamille) {
      return { disponible: false, groupes: [] };
    }
    const racine = new Map();

    for (const produit of index.produits.values()) {
      const g = produit.groupe || "(sans groupe)";
      let noeudG = racine.get(g);
      if (!noeudG) {
        noeudG = { valeur: g, nbProduits: 0, nbArticles: 0, familles: new Map() };
        racine.set(g, noeudG);
      }
      noeudG.nbProduits += 1;
      noeudG.nbArticles += produit.narts.length;

      const f = produit.famille || "(sans famille)";
      let noeudF = noeudG.familles.get(f);
      if (!noeudF) {
        noeudF = {
          valeur: f,
          nbProduits: 0,
          nbArticles: 0,
          sousFamilles: new Map(),
        };
        noeudG.familles.set(f, noeudF);
      }
      noeudF.nbProduits += 1;
      noeudF.nbArticles += produit.narts.length;

      const sf = produit.sousFamille || "(sans sous-famille)";
      let noeudSF = noeudF.sousFamilles.get(sf);
      if (!noeudSF) {
        noeudSF = { valeur: sf, nbProduits: 0, nbArticles: 0 };
        noeudF.sousFamilles.set(sf, noeudSF);
      }
      noeudSF.nbProduits += 1;
      noeudSF.nbArticles += produit.narts.length;
    }

    const trier = (m) =>
      [...m.values()].sort(
        (a, b) => b.nbProduits - a.nbProduits || a.valeur.localeCompare(b.valeur),
      );

    return {
      disponible: true,
      groupes: trier(racine).map((g) => ({
        ...g,
        familles: trier(g.familles).map((f) => ({
          ...f,
          sousFamilles: trier(f.sousFamilles),
        })),
      })),
    };
  }

  /**
   * Replie une liste d'articles (références) en liste de PRODUITS : une entrée
   * par produit, portant la référence à afficher et les autres déclinaisons.
   *
   * C'est ce qui permet à une liste de catalogue de montrer « verrou de fenêtre
   * à clé » une seule fois au lieu de ses 14 références. Le repli s'applique
   * APRÈS filtrage : `narts` ne contient que les déclinaisons qui ont passé les
   * filtres (chercher « blanc » ne fait pas réapparaître les noires).
   *
   * L'ordre d'entrée est conservé (première occurrence = position du produit) :
   * la liste ne se réorganise pas dans le dos de l'appelant. Au sein d'un
   * produit, la référence mise en avant est la première du catalogue (rôle
   * `rang`), pas la première rencontrée dans le fichier.
   *
   * Un article sans compléments artplus est son propre produit : jamais de
   * regroupement « au hasard ».
   *
   * @returns {Promise<Array<{article, narts: string[], nbVariantesProduit: number}>>}
   */
  async grouperArticles(entreprise, articles) {
    const index = await this.getIndex(entreprise);
    if (!index.present) {
      return articles.map((a) => ({
        article: a,
        narts: [safeTrim(a.NART).toUpperCase()],
        nbVariantesProduit: 1,
      }));
    }

    const cleRang = index.roles.rang;
    const rangDe = (nart) => {
      if (!cleRang) return Number.MAX_SAFE_INTEGER;
      const v = parseFloat((index.parNart.get(nart) || {})[cleRang]);
      return Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER;
    };

    const groupes = new Map(); // clé produit -> entrée
    for (const article of articles) {
      const nart = safeTrim(article.NART).toUpperCase();
      // Sans compléments, l'article ne peut être regroupé avec rien : clé
      // dédiée, impossible à confondre avec une clé de produit.
      const cle = index.produitParNart.get(nart) || `#${nart}`;

      const existant = groupes.get(cle);
      if (!existant) {
        groupes.set(cle, {
          article,
          rang: rangDe(nart),
          narts: [nart],
          nbVariantesProduit: index.produits.get(cle)?.narts.length || 1,
        });
        continue;
      }
      existant.narts.push(nart);
      const rang = rangDe(nart);
      if (rang < existant.rang) {
        existant.article = article;
        existant.rang = rang;
      }
    }

    return [...groupes.values()].map((g) => ({
      article: g.article,
      narts: g.narts.sort((a, b) => rangDe(a) - rangDe(b) || a.localeCompare(b)),
      nbVariantesProduit: g.nbVariantesProduit,
    }));
  }

  /** Un produit par sa clé (`p<id>`, `n<slug-du-nom>` ou `a<NART>`). */
  async getProduit(entreprise, cle) {
    const index = await this.getIndex(entreprise);
    const produit = index.produits.get(safeTrim(cle));
    if (!produit) return null;
    const cacheArticles = await articleCacheService.getArticles(entreprise);
    return this.vueProduit(index, produit, cacheArticles);
  }

  // ── Lectures unitaires ────────────────────────────────────────────────────

  /** Attributs normalisés d'un article. `{}` si l'article n'a pas de compléments. */
  async getAttributs(entreprise, nart) {
    const index = await this.getIndex(entreprise);
    return index.parNart.get(safeTrim(nart).toUpperCase()) || {};
  }

  /**
   * Attributs d'un article dans les deux formes : normalisée (clés stables) et
   * brute (INTITULE d'origine, dans l'ordre du fichier).
   */
  async getAttributsDetail(entreprise, nart) {
    const index = await this.getIndex(entreprise);
    const cle = safeTrim(nart).toUpperCase();
    const attributs = index.parNart.get(cle) || {};
    const brut = index.intitules
      .filter((it) => attributs[it.cle])
      .map((it) => ({
        intitule: it.intitule,
        cle: it.cle,
        role: it.role || "",
        contenu: attributs[it.cle],
      }));
    return { attributs, brut, produitCle: index.produitParNart.get(cle) || "" };
  }

  /** Produit (avec la liste de ses NART) auquel appartient un article. */
  async getProduitDeArticle(entreprise, nart) {
    const index = await this.getIndex(entreprise);
    const cle = index.produitParNart.get(safeTrim(nart).toUpperCase());
    return cle ? index.produits.get(cle) : null;
  }

  /** Vide le cache (une société, ou tout). */
  viderCache(nomDossierDBF) {
    if (nomDossierDBF) this.cache.delete(nomDossierDBF);
    else this.cache.clear();
  }
}

const artplusService = new ArtplusService();
export default artplusService;
export { normaliserIntitule, slug };
