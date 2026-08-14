// backend/services/commercialService.js
//
// ESPACE COMMERCIAL — toute la donnée métier d'un commercial, filtrée sur le
// couple SOCIÉTÉ + CODE(S) VENDEUR (REPRES).
//
// Le module ne duplique AUCUN traitement : il s'appuie sur les caches DBF déjà
// en place (clients / factures / proformas) et sur les services d'analyse
// existants :
//   - clientCacheService     -> portefeuille (clients.REPRES)
//   - factureCacheService    -> factures (facture.REPRES)
//   - proformaCacheService   -> proformas, réservations, commandes spéciales
//                               (proforma.REPRES + proforma.ETAT)
//   - commerciauxService     -> CA / marge / top clients (analyse déjà cachée)
//   - resaEntreesService     -> alertes « réservation entrée en stock »
//
// Catégories issues de proforma.ETAT — MÊME convention que l'écran Réservations
// (screens/admin/AdminReservationsScreen.jsx) :
//     0 = commande spéciale · 1 = réservation · 2 = à préparer · autre = devis
// Les libellés affichés viennent de entreprise.mappingEtatsProforma quand il
// est renseigné.

import path from "path";
import fs from "fs";
import { DBFFile } from "dbffile";
import clientCacheService from "./clientCacheService.js";
import factureCacheService from "./factureCacheService.js";
import proformaCacheService from "./proformaCacheService.js";
import commerciauxService from "./commerciauxService.js";
import { getResaEntrees } from "./resaEntreesService.js";
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

/** Nombre de jours entiers écoulés depuis `d` (null si date absente). */
const anciennete = (d) => {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
};

/** Le REPRES d'un enregistrement fait-il partie des codes du commercial ? */
const estAMoi = (repres, codes) => codes.some((c) => sameCode(c, repres));

// Catégories métier dérivées de proforma.ETAT.
export const CATEGORIES = {
  speciale: { etat: 0, label: "Commande spéciale" },
  reservation: { etat: 1, label: "Réservation" },
  preparer: { etat: 2, label: "À préparer" },
  devis: { etat: null, label: "Proforma / devis" },
};

const categorieDeEtat = (etat) => {
  const e = Number(etat);
  if (e === 0) return "speciale";
  if (e === 1) return "reservation";
  if (e === 2) return "preparer";
  return "devis";
};

/** Libellé d'état : mapping société prioritaire, sinon libellé de catégorie. */
const libelleEtat = (entreprise, etat) => {
  const mapping = entreprise?.mappingEtatsProforma;
  const key = String(Number(etat));
  if (mapping) {
    const val =
      typeof mapping.get === "function" ? mapping.get(key) : mapping[key];
    if (safeTrim(val)) return safeTrim(val);
  }
  return CATEGORIES[categorieDeEtat(etat)].label;
};

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
 * Statistiques CA/marge du portefeuille, reprises de l'analyse commerciaux
 * DÉJÀ calculée et cachée (aucun recalcul spécifique au module).
 * @returns {Promise<{parTiers: Map<string,Object>, totaux: Object, top: Array}>}
 */
export const getStatsPortefeuille = async (entreprise, codes) => {
  const analyse = await commerciauxService.getAnalyse(entreprise);
  const miens = (analyse.commerciaux || []).filter((c) =>
    estAMoi(c.code, codes),
  );

  const parTiers = new Map();
  miens.forEach((com) => {
    (com.clients || []).forEach((cl) => {
      const prev = parTiers.get(cl.tiers);
      // Un client n'appartient qu'à un seul REPRES : pas de fusion attendue,
      // mais on additionne par prudence si un code est dupliqué.
      if (!prev) parTiers.set(cl.tiers, { ...cl });
      else {
        prev.caN += cl.caN;
        prev.caN1 += cl.caN1;
        prev.margeN += cl.margeN;
        prev.nbFacture += cl.nbFacture;
      }
    });
  });

  const totaux = commerciauxService.computeTotaux(miens);
  const top = [...parTiers.values()].sort((a, b) => b.caN - a.caN);

  return {
    parTiers,
    totaux,
    top,
    anneeN: analyse.anneeN,
    anneeN1: analyse.anneeN1,
    dateArret: analyse.dateArret,
    mois: analyse.mois,
    moisN: miens.reduce(
      (acc, c) => acc.map((v, i) => v + (c.moisN?.[i] || 0)),
      new Array(12).fill(0),
    ),
    moisN1: miens.reduce(
      (acc, c) => acc.map((v, i) => v + (c.moisN1?.[i] || 0)),
      new Array(12).fill(0),
    ),
  };
};

// ───────────────── Dernière facture par client (clients à recontacter) ──────

const dernieresVentesCache = new Map(); // dossier -> { map, builtAt }
const DERNIERES_VENTES_TTL = 5 * 60 * 1000;

