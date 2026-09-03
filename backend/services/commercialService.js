// backend/services/commercialService.js
//
// ESPACE COMMERCIAL — toute la donnée métier d'un commercial, filtrée sur le
// couple SOCIÉTÉ + CODE(S) VENDEUR (REPRES).
//
// Sources :
//   - clientCacheService     -> portefeuille (clients.REPRES)
//   - proformaCacheService   -> proformas (proforma.REPRES + proforma.ETAT)
//   - index facture LOCAL    -> réservations, commandes spéciales, factures,
//                               CA / marge, dernier achat (voir plus bas)
//   - resaEntreesService     -> alertes « réservation entrée en stock »
//
// ⚠️ L'espace commercial N'UTILISE PAS factureCacheService ni commerciauxService.
// Tous deux chargent facture.dbf ET detail.dbf (6,2 M lignes) pour TOUS les
// commerciaux, soit ~140 s à froid, alors que le module n'a besoin que des
// entêtes de factures. Il construit donc son propre index colonnaire en une
// seule passe (~40 s en local, davantage sur le partage réseau de production),
// qui sert à la fois les réservations, les factures, le CA et le dernier achat.
//
// Catégories de documents :
//   - facture.dbf TYPFACT="R" -> réservations (ETAT=1) et commandes spéciales
//     (ETAT=2), libellés via entreprise.mappingEtatsReservation ;
//   - proforma.dbf -> devis et commandes à préparer, libellés via
//     entreprise.mappingEtatsProforma. Attention : chez QC, proforma.ETAT=1 est
//     libellé « Reservation » alors que ce n'est PAS une réservation ferme.

import path from "path";
import fs from "fs";
import { DBFFile } from "dbffile";
import clientCacheService from "./clientCacheService.js";
import proformaCacheService from "./proformaCacheService.js";
import {
  getResaEntrees,
  getReservationsIndexes,
  getEntreesParArticle,
} from "./resaEntreesService.js";
import articleCacheService from "./articleService.js";
import { sameCode } from "../middleware/commercialAccess.js";

// ─────────────────────────────── Helpers ────────────────────────────────────

const safeTrim = (v) => (v === null || v === undefined ? "" : String(v).trim());

const num = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const parseDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) {
    const d = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);

