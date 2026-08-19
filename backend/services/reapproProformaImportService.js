// backend/services/reapproProformaImportService.js
//
// Source « proforma » des listes de réappro (CDC §2).
//
// Toute proforma dont l'OBSERVATION (`proforma.TEXTE`) commence par « reappro »
// est une liste de réappro. Le job horaire relit proforma.dbf/prodet.dbf et crée
// les listes manquantes.
//
// Constats terrain (mesurés sur la base QC, août 2026) :
//  - 1 147 proformas « reappro » depuis 2019, ~115 par an → volume raisonnable ;
//  - la répartition par ETAT est 1117 × 1, 29 × 2, 1 × 3 : se limiter à ETAT 2
//    (l'état « commande à préparer » de la prépa de commande) raterait 97 % des
//    réappros. On prend donc TOUS les états SAUF les devis (3 et 4) ;
//  - `TIERS` vaut 9900 (compte interne) et `REPRES` porte le code vendeur, qui
//    donne le « qui a poussé la liste » via le dictionnaire `entreprise.vendeurs`.
//
// L'ERP ne purge jamais ces tables : on ne remonte donc que les proformas des
// FENETRE_JOURS derniers jours, sinon le premier passage crée 1 147 listes.
//
// Lecture seule sur les DBF ; la seule écriture est la collection DemandeReappro.
import DemandeReappro from "../models/DemandeReapproModel.js";
import proformaCacheService from "./proformaCacheService.js";
import articleCacheService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";

const PREFIXE_OBSERVATION = "reappro";
const ETATS_DEVIS = new Set([3, 4]);
export const FENETRE_JOURS = 15;

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// « Réappro », « REAPPRO », « réappro » … tout se ramène à la même forme.
const normaliser = (v) =>
  safeTrim(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // diacritiques

const estListeReappro = (p) =>
  normaliser(p.TEXTE).startsWith(PREFIXE_OBSERVATION) &&
  !ETATS_DEVIS.has(Number(p.ETAT));

const toDate = (v) => {
  try {
    const d = proformaCacheService.parseDate(v);
    if (d) return d;
  } catch {
    /* repli ci-dessous */
  }
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

// Nom du demandeur à partir du code vendeur (REPRES) de la proforma.
const nomVendeur = (entreprise, repres) => {
  const code = Number(repres);
  if (!Number.isFinite(code)) return "Proforma";
  const v = (entreprise.vendeurs || []).find(
    (x) => Number(x.code) === code,
  );
  const nom = v ? [v.prenom, v.nom].filter(Boolean).join(" ").trim() : "";
  return nom || `Vendeur ${repres}`;
};

/**
 * Construit les lignes d'une liste à partir des lignes prodet d'une proforma.
 * Les doublons de NART sont cumulés ; les lignes de commentaire sont ignorées.
 */
const construireArticles = async (entreprise, lignesProdet) => {
  const parNart = new Map();

  for (const d of lignesProdet || []) {
    if (proformaCacheService.isCommentLine(d)) continue;
    const nart = safeTrim(d.NART).toUpperCase();
    if (!nart) continue;
    const q = Math.round(num(d.QTE));
    if (q <= 0) continue;

    const dejaVu = parNart.get(nart);
    if (dejaVu) {
      dejaVu.quantiteDemandee += q;
      continue;
    }

    // getProdetByNumfact a déjà résolu l'article (`_articleInfo`) : on ne
    // refait la recherche que si la ligne vient d'ailleurs.
    let article = d._articleInfo || null;
    if (!article) {
      try {
        // eslint-disable-next-line no-await-in-loop
        article = await articleCacheService.findByNart(entreprise, nart);
      } catch {
        /* base articles indisponible : la ligne est conservée sans détail */
      }
    }

    let fournNom = "";
    if (article && article.FOURN !== undefined && article.FOURN !== null) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const f = await fournissCacheService.findByFourn(
          entreprise,
          article.FOURN,
        );
        fournNom = f ? safeTrim(f.NOM) : "";
      } catch {
        /* nom fournisseur facultatif */
      }
    }

    const s1 = article ? num(article.S1) : 0;
    const s2 = article ? num(article.S2) : 0;
    const s3 = article ? num(article.S3) : 0;
    const s4 = article ? num(article.S4) : 0;
    const s5 = article ? num(article.S5) : 0;

    parNart.set(nart, {
      nart,
      design: article ? safeTrim(article.DESIGN) : safeTrim(d.DESIGN),
      fourn:
        article && article.FOURN != null ? String(article.FOURN).trim() : "",
      fournNom,
      gencod: article ? safeTrim(article.GENCOD) : "",
      refer: article ? safeTrim(article.REFER) : "",
      s1, s2, s3, s4, s5,
      stock: s1 + s2 + s3 + s4 + s5,
      quantiteDemandee: q,
      vteMoyMois: 0,
    });
  }

  return [...parNart.values()];
};

