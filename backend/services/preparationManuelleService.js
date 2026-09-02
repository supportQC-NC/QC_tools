// backend/services/preparationManuelleService.js
//
// Lecture DBF du module « Préparation de commande MANUELLE ».
//
// Même source et même périmètre que la préparation scannée
// (backend/services/preparationService.js) : proformas de proforma.dbf dont
// l'ETAT vaut ETAT_A_PREPARER, avec la répartition DOCK (S2) puis MAGASIN (S1)
// de chaque ligne. Ici on ne fait que LIRE : aucune session, aucune saisie.
//
// La différence avec le contrôle réception manuel : sur une fiche de
// préparation les QUANTITÉS SONT IMPRIMÉES (c'est le but — dire à l'agent
// combien prendre) ; la case laissée vide est la colonne « CTRL », où l'agent
// note la quantité réellement prise en cas d'écart.
import fs from "fs";
import path from "path";
import proformaCacheService from "./proformaCacheService.js";
import { analyserProforma } from "./preparationService.js";

// État des proformas « à préparer » (identique au module scanné).
export const ETAT_A_PREPARER = 2;

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const toDate = (v) => proformaCacheService.parseDate(v);

const dateToIso = (d) =>
  d instanceof Date && !isNaN(d.getTime()) ? d.toISOString() : null;

// Libellé d'état depuis le mapping personnalisé de l'entreprise (Map ou objet).
// ⚠️ Jamais de libellé en dur : les états proforma varient d'une société à
// l'autre (fiche société, onglet « États »).
const etatLabel = (entreprise, etat) => {
  try {
    const map = entreprise.mappingEtatsProforma;
    if (map && typeof map.get === "function") return map.get(String(etat)) || "";
    if (map && typeof map === "object") return map[String(etat)] || "";
  } catch {
    /* mapping absent */
  }
  return "";
};

// Identité du vendeur (proforma.REPRES) via le dictionnaire de la fiche société.
// `vendeurs[].code` est une chaîne (« 05 »), REPRES un numérique : comparaison
// numérique obligatoire.
const resolveVendeur = (entreprise, repres) => {
  const brut = safeTrim(repres);
  const code = Number(repres);
  if (!Number.isFinite(code)) return { code: brut, nom: "" };
  const v = (entreprise.vendeurs || []).find((x) => Number(x.code) === code);
  const nom = v ? [v.prenom, v.nom].filter(Boolean).join(" ").trim() : "";
  return { code: brut || String(code), nom };
};

// Vérifie la présence des DBF de proformas de la société.
export const checkProformaFiles = (entreprise) => {
  const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
  for (const fichier of ["proforma.dbf", "prodet.dbf"]) {
    if (!fs.existsSync(path.join(basePath, fichier))) {
      return {
        exists: false,
        error: `Fichier ${fichier} non trouvé pour ${entreprise.nomComplet}`,
      };
    }
  }
  return { exists: true };
};

/**
 * Liste paginée des proformas à préparer (ETAT = 2), les plus récentes d'abord.
 * Les compteurs de lignes / unités viennent de l'index prodet du cache (O(1)),
 * on ne relit donc jamais le DBF ligne à ligne pour l'écran de liste.
 *
 * @param {object} entreprise document Entreprise
 * @param {object} options    { page, limit, search }
 */
export const listerProformas = async (entreprise, options = {}) => {
  const page = parseInt(options.page, 10) || 1;
  const limit = parseInt(options.limit, 10) || 50;
  const search = safeTrim(options.search).toLowerCase();

  const cache = await proformaCacheService.getProformas(entreprise);

  const resultats = cache.proformaRecords.filter((record) => {
    if (Number(record.ETAT) !== ETAT_A_PREPARER) return false;
    if (search) {
      const champs = [record.NUMFACT, record.NOM, record.TEXTE]
        .map((c) => safeTrim(c).toLowerCase())
        .join(" ");
      if (!champs.includes(search)) return false;
    }
    return true;
  });

  // Les plus récentes en tête (les proformas sans date partent en fin).
  resultats.sort((a, b) => {
    const ta = toDate(a.DATFACT)?.getTime() ?? -Infinity;
    const tb = toDate(b.DATFACT)?.getTime() ?? -Infinity;
    if (ta !== tb) return tb - ta;
    return safeTrim(b.NUMFACT).localeCompare(safeTrim(a.NUMFACT));
  });

  const totalRecords = resultats.length;
  const startIndex = (page - 1) * limit;
  const paginated = resultats.slice(startIndex, startIndex + limit);

  const proformas = paginated.map((record) => {
    const numfact = safeTrim(record.NUMFACT);
    const etat = parseInt(record.ETAT, 10);
    const vendeur = resolveVendeur(entreprise, record.REPRES);

    let nbLignes = 0;
    let totalUnites = 0;
    (cache.prodetByNumfact.get(numfact) || []).forEach((l) => {
      if (proformaCacheService.isCommentLine(l)) return;
      nbLignes += 1;
      totalUnites += num(l.QTE);
    });

    return {
      numfact,
      clientNom: safeTrim(record.NOM),
      clientCode:
        record.TIERS != null && record.TIERS !== ""
          ? Number(record.TIERS)
          : null,
      vendeurCode: vendeur.code,
      vendeurNom: vendeur.nom,
      datfact: dateToIso(toDate(record.DATFACT)),
      texte: safeTrim(record.TEXTE),
      etat: isNaN(etat) ? null : etat,
      etatLabel: etatLabel(entreprise, etat),
      nbLignes,
      totalUnites: Math.round(totalUnites),
    };
  });

  return {
    etatAPreparer: ETAT_A_PREPARER,
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
      hasNextPage: startIndex + limit < totalRecords,
      hasPrevPage: page > 1,
    },
    proformas,
  };
};

