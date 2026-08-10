// backend/services/dashboardKpiService.js
//
// Moteur des tuiles KPI « sur mesure » du tableau de bord.
//
// Une tuile = un dataset + une mesure + des filtres. Le moteur :
//   1. vérifie que l'utilisateur a le module du dataset ET, si le dataset est
//      scopé société, l'accès à la société demandée ;
//   2. charge les lignes du dataset sous forme normalisée (un objet plat de
//      champs déclarés dans dashboardCatalogue.KPI_DATASETS) ;
//   3. applique les filtres puis la mesure.
//
// Les droits sont revérifiés À CHAQUE évaluation : une tuile enregistrée alors
// que l'utilisateur avait le module cesse de renvoyer une valeur s'il le perd.

import Permission from "../models/PermissionModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import Task from "../models/TaskModel.js";
import Inventaire from "../models/InventaireModel.js";
import Releve from "../models/ReleveModel.js";
import Reappro from "../models/ReaproModel.js";
import articleCacheService from "./articleService.js";
import fournissCacheService from "./fournissCacheService.js";
import {
  KPI_DATASETS,
  MESURE_KEYS,
  OPERATEUR_KEYS,
  TYPE_GRAPHIQUE_KEYS,
  TRI_KEYS,
  LIMITE_MIN,
  LIMITE_MAX,
} from "../config/dashboardCatalogue.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const nombre = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// ─── Droits ──────────────────────────────────────────────────────────────────

/**
 * L'utilisateur a-t-il le module en lecture ? (mêmes règles que
 * checkModuleAccess : admin -> oui, allModules -> oui, sinon modules[cle].read)
 * `cle` null => données personnelles, toujours autorisées.
 */
export const aModule = async (user, cle) => {
  if (!cle) return true;
  if (user.role === "admin") return true;
  const permission = await Permission.findOne({ user: user._id }).lean();
  if (!permission) return false;
  if (permission.allModules) return true;
  return !!permission.modules?.[cle]?.read;
};

/**
 * Société accessible ? (mêmes règles que checkEntrepriseAccess : l'admin N'A PAS
 * de bypass, seules les sociétés explicitement accordées comptent.)
 * Renvoie le document Entreprise ou null.
 */
export const societeAccessible = async (user, nomDossierDBF) => {
  if (!nomDossierDBF) return null;
  const entreprise = await Entreprise.findOne({ nomDossierDBF });
  if (!entreprise || !entreprise.isActive) return null;
  const permission = await Permission.findOne({ user: user._id }).lean();
  if (!permission) return null;
  if (permission.allEntreprises) return entreprise;
  const ok = (permission.entreprises || []).some(
    (e) => e.toString() === entreprise._id.toString(),
  );
  return ok ? entreprise : null;
};

// ─── Chargement normalisé des datasets ───────────────────────────────────────

const ventesDe = (rec) => {
  const v = (i) => nombre(rec[`V${i}`]);
  const mois = v(1);
  const trois = v(1) + v(2) + v(3);
  let douze = 0;
  for (let i = 1; i <= 12; i++) douze += v(i);
  return { mois, trois, douze };
};

const chargeurs = {
  articles: async ({ entreprise }) => {
    const cache = await articleCacheService.getArticles(entreprise);
    return (cache.records || []).map((r) => {
      const ventes = ventesDe(r);
      const stockTotal = articleCacheService.calculateStockTotal(r);
      const prev = nombre(r.PREV);
      return {
        stockTotal,
        valeurStock: stockTotal * prev,
        PREV: prev,
        PVTE: nombre(r.PVTE),
        PVTETTC: nombre(r.PVTETTC),
        PACHAT: nombre(r.PACHAT),
        ventesMois: ventes.mois,
        ventes3: ventes.trois,
        ventes12: ventes.douze,
        caHt12: ventes.douze * nombre(r.PVTE),
        DEPREC: nombre(r.DEPREC),
        deprecie: articleCacheService.isArticleDeprecie(r),
        GROUPE: safeTrim(r.GROUPE),
        FOURN: nombre(r.FOURN),
        NART: safeTrim(r.NART),
        GENCOD: safeTrim(r.GENCOD),
        WEB: safeTrim(r.WEB),
      };
    });
  },

  fournisseurs: async ({ entreprise }) => {
    const cache = await fournissCacheService.getFournisseurs(entreprise);
    return (cache.records || []).map((r) => ({
      FOURN: nombre(r.FOURN),
      NOM: safeTrim(r.NOM),
      DELAPRO: nombre(r.DELAPRO),
      FRANCO: nombre(r.FRANCO),
      LOCAL: safeTrim(r.LOCAL),
      TEL: safeTrim(r.TEL),
    }));
  },

  taches: async ({ user }) => {
    const docs = await Task.find({ assignes: user._id, archive: { $ne: true } })
      .select("statut priorite deadline type titre")
      .lean();
    const maintenant = Date.now();
    return docs.map((t) => ({
      statut: safeTrim(t.statut),
      priorite: safeTrim(t.priorite),
      type: safeTrim(t.type),
      titre: safeTrim(t.titre),
      enRetard:
        !!t.deadline &&
        new Date(t.deadline).getTime() < maintenant &&
        t.statut !== "termine",
    }));
  },
};