// Empreinte du contenu : sert à ne resynchroniser que si la proforma a bougé.
const signature = (articles) =>
  (articles || [])
    .map((a) => `${a.nart}:${Math.round(a.quantiteDemandee)}`)
    .join("|");

/**
 * Importe les listes de réappro d'une société depuis ses proformas.
 *
 * - crée les listes manquantes (clé : entreprise + NUMFACT) ;
 * - resynchronise celles encore « à faire » si la proforma a changé ;
 * - supprime celles encore « à faire » dont la proforma n'est plus éligible
 *   (passée en devis, observation modifiée, document disparu). Une liste déjà
 *   ouverte par un opérateur n'est JAMAIS touchée.
 *
 * @returns {{crees:number, majs:number, supprimes:number, candidats:number, dureeMs:number}}
 */
export const importerProformasReappro = async (entreprise, options = {}) => {
  const debut = Date.now();
  const { fenetreJours = FENETRE_JOURS } = options;
  const key = entreprise.nomDossierDBF;

  const cache = await proformaCacheService.getProformas(entreprise);
  const plancher = new Date();
  plancher.setDate(plancher.getDate() - fenetreJours);
  plancher.setHours(0, 0, 0, 0);

  // Toutes les proformas (pour juger les listes déjà importées), et celles
  // qui sont éligibles dans la fenêtre (pour créer/mettre à jour).
  const parNumfact = new Map();
  const candidats = [];
  for (const p of cache.proformaRecords || []) {
    const numfact = safeTrim(p.NUMFACT);
    if (!numfact) continue;
    parNumfact.set(numfact, p);
    if (!estListeReappro(p)) continue;
    const dat = toDate(p.DATFACT);
    if (fenetreJours > 0 && (!dat || dat < plancher)) continue;
    candidats.push({ numfact, p, dat });
  }

  let crees = 0;
  let majs = 0;
  let supprimes = 0;

  for (const { numfact, p } of candidats) {
    // eslint-disable-next-line no-await-in-loop
    const existante = await DemandeReappro.findOne({
      entreprise: key,
      source: "proforma",
      sourceRef: numfact,
    });

    // Une liste en cours ou terminée n'est plus resynchronisée.
    if (existante && existante.statut !== "en_attente") continue;

    // eslint-disable-next-line no-await-in-loop
    const lignes = await proformaCacheService.getProdetByNumfact(
      entreprise,
      numfact,
    );
    // eslint-disable-next-line no-await-in-loop
    const articles = await construireArticles(entreprise, lignes);
    if (articles.length === 0) continue; // proforma vide : rien à préparer

    if (!existante) {
      const liste = new DemandeReappro({
        entreprise: key,
        type: "magasin",
        gisement: "Proforma",
        nom: safeTrim(p.TEXTE) || `Réappro proforma ${numfact}`,
        rayon: "",
        source: "proforma",
        sourceRef: numfact,
        // Une liste importée n'a pas de gisement parlant : on nomme son
        // fichier de transfert d'après le n° de proforma (modifiable ensuite).
        nommageTransfert: "proforma",
        priorite: "a_faire",
        statut: "en_attente",
        articles,
        commentaire: safeTrim(p.NOM),
        createdByNom: nomVendeur(entreprise, p.REPRES),
      });
      liste.calculerTotaux();
      try {
        // eslint-disable-next-line no-await-in-loop
        await liste.save();
        crees += 1;
      } catch (e) {
        // 11000 = deux passages simultanés sur la même proforma : sans gravité.
        if (e.code !== 11000) throw e;
      }
      continue;
    }

    if (signature(existante.articles) !== signature(articles)) {
      existante.articles = articles;
      existante.nom = safeTrim(p.TEXTE) || existante.nom;
      existante.calculerTotaux();
      // eslint-disable-next-line no-await-in-loop
      await existante.save();
      majs += 1;
    }
  }

  // Listes encore « à faire » dont la proforma n'est plus éligible.
  const importees = await DemandeReappro.find({
    entreprise: key,
    source: "proforma",
    statut: "en_attente",
  }).select("sourceRef");
  for (const l of importees) {
    const p = parNumfact.get(safeTrim(l.sourceRef));
    if (p && estListeReappro(p)) continue; // toujours valable
    if (!p && parNumfact.size === 0) continue; // lecture DBF douteuse : on ne touche à rien
    // eslint-disable-next-line no-await-in-loop
    await DemandeReappro.deleteOne({ _id: l._id });
    supprimes += 1;
  }

  return {
    crees,
    majs,
    supprimes,
    candidats: candidats.length,
    dureeMs: Date.now() - debut,
  };
};

export default { importerProformasReappro, FENETRE_JOURS };
