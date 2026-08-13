// backend/services/meteoService.js
//
// Collecte de la MÉTÉO QUOTIDIENNE pour croiser le temps qu'il a fait avec la
// fréquentation du magasin.
//
// ⚠️ SOURCE — pourquoi pas meteo.nc :
// le site meteo.nc n'affiche aucune donnée dans son HTML (application Vue) et
// alimente ses pages via son API interne `rpcache.meteo.nc/internet2018client`,
// qui refuse toute requête sans le jeton d'authentification de son propre site
// (« you must provide a token »). Le scraper aurait donc dû réutiliser un jeton
// privé — fragile et hors clou.
// On utilise à la place OPEN-METEO (ouvert, sans clé, sans quota pour cet
// usage), qui fournit pour des coordonnées données :
//   - l'ARCHIVE quotidienne (pluie mm, heures de pluie, ensoleillement, T° min
//     et max, code temps WMO) sur plusieurs années -> l'analyse fonctionne
//     IMMÉDIATEMENT sur l'historique de factures, sans attendre des mois de
//     collecte ;
//   - les jours récents (que l'archive publie avec ~2 jours de retard).
// Toute la couche est isolée ici : brancher une autre source ne touche que ce
// fichier (le modèle MeteoJour est agnostique).
import cron from "node-cron";
import MeteoJour from "../models/MeteoJourModel.js";

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const DAILY_VARS =
  "precipitation_sum,precipitation_hours,sunshine_duration,temperature_2m_max,temperature_2m_min,weather_code";
const TZ = "Pacific/Noumea";

// ---------------------------------------------------------------------------
// LIEUX — coordonnées par société (trigramme). La météo de Koumac n'est pas
// celle de Nouméa. Repli sur Nouméa pour les trigrammes non listés : compléter
// ce tableau au fil des ouvertures de magasins.
// ---------------------------------------------------------------------------
export const LIEUX = {
  NOUMEA: { slug: "noumea", label: "Nouméa", lat: -22.2758, lon: 166.458 },
  BOURAIL: { slug: "bourail", label: "Bourail", lat: -21.5667, lon: 165.4833 },
  KOUMAC: { slug: "koumac", label: "Koumac", lat: -20.5667, lon: 164.2833 },
  KONE: { slug: "kone", label: "Koné (VKP)", lat: -21.0594, lon: 164.8686 },
};

const LIEU_PAR_TRIGRAMME = {
  BB: LIEUX.BOURAIL,
  QK: LIEUX.KOUMAC,
  VKP: LIEUX.KONE,
};

/** Lieu météo d'une société (repli : Nouméa). */
export const lieuPourEntreprise = (entreprise) => {
  const trig = String(entreprise?.trigramme || "").trim().toUpperCase();
  return LIEU_PAR_TRIGRAMME[trig] || LIEUX.NOUMEA;
};

/** Lieu par slug (pour les routes de saisie/consultation). */
export const lieuParSlug = (slug) => {
  const s = String(slug || "").trim().toLowerCase();
  return Object.values(LIEUX).find((l) => l.slug === s) || LIEUX.NOUMEA;
};

// ---------------------------------------------------------------------------
// Codes temps WMO -> libellé lisible
// ---------------------------------------------------------------------------
const WMO = {
  0: "Ciel dégagé",
  1: "Plutôt dégagé",
  2: "Partiellement nuageux",
  3: "Couvert",
  45: "Brouillard",
  48: "Brouillard givrant",
  51: "Bruine faible",
  53: "Bruine",
  55: "Bruine forte",
  56: "Bruine verglaçante",
  57: "Bruine verglaçante forte",
  61: "Pluie faible",
  63: "Pluie modérée",
  65: "Pluie forte",
  66: "Pluie verglaçante",
  67: "Pluie verglaçante forte",
  71: "Neige faible",
  73: "Neige",
  75: "Neige forte",
  77: "Grains de neige",
  80: "Averses faibles",
  81: "Averses",
  82: "Averses violentes",
  85: "Averses de neige",
  86: "Averses de neige fortes",
  95: "Orage",
  96: "Orage avec grêle",
  99: "Orage violent avec grêle",
};