/**
 * Entête + lignes de préparation d'une proforma, prêtes pour la fiche papier.
 *
 * Le parcours est TOUJOURS dock d'abord, magasin ensuite : la répartition et
 * l'ordonnancement (gisement / priorité) viennent de `analyserProforma`, qui
 * sert déjà la préparation scannée — on ne duplique pas la règle métier.
 * Un même article peut donc apparaître DEUX fois : une ligne dock pour la part
 * disponible en S2, une ligne magasin pour le reste.
 *
 * @returns {Promise<{entete, commentaires, lignesDock, lignesMagasin, totaux}>}
 *          entete = null si la proforma est introuvable.
 */
export const getPreparationComplete = async (entreprise, numpro) => {
  const numfact = safeTrim(numpro);
  const vide = {
    entete: null,
    commentaires: [],
    lignesDock: [],
    lignesMagasin: [],
    totaux: null,
  };

  const record = await proformaCacheService.findByNumfact(entreprise, numfact);
  if (!record) return vide;

  let analyse;
  try {
    analyse = await analyserProforma(entreprise, numfact);
  } catch (e) {
    if (e?.status === 404) return vide;
    throw e;
  }

  // Lignes de commentaire de la proforma (NART vide ou contenant « ! ») :
  // analyserProforma les écarte, on les récupère telles quelles depuis le
  // cache (index O(1), aucune relecture DBF).
  const cache = await proformaCacheService.getProformas(entreprise);
  const commentaires = [];
  for (const l of cache.prodetByNumfact.get(numfact) || []) {
    if (!proformaCacheService.isCommentLine(l)) continue;
    const texte = safeTrim(l.DESIGN);
    if (texte) commentaires.push(texte);
  }
  const texteEntete = safeTrim(record.TEXTE);
  if (texteEntete) commentaires.unshift(texteEntete);

  // Projection « fiche » : une entrée par zone de prélèvement, avec la quantité
  // à prendre DANS CETTE zone et le stock de la zone (repère pour l'agent).
  const projeter = (l, zone) => {
    const aPrendre =
      zone === "dock" ? l.qteDockAPreparer || 0 : l.qteMagasinAPreparer || 0;
    const stockZone = zone === "dock" ? l.stockDock || 0 : l.stockMagasin || 0;
    return {
      zone,
      ordre: zone === "dock" ? l.ordreDock : l.ordreMagasin,
      nl: l.nl,
      nart: l.nart,
      designation: l.designation,
      refer: l.refer,
      gencod: l.gencod,
      gism1: l.gism1,
      rayon: l.rayon,
      sousRayon: l.sousRayon,
      qteCommandee: l.qteCommandee,
      aPrendre,
      stockZone,
      stockDock: l.stockDock || 0,
      stockMagasin: l.stockMagasin || 0,
      // Part demandée que le stock de la zone ne couvre pas : l'agent doit le
      // voir AVANT de chercher (rupture probable), pas le découvrir au rayon.
      manquant: Math.max(0, aPrendre - stockZone),
      // Le même article est aussi à prendre dans l'autre zone.
      autreZone:
        zone === "dock"
          ? (l.qteMagasinAPreparer || 0) > 0
          : (l.qteDockAPreparer || 0) > 0,
    };
  };

  const parOrdre = (a, b) =>
    (a.ordre ?? Number.POSITIVE_INFINITY) -
      (b.ordre ?? Number.POSITIVE_INFINITY) || a.nl - b.nl;

  const lignesDock = analyse.lignes
    .filter((l) => (l.qteDockAPreparer || 0) > 0)
    .map((l) => projeter(l, "dock"))
    .sort(parOrdre);

  const lignesMagasin = analyse.lignes
    .filter((l) => (l.qteMagasinAPreparer || 0) > 0)
    .map((l) => projeter(l, "magasin"))
    .sort(parOrdre);

  const somme = (lignes) => lignes.reduce((s, l) => s + l.aPrendre, 0);
  const etat = record.ETAT != null ? Number(record.ETAT) : null;
  const vendeur = resolveVendeur(entreprise, record.REPRES);

  return {
    entete: {
      numfact: analyse.proformaInfo.numfact,
      clientNom: analyse.proformaInfo.clientNom,
      clientCode: analyse.proformaInfo.clientCode,
      vendeurCode: vendeur.code,
      vendeurNom: vendeur.nom,
      datfact: analyse.proformaInfo.datfact,
      etat: Number.isFinite(etat) ? etat : null,
      etatLabel: etatLabel(entreprise, etat),
      texte: texteEntete,
      mailings: analyse.proformaInfo.mailings,
    },
    commentaires,
    lignesDock,
    lignesMagasin,
    totaux: {
      nbArticles: analyse.lignes.length,
      nbLignesFiche: lignesDock.length + lignesMagasin.length,
      totalDemande: Math.round(
        analyse.lignes.reduce((s, l) => s + (l.qteCommandee || 0), 0),
      ),
      totalDock: Math.round(somme(lignesDock)),
      totalMagasin: Math.round(somme(lignesMagasin)),
      nbManquants:
        lignesDock.filter((l) => l.manquant > 0).length +
        lignesMagasin.filter((l) => l.manquant > 0).length,
    },
  };
};

export default {
  ETAT_A_PREPARER,
  checkProformaFiles,
  listerProformas,
  getPreparationComplete,
};
