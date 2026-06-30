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
import Entreprise from "../models/EntrepriseModel.js";
import commandeCacheService from "../services/commandeService.js";
import articleCacheService from "../services/articleService.js";
import fournissCacheService from "../services/fournissCacheService.js";

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
  // --- Réceptions : statuts + conformité + écarts + nouveautés ---
  const receptions = await Reception.find(
    {},
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
    Inventaire.countDocuments({ status: "en_cours" }),
    Inventaire.countDocuments({}),
    Releve.countDocuments({ status: "en_cours" }),
    Releve.countDocuments({ status: "exporte" }),
    Releve.countDocuments({}),
    Reappro.countDocuments({ status: "en_cours" }),
    Reappro.countDocuments({}),
  ]);

  // --- Activité réelle (NB_JOURS derniers jours), bucketisée en JS ---
  const since = startOfDay(Date.now());
  since.setDate(since.getDate() - (NB_JOURS - 1));

  const fetchDates = (Model) =>
    Model.find({ createdAt: { $gte: since } }, { createdAt: 1 }).lean();

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

export default { getGlobalStats, getEntrepriseStats };