export const libelleWmo = (code) =>
  WMO[Number(code)] || (code === null || code === undefined ? "" : `Code ${code}`);

/**
 * Catégorie météo retenue pour l'analyse.
 *   pluvieux : pluie marquée (>= 5 mm) ou pluie soutenue sous un ciel bouché
 *   mitige   : quelques gouttes ou journée peu ensoleillée
 *   beau     : le reste
 *
 * ⚠️ Le nombre d'HEURES de pluie n'est volontairement pas un critère à lui
 * seul : sous ce climat une bruine de 1 mm peut « durer » 10 h tout en laissant
 * 10 h de soleil — calibré sur 74 jours réels de Nouméa (24 beau / 33 mitigé /
 * 17 pluvieux), là où un seuil sur les heures classait 41 jours en pluvieux.
 */
export const categoriser = ({ pluieMm = 0, soleilHeures = 0 }) => {
  if (pluieMm >= 5 || (pluieMm >= 2 && soleilHeures < 5)) return "pluvieux";
  if (pluieMm >= 0.5 || soleilHeures < 5) return "mitige";
  return "beau";
};

// ---------------------------------------------------------------------------
// Appels Open-Meteo
// ---------------------------------------------------------------------------
const arrondir = (v, d = 1) =>
  v === null || v === undefined || Number.isNaN(Number(v))
    ? null
    : Math.round(Number(v) * 10 ** d) / 10 ** d;

// Transforme la réponse « daily » d'Open-Meteo en lignes exploitables.
const mapperDaily = (daily) => {
  if (!daily?.time?.length) return [];
  return daily.time.map((date, i) => {
    const pluieMm = arrondir(daily.precipitation_sum?.[i], 1);
    const pluieHeures = arrondir(daily.precipitation_hours?.[i], 1);
    const soleilHeures = arrondir((daily.sunshine_duration?.[i] ?? 0) / 3600, 1);
    const code = daily.weather_code?.[i] ?? null;
    // Jour sans aucune mesure -> on ne l'enregistre pas (archive en retard).
    if (pluieMm === null && daily.temperature_2m_max?.[i] == null) return null;
    return {
      date,
      pluieMm: pluieMm ?? 0,
      pluieHeures: pluieHeures ?? 0,
      soleilHeures: soleilHeures ?? 0,
      tMin: arrondir(daily.temperature_2m_min?.[i], 1),
      tMax: arrondir(daily.temperature_2m_max?.[i], 1),
      code,
      libelle: libelleWmo(code),
      categorie: categoriser({
        pluieMm: pluieMm ?? 0,
        pluieHeures: pluieHeures ?? 0,
        soleilHeures: soleilHeures ?? 0,
      }),
    };
  }).filter(Boolean);
};

const appelJson = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": "QC-Tools/1.0 (analyse fréquentation magasin)" },
  });
  if (!res.ok) {
    throw new Error(`Service météo indisponible (HTTP ${res.status})`);
  }
  return res.json();
};

/** Archive quotidienne (données consolidées, ~2 jours de retard). */
const fetchArchive = async (lieu, du, au) => {
  const url =
    `${ARCHIVE_URL}?latitude=${lieu.lat}&longitude=${lieu.lon}` +
    `&start_date=${du}&end_date=${au}&daily=${DAILY_VARS}` +
    `&timezone=${encodeURIComponent(TZ)}`;
  const j = await appelJson(url);
  return mapperDaily(j.daily);
};

