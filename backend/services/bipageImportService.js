// backend/services/bipageImportService.js
//
// Deux sources d'alimentation du comptage, en plus des fichiers .DAT déposés
// par le collecteur :
//
//   1. PROFORMA (lecture DBF) — on choisit une plage de dates et un ou plusieurs
//      numéros de client, puis on prend la proforma voulue dans la liste.
//   2. FICHIER EXCEL — deux colonnes, CODE et QUANTITE.
//
// ⚠️ LA ZONE EST TOUJOURS CHOISIE DANS L'ÉCRAN, jamais devinée (décision client
// du 08/09/2026). Avant, elle était lue dans le NOM du fichier Excel
// (« bipage_12_A_1_MAGASIN.xlsx ») et dans l'observation de la proforma : un
// fichier mal nommé était refusé, et la moitié des proformas étaient déclarées
// « non conformes » alors qu'on avait la liste des zones sous les yeux. Le nom
// du fichier et l'observation ne servent donc plus qu'à SUGGÉRER une zone.
//
// Dans les deux cas les lignes produites sont des `LigneBipage` rattachées à la
// SESSION D'INVENTAIRE ACTIVE, exactement comme celles issues d'un .DAT : elles
// s'affichent, se corrigent et s'exportent de la même façon.
//
// ⚠️ Aucune écriture DBF : l'ERP reste en lecture seule.
import ExcelJS from "exceljs";
import proformaCacheService from "./proformaCacheService.js";
import { construireLignes } from "./ficheControleService.js";
import Zone from "../models/ZoneModel.js";
import LigneBipage from "../models/LigneBipageModel.js";
import InventaireCollecte from "../models/InventaireCollecteModel.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";

const trim = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ────────────────────────────────────────────────────────────────────────────
// CONVENTION DE NOMMAGE — commune aux deux imports
//
//   <code de zone>_<EMPLACEMENT>       ex. A_1_MAGASIN, B_5d_DOCK
//
// Le code de zone est TOUT ce qui précède le DERNIER « _ » (les codes en
// contiennent eux-mêmes : A_1, B_5d) ; ce qui suit désigne l'emplacement.
// C'est exactement la règle des fichiers .dat déposés par le collecteur — une
// seule convention à retenir dans toute l'application.
//
// ⚠️ GARDE-FOU : on n'accepte le découpage que si la partie qui suit le dernier
// « _ » est un emplacement RÉELLEMENT utilisé par la société (MAGASIN, DOCK…).
// Sans ça, n'importe quelle observation contenant un « _ » serait prise pour
// une zone — c'est le risque assumé d'une convention sans préfixe.
// ────────────────────────────────────────────────────────────────────────────

/** Emplacements existants de la société (valeurs distinctes de Zone.type). */
export const getEmplacements = async (entrepriseId) => {
  const types = await Zone.distinct("type", { entreprise: entrepriseId });
  return types.map((t) => trim(t)).filter(Boolean);
};

/**
 * Zones existantes (code + emplacement), pour que l'écran puisse proposer une
 * liste de choix quand l'observation d'une proforma ne dit pas où elle a été
 * bipée : l'utilisateur complète alors la zone à la main.
 */
export const getZones = async (entrepriseId) => {
  const zones = await Zone.find({ entreprise: entrepriseId }, "code type").lean();
  return zones
    .map((z) => ({ code: trim(z.code), emplacement: trim(z.type) }))
    .filter((z) => z.code && z.emplacement)
    .sort(
      (a, b) =>
        a.emplacement.localeCompare(b.emplacement) ||
        a.code.localeCompare(b.code, "fr", { numeric: true }),
    );
};

/**
 * Découpe "<zone>_<EMPLACEMENT>".
 * @returns { zoneCode, emplacement } ou null si la convention n'est pas respectée.
 */
export const parserZoneEmplacement = (texte, emplacements = []) => {
  const valeur = trim(texte);
  if (!valeur) return null;
  const sep = valeur.lastIndexOf("_");
  if (sep <= 0) return null;

  const zoneCode = valeur.slice(0, sep).trim();
  const emplacement = valeur.slice(sep + 1).trim();
  if (!zoneCode || !emplacement) return null;

  const connu = emplacements.find(
    (e) => e.toLowerCase() === emplacement.toLowerCase(),
  );
  if (!connu) return null;

  return { zoneCode, emplacement: connu };
};