/** "YYYY-MM-DD" -> 20260814 (clé entière de l'index colonnaire). */
const ymdInt = (v) => {
  const d = parseDate(v);
  if (!d) return null;
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

/** 20260814 -> "2026-08-14". */
const ymdIso = (cle) => {
  if (!cle) return null;
  const s = String(cle);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

/** Nombre de jours entiers écoulés depuis `d` (null si date absente). */
const anciennete = (d) => {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

/** Le REPRES d'un enregistrement fait-il partie des codes du commercial ? */
const estAMoi = (repres, codes) => codes.some((c) => sameCode(c, repres));

/** Évolution en % (même convention que l'analyse commerciaux). */
const evolution = (courant, precedent) => {
  if (precedent !== 0) return ((courant - precedent) / Math.abs(precedent)) * 100;
  return courant === 0 ? 0 : 100;
};

const MOIS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

// Catégories des documents PROFORMA.
//
// ⚠️ Vocabulaire : le mapping proforma de QC libelle l'ETAT=1 « Reservation »,
// mais ce n'en est pas une — les réservations (et commandes spéciales) sont
// EXCLUSIVEMENT les factures TYPFACT="R" (confirmé par le client le 14/08/2026).
// Afficher « Reservation » sur 685 proformas à côté des 33 vraies réservations
// rendait l'espace illisible. Dans l'espace commercial, on affiche donc le
// libellé de CATÉGORIE ci-dessous ; le libellé ERP reste disponible en
// `etatLabelErp` (infobulle), pour que le commercial retrouve son vocabulaire.
export const CATEGORIES = {
  speciale: { etat: 0, label: "Proforma spéciale" },
  attente: { etat: 1, label: "Proforma en attente" },
  preparer: { etat: 2, label: "Commande à préparer" },
  devis: { etat: null, label: "Proforma / devis" },
};

const categorieDeEtat = (etat) => {
  const e = Number(etat);
  if (e === 0) return "speciale";
  if (e === 1) return "attente";
  if (e === 2) return "preparer";
  return "devis";
};

/** Libellé tel qu'il apparaît dans l'ERP (mappingEtatsProforma), pour info. */
const libelleEtatErp = (entreprise, etat) => {
  const mapping = entreprise?.mappingEtatsProforma;
  const key = String(Number(etat));
  if (mapping) {
    const val =
      typeof mapping.get === "function" ? mapping.get(key) : mapping[key];
    if (safeTrim(val)) return safeTrim(val);
  }
  return "";
};

/** Libellé affiché dans l'espace commercial (sans ambiguïté avec les résa). */
const libelleEtat = (entreprise, etat) =>
  CATEGORIES[categorieDeEtat(etat)].label;

// Délai (jours) au-delà duquel une proforma non transformée est « à relancer ».
export const DELAI_RELANCE_DEFAUT = 21;
// Fenêtre glissante (mois) des documents « en cours ». L'ERP ne purge jamais :
// sans cette borne, les compteurs remontent jusqu'à 2019 et plus personne ne
// relance quoi que ce soit. 0 = tout l'historique (filtre explicite de l'écran).
export const FENETRE_MOIS_DEFAUT = 12;

/** Date plancher (YYYY-MM-DD) d'une fenêtre en mois, ou null si illimitée. */
const bornePeriode = (mois) => {
  const m = Number(mois);
  if (!Number.isFinite(m) || m <= 0) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return iso(d);
};
// Délai (jours) sans facture au-delà duquel un client est « à recontacter ».
export const DELAI_CLIENT_INACTIF = 90;
// Profondeur (jours) de recherche des entrées en stock pour les alertes.
export const FENETRE_ALERTES_JOURS = 45;

// ──────────────────────── Portefeuille (clients.REPRES) ─────────────────────

/**
 * Clients du portefeuille : clients.REPRES ∈ codes du commercial POUR CETTE société.
 * @returns {Promise<{clients: Array, tiersSet: Set<string>}>}
 */
export const getPortefeuille = async (entreprise, codes) => {
  const cache = await clientCacheService.getClients(entreprise);
  const clients = (cache.records || []).filter((c) => estAMoi(c.REPRES, codes));
  const tiersSet = new Set(clients.map((c) => safeTrim(c.TIERS)).filter(Boolean));
  return { clients, tiersSet };
};

/**
 * Statistiques CA / marge du portefeuille, calculées directement sur l'index
 * colonnaire (plus de dépendance à commerciauxService, qui charge tout
 * facture.dbf + detail.dbf pour TOUS les commerciaux).
 *
 * Sémantique conservée à l'identique de l'analyse commerciaux :
 *   - factures TYPFACT ∈ {F, A}, les avoirs comptés en négatif ;
 *   - marge = MONTANT - FACTREV ;
 *   - N-1 borné au jour/mois d'aujourd'hui (comparaison year-to-date).
 *
 * @returns {Promise<{parTiers: Map<string,Object>, totaux: Object, top: Array}>}
 */
export const getStatsPortefeuille = async (entreprise, codes) => {
  const [idx, { clients, tiersSet }] = await Promise.all([
    getIndexFactures(entreprise),
    getPortefeuille(entreprise, codes),
  ]);

  const today = new Date();
  const cutoffMd = (today.getMonth() + 1) * 100 + today.getDate();
  const nomParTiers = new Map(
    clients.map((c) => [safeTrim(c.TIERS), safeTrim(c.NOM)]),
  );

  const vide = () => ({
    caN: 0,
    caN1: 0,
    margeN: 0,
    margeN1: 0,
    nbFacture: 0,
    nbFactureN1: 0,
    mois: new Array(12).fill(0),
    moisN1: new Array(12).fill(0),
  });

  const parTiers = new Map();
  const moisN = new Array(12).fill(0);
  const moisN1 = new Array(12).fill(0);

  for (let i = 0; i < idx.n; i += 1) {
    const t = String(idx.tiers[i]);
    if (!tiersSet.has(t)) continue; // portefeuille du commercial uniquement

    const cle = idx.ymd[i];
    const annee = Math.floor(cle / 10000);
    const md = cle % 10000;
    const mois = Math.floor(md / 100) - 1;

    const signe = idx.avoir[i] ? -1 : 1;
    const mt = signe * Math.abs(idx.montant[i]);
    const marge = mt - signe * Math.abs(idx.factrev[i]);

    let st = parTiers.get(t);
    if (!st) {
      st = vide();
      parTiers.set(t, st);
    }

    if (annee === idx.anneeN) {
      st.caN += mt;
      st.margeN += marge;
      st.nbFacture += 1;
      st.mois[mois] += mt;
      moisN[mois] += mt;
    } else if (md <= cutoffMd) {
      // N-1 arrêté à la date du jour (year-to-date)
      st.caN1 += mt;
      st.margeN1 += marge;
      st.nbFactureN1 += 1;
      st.moisN1[mois] += mt;
      moisN1[mois] += mt;
    }
  }

  // Agrégats du portefeuille
  let caN = 0;
  let caN1 = 0;
  let margeN = 0;
  let margeN1 = 0;
  let nbFactures = 0;
  let nbFacturesN1 = 0;
  let nbClientsNouveaux = 0;
  let nbClientsPerdus = 0;
  let nbClientsCroissance = 0;
  let nbClientsBaisse = 0;

  parTiers.forEach((st, t) => {
    st.tiers = t;
    st.nomTiers = nomParTiers.get(t) || "";
    st.evolCA = evolution(st.caN, st.caN1);
    st.evolMarge = evolution(st.margeN, st.margeN1);
    st.pctMarge = st.caN !== 0 ? (st.margeN / st.caN) * 100 : 0;
    caN += st.caN;
    caN1 += st.caN1;
    margeN += st.margeN;
    margeN1 += st.margeN1;
    nbFactures += st.nbFacture;
    nbFacturesN1 += st.nbFactureN1;
    if (st.caN1 === 0 && st.caN > 0) nbClientsNouveaux += 1;
    else if (st.caN === 0 && st.caN1 > 0) nbClientsPerdus += 1;
    else if (st.caN > st.caN1) nbClientsCroissance += 1;
    else if (st.caN < st.caN1) nbClientsBaisse += 1;
  });

  // Part de chaque client dans le portefeuille (taux de contribution)
  parTiers.forEach((st) => {
    st.tauxContribution = caN !== 0 ? (st.caN / caN) * 100 : 0;
  });

  const top = [...parTiers.values()].sort((a, b) => b.caN - a.caN);

  return {
    parTiers,
    top,
    anneeN: idx.anneeN,
    anneeN1: idx.anneeN1,
    dateArret: `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}`,
    mois: MOIS,
    moisN,
    moisN1,
    totaux: {
      caN,
      caN1,
      evolCa: evolution(caN, caN1),
      margeN,
      margeN1,
      pctMarge: caN !== 0 ? (margeN / caN) * 100 : 0,
      nbFactures,
      nbFacturesN1,
      nbClients: parTiers.size,
      panierMoyen: nbFactures !== 0 ? caN / nbFactures : 0,
      nbClientsNouveaux,
      nbClientsPerdus,
      nbClientsCroissance,
      nbClientsBaisse,
    },
  };
};

// ───────────────── Dernière facture par client (clients à recontacter) ──────

/**
 * Map TIERS -> { date } de la dernière facture (TYPFACT F/A), toutes années.
 * Calculée pendant la construction de l'index : aucune lecture supplémentaire.
 */
const getDernieresVentes = async (entreprise) => {
  const idx = await getIndexFactures(entreprise);
  const map = new Map();
  idx.dernierAchat.forEach((cle, tiers) => {
    const annee = Math.floor(cle / 10000);
    const mois = Math.floor((cle % 10000) / 100) - 1;
    const jour = cle % 100;
    map.set(tiers, { date: new Date(annee, mois, jour) });
  });
  return map;
};

// ══════════ RÉSERVATIONS & COMMANDES SPÉCIALES (facture.dbf TYPFACT="R") ══════
//
// Source de vérité VALIDÉE avec le client (14/08/2026), après constat sur les
// données QC : proforma.dbf ne contient AUCUN ETAT=0, ses états réels sont
// 1 = « Reservation », 2 = « Commande à preparer », 3/4 = devis. Les vraies
// réservations et commandes spéciales vivent dans facture.dbf TYPFACT="R",
// avec entreprise.mappingEtatsReservation (1 = Réservation Stock,
// 2 = Commande Spéciale) — la même source que « Entrées sur réservation ».
//
// ⚠️ PERF : on N'UTILISE PAS factureCacheService ici. Ce cache charge 1,7 M
// factures + 6,2 M lignes de détail (~140 s) et s'invalide à chaque facturation.
// On construit à la place un index LÉGER par streaming de facture.dbf seul, en
// ne retenant que les entêtes TYPFACT="R" (quelques milliers de lignes).

const RESA_BATCH = 2000;
// TTL SEUL, volontairement : facture.dbf est modifié à chaque facture émise.
// Invalider sur mtime/taille (comme le font les autres caches) ferait repayer
// le scan complet à presque chaque requête en journée. Une réservation créée à
// l'instant apparaît donc avec au plus 10 minutes de retard — sans conséquence
// métier, alors que l'attente, elle, se voit tout de suite.
const RESA_INDEX_TTL = 10 * 60 * 1000;
const factIndexCache = new Map(); // dossier -> { idx, loadedAt }
const factIndexLocks = new Map(); // dossier -> Promise (évite 2 scans parallèles)

const statSafe = (p) => {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
};

// ── INDEX COLONNAIRE de facture.dbf, pour TOUT l'espace commercial ───────────
//
// facture.dbf ≈ 391 Mo / 1,7 M enregistrements, et il est sur un partage réseau
// en production : une lecture complète coûte ~40 s en local et plus d'une minute
// en prod. On ne peut donc pas se permettre de le lire plusieurs fois, ni de le
// charger en objets JS (c'est ce que fait factureCacheService, qui charge en
// plus detail.dbf — 6,2 M lignes — dont l'espace commercial n'a AUCUN besoin :
// le CA et la marge se calculent sur les entêtes, via MONTANT et FACTREV).
//
// UNE seule passe en streaming alimente donc tout le module :
//   - `resas`        : entêtes TYPFACT="R" (réservations / commandes spéciales) ;
//   - colonnes F/A   : TypedArrays (~30 octets/facture) pour la liste des
//                      factures, le CA, la marge et les évolutions N/N-1 ;
//   - `dernierAchat` : date de dernière facture par client (clients à relancer).
//
// Même principe que l'index colonnaire de frequentationService.
const buildFactureIndex = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const p = path.join(entreprise.cheminBase, dossier, "facture.dbf");
  const st = statSafe(p);
  if (!st) throw new Error(`facture.dbf introuvable: ${p}`);

  const t0 = Date.now();
  const dbf = await DBFFile.open(p, { readMode: "loose" });
  const capacite = dbf.recordCount || 2000000;

  // Colonnes des factures/avoirs des années N et N-1.
  const ymd = new Int32Array(capacite); // 20260814
  const tiers = new Int32Array(capacite);
  const repres = new Int16Array(capacite);
  const montant = new Float64Array(capacite);
  const factrev = new Float64Array(capacite);
  const avoir = new Uint8Array(capacite);
  const numfact = new Array(capacite);
  const noms = new Array(capacite);

  const resas = [];
  const dernierAchat = new Map(); // tiers -> ymd le plus récent
  // Dernière FACTURE (TYPFACT="F" seul : un avoir n'est pas une facturation)
  // par client — sert au module d'analyse « Dernière facturation ».
  const dernieresFactures = new Map(); // tiers -> { ymd, numfact, montant, nb, premiere }
  // NUMFACT -> indice de ligne : sert à joindre detail.dbf sans relire les
  // entêtes (voir commercialAnalyseService, analyse par article/rayon/fourn.).
  const parNumfact = new Map();

  const today = new Date();
  const anneeN = today.getFullYear();
  const anneeN1 = anneeN - 1;

  let n = 0;
  let scanned = 0;
  let batch;
  while ((batch = await dbf.readRecords(RESA_BATCH)).length > 0) {
    scanned += batch.length;
    for (const f of batch) {
      const typ = safeTrim(f.TYPFACT).toUpperCase();

      // Réservations / commandes spéciales : entêtes conservés tels quels
      // (quelques centaines de lignes), toutes années confondues.
      if (typ === "R") {
        resas.push({
          numfact: safeTrim(f.NUMFACT),
          date: parseDate(f.DATFACT),
          tiers: safeTrim(f.TIERS),
          nom: safeTrim(f.NOM),
          texte: safeTrim(f.TEXTE),
          montant: num(f.MONTANT),
          repres: safeTrim(f.REPRES),
          etat: Number(f.ETAT),
        });
        continue;
      }

      if (typ !== "F" && typ !== "A") continue;
      const d = parseDate(f.DATFACT);
      if (!d) continue;
      const annee = d.getFullYear();
      const cle =
        annee * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

      // Dernier achat : toutes années (sert au « client à recontacter »).
      const t = safeTrim(f.TIERS);
      if (t) {
        const prev = dernierAchat.get(t);
        if (!prev || cle > prev) dernierAchat.set(t, cle);
      }
      const numf = safeTrim(f.NUMFACT);
      if (numf) parNumfact.set(numf, { ymd: cle, tiers: t, repres: safeTrim(f.REPRES), avoir: typ === "A" });

      if (typ === "F" && t) {
        const cur = dernieresFactures.get(t);
        if (!cur) {
          dernieresFactures.set(t, {
            ymd: cle,
            numfact: numf,
            montant: num(f.MONTANT),
            nb: 1,
            premiere: cle,
          });
        } else {
          cur.nb += 1;
          if (cle < cur.premiere) cur.premiere = cle;
          if (cle >= cur.ymd) {
            cur.ymd = cle;
            cur.numfact = numf;
            cur.montant = num(f.MONTANT);
          }
        }
      }

      // Colonnes : bornées à N / N-1, comme l'analyse commerciaux existante.
      if (annee !== anneeN && annee !== anneeN1) continue;
      if (n >= capacite) continue; // sécurité si recordCount sous-estime
      ymd[n] = cle;
      tiers[n] = parseInt(t, 10) || 0;
      repres[n] = parseInt(safeTrim(f.REPRES), 10) || 0;
      montant[n] = num(f.MONTANT);
      factrev[n] = num(f.FACTREV);
      avoir[n] = typ === "A" ? 1 : 0;
      numfact[n] = safeTrim(f.NUMFACT);
      noms[n] = safeTrim(f.NOM);
      n += 1;
    }
  }

  console.log(
    `[Commercial] Index facture ${dossier}: ${n} factures ${anneeN1}-${anneeN} + ${resas.length} réservations (scan ${scanned} en ${Date.now() - t0}ms)`,
  );

  return {
    n,
    ymd: ymd.subarray(0, n),
    tiers: tiers.subarray(0, n),
    repres: repres.subarray(0, n),
    montant: montant.subarray(0, n),
    factrev: factrev.subarray(0, n),
    avoir: avoir.subarray(0, n),
    numfact,
    noms,
    resas,
    dernierAchat,
    dernieresFactures,
    parNumfact,
    anneeN,
    anneeN1,
  };
};

/** Index facture caché (TTL) + verrou anti-scans concurrents. */
export const getIndexFactures = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const hit = factIndexCache.get(dossier);
  if (hit && Date.now() - hit.loadedAt < RESA_INDEX_TTL) return hit.idx;
  if (factIndexLocks.has(dossier)) return factIndexLocks.get(dossier);

  const promesse = (async () => {
    try {
      const idx = await buildFactureIndex(entreprise);
      factIndexCache.set(dossier, { idx, loadedAt: Date.now() });
      return idx;
    } finally {
      factIndexLocks.delete(dossier);
    }
  })();
  factIndexLocks.set(dossier, promesse);
  return promesse;
};

/**
 * Invalide l'index facture d'une société (bouton « Rafraîchir » des écrans qui
 * s'appuient dessus). Le prochain appel repaie le scan complet — à n'utiliser
 * que sur action explicite de l'utilisateur.
 */
export const invaliderIndexFactures = (dossier) => {
  factIndexCache.delete(dossier);
};

/** Libellé d'un état de réservation (mappingEtatsReservation de la société). */
const libelleEtatResa = (entreprise, etat) => {
  const m = entreprise?.mappingEtatsReservation;
  const key = String(Number(etat));
  if (m) {
    const val = typeof m.get === "function" ? m.get(key) : m[key];
    if (safeTrim(val)) return safeTrim(val);
  }
  return Number(etat) === 2 ? "Commande spéciale" : "Réservation";
};

/** Catégorie métier d'une réservation (facture.ETAT). */
const categorieResa = (etat) => (Number(etat) === 2 ? "speciale" : "reservation");

/** Entêtes de réservation (TYPFACT="R"), issus de l'index facture unique. */
const getReservationsIndex = async (entreprise) =>
  (await getIndexFactures(entreprise)).resas;

// ── INDEX des ENTÊTES proforma ───────────────────────────────────────────────
// proformaCacheService charge aussi prodet.dbf (1,13 M lignes, ~14 s en local
// et bien plus en production) alors que les listes et le tableau de bord n'ont
// besoin que des entêtes (80 k lignes, ~1 s). On ne retombe sur le cache complet
// que pour le DÉTAIL d'un document, quand l'utilisateur le demande.
const proIndexCache = new Map(); // dossier -> { rows, loadedAt }
const proIndexLocks = new Map();

const buildProformaIndex = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const p = path.join(entreprise.cheminBase, dossier, "proforma.dbf");
  if (!statSafe(p)) throw new Error(`proforma.dbf introuvable: ${p}`);

  const t0 = Date.now();
  const dbf = await DBFFile.open(p, { readMode: "loose" });
  const rows = [];
  let batch;
  while ((batch = await dbf.readRecords(RESA_BATCH)).length > 0) {
    for (const r of batch) rows.push(r);
  }
  console.log(
    `[Commercial] Index proforma ${dossier}: ${rows.length} entêtes en ${Date.now() - t0}ms`,
  );
  return rows;
};

