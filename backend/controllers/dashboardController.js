// backend/controllers/dashboardController.js
//
// KPI du tableau de bord admin.
//  - GET /api/dashboard/global                  : agrégats Mongo, toutes entreprises
//  - GET /api/dashboard/entreprise/:nomDossierDBF : agrégats DBF d'une entreprise
//
// Toutes les routes sont protégées par protect + admin (voir dashboardRoutes.js).

import asyncHandler from "../middleware/asyncHandler.js";
import Reception from "../models/ReceptionModel.js";
import Inventaire from "../models/InventaireModel.js";
import Releve from "../models/ReleveModel.js";
import Reappro from "../models/ReaproModel.js";
import Task from "../models/TaskModel.js";
import AiSalesSnapshot from "../models/AiSalesSnapshotModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import commandeCacheService from "../services/commandeService.js";
import articleCacheService from "../services/articleService.js";
import fournissCacheService from "../services/fournissCacheService.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const num = (v) => {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(
    x.getDate(),
  ).padStart(2, "0")}`;
};

// Lecture robuste d'un champ DBF (insensible casse/espaces).
const lireChamp = (rec, ...names) => {
  if (!rec) return undefined;
  for (const name of names) {
    if (rec[name] !== undefined) return rec[name];
  }
  const targets = names.map((n) => n.toUpperCase());
  for (const k of Object.keys(rec)) {
    if (targets.includes(k.toUpperCase().trim())) return rec[k];
  }
  return undefined;
};

// Ventes annuelles = somme V1..V12 (ventes mensuelles). any = au moins un champ V présent.
const ventes12 = (art) => {
  let total = 0;
  let any = false;
  for (let i = 1; i <= 12; i++) {
    const v = lireChamp(art, `V${i}`, `V${String(i).padStart(2, "0")}`);
    if (v !== undefined) {
      any = true;
      total += num(v);
    }
  }
  return { total, any };
};

const stockTotal = (art) =>
  num(art.S1) + num(art.S2) + num(art.S3) + num(art.S4) + num(art.S5);

const ETAT_LABELS = {
  0: "Brouillon",
  1: "En cours",
  2: "Expédiée",
  3: "Réceptionnée",
  4: "Clôturée",
};

// ===========================================================================
// GLOBAL (Mongo, toutes entreprises)
// ===========================================================================
const NB_JOURS = 14;

export const getGlobalStats = asyncHandler(async (req, res) => {
  // Périmètre de l'utilisateur : un admin scopé ne voit que SES entreprises.
  const access = await getAccessibleEntreprises(req.user);
  const entFilter = access.all ? {} : { entreprise: { $in: access.ids } };

  // --- Réceptions : statuts + conformité + écarts + nouveautés ---
  const receptions = await Reception.find(
    { ...entFilter },
    {
      status: 1,
      lignesCommande: 1,
      comptages: 1,
      createdAt: 1,
    },
  ).lean();

  let recEnCours = 0;
  let recTermine = 0;
  let totalLignes = 0;
  let lignesConformes = 0;
  let totalEcarts = 0;
  let nouveautes = 0;

  for (const r of receptions) {
    if (r.status === "termine") recTermine += 1;
    else recEnCours += 1;

    if (r.status !== "termine") continue;

    const cByNart = new Map();
    (r.comptages || []).forEach((c) => {
      if (c.nart) cByNart.set(c.nart, c);
    });

    for (const l of r.lignesCommande || []) {
      totalLignes += 1;
      const c = cByNart.get(l.nart);
      const retenue = c ? (c.qteValidee != null ? c.qteValidee : c.qteComptee) : 0;
      const ecart = retenue - (l.qteCommandee || 0);
      if (ecart === 0) lignesConformes += 1;
      else totalEcarts += 1;
      if (l.estNouveau || (c && c.estNouveau)) nouveautes += 1;
    }
    // Nouveautés hors commande
    (r.comptages || []).forEach((c) => {
      if ((!c.dansCommande || c.isInconnu) && c.estNouveau) nouveautes += 1;
    });
  }

  const tauxConformite =
    totalLignes > 0 ? Math.round((lignesConformes / totalLignes) * 100) : null;

  // --- Compteurs sessions (en cours / total) ---
  const [
    invEnCours,
    invTotal,
    relEnCours,
    relExporte,
    relTotal,
    reaEnCours,
    reaTotal,
  ] = await Promise.all([
    Inventaire.countDocuments({ ...entFilter, status: "en_cours" }),
    Inventaire.countDocuments({ ...entFilter }),
    Releve.countDocuments({ ...entFilter, status: "en_cours" }),
    Releve.countDocuments({ ...entFilter, status: "exporte" }),
    Releve.countDocuments({ ...entFilter }),
    Reappro.countDocuments({ ...entFilter, status: "en_cours" }),
    Reappro.countDocuments({ ...entFilter }),
  ]);

  // --- Activité réelle (NB_JOURS derniers jours), bucketisée en JS ---
  const since = startOfDay(Date.now());
  since.setDate(since.getDate() - (NB_JOURS - 1));

  const fetchDates = (Model) =>
    Model.find(
      { ...entFilter, createdAt: { $gte: since } },
      { createdAt: 1 },
    ).lean();

  const [rDates, iDates, lDates] = await Promise.all([
    fetchDates(Reception),
    fetchDates(Inventaire),
    fetchDates(Releve),
  ]);

  const buckets = [];
  const idxByKey = new Map();
  for (let k = 0; k < NB_JOURS; k++) {
    const d = new Date(since);
    d.setDate(d.getDate() + k);
    const key = ymd(d);
    idxByKey.set(key, k);
    buckets.push({
      date: key,
      jour: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }),
      receptions: 0,
      inventaires: 0,
      releves: 0,
    });
  }
  const addDates = (dates, field) => {
    for (const o of dates) {
      if (!o.createdAt) continue;
      const k = idxByKey.get(ymd(o.createdAt));
      if (k != null) buckets[k][field] += 1;
    }
  };
  addDates(rDates, "receptions");
  addDates(iDates, "inventaires");
  addDates(lDates, "releves");

  res.json({
    receptions: {
      enCours: recEnCours,
      termine: recTermine,
      total: recEnCours + recTermine,
      tauxConformite, // %
      totalEcarts, // lignes en écart (réceptions terminées)
      nouveautes, // nouveautés détectées (occurrences)
    },
    inventaires: { enCours: invEnCours, total: invTotal },
    releves: { enCours: relEnCours, exporte: relExporte, total: relTotal },
    reappros: { enCours: reaEnCours, total: reaTotal },
    activite: buckets,
    nbJours: NB_JOURS,
  });
});

// ===========================================================================
// ENTREPRISE (DBF, une entreprise)
// ===========================================================================
export const getEntrepriseStats = asyncHandler(async (req, res) => {
  const { nomDossierDBF } = req.params;
  const entreprise = await Entreprise.findOne({ nomDossierDBF });
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise introuvable");
  }

  // --- Commandes (cmdref) : par état, top fournisseurs, à réceptionner, bateaux ---
  const [etatsRaw, fournRaw, cmdRef] = await Promise.all([
    commandeCacheService.getEtats(entreprise),
    commandeCacheService.getFournisseurs(entreprise),
    commandeCacheService.getCmdRef(entreprise),
  ]);

  const commandesParEtat = etatsRaw.map((e) => ({
    etat: e.code,
    label: ETAT_LABELS[e.code] ?? `État ${e.code}`,
    count: e.count,
  }));
  const totalCommandes = etatsRaw.reduce((s, e) => s + e.count, 0);
  const aReceptionner = etatsRaw
    .filter((e) => Number(e.code) >= 4)
    .reduce((s, e) => s + e.count, 0);

  // Top fournisseurs (par nb de commandes) avec résolution du nom
  const topFournRaw = [...fournRaw].sort((a, b) => b.count - a.count).slice(0, 6);
  const topFournisseurs = [];
  for (const f of topFournRaw) {
    let nom = `Fourn. ${f.code}`;
    try {
      const rec = await fournissCacheService.findByFourn(entreprise, f.code);
      if (rec && rec.NOM && String(rec.NOM).trim()) nom = String(rec.NOM).trim();
    } catch {
      /* ignore */
    }
    topFournisseurs.push({ code: f.code, nom, count: f.count });
  }

  // Prochains bateaux : ARRIVEE >= aujourd'hui, regroupés par bateau + date
  const today = startOfDay(Date.now());
  const bateauxMap = new Map();
  for (const rec of cmdRef.records || []) {
    const arr = rec.ARRIVEE ? new Date(rec.ARRIVEE) : null;
    if (!arr || isNaN(arr.getTime()) || arr < today) continue;
    const bateau = rec.BATEAU ? String(rec.BATEAU).trim() : "";
    const key = `${bateau}|${ymd(arr)}`;
    const cur = bateauxMap.get(key) || { bateau, arrivee: arr, count: 0 };
    cur.count += 1;
    bateauxMap.set(key, cur);
  }
  const prochainsBateaux = [...bateauxMap.values()]
    .sort((a, b) => a.arrivee - b.arrivee)
    .slice(0, 6)
    .map((b) => ({ bateau: b.bateau, arrivee: b.arrivee, count: b.count }));

  // --- Articles (article.dbf) : top ventes, nouveautés, ruptures ---
  const artCache = await articleCacheService.getArticles(entreprise);
  const records = artCache.records || [];

  let nbNouveautes = 0;
  let nbRuptures = 0;
  const ventesArr = [];
  const rupturesArr = [];

  for (const a of records) {
    const { total: v, any } = ventes12(a);
    const st = stockTotal(a);
    const nart = a.NART ? String(a.NART).trim() : "";
    const design = a.DESIGN ? String(a.DESIGN).trim() : "";

    if (any && v === 0) nbNouveautes += 1; // jamais vendu = nouveauté
    if (st <= 0 && v > 0) {
      nbRuptures += 1; // a déjà vendu mais stock épuisé
      rupturesArr.push({ nart, design, ventes: v, stock: st });
    }
    if (v > 0) {
      ventesArr.push({ nart, design, ventes: v, stock: st, pv: num(a.PVTETTC) });
    }
  }

  ventesArr.sort((a, b) => b.ventes - a.ventes);
  rupturesArr.sort((a, b) => b.ventes - a.ventes);

  res.json({
    entreprise: {
      _id: entreprise._id,
      nomDossierDBF: entreprise.nomDossierDBF,
      nom: entreprise.nomComplet || entreprise.nom || entreprise.nomDossierDBF,
      trigramme: entreprise.trigramme || "",
    },
    commandes: {
      total: totalCommandes,
      parEtat: commandesParEtat,
      aReceptionner,
      topFournisseurs,
      prochainsBateaux,
    },
    articles: {
      totalArticles: records.length,
      nbNouveautes,
      nbRuptures,
      topVentes: ventesArr.slice(0, 10),
      topRuptures: rupturesArr.slice(0, 8),
    },
  });
});

// ===========================================================================
// PERSONNEL (« mon » tableau de bord) — accessible à TOUT utilisateur connecté.
// Données scopées à SES sociétés (getAccessibleEntreprises) et à SES tâches.
// GET /api/dashboard/me
// ===========================================================================
export const getMyDashboard = asyncHandler(async (req, res) => {
  const me = req.user._id;
  const access = await getAccessibleEntreprises(req.user);
  const entFilter = access.all ? {} : { entreprise: { $in: access.ids } };
  const now = new Date();
  const since7 = new Date(now);
  since7.setDate(now.getDate() - 7);

  // --- Mes tâches (assignées à moi OU créées par moi) ---
  const mine = { $or: [{ assignes: me }, { creePar: me }] };
  const actives = { ...mine, archive: { $ne: true } };
  const [aFaire, enCoursT, bloque, enRetard, termine7j] = await Promise.all([
    Task.countDocuments({ ...actives, statut: "a_faire" }),
    Task.countDocuments({ ...actives, statut: "en_cours" }),
    Task.countDocuments({ ...actives, statut: "bloque" }),
    Task.countDocuments({
      ...actives,
      statut: { $ne: "termine" },
      deadline: { $ne: null, $lt: now },
    }),
    Task.countDocuments({ ...mine, statut: "termine", completedAt: { $gte: since7 } }),
  ]);

  // --- Sessions en cours dans mes sociétés ---
  const [invEnCours, relEnCours, reaEnCours, recEnCours] = await Promise.all([
    Inventaire.countDocuments({ ...entFilter, status: "en_cours" }),
    Releve.countDocuments({ ...entFilter, status: "en_cours" }),
    Reappro.countDocuments({ ...entFilter, status: "en_cours" }),
    Reception.countDocuments({ ...entFilter, status: { $ne: "termine" } }),
  ]);

  // --- Mon activité (14 jours) : inventaires / relevés / réceptions créés ---
  const NB = 14;
  const since = startOfDay(Date.now());
  since.setDate(since.getDate() - (NB - 1));
  const fetchDates = (Model) =>
    Model.find({ ...entFilter, createdAt: { $gte: since } }, { createdAt: 1 }).lean();
  const [iDates, lDates, rDates] = await Promise.all([
    fetchDates(Inventaire),
    fetchDates(Releve),
    fetchDates(Reception),
  ]);
  const buckets = [];
  const idxByKey = new Map();
  for (let k = 0; k < NB; k++) {
    const d = new Date(since);
    d.setDate(d.getDate() + k);
    idxByKey.set(ymd(d), k);
    buckets.push({
      jour: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }),
      inventaires: 0,
      releves: 0,
      receptions: 0,
    });
  }
  const addDates = (dates, field) => {
    for (const o of dates) {
      const k = idxByKey.get(ymd(o.createdAt));
      if (k != null) buckets[k][field] += 1;
    }
  };
  addDates(iDates, "inventaires");
  addDates(lDates, "releves");
  addDates(rDates, "receptions");

  res.json({
    taches: {
      aFaire,
      enCours: enCoursT,
      bloque,
      enRetard,
      termine7j,
      total: aFaire + enCoursT + bloque,
    },
    sessions: {
      inventaires: invEnCours,
      releves: relEnCours,
      reappros: reaEnCours,
      receptions: recEnCours,
    },
    activite: buckets,
    nbEntreprises: access.all ? null : access.ids.length,
  });
});

// ===========================================================================
// CA / MEILLEURES VENTES (snapshot pré-calculé — INSTANTANÉ) d'une entreprise.
// Réservé aux utilisateurs ayant l'ANALYSE CA (module analyse_ca_admin).
// GET /api/dashboard/ca/:nomDossierDBF
// ===========================================================================
export const getCaDashboard = asyncHandler(async (req, res) => {
  const snap = await AiSalesSnapshot.findOne({
    entreprise: req.entreprise._id,
  }).lean();
  if (!snap || !snap.computedAt) {
    // Snapshot non encore calculé (cron nocturne). On l'indique sans bloquer.
    return res.json({ available: false });
  }
  res.json({
    available: true,
    debut: snap.debut,
    fin: snap.fin,
    computedAt: snap.computedAt,
    caTotal: Math.round(snap.totaux?.caTotal || 0),
    quantiteTotale: Math.round(snap.totaux?.qteTotale || 0),
    nbFactures: snap.totaux?.nbFacturesAnalysees || 0,
    nbReferences: snap.totaux?.nbArticlesDistincts || 0,
    topVentes: (snap.topCa || []).slice(0, 8).map((a) => ({
      nart: a.nart,
      design: a.design,
      ca: Math.round(a.ca || 0),
      qte: Math.round(a.qte || 0),
      partCa: Math.round((a.partCa || 0) * 10) / 10,
    })),
  });
});

// ===========================================================================
// COMPARAISON CA entre les sociétés accessibles (snapshots pré-calculés).
// Réservé à l'analyse CA. GET /api/dashboard/ca-comparaison
// ===========================================================================
export const getCaComparaison = asyncHandler(async (req, res) => {
  const access = await getAccessibleEntreprises(req.user);
  const filter = access.all ? {} : { _id: { $in: access.ids } };
  const companies = await Entreprise.find(filter).select("nom trigramme").lean();
  const snaps = await AiSalesSnapshot.find({
    entreprise: { $in: companies.map((c) => c._id) },
  }).lean();
  const byEnt = new Map(snaps.map((s) => [String(s.entreprise), s]));

  const societes = companies
    .map((c) => {
      const s = byEnt.get(String(c._id));
      return {
        trigramme: c.trigramme || c.nom,
        nom: c.nom,
        caTotal: s ? Math.round(s.totaux?.caTotal || 0) : null,
        dispo: !!s,
      };
    })
    .sort((a, b) => (b.caTotal || 0) - (a.caTotal || 0));

  const totalGroupe = societes.reduce((sum, s) => sum + (s.caTotal || 0), 0);
  res.json({
    fin: snaps[0]?.fin || null,
    totalGroupe,
    nbAvecDonnees: societes.filter((s) => s.dispo).length,
    societes,
  });
});

export default {
  getGlobalStats,
  getEntrepriseStats,
  getMyDashboard,
  getCaDashboard,
  getCaComparaison,
};