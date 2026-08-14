// backend/services/commercialAnalyseService.js
//
// ANALYSE COMMERCIALE — portage du rapport Power BI « pbi_QC_stats_<NOM> ».
//
// Le rapport d'origine existait en UN FICHIER PAR COMMERCIAL : le portefeuille
// y était une liste de clients figée (filtre verrouillé au niveau rapport) et le
// taux de prime une constante DAX (`IF(NOM="CAMELIA", 0.015, 0)`). Ici tout est
// dynamique : portefeuille = clients.REPRES, taux = paramétré par le commercial.
//
// Formules reprises À L'IDENTIQUE des colonnes calculées du modèle tabulaire,
// qui travaillent LIGNE À LIGNE sur detail.dbf (et non sur facture.MONTANT) :
//   QteAjusté        = QTE si TYPFACT="F", sinon -QTE
//   montantRemise    = PVTE × POURC / 100
//   pvteHTNet        = PVTE - montantRemise
//   CA_HTNet         = pvteHTNet × QteAjusté
//   PrixRevientTotal = PREV × QteAjusté
//   Profit           = CA HT Net - Coût de revient
//   Marge de profit  = Profit / CA HT Net
//   Transactions     = NUMFACT distincts
//   Quantité vendue  = Σ QteAjusté
//
// ⚠️ PERF : detail.dbf ≈ 1,17 Go / 6,2 M lignes. Comme pour les factures, on ne
// le charge JAMAIS en objets JS : streaming vers un index COLONNAIRE en
// TypedArrays, borné aux années N/N-1, joint aux entêtes déjà indexés par
// commercialService (aucune relecture de facture.dbf).

import path from "path";
import fs from "fs";
import { DBFFile } from "dbffile";
import articleCacheService from "./articleService.js";
import clientCacheService from "./clientCacheService.js";
import { getIndexFactures } from "./commercialService.js";
import { sameCode } from "../middleware/commercialAccess.js";

const BATCH = 2000;
const TTL_MS = 10 * 60 * 1000;

const detIndexCache = new Map(); // dossier -> { idx, loadedAt }
const detIndexLocks = new Map();

const safeTrim = (v) => (v === null || v === undefined ? "" : String(v)).trim();
const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

/** Une ligne de detail sans article (commentaire) ? */
const estCommentaire = (nart) => !nart || nart.includes("!");

// ─────────────────────────── Index colonnaire detail ─────────────────────────