const getIndexProformas = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const hit = proIndexCache.get(dossier);
  if (hit && Date.now() - hit.loadedAt < RESA_INDEX_TTL) return hit.rows;
  if (proIndexLocks.has(dossier)) return proIndexLocks.get(dossier);

  const promesse = (async () => {
    try {
      const rows = await buildProformaIndex(entreprise);
      proIndexCache.set(dossier, { rows, loadedAt: Date.now() });
      return rows;
    } finally {
      proIndexLocks.delete(dossier);
    }
  })();
  proIndexLocks.set(dossier, promesse);
  return promesse;
};

/**
 * Réservations / commandes spéciales du commercial.
 * @param {Object} opts categorie ("reservation"|"speciale"), tiers, search,
 *                      fenetreMois (défaut 12, 0 = tout l'historique), page, limit
 */
export const getReservationsCommercial = async (
  entreprise,
  codes,
  opts = {},
) => {
  const {
    categorie,
    tiers,
    search,
    fenetreMois = FENETRE_MOIS_DEFAUT,
    page = 1,
    limit = 50,
  } = opts;

  const [index, cacheClients] = await Promise.all([
    getReservationsIndex(entreprise),
    clientCacheService.getClients(entreprise),
  ]);
  const nomParTiers = new Map(
    (cacheClients.records || []).map((c) => [
      safeTrim(c.TIERS),
      safeTrim(c.NOM),
    ]),
  );

  const limiteYmd = bornePeriode(fenetreMois);

  let rows = index
    .filter((r) => estAMoi(r.repres, codes))
    .map((r) => ({
      numfact: r.numfact,
      date: iso(r.date),
      joursAnciennete: anciennete(r.date),
      tiers: r.tiers,
      nom: r.nom || nomParTiers.get(r.tiers) || "",
      texte: r.texte,
      montant: r.montant,
      repres: r.repres,
      etat: r.etat,
      categorie: categorieResa(r.etat),
      etatLabel: libelleEtatResa(entreprise, r.etat),
    }));

  if (categorie) rows = rows.filter((r) => r.categorie === categorie);
  if (limiteYmd) rows = rows.filter((r) => r.date && r.date >= limiteYmd);

  if (tiers !== undefined && tiers !== null && String(tiers) !== "") {
    const t = String(tiers).trim();
    rows = rows.filter((r) => r.tiers === t);
  }
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.numfact.toLowerCase().includes(q) ||
        r.nom.toLowerCase().includes(q) ||
        r.texte.toLowerCase().includes(q),
    );
  }

  rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const totalRecords = rows.length;
  const totalMontant = rows.reduce((s, r) => s + r.montant, 0);
  const start = (page - 1) * limit;

  return {
    totalRecords,
    totalMontant,
    totalPages: Math.ceil(totalRecords / limit) || 1,
    page,
    limit,
    hasNextPage: start + limit < totalRecords,
    hasPrevPage: page > 1,
    fenetreMois: Number(fenetreMois) || 0,
    reservations: rows.slice(start, start + limit),
  };
};