/** Nom lisible d'un agent à partir de son code vendeur (REPRES). */
export const nomAgent = (entreprise, code) => {
  const c = trim(code);
  if (!c) return "";
  const vendeurs = entreprise.vendeurs || [];
  // Le code REPRES est numérique dans le DBF ("8") et souvent stocké sur deux
  // caractères dans le dictionnaire des vendeurs ("08") : on compare les deux.
  const v = vendeurs.find(
    (x) => trim(x.code) === c || trim(x.code) === c.padStart(2, "0"),
  );
  // Repli quand l'onglet Vendeurs de la fiche société n'est pas renseigné :
  // même formulation que le module réappro, pour ne jamais afficher un vide.
  if (!v) return `Vendeur ${c}`;
  return `${trim(v.prenom)} ${trim(v.nom)}`.trim() || `Vendeur ${trim(v.code)}`;
};

// ────────────────────────────────────────────────────────────────────────────
// SOURCE 1 — PROFORMAS
// ────────────────────────────────────────────────────────────────────────────

// Dans proforma.dbf, l'observation saisie dans l'ERP est le champ TEXTE (C60) —
// il n'existe pas de champ nommé OBSERV.
const CHAMP_OBSERVATION = "TEXTE";

/**
 * Une ligne de `prodet` est-elle un ARTICLE à compter ?
 *
 * Deux formes de lignes de commentaire cohabitent dans les proformas de l'ERP :
 *  - NART vide (ligne de texte libre) ;
 *  - NART contenant « ! » — c'est la convention de saisie des commentaires
 *    (constatée sur les proformas QC, confirmée par le client le 09/09/2026).
 * Aucune des deux ne doit produire de LigneBipage : ce ne sont pas des
 * articles, elles n'ont pas de stock, et elles ressortiraient en « article
 * inconnu » dans le détail des bipages et sur la fiche de contrôle.
 */
const estLigneArticle = (ligne) => {
  const nart = trim(ligne?.NART);
  return !!nart && !nart.includes("!");
};

/** Les seules lignes d'une proforma qui comptent comme des articles. */
const lignesArticles = (cache, numfact) =>
  (cache.prodetByNumfact.get(numfact) || []).filter(estLigneArticle);

const memeJour = (d) => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return null;
  return dt;
};

/**
 * Résout la zone visée par un import. La zone est CHOISIE dans l'écran : on
 * exige donc son code, et son emplacement dès que la société en utilise
 * plusieurs (le même code peut exister en MAGASIN et en DOCK).
 */
export const resoudreZoneImport = async (entrepriseId, zoneCode, emplacement) => {
  const code = trim(zoneCode);
  if (!code) {
    throw new Error("Aucune zone choisie : sélectionnez la zone avant d'importer.");
  }
  const empl = trim(emplacement);
  const requete = { entreprise: entrepriseId, code };
  if (empl) requete.type = empl;

  const candidates = await Zone.find(requete);
  if (candidates.length === 0) {
    throw new Error(
      `Zone ${code}${empl ? ` (${empl})` : ""} inconnue pour cette société.`,
    );
  }
  if (candidates.length > 1) {
    // Code présent à plusieurs emplacements et aucun n'a été précisé : on ne
    // devine pas, le comptage atterrirait une fois sur deux au mauvais endroit.
    throw new Error(
      `La zone ${code} existe à plusieurs emplacements (${candidates
        .map((z) => z.type || "sans emplacement")
        .join(", ")}) : précisez lequel.`,
    );
  }
  return candidates[0];
};

/**
 * Une zone n'a « jamais été comptée » si rien ne la concerne dans la session :
 * ni ligne bipée (collecteur, Excel ou proforma), ni collecte ouverte ou
 * déposée sur le collecteur.
 *
 * ⚠️ Le test sur les collectes n'est pas redondant : en production le fichier
 * .DAT est traité par le poste d'impression, donc une zone peut avoir été
 * déposée par un agent sans qu'aucune LigneBipage n'existe encore.
 */
export const zoneJamaisComptee = async (session, zone) => {
  const dejaBipee = await LigneBipage.exists({
    session: session._id,
    zoneCode: zone.code,
    zoneType: zone.type || "",
  });
  if (dejaBipee) return false;

  const dejaCollectee = await InventaireCollecte.exists({
    session: session._id,
    zoneCode: zone.code,
    zoneType: zone.type || "",
  });
  return !dejaCollectee;
};