// Les trois collections de sessions partagent la même forme.
// NB : le champ Mongo s'appelle `status` (et non `statut`) ; on l'expose sous
// le nom `statut` pour rester homogène avec le dataset « tâches ».
const chargeurSessions = (Model, champLignes) => async ({ user }) => {
  const docs = await Model.find({ user: user._id })
    .select(`status nom nomDossierDBF ${champLignes}`)
    .lean();
  return docs.map((d) => ({
    statut: safeTrim(d.status),
    nom: safeTrim(d.nom),
    nomDossierDBF: safeTrim(d.nomDossierDBF),
    nbLignes: Array.isArray(d[champLignes]) ? d[champLignes].length : 0,
  }));
};

chargeurs.inventaires = chargeurSessions(Inventaire, "lignes");
chargeurs.releves = chargeurSessions(Releve, "lignes");
chargeurs.reappros = chargeurSessions(Reappro, "lignes");

// ─── Croisement de deux sources ──────────────────────────────────────────────

/**
 * Champs adressables par un bloc : ceux de sa source, plus — si un croisement
 * est défini — ceux de la source jointe, préfixés « <dataset>. ».
 * Renvoie null si la source principale est inconnue.
 */
/**
 * Un champ est-il visible compte tenu des droits « champ par champ » ?
 * Un champ calculé est masqué dès qu'UNE de ses sources DBF l'est : sinon
 * masquer PVTE laisserait déduire le prix via le CA.
 */
export const champVisible = (champ, masque, origineDataset) => {
  if (!masque || masque.size === 0) return true;
  if (origineDataset !== "dbf") return true; // collections Mongo : hors sujet
  const sources = champ.sources?.length ? champ.sources : [champ.name];
  return !sources.some((s) => masque.has(String(s).toUpperCase()));
};

export const champsEffectifs = (bloc, masque = null) => {
  const ds = KPI_DATASETS[bloc?.dataset];
  if (!ds) return null;

  const champs = ds.champs
    .filter((c) => champVisible(c, masque, ds.origine))
    .map((c) => ({ ...c }));

  const j = bloc?.jointure;
  const dsDroite = j?.dataset ? KPI_DATASETS[j.dataset] : null;
  if (dsDroite) {
    for (const c of dsDroite.champs) {
      if (!champVisible(c, masque, dsDroite.origine)) continue;
      champs.push({
        ...c,
        name: `${j.dataset}.${c.name}`,
        label: `${dsDroite.label} · ${c.label}`,
      });
    }
  }
  return champs;
};

// Clé de rapprochement normalisée : on compare en texte pour que 3 et "3"
// (numérique DBF vs chaîne) tombent bien ensemble.
const cleJointure = (v) => safeTrim(v).toLowerCase();

/**
 * Valide la définition d'un croisement. Renvoie un message d'erreur ou null.
 */