export { getReservationsIndex };

// ───────────── Disponibilité des réservations (entrées en stock) ─────────────
//
// « Est-ce que ce que mon client a réservé est arrivé ? »
//
// On croise les LIGNES de la réservation (detail.dbf, via resaEntreesService)
// avec les ENTRÉES en stock (entrees.dbf). Une ligne est « arrivée » si son
// article a une entrée POSTÉRIEURE OU ÉGALE à la date de la réservation.
//
// ⚠️ PERF : ce croisement lit detail.dbf (6,2 M lignes) — c'est le même index
// que les alertes, et c'est précisément ce que le reste de l'espace commercial
// évite. Il a donc son PROPRE endpoint, chargé en différé par le front une fois
// la liste des réservations affichée. Ne pas le fusionner avec la liste.

// Profondeur du scan des entrées. Fenêtre volontairement FIXE et arrondie au
// 1er du mois : le cache des entrées est indexé par plage, une plage qui
// changerait à chaque requête ferait rescanner entrees.dbf à chaque fois.
export const FENETRE_DISPO_MOIS = 24;

const fenetreEntrees = () => {
  const debut = new Date();
  debut.setMonth(debut.getMonth() - FENETRE_DISPO_MOIS);
  debut.setDate(1);
  return { start: iso(debut), end: iso(new Date()) };
};

/** Statut d'un document à partir du compte de lignes arrivées. */
const statutDispo = (nbLignes, nbArrivees) => {
  if (!nbLignes) return "inconnu";
  if (nbArrivees === 0) return "attente";
  return nbArrivees >= nbLignes ? "complet" : "partiel";
};

/**
 * Disponibilité (entrée en stock) des réservations du commercial.
 * @returns {Promise<{fenetreMois, periode, total, nbComplets, nbPartiels,
 *                    documents: Object<string, Object>}>}
 */
export const getDisponibilitesReservations = async (
  entreprise,
  codes,
  opts = {},
) => {
  const { fenetreMois = FENETRE_MOIS_DEFAUT } = opts;

  const periode = fenetreEntrees();
  const [{ parDocument }, entrees] = await Promise.all([
    getReservationsIndexes(entreprise),
    getEntreesParArticle(entreprise, periode),
  ]);

  const limiteYmd = bornePeriode(fenetreMois); // "YYYY-MM-DD" ou null
  const limiteBrute = limiteYmd ? limiteYmd.replace(/-/g, "") : null;
  const debutEntrees = periode.start.replace(/-/g, "");

  const documents = {};
  let nbComplets = 0;
  let nbPartiels = 0;

  for (const [numfact, doc] of parDocument) {
    const { header, lignes } = doc;
    if (!estAMoi(header.repres, codes)) continue;
    if (limiteBrute && (!header.datfact || header.datfact < limiteBrute)) {
      continue;
    }

    // Réservation antérieure à la profondeur du scan des entrées : on ne peut
    // rien affirmer, on le dit plutôt que d'afficher « en attente » à tort.
    if (!header.datfact || header.datfact < debutEntrees) {
      documents[numfact] = {
        statut: "inconnu",
        nbLignes: lignes.length,
        nbArrivees: 0,
        dateArrivee: null,
      };
      continue;
    }

    let nbArrivees = 0;
    let derniereArrivee = "";
    for (const l of lignes) {
      const entree = entrees.get(l.nart);
      if (!entree || entree.dateEntree < header.datfact) continue;
      nbArrivees += 1;
      if (entree.dateEntree > derniereArrivee) {
        derniereArrivee = entree.dateEntree;
      }
    }

    const statut = statutDispo(lignes.length, nbArrivees);
    if (statut === "complet") nbComplets += 1;
    if (statut === "partiel") nbPartiels += 1;

    documents[numfact] = {
      statut,
      nbLignes: lignes.length,
      nbArrivees,
      dateArrivee: derniereArrivee ? ymdIso(derniereArrivee) : null,
    };
  }

  return {
    fenetreMois: Number(fenetreMois) || 0,
    periode,
    total: Object.keys(documents).length,
    nbComplets,
    nbPartiels,
    documents,
  };
};

/**
 * Lignes d'UNE réservation, avec leur disponibilité article par article.
 * Renvoie null si le document n'existe pas OU n'appartient pas au commercial
 * (on ne distingue pas les deux cas : pas de fuite d'information).
 */