/**
 * Marque « papillonnage » et « bipage » comme faits sur une zone de la session.
 *
 * POURQUOI : un comptage importé (Excel ou proforma) remplace le passage de
 * l'agent au collecteur. Sans ce marquage, la zone resterait rouge dans le
 * récapitulatif et le suivi réclamerait éternellement des coupons qui
 * n'existent pas — l'équipe n'ayant pas travaillé avec la fiche papier.
 * La phase « contrôle » n'est PAS cochée : elle reste à faire, un import ne
 * vérifie rien.
 *
 * Le marquage n'a lieu qu'au PREMIER comptage de la zone : un import qui vient
 * s'ajouter à un comptage existant ne réécrit ni l'heure ni l'auteur.
 */
export const marquerPhasesImport = async (session, zone, userId) => {
  const cible = (session.zones || []).find(
    (z) => z.code === zone.code && (z.type || "") === (zone.type || ""),
  );
  if (!cible) return [];

  const marquees = [];
  ["papillonnage", "bipage"].forEach((phase) => {
    if (!cible[phase] || !cible[phase].fait) {
      cible[phase].fait = true;
      cible[phase].at = new Date();
      cible[phase].by = userId || null;
      marquees.push(phase);
    }
  });

  if (marquees.length) {
    session.markModified("zones");
    await session.save();
  }
  return marquees;
};

/**
 * Proformas candidates : plage de dates (DATFACT) + numéros de client (TIERS).
 * Chaque proforma est renvoyée AVEC le verdict de lecture de son observation,
 * pour que l'écran puisse expliquer pourquoi une proforma n'est pas éligible.
 */
export const getProformasEligibles = async (entreprise, options = {}) => {
  const { dateDebut, dateFin, clients = [] } = options;

  const cache = await proformaCacheService.getProformas(entreprise);
  const emplacements = await getEmplacements(entreprise._id);
  const zones = await getZones(entreprise._id);

  const debut = memeJour(dateDebut);
  const fin = memeJour(dateFin);
  if (fin) fin.setHours(23, 59, 59, 999);

  const listeClients = (Array.isArray(clients) ? clients : [clients])
    .map((c) => trim(c))
    .filter(Boolean);

  // Restriction par client via l'index TIERS quand on en a (bien plus rapide
  // qu'un balayage complet : proforma.dbf fait ~80 000 lignes chez QC).
  let indices = null;
  if (listeClients.length) {
    indices = [];
    for (const c of listeClients) {
      const idx = cache.indexByTiers.get(String(Number(c))) || [];
      indices.push(...idx);
    }
    indices = [...new Set(indices)];
  }

  const source = indices
    ? indices.map((i) => cache.proformaRecords[i])
    : cache.proformaRecords;

  const proformas = [];
  for (const p of source) {
    if (!p) continue;
    const date = memeJour(p.DATFACT);
    if (debut && (!date || date < debut)) continue;
    if (fin && (!date || date > fin)) continue;

    const observation = trim(p[CHAMP_OBSERVATION]);
    const lecture = parserZoneEmplacement(observation, emplacements);
    const numfact = trim(p.NUMFACT);
    // Compte les ARTICLES, pas les lignes du document : une proforma faite de
    // commentaires seuls annoncerait sinon des lignes qu'aucun import ne
    // produirait.
    const lignes = lignesArticles(cache, numfact);

    proformas.push({
      numfact,
      datfact: p.DATFACT || null,
      tiers: p.TIERS ?? null,
      nomClient: trim(p.NOM),
      etat: p.ETAT ?? null,
      observation,
      montant: p.MONTANT ?? 0,
      nbLignes: lignes.length,
      agentCode: trim(p.REPRES),
      agentNom: nomAgent(entreprise, p.REPRES),
      zoneCode: lecture ? lecture.zoneCode : "",
      emplacement: lecture ? lecture.emplacement : "",
      // La zone étant choisie dans l'écran, TOUTE proforma qui porte au moins
      // une ligne article est intégrable. L'observation ne sert plus qu'à
      // proposer une zone par défaut (`zoneCode`/`emplacement` ci-dessus).
      eligible: lignes.length > 0,
      raison: lignes.length === 0 ? "Proforma sans ligne article" : "",
    });
  }

  proformas.sort((a, b) => new Date(b.datfact || 0) - new Date(a.datfact || 0));
  return {
    emplacements,
    zones,
    total: proformas.length,
    nbEligibles: proformas.filter((p) => p.eligible).length,
    proformas,
  };
};