export const validerJointure = (bloc) => {
  const j = bloc?.jointure;
  if (!j || !j.dataset) return null; // pas de croisement : rien à valider

  const dsGauche = KPI_DATASETS[bloc.dataset];
  const dsDroite = KPI_DATASETS[j.dataset];
  if (!dsDroite) return `Source croisée inconnue : ${j.dataset}`;
  if (j.dataset === bloc.dataset) {
    return "Une source ne peut pas être croisée avec elle-même.";
  }

  // Le croisement est réservé aux bases DBF : les collections Mongo
  // (tâches, sessions) ne se croisent pas.
  const nonDbf = [dsGauche, dsDroite].filter((d) => d.origine !== "dbf");
  if (nonDbf.length > 0) {
    return `Le croisement n'est possible qu'entre bases DBF. ${nonDbf
      .map((d) => `« ${d.label} »`)
      .join(" et ")} ${
      nonDbf.length > 1 ? "ne sont pas des bases DBF" : "n'est pas une base DBF"
    }.`;
  }
  if (!dsGauche.champs.some((c) => c.name === j.champGauche)) {
    return `Champ de rapprochement inconnu dans ${dsGauche.label} : ${j.champGauche}`;
  }
  if (!dsDroite.champs.some((c) => c.name === j.champDroit)) {
    return `Champ de rapprochement inconnu dans ${dsDroite.label} : ${j.champDroit}`;
  }
  return null;
};

/**
 * Charge les lignes d'un bloc, croisement appliqué le cas échéant.
 * Rapprochement gauche : chaque ligne de la source principale est conservée ;
 * en cas de doublons à droite, la PREMIÈRE correspondance est retenue.
 */
const chargerLignes = async ({ bloc, user, entreprise }) => {
  const lignes = await chargeurs[bloc.dataset]({ user, entreprise });

  const j = bloc?.jointure;
  if (!j?.dataset) return lignes;

  const droites = await chargeurs[j.dataset]({ user, entreprise });
  const index = new Map();
  for (const d of droites) {
    const cle = cleJointure(d[j.champDroit]);
    if (cle !== "" && !index.has(cle)) index.set(cle, d);
  }

  const champsDroite = KPI_DATASETS[j.dataset].champs;
  return lignes.map((l) => {
    const correspondance = index.get(cleJointure(l[j.champGauche]));
    const fusion = { ...l };
    for (const c of champsDroite) {
      fusion[`${j.dataset}.${c.name}`] = correspondance
        ? correspondance[c.name]
        : c.type === "nombre"
          ? 0
          : c.type === "booleen"
            ? false
            : "";
    }
    return fusion;
  });
};

// ─── Filtres ─────────────────────────────────────────────────────────────────

const comparer = (valeur, operateur, attendu, type) => {
  if (operateur === "vide") return valeur === "" || valeur == null;
  if (operateur === "nonVide") return !(valeur === "" || valeur == null);

  if (type === "nombre") {
    const a = nombre(valeur);
    const b = nombre(attendu);
    switch (operateur) {
      case "egal": return a === b;
      case "different": return a !== b;
      case "sup": return a > b;
      case "supEgal": return a >= b;
      case "inf": return a < b;
      case "infEgal": return a <= b;
      default: return false;
    }
  }

  if (type === "booleen") {
    const attenduVrai = ["true", "oui", "1", "o"].includes(
      safeTrim(attendu).toLowerCase(),
    );
    return operateur === "different" ? !!valeur !== attenduVrai : !!valeur === attenduVrai;
  }

  const a = safeTrim(valeur).toLowerCase();
  const b = safeTrim(attendu).toLowerCase();
  switch (operateur) {
    case "egal": return a === b;
    case "different": return a !== b;
    case "contient": return a.includes(b);
    default: return false;
  }
};

// ─── Évaluation d'une tuile ──────────────────────────────────────────────────

/**
 * Valide la définition d'une tuile KPI. Renvoie un message d'erreur ou null.
 */
export const validerKpi = (bloc, masque = null) => {
  const ds = KPI_DATASETS[bloc?.dataset];
  if (!ds) return `Source inconnue : ${bloc?.dataset}`;
  if (!MESURE_KEYS.includes(bloc.mesure)) return `Mesure inconnue : ${bloc.mesure}`;

  const jointureInvalide = validerJointure(bloc);
  if (jointureInvalide) return jointureInvalide;

  // Les champs de la source croisée sont adressables comme les autres.
  // `masque` retire ceux que les droits « champ par champ » interdisent : un
  // champ masqué devient donc « inconnu » pour cet utilisateur.
  const champsParNom = new Map(
    champsEffectifs(bloc, masque).map((c) => [c.name, c]),
  );

  if (bloc.mesure !== "count") {
    const champ = champsParNom.get(bloc.champ);
    if (!champ) return `Champ inconnu : ${bloc.champ}`;
    if (champ.type !== "nombre") {
      return `« ${champ.label} » n'est pas numérique, mesure impossible.`;
    }
  }

  for (const f of bloc.filtres || []) {
    if (!champsParNom.has(f.champ)) return `Champ de filtre inconnu : ${f.champ}`;
    if (!OPERATEUR_KEYS.includes(f.operateur)) {
      return `Opérateur inconnu : ${f.operateur}`;
    }
  }
  return null;
};