export const getLignesReservation = async (entreprise, codes, numfact) => {
  const ref = safeTrim(numfact);
  const { parDocument } = await getReservationsIndexes(entreprise);
  const doc = parDocument.get(ref);
  if (!doc || !estAMoi(doc.header.repres, codes)) return null;

  const periode = fenetreEntrees();
  const entrees = await getEntreesParArticle(entreprise, periode);
  const { header } = doc;
  const dateResa = header.datfact || "";
  const horsFenetre = !dateResa || dateResa < periode.start.replace(/-/g, "");

  const lignes = [];
  for (const l of doc.lignes) {
    let article = null;
    try {
      article = await articleCacheService.findByNart(entreprise, l.nart);
    } catch {
      article = null;
    }
    const entree = entrees.get(l.nart) || null;
    const arrive =
      !horsFenetre && !!entree && entree.dateEntree >= dateResa;

    lignes.push({
      nart: safeTrim(article?.NART) || l.nart,
      design: safeTrim(article?.DESIGN),
      gencod: safeTrim(article?.GENCOD),
      qteResa: l.qteResa,
      stockTotal:
        num(article?.S1) +
        num(article?.S2) +
        num(article?.S3) +
        num(article?.S4) +
        num(article?.S5),
      arrive,
      dateEntree: arrive ? ymdIso(entree.dateEntree) : null,
      qteEntree: arrive ? entree.qteEntree : null,
      numcde: arrive ? entree.numcde : "",
    });
  }

  const nbArrivees = lignes.filter((l) => l.arrive).length;
  const derniere = lignes
    .filter((l) => l.dateEntree)
    .map((l) => l.dateEntree)
    .sort()
    .pop();

  return {
    numfact: ref,
    date: header.datfact ? ymdIso(header.datfact) : null,
    tiers: header.tiers == null ? "" : String(header.tiers),
    nom: header.nom,
    texte: header.texte,
    etat: header.etat,
    categorie: categorieResa(header.etat),
    etatLabel: libelleEtatResa(entreprise, header.etat),
    statut: horsFenetre
      ? "inconnu"
      : statutDispo(lignes.length, nbArrivees),
    nbLignes: lignes.length,
    nbArrivees,
    dateArrivee: derniere || null,
    lignes,
  };
};

// ──────────────────────────── Proformas / réservations ──────────────────────

/** Mise en forme d'une proforma pour l'espace commercial. */
const mapProforma = (entreprise, p, suivis) => {
  const etat = Number(p.ETAT);
  const categorie = categorieDeEtat(etat);
  const date = parseDate(p.DATFACT);
  const numfact = safeTrim(p.NUMFACT);
  const suivi = suivis?.get(numfact) || null;
  return {
    numfact,
    date: iso(date),
    joursAnciennete: anciennete(date),
    tiers: safeTrim(p.TIERS),
    nom: safeTrim(p.NOM),
    texte: safeTrim(p.TEXTE),
    montant: num(p.MONTANT),
    repres: safeTrim(p.REPRES),
    etat,
    categorie,
    etatLabel: libelleEtat(entreprise, etat),
    // Libellé d'origine dans l'ERP (ex. « Reservation » pour ETAT=1) : affiché
    // en infobulle, jamais comme libellé principal (collision avec les résa).
    etatLabelErp: libelleEtatErp(entreprise, etat),
    dateChantier: iso(parseDate(p.DATCHANT)),
    relanceLe: suivi ? suivi.faitLe : null,
    relanceCanal: suivi ? suivi.canal : "",
    relanceNote: suivi ? suivi.note : "",
  };
};

/**
 * Proformas du commercial (toutes catégories confondues), triées par date
 * décroissante puis paginées.
 *
 * @param {Object} opts
 *   categorie   : "speciale" | "reservation" | "preparer" | "devis" | undefined
 *   aRelancer   : true -> uniquement les documents non transformés, anciens de
 *                 `joursRelance` jours et non relancés depuis autant de jours
 *   tiers, search, page, limit, joursRelance
 * @param {Map<string,Object>} suivis - relances déjà enregistrées (NUMFACT -> suivi)
 */
export const getProformasCommercial = async (
  entreprise,
  codes,
  opts = {},
  suivis = new Map(),
) => {
  const {
    categorie,
    aRelancer = false,
    tiers,
    search,
    page = 1,
    limit = 50,
    joursRelance = DELAI_RELANCE_DEFAUT,
    fenetreMois = FENETRE_MOIS_DEFAUT,
  } = opts;

  const entetes = await getIndexProformas(entreprise);
  let rows = entetes
    .filter((p) => estAMoi(p.REPRES, codes))
    .map((p) => mapProforma(entreprise, p, suivis));

  if (categorie) rows = rows.filter((r) => r.categorie === categorie);

  // Fenêtre glissante : au-delà, le document est considéré mort (l'ERP ne purge
  // pas). Passer fenetreMois=0 depuis l'écran pour voir tout l'historique.
  const limiteYmd = bornePeriode(fenetreMois);
  if (limiteYmd) rows = rows.filter((r) => r.date && r.date >= limiteYmd);

  if (tiers !== undefined && tiers !== null && String(tiers) !== "") {
    const t = String(tiers).trim();
    rows = rows.filter((r) => r.tiers === t);
  }

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.numfact.toLowerCase().includes(q) ||
        r.nom.toLowerCase().includes(q) ||
        r.texte.toLowerCase().includes(q),
    );
  }

  if (aRelancer) {
    const seuil = Number(joursRelance) || DELAI_RELANCE_DEFAUT;
    rows = rows.filter((r) => {
      // « À préparer » = déjà transformé en commande : rien à relancer.
      if (r.categorie === "preparer") return false;
      if (r.joursAnciennete === null || r.joursAnciennete < seuil) return false;
      // Relancé récemment -> on laisse le délai courir.
      if (r.relanceLe) {
        const j = anciennete(new Date(r.relanceLe));
        if (j !== null && j < seuil) return false;
      }
      return true;
    });
  }
  // Tri unique dans tout l'espace commercial : du plus récent au plus ancien.
  rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const totalRecords = rows.length;
  const totalMontant = rows.reduce((s, r) => s + r.montant, 0);
  const start = (page - 1) * limit;

  return {
    totalRecords,
    totalMontant,
    totalPages: Math.ceil(totalRecords / limit) || 1,
    page,
    limit,
    hasNextPage: start + limit < totalRecords,
    hasPrevPage: page > 1,
    proformas: rows.slice(start, start + limit),
  };
};

/** Lignes détail (prodet) d'une proforma — accès contrôlé en amont. */
export const getLignesProforma = async (entreprise, numfact) => {
  const lignes = await proformaCacheService.getProdetByNumfact(
    entreprise,
    numfact,
  );
  return (lignes || []).map((l) => ({
    nart: safeTrim(l.NART),
    design: safeTrim(l.DESIGN),
    qte: num(l.QTE),
    pvte: num(l.PVTE),
    total: num(l.QTE) * num(l.PVTE),
    commentaire: proformaCacheService.isCommentLine(l),
  }));
};

// ─────────────────────────────── Factures ───────────────────────────────────

/**
 * Factures rattachées au commercial (facture.REPRES ∈ ses codes) OU, pour la
 * fiche client, toutes les factures d'un client de son portefeuille — les
 * factures réalisées par un autre représentant sont alors marquées `parAutre`.
 */