/** Map TIERS -> { date, montant, numfact } de la dernière facture (TYPFACT F/A). */
const getDernieresVentes = async (entreprise) => {
  const key = entreprise.nomDossierDBF;
  const hit = dernieresVentesCache.get(key);
  if (hit && Date.now() - hit.builtAt < DERNIERES_VENTES_TTL) return hit.map;

  const cache = await factureCacheService.getFactures(entreprise);
  const map = new Map();
  for (const f of cache.factureRecords || []) {
    const typ = safeTrim(f.TYPFACT).toUpperCase();
    if (typ !== "F" && typ !== "A") continue;
    const tiers = safeTrim(f.TIERS);
    if (!tiers) continue;
    const d = parseDate(f.DATFACT);
    if (!d) continue;
    const prev = map.get(tiers);
    if (!prev || d > prev.date) {
      map.set(tiers, {
        date: d,
        montant: num(f.MONTANT),
        numfact: safeTrim(f.NUMFACT),
      });
    }
  }
  dernieresVentesCache.set(key, { map, builtAt: Date.now() });
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
// le scan complet (~40 s) à presque chaque requête en journée. Une réservation
// créée à l'instant apparaît donc avec au plus 10 minutes de retard — sans
// conséquence métier, alors que l'attente, elle, se voit tout de suite.
const RESA_INDEX_TTL = 10 * 60 * 1000;
const resaIndexCache = new Map(); // dossier -> { rows, loadedAt }

const statSafe = (p) => {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
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

/** Index des entêtes de réservation (facture.dbf TYPFACT="R"), caché. */
const getReservationsIndex = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const p = path.join(entreprise.cheminBase, dossier, "facture.dbf");
  const st = statSafe(p);
  if (!st) throw new Error(`facture.dbf introuvable: ${p}`);

  const hit = resaIndexCache.get(dossier);
  if (hit && Date.now() - hit.loadedAt < RESA_INDEX_TTL) return hit.rows;

  const t0 = Date.now();
  const dbf = await DBFFile.open(p, { readMode: "loose" });
  const rows = [];
  let batch;
  let scanned = 0;
  while ((batch = await dbf.readRecords(RESA_BATCH)).length > 0) {
    scanned += batch.length;
    for (const r of batch) {
      if (safeTrim(r.TYPFACT).toUpperCase() !== "R") continue;
      rows.push({
        numfact: safeTrim(r.NUMFACT),
        date: parseDate(r.DATFACT),
        tiers: safeTrim(r.TIERS),
        nom: safeTrim(r.NOM),
        texte: safeTrim(r.TEXTE),
        montant: num(r.MONTANT),
        repres: safeTrim(r.REPRES),
        etat: Number(r.ETAT),
      });
    }
  }

  resaIndexCache.set(dossier, { rows, loadedAt: Date.now() });
  console.log(
    `[Commercial] Index réservations ${dossier}: ${rows.length} TYPFACT=R sur ${scanned} factures en ${Date.now() - t0}ms`,
  );
  return rows;
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

  const cache = await proformaCacheService.getProformas(entreprise);
  let rows = (cache.proformaRecords || [])
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
    rows.sort((a, b) => (b.joursAnciennete || 0) - (a.joursAnciennete || 0));
  } else {
    rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }

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
  const [cache, cacheClients] = await Promise.all([
    factureCacheService.getFactures(entreprise),
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

  const dDeb = dateDebut ? parseDate(dateDebut) : null;
  const dFin = dateFin ? parseDate(dateFin) : null;

  let rows = [];
  for (const f of cache.factureRecords || []) {
    const typ = safeTrim(f.TYPFACT).toUpperCase();
    if (types.length && !types.includes(typ)) continue;

    const t = safeTrim(f.TIERS);
    const mien = estAMoi(f.REPRES, codes);

    // Périmètre : mes factures, ou les factures d'un client de mon portefeuille.
    if (tiersAutorises) {
      if (!tiersAutorises.has(t)) continue;
    } else if (!mien) {
      continue;
    }

    if (tiers !== undefined && tiers !== null && String(tiers) !== "") {
      if (t !== String(tiers).trim()) continue;
    }

    const d = parseDate(f.DATFACT);
    if (dDeb && (!d || d < dDeb)) continue;
    if (dFin && (!d || d > dFin)) continue;

    const nom = safeTrim(f.NOM) || nomParTiers.get(t) || "";
    const numfact = safeTrim(f.NUMFACT);
    if (search) {
      const q = search.toLowerCase();
      if (
        !numfact.toLowerCase().includes(q) &&
        !nom.toLowerCase().includes(q) &&
        !safeTrim(f.TEXTE).toLowerCase().includes(q)
      ) {
        continue;
      }
    }

    const montant = typ === "A" ? -Math.abs(num(f.MONTANT)) : num(f.MONTANT);
    rows.push({
      numfact,
      date: iso(d),
      typfact: typ,
      tiers: t,
      nom,
      texte: safeTrim(f.TEXTE),
      montant,
      repres: safeTrim(f.REPRES),
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
  const parCategorie = { speciale: [], reservation: [], preparer: [], devis: [] };
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
    proformas: [...parCategorie.devis, ...parCategorie.reservation],
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

  const [{ clients }, cacheProforma, resas] = await Promise.all([
    getPortefeuille(entreprise, codes),
    proformaCacheService.getProformas(entreprise),
    getReservationsCommercial(entreprise, codes, {
      fenetreMois,
      limit: 100000,
    }),
  ]);

  // Fenêtre glissante : l'ERP ne purge pas, sans borne les compteurs remontent
  // à 2019 et ne veulent plus rien dire.
  const limiteYmd = bornePeriode(fenetreMois);
  const docs = (cacheProforma.proformaRecords || [])
    .filter((p) => estAMoi(p.REPRES, codes))
    .map((p) => mapProforma(entreprise, p, suivis))
    .filter((d) => !limiteYmd || (d.date && d.date >= limiteYmd));

  const compte = (cat) => docs.filter((d) => d.categorie === cat);
  const preparer = compte("preparer");
  // Documents proforma relançables : devis + « réservations » proforma (ETAT=1),
  // qui sont des documents en attente et non les réservations fermes.
  const devis = [...compte("devis"), ...compte("reservation")];
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
        .sort((a, b) => (b.joursAnciennete || 0) - (a.joursAnciennete || 0))
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

export default {
  CATEGORIES,
  DELAI_RELANCE_DEFAUT,
  DELAI_CLIENT_INACTIF,
  FENETRE_ALERTES_JOURS,
  FENETRE_MOIS_DEFAUT,
  getReservationsCommercial,
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