/**
 * État des phases d'une zone dans la session, pour prévenir AVANT d'importer.
 * Une zone déjà contrôlée est le cas sensible : le contrôle a porté sur un
 * comptage donné, le modifier après coup invalide ce contrôle.
 */
export const etatZoneImport = (session, zone) => {
  const cible = (session.zones || []).find(
    (z) => z.code === zone.code && (z.type || "") === (zone.type || ""),
  );
  const lire = (phase) => ({
    fait: !!cible?.[phase]?.fait,
    at: cible?.[phase]?.at || null,
  });
  return {
    papillonnage: lire("papillonnage"),
    bipage: lire("bipage"),
    controle: lire("controle"),
  };
};

/**
 * Clé de rapprochement d'un article entre le comptage existant et l'import.
 * Le NART résolu par le catalogue fait foi ; à défaut (article inconnu de
 * l'ERP) on retombe sur le code brut. ⚠️ Comparaison seulement : on ne touche
 * ni aux zéros de tête ni à la casse des valeurs stockées.
 */
const cleArticle = (nart, code) => (trim(nart) || trim(code)).toUpperCase();

/** Référence d'import d'une proforma (clé d'idempotence). */
const referenceProforma = (numfact, zoneCode, emplacement, deduction) =>
  `${deduction ? "deduction proforma" : "proforma"} ${numfact} ${zoneCode}${
    emplacement ? `_${emplacement}` : ""
  }`;

/**
 * Ce qui est DÉJÀ compté sur une zone, article par article, toutes sources
 * confondues (collecteur, Excel, proformas déjà intégrées).
 *
 * `referencesExclues` : les lignes qu'un ré-import va REMPLACER ne doivent pas
 * compter comme « déjà là », sinon l'aperçu annoncerait un résultat faux au
 * second passage.
 */
export const comptageExistant = async (session, zone, referencesExclues = []) => {
  const filtre = {
    session: session._id,
    zoneCode: zone.code,
    zoneType: zone.type || "",
  };
  if (referencesExclues.length) {
    filtre.datFileName = { $nin: referencesExclues };
  }
  const lignes = await LigneBipage.find(filtre)
    .select("nart eanArticle qteScan designation")
    .lean();

  const parArticle = new Map();
  for (const l of lignes) {
    const cle = cleArticle(l.nart, l.eanArticle);
    if (!cle) continue;
    const acc = parArticle.get(cle) || { quantite: 0, designation: "" };
    acc.quantite += Number(l.qteScan) || 0;
    if (!acc.designation && l.designation) acc.designation = l.designation;
    parArticle.set(cle, acc);
  }
  return parArticle;
};

/**
 * APERÇU d'un import de proformas : ce que l'opération va changer, article par
 * article, SANS RIEN ÉCRIRE.
 *
 * POURQUOI : en mode déduction surtout, la question n'est pas « combien la
 * proforma porte-t-elle » mais « que restera-t-il sur la zone ». On rapproche
 * donc le mouvement du comptage déjà en place et on signale les deux cas qui
 * demandent une décision humaine :
 *   · `nouveau`  — l'article n'a jamais été compté sur cette zone (en
 *     déduction, retirer ce qui n'a pas été compté donne un résultat négatif) ;
 *   · `negatif`  — la déduction dépasse ce qui était compté.
 * On ne borne PAS la déduction au comptage existant : un résultat négatif est
 * une anomalie de terrain qu'il faut voir, pas un chiffre à corriger en douce.
 */