export const getFacturesCommercial = async (entreprise, codes, opts = {}) => {
  const {
    tiers,
    tiersAutorises = null, // Set des TIERS du portefeuille (fiche client)
    typfact = "FA",
    search,
    dateDebut,
    dateFin,
    page = 1,
    limit = 50,
  } = opts;

  // facture.NOM est souvent vide (comptes ouverts) : on retombe sur le nom du
  // client via son TIERS, sinon le commercial lit des lignes anonymes.
  const [idx, cacheClients] = await Promise.all([
    getIndexFactures(entreprise),
    clientCacheService.getClients(entreprise),
  ]);
  const nomParTiers = new Map(
    (cacheClients.records || []).map((c) => [
      safeTrim(c.TIERS),
      safeTrim(c.NOM),
    ]),
  );
  const types = String(typfact || "")
    .toUpperCase()
    .split("")
    .filter(Boolean);
  const veutF = !types.length || types.includes("F");
  const veutA = !types.length || types.includes("A");

  const ymdDeb = dateDebut ? ymdInt(dateDebut) : null;
  const ymdFin = dateFin ? ymdInt(dateFin) : null;
  const tiersCible =
    tiers !== undefined && tiers !== null && String(tiers) !== ""
      ? String(tiers).trim()
      : null;
  const q = search ? search.toLowerCase() : null;

  const rows = [];
  for (let i = 0; i < idx.n; i += 1) {
    const estAvoir = idx.avoir[i] === 1;
    if (estAvoir ? !veutA : !veutF) continue;

    const t = String(idx.tiers[i]);
    const mien = estAMoi(idx.repres[i], codes);

    // Périmètre : mes factures, ou les factures d'un client de mon portefeuille.
    if (tiersAutorises) {
      if (!tiersAutorises.has(t)) continue;
    } else if (!mien) {
      continue;
    }
    if (tiersCible && t !== tiersCible) continue;

    const cle = idx.ymd[i];
    if (ymdDeb && cle < ymdDeb) continue;
    if (ymdFin && cle > ymdFin) continue;

    const numfact = idx.numfact[i];
    const nom = idx.noms[i] || nomParTiers.get(t) || "";
    if (q && !numfact.toLowerCase().includes(q) && !nom.toLowerCase().includes(q)) {
      continue;
    }

    rows.push({
      numfact,
      date: ymdIso(cle),
      typfact: estAvoir ? "A" : "F",
      tiers: t,
      nom,
      texte: "",
      montant: estAvoir
        ? -Math.abs(idx.montant[i])
        : idx.montant[i],
      repres: String(idx.repres[i]),
      parAutre: !mien,
    });
  }

  rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  const totalRecords = rows.length;
  const totalMontant = rows.reduce((s, r) => s + r.montant, 0);
  const start = (page - 1) * limit;

  return {
    totalRecords,
    totalMontant,
    totalPages: Math.ceil(totalRecords / limit) || 1,
    page,
    limit,
    hasNextPage: start + limit < totalRecords,
    hasPrevPage: page > 1,
    factures: rows.slice(start, start + limit),
  };
};

// ──────────────────────────── Portefeuille (liste) ──────────────────────────

/**
 * Liste du portefeuille enrichie CRM : CA N/N-1, nb factures, dernière vente,
 * ancienneté du dernier achat.
 */
export const getPortefeuilleListe = async (entreprise, codes, opts = {}) => {
  const {
    search,
    tri = "ca",
    inactifs = false,
    joursInactif = DELAI_CLIENT_INACTIF,
    page = 1,
    limit = 50,
  } = opts;

  const [{ clients }, stats, dernieres] = await Promise.all([
    getPortefeuille(entreprise, codes),
    getStatsPortefeuille(entreprise, codes),
    getDernieresVentes(entreprise),
  ]);

  let rows = clients.map((c) => {
    const tiers = safeTrim(c.TIERS);
    const st = stats.parTiers.get(tiers);
    const last = dernieres.get(tiers);
    return {
      tiers,
      nom: safeTrim(c.NOM),
      adresse: [safeTrim(c.AD1), safeTrim(c.AD2), safeTrim(c.AD3)]
        .filter(Boolean)
        .join(" "),
      ville: safeTrim(c.AD3) || safeTrim(c.VILLE),
      telephone: safeTrim(c.TEL) || safeTrim(c.TEL1),
      email: safeTrim(c.EMAIL) || safeTrim(c.MAIL),
      categorie: safeTrim(c.CATEGORIE),
      profession: safeTrim(c.PROFES),
      repres: safeTrim(c.REPRES),
      encours: num(c.ENCOURS),
      caN: st ? st.caN : 0,
      caN1: st ? st.caN1 : 0,
      evolCA: st ? st.evolCA : 0,
      margeN: st ? st.margeN : 0,
      nbFacture: st ? st.nbFacture : 0,
      derniereVente: last ? iso(last.date) : null,
      joursSansAchat: last ? anciennete(last.date) : null,
    };
  });

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (r) =>
        r.nom.toLowerCase().includes(q) ||
        r.tiers.toLowerCase().includes(q) ||
        r.ville.toLowerCase().includes(q),
    );
  }

  if (inactifs) {
    const seuil = Number(joursInactif) || DELAI_CLIENT_INACTIF;
    rows = rows.filter(
      (r) => r.joursSansAchat === null || r.joursSansAchat >= seuil,
    );
  }

  const tris = {
    ca: (a, b) => b.caN - a.caN,
    nom: (a, b) => a.nom.localeCompare(b.nom, "fr"),
    recent: (a, b) =>
      String(b.derniereVente || "").localeCompare(String(a.derniereVente || "")),
    ancien: (a, b) => (b.joursSansAchat ?? 99999) - (a.joursSansAchat ?? 99999),
  };
  rows.sort(tris[tri] || tris.ca);

  const totalRecords = rows.length;
  const start = (page - 1) * limit;

  return {
    totalRecords,
    totalPages: Math.ceil(totalRecords / limit) || 1,
    page,
    limit,
    hasNextPage: start + limit < totalRecords,
    hasPrevPage: page > 1,
    totalCaN: rows.reduce((s, r) => s + r.caN, 0),
    clients: rows.slice(start, start + limit),
  };
};

// ─────────────────────────────── Fiche client ───────────────────────────────

/**
 * Fiche client 360° : infos, CA, factures, proformas / réservations /
 * commandes spéciales. Le client DOIT appartenir au portefeuille du commercial.
 * @returns {Promise<Object|null>} null si le client n'est pas dans son portefeuille
 */