const buildDetailIndex = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const p = path.join(entreprise.cheminBase, dossier, "detail.dbf");
  if (!fs.existsSync(p)) throw new Error(`detail.dbf introuvable: ${p}`);

  const t0 = Date.now();
  // Entêtes déjà en mémoire (numfact -> date/tiers/repres/type) + articles.
  const [idxFact, cacheArticles] = await Promise.all([
    getIndexFactures(entreprise),
    articleCacheService.getArticles(entreprise),
  ]);

  // NART -> { fourn, groupe, design }
  const parNart = new Map();
  for (const a of cacheArticles.records || []) {
    const nart = safeTrim(a.NART).toUpperCase();
    if (!nart) continue;
    // StockTotal = S1+..+S5 et JourRuptureTotal = RUP1+..+RUP12, comme les
    // colonnes calculées du modèle Power BI (JourEnStock = 360 - ruptures).
    let stock = 0;
    for (let s = 1; s <= 5; s += 1) stock += num(a[`S${s}`]);
    let rupture = 0;
    for (let r = 1; r <= 12; r += 1) rupture += num(a[`RUP${r}`]);
    parNart.set(nart, {
      fourn: safeTrim(a.FOURN),
      // Axe « rayon » : gisement principal GISM1 (choix client). GISM2..5 sont
      // vides à plus de 99 % dans les données QC.
      rayon: safeTrim(a.GISM1),
      design: safeTrim(a.DESIGN),
      stock,
      rupture,
    });
  }

  const dbf = await DBFFile.open(p, { readMode: "loose" });
  const capacite = dbf.recordCount || 7000000;

  // Colonnes (≈ 40 octets/ligne). Bornées aux factures présentes dans l'index
  // facture, donc aux années N/N-1 et aux TYPFACT F/A.
  const ymd = new Int32Array(capacite);
  const tiers = new Int32Array(capacite);
  const ca = new Float64Array(capacite);
  const revient = new Float64Array(capacite);
  const qte = new Float64Array(capacite);
  const nartId = new Int32Array(capacite);
  const factId = new Int32Array(capacite);

  // Dictionnaires (indices -> libellés), pour ne stocker que des entiers.
  const narts = [];
  const nartIndex = new Map();
  const facts = [];
  const factIndex = new Map();

  let n = 0;
  let scanned = 0;
  let batch;
  while ((batch = await dbf.readRecords(BATCH)).length > 0) {
    scanned += batch.length;
    for (const d of batch) {
      const numfact = safeTrim(d.NUMFACT);
      if (!numfact) continue;
      const entete = idxFact.parNumfact.get(numfact);
      if (!entete) continue; // hors période / hors TYPFACT F,A

      const nart = safeTrim(d.NART).toUpperCase();
      if (estCommentaire(nart)) continue;
      if (n >= capacite) continue;

      // QteAjusté : les avoirs comptent en négatif.
      const q = entete.avoir ? -num(d.QTE) : num(d.QTE);
      const pvte = num(d.PVTE);
      const pvteNet = pvte - (pvte * num(d.POURC)) / 100;

      let idNart = nartIndex.get(nart);
      if (idNart === undefined) {
        idNart = narts.length;
        const a = parNart.get(nart);
        narts.push({
          nart,
          design: a ? a.design : safeTrim(d.DESIGN),
          fourn: a ? a.fourn : "",
          rayon: a ? a.rayon : "",
          stock: a ? a.stock : 0,
          rupture: a ? a.rupture : 0,
        });
        nartIndex.set(nart, idNart);
      }
      let idFact = factIndex.get(numfact);
      if (idFact === undefined) {
        idFact = facts.length;
        facts.push(numfact);
        factIndex.set(numfact, idFact);
      }

      ymd[n] = entete.ymd;
      tiers[n] = parseInt(entete.tiers, 10) || 0;
      ca[n] = pvteNet * q;
      revient[n] = num(d.PREV) * q;
      qte[n] = q;
      nartId[n] = idNart;
      factId[n] = idFact;
      n += 1;
    }
  }

  console.log(
    `[Commercial] Index detail ${dossier}: ${n} lignes retenues sur ${scanned} (${narts.length} articles) en ${Date.now() - t0}ms`,
  );

  return {
    n,
    ymd: ymd.subarray(0, n),
    tiers: tiers.subarray(0, n),
    ca: ca.subarray(0, n),
    revient: revient.subarray(0, n),
    qte: qte.subarray(0, n),
    nartId: nartId.subarray(0, n),
    factId: factId.subarray(0, n),
    narts,
    facts,
    anneeN: idxFact.anneeN,
    anneeN1: idxFact.anneeN1,
  };
};

export const getIndexDetail = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const hit = detIndexCache.get(dossier);
  if (hit && Date.now() - hit.loadedAt < TTL_MS) return hit.idx;
  if (detIndexLocks.has(dossier)) return detIndexLocks.get(dossier);

  const promesse = (async () => {
    try {
      const idx = await buildDetailIndex(entreprise);
      detIndexCache.set(dossier, { idx, loadedAt: Date.now() });
      return idx;
    } finally {
      detIndexLocks.delete(dossier);
    }
  })();
  detIndexLocks.set(dossier, promesse);
  return promesse;
};

// ─────────────────────────────── Agrégations ────────────────────────────────

/** Clé d'axe d'une ligne : fournisseur, rayon, client ou article. */
const cleAxe = (idx, i, axe) => {
  const a = idx.narts[idx.nartId[i]];
  if (axe === "fournisseur") return a.fourn || "—";
  if (axe === "rayon") return a.rayon || "—";
  if (axe === "client") return String(idx.tiers[i]);
  return String(idx.nartId[i]); // article
};

/**
 * Analyse par axe, sur le portefeuille du commercial.
 *
 * @param {Object} opts
 *   axe        : "fournisseur" | "rayon" | "client" | "article"
 *   annee      : année analysée (défaut = N)
 *   mois       : 1-12 ou 0 = toute l'année
 *   fournisseur/rayon/tiers : filtres croisés (comme les slicers du rapport)
 */