export const previsualiserImportProformas = async (
  entreprise,
  session,
  zone,
  selection = [],
  mode = "inventaire",
) => {
  const deduction = mode === "deduction";
  const zoneCode = trim(zone?.code);
  const emplacement = trim(zone?.type);

  const numfacts = [];
  const vus = new Set();
  for (const brut of Array.isArray(selection) ? selection : [selection]) {
    const numfact =
      brut && typeof brut === "object" ? trim(brut.numfact) : trim(brut);
    if (!numfact || vus.has(numfact)) continue;
    vus.add(numfact);
    numfacts.push(numfact);
  }

  const etat = etatZoneImport(session, zone);
  const references = numfacts.map((n) =>
    referenceProforma(n, zoneCode, emplacement, deduction),
  );
  const dejaCompte = await comptageExistant(session, zone, references);

  // ⚠️ Cas piégeux : en production le .DAT du collecteur est traité par le poste
  // d'impression. Une zone peut donc avoir été DÉPOSÉE sans qu'aucune
  // LigneBipage n'existe encore — l'aperçu annoncerait alors « 0 déjà compté »
  // et toutes les références en « nouvelle ». On le signale plutôt que de
  // laisser lire un chiffre faux.
  const comptageEnAttente =
    dejaCompte.size === 0 &&
    !!(await InventaireCollecte.exists({
      session: session._id,
      zoneCode: zone.code,
      zoneType: zone.type || "",
    }));

  const cache = await proformaCacheService.getProformas(entreprise);

  // Mouvement cumulé de la sélection, article par article.
  const mouvements = new Map();
  const proformas = [];
  for (const numfact of numfacts) {
    const idx = cache.indexByNumfact.get(numfact);
    const p = idx !== undefined ? cache.proformaRecords[idx] : null;
    if (!p) {
      proformas.push({
        numfact,
        statut: "erreur",
        message: "Proforma introuvable",
      });
      continue;
    }
    const aCompter = lignesArticles(cache, numfact).map((l) => ({
      code: trim(l.NART),
      quantite: Number(l.QTE) || 0,
    }));
    if (!aCompter.length) {
      proformas.push({
        numfact,
        statut: "erreur",
        message: "Aucune ligne article",
      });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const { rows } = await construireLignes(entreprise, aCompter);
    for (const r of rows) {
      const cle = cleArticle(r.nart === "-" ? "" : r.nart, r.code);
      if (!cle) continue;
      const acc = mouvements.get(cle) || {
        cle,
        code: r.code,
        nart: r.nart === "-" ? "" : r.nart,
        designation: r.designation,
        stock: typeof r.stock === "number" ? r.stock : null,
        inconnu: !!r.nonTrouve,
        quantite: 0,
      };
      acc.quantite += r.qte;
      if (!acc.designation && r.designation) acc.designation = r.designation;
      mouvements.set(cle, acc);
    }

    proformas.push({
      numfact,
      statut: "ok",
      datfact: p.DATFACT || null,
      tiers: trim(p.TIERS),
      nomClient: trim(p.NOM),
      lignes: rows.length,
      unites: rows.reduce((t, r) => t + r.qte, 0),
    });
  }

  const articles = [...mouvements.values()].map((m) => {
    const avant = dejaCompte.get(m.cle)?.quantite || 0;
    const mouvement = deduction ? -m.quantite : m.quantite;
    const apres = avant + mouvement;
    return {
      code: m.code,
      nart: m.nart,
      designation: m.designation || dejaCompte.get(m.cle)?.designation || "",
      stock: m.stock,
      inconnu: m.inconnu,
      avant,
      mouvement,
      apres,
      // Jamais compté sur cette zone : en comptage c'est une référence qui
      // s'ajoute, en déduction c'est un retrait « à vide ».
      nouveau: !dejaCompte.has(m.cle),
      negatif: apres < 0,
    };
  });

  // Ce qui demande une décision remonte : négatifs, puis nouveautés.
  articles.sort((a, b) => {
    if (a.negatif !== b.negatif) return a.negatif ? -1 : 1;
    if (a.nouveau !== b.nouveau) return a.nouveau ? -1 : 1;
    return (a.designation || "").localeCompare(b.designation || "");
  });

  return {
    mode: deduction ? "deduction" : "inventaire",
    zone: { code: zoneCode, libelle: trim(zone?.libelle), type: emplacement },
    etat,
    comptageEnAttente,
    proformas,
    articles,
    totaux: {
      nbProformas: proformas.filter((x) => x.statut === "ok").length,
      nbArticles: articles.length,
      nbNouveaux: articles.filter((a) => a.nouveau).length,
      nbNegatifs: articles.filter((a) => a.negatif).length,
      unitesMouvement: articles.reduce((t, a) => t + a.mouvement, 0),
      unitesAvant: articles.reduce((t, a) => t + a.avant, 0),
      unitesApres: articles.reduce((t, a) => t + a.apres, 0),
    },
  };
};

/**
 * Intègre les proformas choisies dans la session d'inventaire active, SUR UNE
 * ZONE CHOISIE DANS L'ÉCRAN.
 *
 * `zone` est le document Zone cible (résolu par resoudreZoneImport). Toutes les
 * proformas de la sélection y sont intégrées : l'écran travaille zone par zone.
 *
 * `mode` :
 *  - "inventaire" (défaut) : comptage normal, quantités positives, qui S'AJOUTE
 *    au comptage déjà présent sur la zone (collecteur, Excel, autre proforma) ;
 *  - "deduction" : quantités enregistrées en NÉGATIF, pour retrancher du
 *    comptage ce qui est sorti d'une partie du magasin restée ouverte.
 *
 * Idempotence : ré-intégrer LA MÊME proforma sur LA MÊME zone dans LE MÊME mode
 * remplace ses lignes au lieu de les empiler (un double clic ne double pas le
 * comptage). Les deux modes coexistent, et deux proformas différentes
 * s'additionnent.
 */
export const importerProformas = async (
  entreprise,
  session,
  zone,
  selection = [],
  mode = "inventaire",
  userId = null,
) => {
  const deduction = mode === "deduction";
  const zoneCode = trim(zone?.code);
  const emplacement = trim(zone?.type);
  // Photographié AVANT le premier import : un import qui réussit crée des
  // lignes, et la zone ne serait plus « jamais comptée » au second passage.
  const premierComptage = await zoneJamaisComptee(session, zone);

  // Normalisation : numéros bruts ou objets complétés, sans doublon de numfact.
  const items = [];
  const vus = new Set();
  for (const brut of Array.isArray(selection) ? selection : [selection]) {
    // La zone ne vient plus de l'item : elle est choisie une fois pour toute la
    // sélection. Seul l'agent reste surchargeable par ligne.
    const item =
      brut && typeof brut === "object"
        ? { numfact: trim(brut.numfact), agentCode: trim(brut.agentCode) }
        : { numfact: trim(brut), agentCode: "" };
    if (!item.numfact || vus.has(item.numfact)) continue;
    vus.add(item.numfact);
    items.push(item);
  }
  if (!items.length)
    return {
      mode: deduction ? "deduction" : "inventaire",
      zoneCode,
      emplacement,
      importees: 0,
      lignes: 0,
      unites: 0,
      phasesMarquees: [],
      resultats: [],
    };

  const cache = await proformaCacheService.getProformas(entreprise);

  const resultats = [];
  let totalLignes = 0;
  let totalUnites = 0;

  for (const item of items) {
    const { numfact } = item;
    const idx = cache.indexByNumfact.get(numfact);
    const p = idx !== undefined ? cache.proformaRecords[idx] : null;
    if (!p) {
      resultats.push({ numfact, statut: "erreur", message: "Proforma introuvable" });
      continue;
    }

    // Les lignes de commentaire (NART vide ou contenant « ! ») ne sont pas des
    // articles bipés : voir `estLigneArticle`.
    const aCompter = lignesArticles(cache, numfact).map((l) => ({
      code: trim(l.NART),
      quantite: Number(l.QTE) || 0,
    }));

    if (!aCompter.length) {
      resultats.push({ numfact, statut: "erreur", message: "Aucune ligne article" });
      continue;
    }

    const { rows } = await construireLignes(entreprise, aCompter);
    // Référence distincte par mode : une même proforma peut être intégrée en
    // comptage PUIS en déduction sans que l'un écrase l'autre (comme l'Excel).
    const reference = referenceProforma(numfact, zoneCode, emplacement, deduction);
    // L'agent saisi à la main l'emporte sur le vendeur de la proforma (REPRES
    // n'est pas toujours celui qui a effectivement bipé le rayon).
    const agentCode = item.agentCode || trim(p.REPRES);
    const agentNom = nomAgent(entreprise, agentCode);
    const unites = rows.reduce((s, r) => s + r.qte, 0) * (deduction ? -1 : 1);

    await LigneBipage.deleteMany({ session: session._id, datFileName: reference });
    await LigneBipage.insertMany(
      rows.map((r) => ({
        entreprise: entreprise._id,
        session: session._id,
        datFileName: reference,
        zoneCode,
        zoneType: emplacement,
        ordre: r.n,
        eanArticle: r.code,
        qteScan: deduction ? -r.qte : r.qte,
        nart: r.nart === "-" ? "" : r.nart,
        designation: r.designation,
        observation: "",
        stock: typeof r.stock === "number" ? r.stock : null,
        found: !r.nonTrouve,
        source: "proforma",
        sourceRef: numfact,
        modeImport: deduction ? "deduction" : "inventaire",
        agentCode,
        agentNom,
      })),
    );

    totalLignes += rows.length;
    totalUnites += unites;
    resultats.push({
      numfact,
      statut: "importee",
      zoneCode,
      emplacement,
      agentNom,
      lignes: rows.length,
      unites,
    });
  }

  const importees = resultats.filter((r) => r.statut === "importee").length;
  // Premier comptage de la zone : papillonnage et bipage passent à « fait ».
  const phasesMarquees =
    importees && premierComptage
      ? await marquerPhasesImport(session, zone, userId)
      : [];

  return {
    mode: deduction ? "deduction" : "inventaire",
    zoneCode,
    emplacement,
    importees,
    lignes: totalLignes,
    unites: totalUnites,
    phasesMarquees,
    resultats,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// SOURCE 2 — FICHIER EXCEL
//
// Le fichier ne porte QUE le comptage : deux colonnes, CODE et QUANTITE. Son
// nom n'a aucune importance — la zone, l'emplacement et le mode sont choisis
// dans l'écran au moment de l'import.
// ────────────────────────────────────────────────────────────────────────────

/** Modèle Excel téléchargeable depuis l'écran. */
export const genererModeleExcelBipage = async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC Tools";

  const ws = wb.addWorksheet("Bipage");
  ws.columns = [
    { header: "CODE", key: "code", width: 22 },
    { header: "QUANTITE", key: "qte", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRows([
    { code: "3223430141205", qte: 12 },
    { code: "781172", qte: 2 },
  ]);

  const aide = wb.addWorksheet("Aide");
  aide.columns = [{ width: 110 }];
  [
    "IMPORT D'UN COMPTAGE DEPUIS EXCEL",
    "",
    "Le nom du fichier n'a aucune importance : la zone, l'emplacement et le mode",
    "sont choisis dans l'ecran au moment de l'import.",
    "",
    "1) REMPLISSEZ L'ONGLET « Bipage » :",
    "",
    "   - CODE     : code-barres (gencode) ou code article (NART)",
    "   - QUANTITE : quantite comptee, en nombre entier",
    "",
    "   Une ligne par article. Les lignes sans code sont ignorees.",
    "",
    "2) IMPORTEZ le fichier depuis l'ecran « Progression inventaire » :",
    "",
    "   - choisissez d'abord la ZONE dans la liste ;",
    "   - puis le MODE :",
    "",
    "     Comptage  : les quantites s'AJOUTENT au comptage deja present sur la zone.",
    "     Deduction : les quantites sont RETRANCHEES (enregistrees en negatif).",
    "                 A utiliser pour une partie du magasin restee OUVERTE :",
    "                 ce qui a ete vendu entre le debut et la fin de l'inventaire",
    "                 ne doit pas etre compte comme present en rayon.",
    "",
    "   Dans les deux cas, saisissez les quantites NORMALEMENT (en positif) :",
    "   c'est le mode choisi a l'import qui decide du signe.",
    "",
    "Si la zone n'avait jamais ete comptee, l'import coche automatiquement ses",
    "phases « papillonnage » et « bipage » pour le suivi. La phase « controle »",
    "reste a faire.",
    "",
    "Les articles inconnus du catalogue sont importes quand meme et signales",
    "« Article non trouve » a l'ecran, comme pour un bipage au collecteur.",
    "",
    "Reimporter le MEME fichier sur la MEME zone dans le MEME mode remplace les",
    "lignes deja importees : cela corrige une erreur sans creer de doublon.",
    "Deux fichiers de noms differents s'additionnent.",
  ].forEach((l) => aide.addRow([l]));
  aide.getRow(1).font = { bold: true, size: 13 };
  aide.getRow(6).font = { bold: true };
  aide.getRow(13).font = { bold: true };

  return wb.xlsx.writeBuffer();
};

/**
 * Lit le fichier Excel et crée les lignes de bipage SUR LA ZONE CHOISIE DANS
 * L'ÉCRAN. Le nom du fichier ne sert qu'à tracer la provenance.
 *
 * `mode` :
 *  - "inventaire" (défaut) : comptage normal, quantités positives, qui S'AJOUTE
 *    au comptage déjà présent sur la zone ;
 *  - "deduction" : les quantités sont enregistrées en NÉGATIF. Sert aux parties
 *    du magasin restées ouvertes : ce qui a été vendu entre le début et la fin
 *    de l'inventaire est retranché du comptage.
 *
 * Idempotence : réimporter LE MÊME fichier sur LA MÊME zone dans LE MÊME mode
 * remplace ses lignes au lieu de les empiler (un double clic ne double pas le
 * comptage). Deux fichiers de noms différents s'additionnent, et les deux modes
 * coexistent.
 */
export const importerExcelBipage = async (
  entreprise,
  session,
  zone,
  nomFichier,
  buffer,
  mode = "inventaire",
  agent = {},
) => {
  const deduction = mode === "deduction";
  const zoneCode = trim(zone?.code);
  const emplacement = trim(zone?.type);
  // Photographié AVANT l'import : voir importerProformas.
  const premierComptage = await zoneJamaisComptee(session, zone);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet("Bipage") || wb.worksheets[0];
  if (!ws) throw new Error("Fichier Excel vide.");

  // Repérage des colonnes CODE / QUANTITE sur la première ligne, quel que soit
  // leur ordre ; à défaut on prend les deux premières colonnes.
  const entetes = {};
  ws.getRow(1).eachCell((cell, col) => {
    const t = trim(cell.value).toUpperCase();
    if (t.startsWith("CODE")) entetes.code = col;
    else if (t.startsWith("QUANT") || t === "QTE") entetes.qte = col;
  });
  const colCode = entetes.code || 1;
  const colQte = entetes.qte || 2;

  const aCompter = [];
  const ignorees = [];
  ws.eachRow((row, numero) => {
    if (numero === 1) return;
    const brut = row.getCell(colCode).value;
    const code = trim(
      brut && typeof brut === "object" && brut.text ? brut.text : brut,
    );
    if (!code) return;
    // En mode déduction la quantité est saisie normalement (positive) et c'est
    // l'import qui la passe en négatif ; on tolère aussi un signe déjà saisi.
    const quantite = Math.abs(parseInt(row.getCell(colQte).value, 10));
    if (!quantite) {
      ignorees.push({ ligne: numero, code, raison: "Quantité absente ou nulle" });
      return;
    }
    aCompter.push({ code, quantite });
  });

  if (!aCompter.length) {
    throw new Error("Aucune ligne exploitable (colonnes CODE et QUANTITE).");
  }

  const { rows } = await construireLignes(entreprise, aCompter);
  // La référence identifie l'import : mode + fichier + zone. Deux modes, deux
  // fichiers ou deux zones ne s'écrasent donc jamais ; le même trio, si.
  const reference = `${deduction ? "deduction" : "excel"} ${trim(nomFichier)} ${zoneCode}${
    emplacement ? `_${emplacement}` : ""
  }`;

  await LigneBipage.deleteMany({ session: session._id, datFileName: reference });
  await LigneBipage.insertMany(
    rows.map((r) => ({
      entreprise: entreprise._id,
      session: session._id,
      datFileName: reference,
      zoneCode,
      zoneType: emplacement,
      ordre: r.n,
      eanArticle: r.code,
      qteScan: deduction ? -r.qte : r.qte,
      nart: r.nart === "-" ? "" : r.nart,
      designation: r.designation,
      observation: "",
      stock: typeof r.stock === "number" ? r.stock : null,
      found: !r.nonTrouve,
      source: "excel",
      sourceRef: trim(nomFichier),
      modeImport: deduction ? "deduction" : "inventaire",
      // Le nom du fichier ne porte plus le code agent : on trace qui a importé.
      agentCode: trim(agent.code),
      agentNom: trim(agent.nom) || nomAgent(entreprise, agent.code),
    })),
  );

  // Premier comptage de la zone : papillonnage et bipage passent à « fait ».
  const phasesMarquees = premierComptage
    ? await marquerPhasesImport(session, zone, agent.userId)
    : [];

  return {
    mode: deduction ? "deduction" : "inventaire",
    zoneCode,
    emplacement,
    agentCode: trim(agent.code),
    agentNom: trim(agent.nom) || nomAgent(entreprise, agent.code),
    lignes: rows.length,
    unites: rows.reduce((s, r) => s + r.qte, 0) * (deduction ? -1 : 1),
    nonTrouves: rows.filter((r) => r.nonTrouve).length,
    phasesMarquees,
    ignorees,
  };
};

export default {
  getEmplacements,
  getZones,
  parserZoneEmplacement,
  getProformasEligibles,
  importerProformas,
  previsualiserImportProformas,
  etatZoneImport,
  genererModeleExcelBipage,
  importerExcelBipage,
};