export const getFicheClient = async (
  entreprise,
  codes,
  tiers,
  suivis = new Map(),
) => {
  const cible = String(tiers).trim();
  const { clients, tiersSet } = await getPortefeuille(entreprise, codes);
  if (!tiersSet.has(cible)) return null;

  const client = clients.find((c) => safeTrim(c.TIERS) === cible);
  const [stats, dernieres, factures, docs, resas] = await Promise.all([
    getStatsPortefeuille(entreprise, codes),
    getDernieresVentes(entreprise),
    getFacturesCommercial(entreprise, codes, {
      tiers: cible,
      tiersAutorises: tiersSet,
      typfact: "FA",
      limit: 200,
    }),
    // Fiche client : tout l'historique du client (fenetreMois=0), c'est une
    // consultation ciblée et non un compteur d'activité.
    getProformasCommercial(
      entreprise,
      codes,
      { tiers: cible, limit: 500, fenetreMois: 0 },
      suivis,
    ),
    getReservationsCommercial(entreprise, codes, {
      tiers: cible,
      limit: 500,
      fenetreMois: 0,
    }),
  ]);

  const st = stats.parTiers.get(cible) || null;
  const last = dernieres.get(cible) || null;
  const parCategorie = { speciale: [], attente: [], preparer: [], devis: [] };
  docs.proformas.forEach((p) => parCategorie[p.categorie].push(p));
  // Réservations / commandes spéciales : source facture.dbf TYPFACT="R".
  const resasParCat = { reservation: [], speciale: [] };
  resas.reservations.forEach((r) => resasParCat[r.categorie].push(r));

  return {
    client: {
      tiers: cible,
      nom: safeTrim(client.NOM),
      adresse: [safeTrim(client.AD1), safeTrim(client.AD2)]
        .filter(Boolean)
        .join(" "),
      ville: safeTrim(client.AD3) || safeTrim(client.VILLE),
      telephone: safeTrim(client.TEL) || safeTrim(client.TEL1),
      fax: safeTrim(client.FAX),
      email: safeTrim(client.EMAIL) || safeTrim(client.MAIL),
      contact: safeTrim(client.CONTACT),
      categorie: safeTrim(client.CATEGORIE),
      profession: safeTrim(client.PROFES),
      remise: num(client.REMISE),
      encours: num(client.ENCOURS),
      plafond: num(client.PLAFOND),
      repres: safeTrim(client.REPRES),
      ridet: safeTrim(client._ridet || client.AD5),
    },
    kpi: {
      caN: st ? st.caN : 0,
      caN1: st ? st.caN1 : 0,
      evolCA: st ? st.evolCA : 0,
      margeN: st ? st.margeN : 0,
      pctMarge: st ? st.pctMarge : 0,
      nbFacture: st ? st.nbFacture : 0,
      nbFactureN1: st ? st.nbFactureN1 : 0,
      tauxContribution: st ? st.tauxContribution : 0,
      derniereVente: last ? iso(last.date) : null,
      joursSansAchat: last ? anciennete(last.date) : null,
      anneeN: stats.anneeN,
      anneeN1: stats.anneeN1,
      mois: st ? st.mois : new Array(12).fill(0),
    },
    factures: factures.factures,
    totalFactures: factures.totalRecords,
    // Réservations & commandes spéciales : facture.dbf TYPFACT="R".
    reservations: resasParCat.reservation,
    commandesSpeciales: resasParCat.speciale,
    // Documents proforma.dbf du client (à préparer + devis).
    aPreparer: parCategorie.preparer,
    proformas: [
      ...parCategorie.devis,
      ...parCategorie.attente,
      ...parCategorie.speciale,
    ],
  };
};

// ───────────────────── Alertes commandes spéciales reçues ───────────────────

/** Clé stable d'une alerte (sert au marquage « vue » en base). */
export const cleAlerte = (row) =>
  `${safeTrim(row.refResa)}|${safeTrim(row.nart)}|${safeTrim(row.dateEntreeYmd)}`;

/**
 * Réservations / commandes spéciales du commercial dont l'article vient
 * d'ENTRER EN STOCK. Réutilise tel quel le service « Entrées sur réservation ».
 *
 * ⚠️ PERF : premier appel = scan streaming facture.dbf + detail.dbf (plusieurs
 * dizaines de secondes sur les grosses sociétés), puis cache 10 min côté
 * resaEntreesService. C'est pourquoi les alertes ont leur propre endpoint et ne
 * bloquent pas le chargement du dashboard.
 */
export const getAlertesCommandesSpeciales = async (
  entreprise,
  codes,
  opts = {},
) => {
  const { jours = FENETRE_ALERTES_JOURS, vues = new Set() } = opts;
  const fin = new Date();
  const debut = new Date(fin.getTime() - Number(jours) * 86400000);

  const { rows } = await getResaEntrees(entreprise, {
    start: iso(debut),
    end: iso(fin),
  });

  return rows
    .filter((r) => estAMoi(r.vendeurCode, codes))
    .map((r) => {
      const cle = cleAlerte(r);
      return {
        cle,
        nart: r.nart,
        design: r.design,
        gencod: r.gencod,
        qteResa: r.qteResa,
        qteEntree: r.qteEntree,
        stockTotal: r.stockTotal,
        dateEntree: r.dateEntree,
        dateEntreeYmd: r.dateEntreeYmd,
        client: r.client,
        tiers: r.tiers,
        refResa: r.refResa,
        texteResa: r.texteResa,
        dateResa: r.dateResa,
        etatResa: r.etatResa,
        etatCode: r.etatCode,
        vue: vues.has(cle),
      };
    });
};

// ───────────────────────────────── Dashboard ────────────────────────────────

/**
 * Bloc dashboard RAPIDE d'UNE société : portefeuille et documents.
 *
 * ⚠️ N'utilise QUE les caches clients (~3 s à froid) et proformas (~35 s) —
 * surtout PAS le cache factures, dont le chargement dépasse deux minutes sur
 * les grosses sociétés (1,7 M factures) et qui s'invalide à chaque facturation.
 * Le chiffre d'affaires et les clients à recontacter en dépendent : ils sont
 * servis à part par getCaSociete, pour ne pas retarder la page d'accueil.
 */
export const getDashboardSociete = async (
  entreprise,
  codes,
  opts = {},
  suivis = new Map(),
) => {
  const {
    joursRelance = DELAI_RELANCE_DEFAUT,
    fenetreMois = FENETRE_MOIS_DEFAUT,
  } = opts;

  const [{ clients }, entetes, resas] = await Promise.all([
    getPortefeuille(entreprise, codes),
    getIndexProformas(entreprise),
    getReservationsCommercial(entreprise, codes, {
      fenetreMois,
      limit: 100000,
    }),
  ]);

  // Fenêtre glissante : l'ERP ne purge pas, sans borne les compteurs remontent
  // à 2019 et ne veulent plus rien dire.
  const limiteYmd = bornePeriode(fenetreMois);
  const docs = entetes
    .filter((p) => estAMoi(p.REPRES, codes))
    .map((p) => mapProforma(entreprise, p, suivis))
    .filter((d) => !limiteYmd || (d.date && d.date >= limiteYmd));

  const compte = (cat) => docs.filter((d) => d.categorie === cat);
  const preparer = compte("preparer");
  // Documents proforma relançables : devis + « réservations » proforma (ETAT=1),
  // qui sont des documents en attente et non les réservations fermes.
  const devis = [
    ...compte("devis"),
    ...compte("attente"),
    ...compte("speciale"),
  ];
  // Réservations & commandes spéciales fermes : facture.dbf TYPFACT="R".
  const reservations = resas.reservations.filter(
    (r) => r.categorie === "reservation",
  );
  const speciales = resas.reservations.filter(
    (r) => r.categorie === "speciale",
  );

  const seuilRelance = Number(joursRelance) || DELAI_RELANCE_DEFAUT;
  const aRelancer = docs.filter((d) => {
    if (d.categorie === "preparer") return false;
    if (d.joursAnciennete === null || d.joursAnciennete < seuilRelance)
      return false;
    if (d.relanceLe) {
      const j = anciennete(new Date(d.relanceLe));
      if (j !== null && j < seuilRelance) return false;
    }
    return true;
  });

  const totalDoc = (list) => list.reduce((s, d) => s + d.montant, 0);

  return {
    entreprise: {
      _id: entreprise._id,
      nomDossierDBF: entreprise.nomDossierDBF,
      trigramme: entreprise.trigramme,
      nomComplet: entreprise.nomComplet,
    },
    codes,
    fenetreMois: Number(fenetreMois) || 0,
    portefeuille: {
      nbClients: clients.length,
    },
    documents: {
      reservations: { nb: reservations.length, montant: totalDoc(reservations) },
      speciales: { nb: speciales.length, montant: totalDoc(speciales) },
      preparer: { nb: preparer.length, montant: totalDoc(preparer) },
      devis: { nb: devis.length, montant: totalDoc(devis) },
      aRelancer: { nb: aRelancer.length, montant: totalDoc(aRelancer) },
    },
    // Aperçus directement cliquables depuis le dashboard.
    apercus: {
      aRelancer: aRelancer
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
        .slice(0, 8),
      reservations: reservations
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
        .slice(0, 8),
      speciales: speciales
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
        .slice(0, 8),
    },
  };
};