export const analyser = async (entreprise, codes, opts = {}) => {
  const {
    axe = "fournisseur",
    annee,
    mois = 0,
    fournisseur,
    rayon,
    tiers: tiersFiltre,
    limit = 200,
    // Neutralise le filtre portefeuille — équivalent du ALL(QC_clients[catClient])
    // du rapport, utilisé par la prime fournisseur (mesurée sur toute la société).
    tousClients = false,
  } = opts;

  const [idx, cacheClients] = await Promise.all([
    getIndexDetail(entreprise),
    clientCacheService.getClients(entreprise),
  ]);

  // Portefeuille = clients.REPRES ∈ codes (remplace la liste figée du .pbix).
  const portefeuille = new Set();
  const nomClient = new Map();
  for (const c of cacheClients.records || []) {
    const t = safeTrim(c.TIERS);
    if (!t) continue;
    nomClient.set(t, safeTrim(c.NOM));
    if (tousClients || codes.some((code) => sameCode(code, c.REPRES))) {
      portefeuille.add(t);
    }
  }

  const anneeN = Number(annee) || idx.anneeN;
  const anneeN1 = anneeN - 1;
  const moisFiltre = Number(mois) || 0;

  const groupes = new Map();
  // Transactions du périmètre : DISTINCTCOUNT global. Sommer les comptes par
  // groupe compterait plusieurs fois une facture qui couvre 2 fournisseurs.
  const facturesGlobales = new Set();
  const vide = () => ({
    caN: 0,
    caN1: 0,
    revientN: 0,
    revientN1: 0,
    qteN: 0,
    factures: new Set(),
    // Articles distincts du groupe : « Nombre de Produits » du rapport, et
    // base des cumuls de stock / jours de rupture (sans double comptage).
    articles: new Set(),
    moisN: new Array(12).fill(0),
    moisN1: new Array(12).fill(0),
    // Marge par mois : la prime fournisseur se calcule mois par mois.
    moisProfitN: new Array(12).fill(0),
  });

  for (let i = 0; i < idx.n; i += 1) {
    const t = String(idx.tiers[i]);
    if (!portefeuille.has(t)) continue;

    const a = idx.narts[idx.nartId[i]];
    if (fournisseur && a.fourn !== String(fournisseur)) continue;
    if (rayon && a.rayon !== String(rayon)) continue;
    if (tiersFiltre && t !== String(tiersFiltre)) continue;

    const cle = idx.ymd[i];
    const an = Math.floor(cle / 10000);
    if (an !== anneeN && an !== anneeN1) continue;
    const m = Math.floor((cle % 10000) / 100);
    if (moisFiltre && m !== moisFiltre) continue;

    const k = cleAxe(idx, i, axe);
    let g = groupes.get(k);
    if (!g) {
      g = vide();
      groupes.set(k, g);
    }

    if (an === anneeN) {
      g.caN += idx.ca[i];
      g.revientN += idx.revient[i];
      g.qteN += idx.qte[i];
      g.factures.add(idx.factId[i]);
      g.articles.add(idx.nartId[i]);
      facturesGlobales.add(idx.factId[i]);
      g.moisN[m - 1] += idx.ca[i];
      g.moisProfitN[m - 1] += idx.ca[i] - idx.revient[i];
    } else {
      g.caN1 += idx.ca[i];
      g.revientN1 += idx.revient[i];
      g.moisN1[m - 1] += idx.ca[i];
    }
  }

  // Libellés d'axe (catFourn / catRayons / catClient / catNartDesign du .pbix)
  const libelle = (k) => {
    if (axe === "client") return `${k} - ${nomClient.get(k) || ""}`.trim();
    if (axe === "article") {
      const a = idx.narts[Number(k)];
      return `${a.nart} - ${a.design}`;
    }
    return k;
  };

  const lignes = [...groupes.entries()].map(([k, g]) => {
    const profitN = g.caN - g.revientN;
    const profitN1 = g.caN1 - g.revientN1;
    // Stock et ruptures : sommés sur les ARTICLES distincts du groupe.
    let stockTotal = 0;
    let jourRupture = 0;
    g.articles.forEach((id) => {
      stockTotal += idx.narts[id].stock;
      jourRupture += idx.narts[id].rupture;
    });
    const jourEnStock = Math.max(0, 360 * g.articles.size - jourRupture);
    return {
      stockTotal,
      jourRupture,
      jourEnStock,
      nbArticles: g.articles.size,
      // Quantité moyenne vendue par jour / par mois (mesures du rapport).
      qteMoyenneJour: jourEnStock !== 0 ? g.qteN / jourEnStock : 0,
      qteMoyenneMois: jourEnStock !== 0 ? (g.qteN / jourEnStock) * 30 : 0,
      cle: k,
      libelle: libelle(k),
      caN: g.caN,
      caN1: g.caN1,
      revientN: g.revientN,
      profitN,
      profitN1,
      margePct: g.caN !== 0 ? (profitN / g.caN) * 100 : 0,
      qteN: g.qteN,
      nbTransactions: g.factures.size,
      evolutionCa: g.caN - g.caN1,
      evolutionPct: g.caN1 !== 0 ? ((g.caN - g.caN1) / Math.abs(g.caN1)) * 100 : 0,
      moisN: g.moisN,
      moisN1: g.moisN1,
      moisProfitN: g.moisProfitN,
    };
  });

  lignes.sort((a, b) => b.caN - a.caN);

  const totaux = lignes.reduce(
    (acc, l) => {
      acc.caN += l.caN;
      acc.caN1 += l.caN1;
      acc.revientN += l.revientN;
      acc.profitN += l.profitN;
      acc.qteN += l.qteN;
      for (let m = 0; m < 12; m += 1) {
        acc.moisN[m] += l.moisN[m];
        acc.moisN1[m] += l.moisN1[m];
        acc.moisProfitN[m] += l.moisProfitN[m];
      }
      return acc;
    },
    {
      caN: 0,
      caN1: 0,
      revientN: 0,
      profitN: 0,
      qteN: 0,
      moisN: new Array(12).fill(0),
      moisN1: new Array(12).fill(0),
      moisProfitN: new Array(12).fill(0),
    },
  );
  totaux.nbTransactions = facturesGlobales.size;
  totaux.nbArticles = lignes.reduce((s, l) => s + l.nbArticles, 0);
  totaux.stockTotal = lignes.reduce((s, l) => s + l.stockTotal, 0);
  totaux.margePct = totaux.caN !== 0 ? (totaux.profitN / totaux.caN) * 100 : 0;
  // Cumuls YTD N et N-1 (TOTALYTD du rapport) + évolution mensuelle (waterfall).
  let cN = 0;
  let cN1 = 0;
  totaux.cumulN = totaux.moisN.map((v) => (cN += v));
  totaux.cumulN1 = totaux.moisN1.map((v) => (cN1 += v));
  totaux.evolutionMois = totaux.moisN.map((v, i) => v - totaux.moisN1[i]);
  totaux.evolutionCa = totaux.caN - totaux.caN1;
  totaux.evolutionPct =
    totaux.caN1 !== 0
      ? ((totaux.caN - totaux.caN1) / Math.abs(totaux.caN1)) * 100
      : 0;

  return {
    axe,
    annee: anneeN,
    anneeN1,
    mois: moisFiltre,
    nbClientsPortefeuille: portefeuille.size,
    totalLignes: lignes.length,
    lignes: lignes.slice(0, limit),
    totaux,
  };
};