/**
 * Évalue une tuile KPI pour un utilisateur.
 *
 * @param {object} p
 * @param {object} p.user             req.user
 * @param {object} p.bloc             définition de la tuile
 * @param {string} [p.nomDossierDBF]  société sélectionnée dans l'en-tête
 * @returns {Promise<{ valeur:number|null, lignes:number, erreur:string|null }>}
 */
/**
 * Contrôles d'accès communs à un bloc : module de la source principale ET de
 * la source croisée, puis société si l'une des deux en exige une.
 * Renvoie { entreprise } ou { erreur }.
 */
const preparerContexte = async ({ user, bloc, nomDossierDBF }) => {
  const dsGauche = KPI_DATASETS[bloc.dataset];
  const dsDroite = bloc.jointure?.dataset
    ? KPI_DATASETS[bloc.jointure.dataset]
    : null;

  for (const ds of [dsGauche, dsDroite].filter(Boolean)) {
    if (!(await aModule(user, ds.module))) {
      return { erreur: `Module non autorisé (${ds.label}).` };
    }
  }

  const besoinSociete =
    dsGauche.scopeSociete || (dsDroite ? dsDroite.scopeSociete : false);
  if (!besoinSociete) return { entreprise: null };

  if (!nomDossierDBF) {
    return { erreur: "Sélectionnez une société dans l'en-tête." };
  }
  const entreprise = await societeAccessible(user, nomDossierDBF);
  if (!entreprise) return { erreur: "Société non autorisée." };
  return { entreprise };
};

export const evaluerKpi = async ({ user, bloc, nomDossierDBF, masque = null }) => {
  const invalide = validerKpi(bloc, masque);
  if (invalide) return { valeur: null, lignes: 0, erreur: invalide };

  const ctx = await preparerContexte({ user, bloc, nomDossierDBF });
  if (ctx.erreur) return { valeur: null, lignes: 0, erreur: ctx.erreur };

  const champsParNom = new Map(
    champsEffectifs(bloc, masque).map((c) => [c.name, c]),
  );
  let lignes = await chargerLignes({ bloc, user, entreprise: ctx.entreprise });

  for (const f of bloc.filtres || []) {
    const type = champsParNom.get(f.champ).type;
    lignes = lignes.filter((l) => comparer(l[f.champ], f.operateur, f.valeur, type));
  }

  if (bloc.mesure === "count") {
    return { valeur: lignes.length, lignes: lignes.length, erreur: null };
  }

  const valeurs = lignes.map((l) => nombre(l[bloc.champ]));
  if (valeurs.length === 0) {
    return { valeur: 0, lignes: 0, erreur: null };
  }

  let valeur;
  switch (bloc.mesure) {
    case "somme":
      valeur = valeurs.reduce((s, v) => s + v, 0);
      break;
    case "moyenne":
      valeur = valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
      break;
    case "min":
      valeur = Math.min(...valeurs);
      break;
    case "max":
      valeur = Math.max(...valeurs);
      break;
    default:
      valeur = null;
  }

  return {
    valeur: valeur === null ? null : Math.round(valeur * 100) / 100,
    lignes: lignes.length,
    erreur: null,
  };
};

// ─── Graphiques configurables ────────────────────────────────────────────────

/**
 * Valide la définition d'un graphique. Renvoie un message d'erreur ou null.
 */