/**
 * Volet CHIFFRE D'AFFAIRES d'une société : CA N/N-1, marge, top clients et
 * clients à recontacter. Servi par un endpoint séparé car il s'appuie sur le
 * cache des factures (long à (re)construire) — le dashboard l'affiche en
 * différé, sans bloquer les indicateurs de documents.
 */
export const getCaSociete = async (entreprise, codes, opts = {}) => {
  const { joursInactif = DELAI_CLIENT_INACTIF } = opts;

  const [{ clients }, stats, dernieres] = await Promise.all([
    getPortefeuille(entreprise, codes),
    getStatsPortefeuille(entreprise, codes),
    getDernieresVentes(entreprise),
  ]);

  // Clients à recontacter : aucun achat depuis `joursInactif` jours.
  const seuilInactif = Number(joursInactif) || DELAI_CLIENT_INACTIF;
  const aContacter = [];
  clients.forEach((c) => {
    const tiers = safeTrim(c.TIERS);
    const last = dernieres.get(tiers);
    const j = last ? anciennete(last.date) : null;
    if (j === null || j >= seuilInactif) {
      const st = stats.parTiers.get(tiers);
      aContacter.push({
        tiers,
        nom: safeTrim(c.NOM),
        telephone: safeTrim(c.TEL) || safeTrim(c.TEL1),
        derniereVente: last ? iso(last.date) : null,
        joursSansAchat: j,
        caN: st ? st.caN : 0,
      });
    }
  });
  aContacter.sort((a, b) => b.caN - a.caN);

  return {
    entreprise: {
      _id: entreprise._id,
      nomDossierDBF: entreprise.nomDossierDBF,
      trigramme: entreprise.trigramme,
      nomComplet: entreprise.nomComplet,
    },
    portefeuille: {
      nbClients: clients.length,
      nbClientsActifs: stats.parTiers.size,
      top: stats.top.slice(0, 3).map((c) => ({
        tiers: c.tiers,
        nom: c.nomTiers,
        caN: c.caN,
        caN1: c.caN1,
        evolCA: c.evolCA,
        partPct: c.tauxContribution,
      })),
      nbAContacter: aContacter.length,
      aContacter: aContacter.slice(0, 10),
    },
    ca: {
      anneeN: stats.anneeN,
      anneeN1: stats.anneeN1,
      dateArret: stats.dateArret,
      caN: stats.totaux.caN,
      caN1: stats.totaux.caN1,
      evolCa: stats.totaux.evolCa,
      margeN: stats.totaux.margeN,
      pctMarge: stats.totaux.pctMarge,
      nbFactures: stats.totaux.nbFactures,
      panierMoyen: stats.totaux.panierMoyen,
      nbClientsNouveaux: stats.totaux.nbClientsNouveaux,
      nbClientsPerdus: stats.totaux.nbClientsPerdus,
      moisN: stats.moisN,
      moisN1: stats.moisN1,
      mois: stats.mois,
    },
  };
};

// ───────────────────────── Préchauffage des index ───────────────────────────
//
// Sans lui, c'est un commercial qui paie la reconstruction de l'index facture
// (~35 s en local, davantage sur le partage réseau de production) toutes les
// 10 minutes. On le reconstruit donc en tâche de fond, un peu avant l'expiration
// du TTL, pour les seules sociétés ayant au moins un commercial actif.
const PRECHAUFFE_MS = 8 * 60 * 1000;
let prechauffeTimer = null;

const prechaufferUneFois = async () => {
  try {
    const { default: Permission } = await import("../models/PermissionModel.js");
    const { default: Entreprise } = await import(
      "../models/EntrepriseModel.js"
    );

    const perms = await Permission.find({ "commercial.actif": true }).select(
      "commercial",
    );
    const ids = new Set();
    perms.forEach((p) =>
      (p.commercial?.codes || []).forEach(
        (l) => l?.entreprise && ids.add(l.entreprise.toString()),
      ),
    );
    if (!ids.size) return;

    const entreprises = await Entreprise.find({
      _id: { $in: [...ids] },
      isActive: true,
    });

    // Import dynamique : commercialAnalyseService dépend de ce module
    // (getIndexFactures), un import statique créerait un cycle.
    const { getIndexDetail } = await import("./commercialAnalyseService.js");

    for (const e of entreprises) {
      try {
        await Promise.all([getIndexFactures(e), getIndexProformas(e)]);
        // Index des lignes de détail (analyses + prime) : le plus lourd
        // (~165 s), donc surtout pas payé par un utilisateur.
        await getIndexDetail(e);
        // Réservations ligne à ligne + entrées en stock : sert la colonne
        // « Stock » de l'écran Réservations et les alertes. Scan facture.dbf +
        // detail.dbf (~142 s en local) — même raison de le préchauffer.
        await getReservationsIndexes(e);
        await getEntreesParArticle(e, fenetreEntrees());
      } catch (err) {
        console.error(
          `[Commercial] Préchauffage ${e.nomDossierDBF} échoué:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error("[Commercial] Préchauffage impossible:", err.message);
  }
};

/**
 * Démarre le préchauffage périodique des index de l'espace commercial.
 * À appeler depuis server.js, comme startInventaireWatcher().
 */
export const startCommercialIndexWarmer = () => {
  if (prechauffeTimer) return;
  console.log(
    `[Commercial] Préchauffage des index toutes les ${PRECHAUFFE_MS / 60000} min`,
  );
  // Premier passage différé : on laisse le serveur finir de démarrer.
  setTimeout(prechaufferUneFois, 15000);
  prechauffeTimer = setInterval(prechaufferUneFois, PRECHAUFFE_MS);
  if (typeof prechauffeTimer.unref === "function") prechauffeTimer.unref();
};

export default {
  startCommercialIndexWarmer,
  CATEGORIES,
  DELAI_RELANCE_DEFAUT,
  DELAI_CLIENT_INACTIF,
  FENETRE_ALERTES_JOURS,
  FENETRE_MOIS_DEFAUT,
  getReservationsCommercial,
  getDisponibilitesReservations,
  getLignesReservation,
  FENETRE_DISPO_MOIS,
  getPortefeuille,
  getPortefeuilleListe,
  getStatsPortefeuille,
  getProformasCommercial,
  getLignesProforma,
  getFacturesCommercial,
  getFicheClient,
  getAlertesCommandesSpeciales,
  getDashboardSociete,
  getCaSociete,
  cleAlerte,
};