/** Valeurs proposées dans les filtres (fournisseurs / rayons du portefeuille). */
export const getFiltresAnalyse = async (entreprise, codes) => {
  const [fourn, rayon] = await Promise.all([
    analyser(entreprise, codes, { axe: "fournisseur", limit: 1000 }),
    analyser(entreprise, codes, { axe: "rayon", limit: 1000 }),
  ]);
  return {
    fournisseurs: fourn.lignes.map((l) => ({ code: l.cle, caN: l.caN })),
    rayons: rayon.lignes.map((l) => ({ code: l.cle, caN: l.caN })),
    annees: [fourn.annee, fourn.anneeN1],
  };
};

// ────────────────────────────────── Prime ────────────────────────────────────

/** Palier atteint : le dernier dont le seuil est franchi (paliers continus). */
export const primePalier = (marge, paliers = []) => {
  const tries = [...paliers].sort((a, b) => a.seuil - b.seuil);
  let montant = 0;
  let atteint = null;
  for (const p of tries) {
    if (marge >= p.seuil) {
      montant = p.montant;
      atteint = p;
    }
  }
  const suivant = tries.find((p) => marge < p.seuil) || null;
  return { montant, palierAtteint: atteint, palierSuivant: suivant };
};

/**
 * Calcul de la prime d'un commercial pour une période.
 * Reproduit le « Suivi Prime » du rapport, avec le taux et les paliers saisis
 * par le commercial au lieu des constantes DAX.
 */