export const validerGraphique = (bloc, masque = null) => {
  // dataset / mesure / champ / filtres suivent exactement les règles des tuiles.
  const base = validerKpi(bloc, masque);
  if (base) return base;

  const champsParNom = new Map(
    champsEffectifs(bloc, masque).map((c) => [c.name, c]),
  );

  if (!champsParNom.has(bloc.dimension)) {
    return `Champ de regroupement inconnu : ${bloc.dimension}`;
  }
  if (!TYPE_GRAPHIQUE_KEYS.includes(bloc.typeGraphique)) {
    return `Type de graphique inconnu : ${bloc.typeGraphique}`;
  }
  if (bloc.tri && !TRI_KEYS.includes(bloc.tri)) {
    return `Tri inconnu : ${bloc.tri}`;
  }
  const limite = Number(bloc.limite);
  if (!Number.isFinite(limite) || limite < LIMITE_MIN || limite > LIMITE_MAX) {
    return `Le nombre de groupes doit être compris entre ${LIMITE_MIN} et ${LIMITE_MAX}.`;
  }
  return null;
};

// Libellé lisible d'une valeur de regroupement.
const libelleGroupe = (valeur, type) => {
  if (type === "booleen") return valeur ? "Oui" : "Non";
  const s = safeTrim(valeur);
  return s === "" ? "(vide)" : s;
};

const agreger = (valeurs, mesure) => {
  if (mesure === "count") return valeurs.length;
  if (valeurs.length === 0) return 0;
  switch (mesure) {
    case "somme": return valeurs.reduce((s, v) => s + v, 0);
    case "moyenne": return valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
    case "min": return Math.min(...valeurs);
    case "max": return Math.max(...valeurs);
    default: return 0;
  }
};

/**
 * Évalue un graphique : mêmes source / filtres qu'une tuile, puis regroupement
 * sur `dimension`. Au-delà de `limite` groupes, le reste est CUMULÉ dans
 * « Autres » — jamais tronqué en silence.
 *
 * @returns {Promise<{ series:Array<{libelle:string,valeur:number}>, lignes:number, groupes:number, erreur:string|null }>}
 */
export const evaluerGraphique = async ({
  user,
  bloc,
  nomDossierDBF,
  masque = null,
}) => {
  const invalide = validerGraphique(bloc, masque);
  if (invalide) return { series: [], lignes: 0, groupes: 0, erreur: invalide };

  const ctx = await preparerContexte({ user, bloc, nomDossierDBF });
  if (ctx.erreur) {
    return { series: [], lignes: 0, groupes: 0, erreur: ctx.erreur };
  }

  const champsParNom = new Map(
    champsEffectifs(bloc, masque).map((c) => [c.name, c]),
  );
  let lignes = await chargerLignes({ bloc, user, entreprise: ctx.entreprise });

  for (const f of bloc.filtres || []) {
    const type = champsParNom.get(f.champ).type;
    lignes = lignes.filter((l) => comparer(l[f.champ], f.operateur, f.valeur, type));
  }

  const typeDim = champsParNom.get(bloc.dimension).type;
  const groupes = new Map(); // libellé -> valeurs à agréger
  for (const l of lignes) {
    const cle = libelleGroupe(l[bloc.dimension], typeDim);
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(bloc.mesure === "count" ? 1 : nombre(l[bloc.champ]));
  }

  let series = [...groupes.entries()].map(([libelle, valeurs]) => ({
    libelle,
    valeur: Math.round(agreger(valeurs, bloc.mesure) * 100) / 100,
  }));

  const nbGroupes = series.length;

  // Tri puis limite + cumul du reste.
  if (bloc.tri === "libelle") {
    series.sort((a, b) => a.libelle.localeCompare(b.libelle, "fr", { numeric: true }));
  } else if (bloc.tri === "valeurAsc") {
    series.sort((a, b) => a.valeur - b.valeur);
  } else {
    series.sort((a, b) => b.valeur - a.valeur);
  }

  const limite = Number(bloc.limite) || 10;
  if (series.length > limite) {
    const gardes = series.slice(0, limite);
    const reste = series.slice(limite);
    // « Autres » n'a de sens qu'en cumul : pour min/moyenne/max on le laisse
    // de côté et on le signale par le nombre total de groupes.
    if (bloc.mesure === "count" || bloc.mesure === "somme") {
      gardes.push({
        libelle: `Autres (${reste.length})`,
        valeur: Math.round(reste.reduce((s, r) => s + r.valeur, 0) * 100) / 100,
      });
    }
    series = gardes;
  }

  return { series, lignes: lignes.length, groupes: nbGroupes, erreur: null };
};

export default {
  evaluerKpi,
  validerKpi,
  evaluerGraphique,
  validerGraphique,
  validerJointure,
  champsEffectifs,
  champVisible,
  aModule,
  societeAccessible,
};