/** Jours récents (jusqu'à 92 jours en arrière) via le modèle de prévision. */
const fetchRecent = async (lieu, pastDays) => {
  const p = Math.max(1, Math.min(92, pastDays));
  const url =
    `${FORECAST_URL}?latitude=${lieu.lat}&longitude=${lieu.lon}` +
    `&daily=${DAILY_VARS}&past_days=${p}&forecast_days=1` +
    `&timezone=${encodeURIComponent(TZ)}`;
  const j = await appelJson(url);
  return mapperDaily(j.daily);
};

const aujourdhuiIso = () =>
  new Date().toLocaleDateString("fr-CA", { timeZone: TZ }); // "AAAA-MM-JJ"

const joursEntre = (du, au) =>
  Math.round((new Date(au) - new Date(du)) / 86400000) + 1;

const veilleIso = () => {
  const d = new Date(`${aujourdhuiIso()}T12:00:00`);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Collecte (ou recollecte) la météo d'un lieu sur une plage de dates et
 * l'enregistre en base. Les jours corrigés à la main (verrouille = true) ne
 * sont jamais écrasés.
 *
 * ⚠️ LE JOUR EN COURS N'EST PAS ENREGISTRÉ par défaut : tant que la journée
 * n'est pas finie, la valeur renvoyée est une PRÉVISION (« 6,7 mm » un matin
 * de grand soleil = la pluie attendue le soir). Seule la collecte nocturne
 * (23:40, journée terminée) passe `inclureAujourdhui`.
 * Les 3 derniers jours restent marqués « provisoire » : ils sont publiés par
 * le modèle avant d'être consolidés par la réanalyse, et la collecte nocturne
 * les repasse tant qu'ils sont dans sa fenêtre de 7 jours.
 *
 * @param {object} lieu   entrée de LIEUX
 * @param {string} du     "AAAA-MM-JJ"
 * @param {string} au     "AAAA-MM-JJ"
 * @param {object} [opts] { inclureAujourdhui:boolean }
 */
export const collecterMeteo = async (lieu, du, au, opts = {}) => {
  const aujourdhui = aujourdhuiIso();
  const plafond = opts.inclureAujourdhui ? aujourdhui : veilleIso();
  const fin = au > plafond ? plafond : au;

  // Une valeur du jour déjà enregistrée par une collecte trop précoce est une
  // prévision : on la retire (sauf si elle a été corrigée à la main).
  const supprimees = await MeteoJour.deleteMany({
    lieu: lieu.slug,
    date: { $gt: plafond },
    verrouille: { $ne: true },
  });

  if (du > fin) {
    return {
      lieu: lieu.slug,
      du,
      au: fin,
      recus: 0,
      enregistres: 0,
      ignores: 0,
      plafonne: au > plafond,
      supprimees: supprimees.deletedCount || 0,
    };
  }

  // L'archive s'arrête ~2 jours avant aujourd'hui : on complète les jours
  // récents avec le modèle de prévision (qui publie aussi le passé proche).
  const parDate = new Map();
  try {
    (await fetchArchive(lieu, du, fin)).forEach((r) => parDate.set(r.date, r));
  } catch (e) {
    // L'archive peut être momentanément indisponible : on continue avec le
    // modèle récent plutôt que d'échouer complètement.
    console.warn(`[meteo] archive indisponible (${lieu.slug}) : ${e.message}`);
  }

  const manquants = joursEntre(du, fin) - parDate.size;
  if (manquants > 0) {
    try {
      const recents = await fetchRecent(lieu, joursEntre(fin, aujourdhui) + 7);
      recents.forEach((r) => {
        if (r.date >= du && r.date <= fin && !parDate.has(r.date)) {
          parDate.set(r.date, r);
        }
      });
    } catch (e) {
      console.warn(`[meteo] jours récents indisponibles (${lieu.slug}) : ${e.message}`);
    }
  }

  const lignes = [...parDate.values()];
  if (lignes.length === 0) {
    return {
      lieu: lieu.slug,
      du,
      au: fin,
      recus: 0,
      enregistres: 0,
      ignores: 0,
      plafonne: au > plafond,
      supprimees: supprimees.deletedCount || 0,
    };
  }

  // Seuil de consolidation : au-delà de 3 jours, la réanalyse a pris le relais.
  const consolideAvant = new Date(`${aujourdhui}T12:00:00`);
  consolideAvant.setDate(consolideAvant.getDate() - 3);
  const seuilConsolide = consolideAvant.toISOString().slice(0, 10);

  // Les jours verrouillés (corrigés à la main) restent intacts.
  const verrouilles = new Set(
    (
      await MeteoJour.find({
        lieu: lieu.slug,
        date: { $gte: du, $lte: fin },
        verrouille: true,
      })
        .select("date")
        .lean()
    ).map((m) => m.date),
  );

  const ops = lignes
    .filter((r) => !verrouilles.has(r.date))
    .map((r) => ({
      updateOne: {
        filter: { lieu: lieu.slug, date: r.date },
        update: {
          $set: {
            ...r,
            lieu: lieu.slug,
            source: "open-meteo",
            provisoire: r.date > seuilConsolide,
          },
        },
        upsert: true,
      },
    }));

  if (ops.length) await MeteoJour.bulkWrite(ops, { ordered: false });

  return {
    lieu: lieu.slug,
    du,
    au: fin,
    recus: lignes.length,
    enregistres: ops.length,
    ignores: lignes.length - ops.length,
    plafonne: au > plafond,
    supprimees: supprimees.deletedCount || 0,
  };
};