export const calculerPrime = async (entreprise, codes, config, opts = {}) => {
  const { annee, mois = 0 } = opts;
  const taux = Number(config?.taux) || 0;
  const assiette = config?.assiette === "ca" ? "ca" : "marge";
  const fp = config?.fournisseurPrime || {};

  // Portefeuille, par client (axe client = le détail du rapport).
  const parClient = await analyser(entreprise, codes, {
    axe: "client",
    annee,
    mois,
    limit: 10000,
  });

  const lignes = parClient.lignes.map((l) => {
    const base = assiette === "ca" ? l.caN : l.profitN;
    const baseN1 = assiette === "ca" ? l.caN1 : l.profitN1;
    return {
      ...l,
      basePrime: base,
      prime: base * taux,
      primeN1: baseN1 * taux,
    };
  });

  const primePortefeuille = lignes.reduce((s, l) => s + l.prime, 0);
  const primePortefeuilleN1 = lignes.reduce((s, l) => s + l.primeN1, 0);

  // Prime fournisseur (le « BLUM » du rapport, FOURN=24) : sur toute la société
  // ou sur le seul portefeuille, selon le paramétrage.
  let fournisseur = null;
  if (fp.code) {
    const surTout = fp.surTouteLaSociete !== false;
    const analyseFourn = await analyser(entreprise, codes, {
      axe: "fournisseur",
      annee,
      mois,
      fournisseur: fp.code,
      limit: 10,
      tousClients: surTout, // équivalent du ALL(catClient) du DAX
    });
    // La prime fournisseur se calcule MOIS PAR MOIS (décision client) : les
    // paliers (1,3 M → 2,2 M) sont taillés pour une marge mensuelle, pas
    // annuelle — en cumul annuel le dernier palier serait toujours acquis.
    const margesMois = analyseFourn.totaux.moisProfitN;
    const moisCible = Number(mois) || 0;
    const detailMois = margesMois.map((marge, i) => {
      const { montant, palierAtteint, palierSuivant } = primePalier(
        marge,
        fp.paliers,
      );
      return {
        mois: i + 1,
        marge,
        prime: montant,
        palierAtteint,
        palierSuivant,
        resteAAtteindre: palierSuivant
          ? Math.max(0, palierSuivant.seuil - marge)
          : 0,
      };
    });

    // Mois sélectionné, sinon cumul des primes mensuelles de l'année.
    const retenus = moisCible
      ? detailMois.filter((d) => d.mois === moisCible)
      : detailMois;
    const primeCumulee = retenus.reduce((s, d) => s + d.prime, 0);
    const margeCumulee = retenus.reduce((s, d) => s + d.marge, 0);
    const courant = moisCible
      ? retenus[0]
      : detailMois[new Date().getMonth()] || detailMois[0];

    fournisseur = {
      code: fp.code,
      libelle: fp.libelle || fp.code,
      surTouteLaSociete: surTout,
      periode: "mensuelle",
      caHT: analyseFourn.totaux.caN,
      marge: margeCumulee,
      prime: primeCumulee,
      // Situation du mois en cours (ou du mois filtré) : ce que le commercial
      // regarde pour savoir s'il peut encore décrocher le palier suivant.
      moisCourant: courant,
      palierAtteint: courant ? courant.palierAtteint : null,
      palierSuivant: courant ? courant.palierSuivant : null,
      resteAAtteindre: courant ? courant.resteAAtteindre : 0,
      detailMois,
    };
  }

  const primeFournisseur = fournisseur ? fournisseur.prime : 0;

  return {
    annee: parClient.annee,
    mois: parClient.mois,
    config: {
      taux,
      assiette,
      fournisseurPrime: fp.code ? fp : null,
    },
    portefeuille: {
      nbClients: parClient.nbClientsPortefeuille,
      caN: parClient.totaux.caN,
      profitN: parClient.totaux.profitN,
      prime: primePortefeuille,
      primeN1: primePortefeuilleN1,
      evolutionPct:
        primePortefeuilleN1 !== 0
          ? ((primePortefeuille - primePortefeuilleN1) /
              Math.abs(primePortefeuilleN1)) *
            100
          : 0,
      // Contrôle de cohérence du rapport (« Prime sur portefeuille moyen (%) »)
      tauxEffectifPct:
        parClient.totaux.profitN !== 0
          ? (primePortefeuille / parClient.totaux.profitN) * 100
          : 0,
    },
    fournisseur,
    primeTotale: primePortefeuille + primeFournisseur,
    lignes: lignes.sort((a, b) => b.prime - a.prime),
  };
};

export default {
  getIndexDetail,
  analyser,
  getFiltresAnalyse,
  calculerPrime,
  primePalier,
};