/**
 * Collecte quotidienne : rattrape les 7 derniers jours de TOUS les lieux
 * connus (couvre une panne réseau de quelques jours et consolide les valeurs
 * provisoires quand l'archive les publie).
 */
export const collecteQuotidienne = async () => {
  const aujourdhui = aujourdhuiIso();
  const debut = new Date(aujourdhui);
  debut.setDate(debut.getDate() - 7);
  const du = debut.toISOString().slice(0, 10);

  const resultats = [];
  for (const lieu of Object.values(LIEUX)) {
    try {
      // 23:40 : la journée est terminée, on peut enregistrer le jour même.
      resultats.push(
        await collecterMeteo(lieu, du, aujourdhui, { inclureAujourdhui: true }),
      );
    } catch (e) {
      console.error(`[meteo] échec collecte ${lieu.slug} : ${e.message}`);
      resultats.push({ lieu: lieu.slug, erreur: e.message });
    }
  }
  return resultats;
};

/**
 * Job quotidien : 23:40 heure de Nouméa (la journée commerciale est finie, la
 * météo du jour est complète). Rattrape aussi les jours précédents.
 */
export const startMeteoScheduler = () => {
  cron.schedule(
    "40 23 * * *",
    () => {
      collecteQuotidienne()
        .then((r) => {
          const total = r.reduce((s, x) => s + (x.enregistres || 0), 0);
          console.log(`[meteo] collecte quotidienne : ${total} jour(s) enregistré(s).`);
        })
        .catch((e) => console.warn("[meteo] cron :", e.message));
    },
    { timezone: "Pacific/Noumea" },
  );
  console.log("🌦️  Collecte météo quotidienne planifiée (23:40 Pacific/Noumea).");
};

/** Météo d'un lieu sur une plage, indexée par date (pour l'analyse). */
export const getMeteoParDate = async (lieuSlug, du, au) => {
  const rows = await MeteoJour.find({
    lieu: lieuSlug,
    date: { $gte: du, $lte: au },
  }).lean();
  return new Map(rows.map((r) => [r.date, r]));
};

export default {
  LIEUX,
  lieuPourEntreprise,
  lieuParSlug,
  collecterMeteo,
  collecteQuotidienne,
  startMeteoScheduler,
  getMeteoParDate,
  categoriser,
  libelleWmo,
};
