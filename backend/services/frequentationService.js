// backend/services/frequentationService.js
//
// Module « Fréquentation du magasin ».
//
// À partir des FACTURES éditées (facture.dbf : DATFACT + HEURE), on reconstitue
// les plages de fréquentation du magasin sur une période choisie :
//   - nombre de tickets par tranche horaire (pas 15 / 30 / 60 min) ;
//   - par jour de la semaine ;
//   - carte de chaleur jour de semaine × tranche horaire ;
//   - évolution jour par jour.
//
// Une facture éditée = un passage en caisse. On ne retient que TYPFACT = "F"
// (ventes) ; les avoirs "A" sont comptés à part (KPI) et les RESA "R" /
// transferts "T" sont ignorés — ce ne sont pas des passages client.
//
// ⚠️ PERFORMANCE : facture.dbf est ÉNORME (≈ 391 Mo, ~1,7 M enregistrements ;
// ~42 s de lecture sur le partage réseau). On ne le charge JAMAIS en objets JS :
// lecture EN STREAMING par lots (readRecords(2000)) vers un INDEX COLONNAIRE en
// TypedArrays (date / minute / montant / type ≈ 15 octets par facture, soit
// ~25 Mo pour QC). Cet index est mis en cache par société (TTL 15 min, invalidé
// si le .dbf change) : seule la PREMIÈRE analyse paie la lecture, toutes les
// autres plages de dates et tous les pas horaires se calculent ensuite en
// quelques millisecondes.
import path from "path";
import fs from "fs";
import { DBFFile } from "dbffile";
import VacancesScolaires from "../models/VacancesScolairesModel.js";
import EvenementSpecial from "../models/EvenementSpecialModel.js";
import { lieuPourEntreprise, getMeteoParDate } from "./meteoService.js";

const BATCH = 2000;
const TTL_MS = 15 * 60 * 1000;

// Types de facture conservés dans l'index.
const TYP_F = 1; // vente = un passage client
const TYP_A = 2; // avoir = retour, compté à part

// COMPTES INTERNES : les tiers au-delà de ce numéro (transferts internes,
// comptes techniques…) ne correspondent pas à un passage client -> exclus.
const TIERS_MAX = 9900;

// Pas horaires autorisés (minutes).
export const PAS_AUTORISES = [15, 30, 60];

// Amplitude maximale d'une analyse (garde-fou : 5 ans).
const MAX_JOURS = 366 * 5;

const JOURS_SEMAINE = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

// Index colonnaire par société : dossier -> { ymd, minutes, montant, typ, n, ... }
const indexCache = new Map();
const loadingLocks = new Map(); // évite deux lectures simultanées du même .dbf

// ─────────────────────────── Helpers ────────────────────────────────────────
const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const statSafe = (p) => {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
};

// "YYYY-MM-DD" -> 20260813 (0 si invalide).
export const ymdFromInput = (v) => {
  const s = safeTrim(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return 0;
  return Number(s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10));
};

// Valeur DATFACT (Date des .dbf ou "YYYYMMDD") -> 20260813 (0 si illisible).
const ymdOf = (v) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return (
      v.getFullYear() * 10000 + (v.getMonth() + 1) * 100 + v.getDate()
    );
  }
  const s = (v == null ? "" : String(v)).replace(/\D/g, "");
  return s.length >= 8 ? Number(s.slice(0, 8)) : 0;
};

// 20260813 -> "2026-08-13"
const isoFromYmd = (ymd) => {
  const s = String(ymd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

// 20260813 -> index jour de semaine (0 = lundi … 6 = dimanche)
const jourSemaineOf = (ymd) => {
  const d = new Date(
    Math.floor(ymd / 10000),
    Math.floor((ymd % 10000) / 100) - 1,
    ymd % 100,
  );
  return (d.getDay() + 6) % 7; // JS : 0 = dimanche -> on veut lundi en tête
};

// HEURE (C:5) -> minutes depuis minuit, ou null si illisible.
// Formats rencontrés : "08:35", "8:35", "0835", "835".
const minutesOf = (heureRaw) => {
  const digits = safeTrim(heureRaw).replace(/\D/g, "");
  if (digits.length < 3) return null;
  const h = Number(digits.slice(0, digits.length - 2));
  const m = Number(digits.slice(-2));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

// Index de tranche -> libellé "08:30".
const labelTranche = (index, pas) => {
  const minutes = index * pas;
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
};

// ─────────────────── Index colonnaire des factures (cache) ──────────────────

/**
 * Charge (ou récupère en cache) l'index colonnaire des factures d'une société.
 * Une seule lecture de facture.dbf sert ensuite toutes les plages de dates.
 *
 * @returns {Promise<{ymd:Int32Array, minutes:Int16Array, montant:Float64Array,
 *                    typ:Uint8Array, tiers:Int32Array, n:number,
 *                    scanned:number, loadMs:number}>}
 */
const getFactureIndex = async (entreprise) => {
  const dossier = entreprise.nomDossierDBF;
  const factPath = path.join(entreprise.cheminBase, dossier, "facture.dbf");
  const st = statSafe(factPath);
  if (!st) throw new Error(`Fichier facture.dbf non trouvé : ${factPath}`);

  const sig = `${st.mtime.getTime()}:${st.size}`;
  const cached = indexCache.get(dossier);
  if (cached && Date.now() - cached.loadedAt < TTL_MS && cached.sig === sig) {
    return { ...cached.index, fromCache: true };
  }

  // Une lecture à la fois par société (une analyse concurrente attend la même).
  if (loadingLocks.has(dossier)) return loadingLocks.get(dossier);

  const promesse = (async () => {
    const t0 = Date.now();
    const dbf = await DBFFile.open(factPath, { readMode: "loose" });
    const capacite = dbf.recordCount || 0;

    const ymdArr = new Int32Array(capacite);
    const minArr = new Int16Array(capacite);
    const montantArr = new Float64Array(capacite);
    const typArr = new Uint8Array(capacite);
    const tiersArr = new Int32Array(capacite);

    let n = 0;
    let scanned = 0;
    let batch;
    while ((batch = await dbf.readRecords(BATCH)).length > 0) {
      scanned += batch.length;
      for (const f of batch) {
        if (n >= capacite) break; // sécurité si recordCount sous-estime
        const typRaw = safeTrim(f.TYPFACT).toUpperCase();
        const typ = typRaw === "F" ? TYP_F : typRaw === "A" ? TYP_A : 0;
        if (!typ) continue; // RESA / transferts : pas un passage client
        const ymd = ymdOf(f.DATFACT);
        if (!ymd) continue;

        const minutes = minutesOf(f.HEURE);
        ymdArr[n] = ymd;
        minArr[n] = minutes === null ? -1 : minutes;
        montantArr[n] = num(f.MONTANT);
        typArr[n] = typ;
        tiersArr[n] = Math.round(num(f.TIERS));
        n += 1;
      }
    }

    const index = {
      ymd: ymdArr,
      minutes: minArr,
      montant: montantArr,
      typ: typArr,
      tiers: tiersArr,
      n,
      scanned,
      loadMs: Date.now() - t0,
    };
    indexCache.set(dossier, { index, loadedAt: Date.now(), sig });
    return index;
  })().finally(() => loadingLocks.delete(dossier));

  loadingLocks.set(dossier, promesse);
  return promesse;
};

// ───────── Contexte : météo, vacances scolaires, événements spéciaux ────────

/**
 * Charge le contexte d'une période : météo du lieu de la société, périodes de
 * vacances scolaires et événements spéciaux qui recoupent la plage.
 */
const chargerContexte = async (entreprise, du, au) => {
  const lieu = lieuPourEntreprise(entreprise);

  const [meteoParDate, vacances, evenements] = await Promise.all([
    getMeteoParDate(lieu.slug, du, au),
    VacancesScolaires.find({ dateDebut: { $lte: au }, dateFin: { $gte: du } })
      .sort({ dateDebut: 1 })
      .lean(),
    EvenementSpecial.find({
      dateDebut: { $lte: au },
      dateFin: { $gte: du },
      // Événement global (aucune société listée) OU visant cette société.
      $or: [{ entreprises: { $size: 0 } }, { entreprises: entreprise._id }],
    })
      .sort({ dateDebut: 1 })
      .lean(),
  ]);

  return { lieu, meteoParDate, vacances, evenements };
};

// Clé d'instant comparable : AAAAMMJJ * 1440 + minutes depuis minuit.
// Monotone en (date, heure), donc directement comparable par <= / >=.
const instantKey = (ymd, minutes) => ymd * 1440 + Math.max(0, minutes);

// "HH:MM" -> minutes depuis minuit (null si vide/invalide).
const minutesDeHeure = (h) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(safeTrim(h));
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
};

/**
 * Fenêtres d'exclusion issues des événements marqués « exclure » : leurs
 * ventes sortent des moyennes (mais restent comptées pour l'événement).
 */
const construireExclusions = (evenements) =>
  evenements
    .filter((e) => e.exclure)
    .map((e) => {
      const dDeb = ymdFromInput(e.dateDebut);
      const dFin = ymdFromInput(e.dateFin);
      const mDeb = minutesDeHeure(e.heureDebut) ?? 0;
      const mFin = minutesDeHeure(e.heureFin) ?? 1439;
      return {
        id: String(e._id),
        libelle: e.libelle,
        debut: instantKey(dDeb, mDeb),
        fin: instantKey(dFin, mFin),
      };
    })
    .filter((x) => x.debut && x.fin && x.debut <= x.fin);

// Statistiques d'un groupe de journées (moyennes par jour ouvert).
const statsJours = (liste) => {
  const nbJours = liste.length;
  const tickets = liste.reduce((s, j) => s + j.nb, 0);
  const ca = liste.reduce((s, j) => s + j.ca, 0);
  return {
    nbJours,
    tickets,
    ca,
    moyenneTickets: nbJours ? +(tickets / nbJours).toFixed(1) : 0,
    moyenneCa: nbJours ? Math.round(ca / nbJours) : 0,
    panierMoyen: tickets ? Math.round(ca / tickets) : 0,
  };
};

// Écart en % entre une valeur et une référence (null si référence nulle).
const ecartPct = (valeur, reference) =>
  reference ? +(((valeur - reference) / reference) * 100).toFixed(1) : null;

/**
 * Analyse de fréquentation d'une société sur une plage de dates.
 *
 * @param {object} entreprise           document Entreprise
 * @param {object} periode
 * @param {string} periode.du           "AAAA-MM-JJ"
 * @param {string} periode.au           "AAAA-MM-JJ"
 * @param {number} periode.pas          15 | 30 | 60 (minutes)
 * @param {number|null} periode.jour    0 = lundi … 6 = dimanche ; null = tous
 *                                      (permet de suivre l'évolution d'un seul
 *                                      jour de la semaine sur la période)
 * @returns {Promise<object>}           agrégats prêts pour les graphiques
 */
export const getFrequentation = async (
  entreprise,
  { du, au, pas = 60, jour = null },
) => {
  const duYmd = ymdFromInput(du);
  const auYmd = ymdFromInput(au);
  if (!duYmd || !auYmd) {
    const e = new Error("Plage de dates invalide (format attendu : AAAA-MM-JJ).");
    e.statusCode = 400;
    throw e;
  }
  if (duYmd > auYmd) {
    const e = new Error("La date de début doit précéder la date de fin.");
    e.statusCode = 400;
    throw e;
  }
  const pasMin = PAS_AUTORISES.includes(Number(pas)) ? Number(pas) : 60;

  // Filtre « un seul jour de la semaine » (0 = lundi … 6 = dimanche).
  const jourFiltre =
    jour === null || jour === undefined || jour === "" ? null : Number(jour);
  if (jourFiltre !== null && !(jourFiltre >= 0 && jourFiltre <= 6)) {
    const e = new Error("Jour de la semaine invalide (0 = lundi … 6 = dimanche).");
    e.statusCode = 400;
    throw e;
  }

  const nbJoursPlage =
    Math.round(
      (new Date(isoFromYmd(auYmd)) - new Date(isoFromYmd(duYmd))) / 86400000,
    ) + 1;
  if (nbJoursPlage > MAX_JOURS) {
    const e = new Error(
      `Plage trop large (${nbJoursPlage} jours) : 5 ans maximum par analyse.`,
    );
    e.statusCode = 400;
    throw e;
  }

  const t0 = Date.now();
  const index = await getFactureIndex(entreprise);
  const nbTranches = Math.ceil((24 * 60) / pasMin);

  // Contexte (météo / vacances / événements) chargé AVANT l'agrégation : les
  // fenêtres d'événements « exclus » doivent être connues pendant le comptage.
  const contexte = await chargerContexte(
    entreprise,
    isoFromYmd(duYmd),
    isoFromYmd(auYmd),
  );
  const exclusions = construireExclusions(contexte.evenements);
  // Ventes retirées des moyennes, comptées à part par événement.
  const exclusParEvt = new Map(
    exclusions.map((x) => [x.id, { nb: 0, ca: 0, jours: new Set() }]),
  );
  let nbExclus = 0;

  // Accumulateurs
  const parTranche = Array.from({ length: nbTranches }, () => ({ nb: 0, ca: 0 }));
  const parJourSem = Array.from({ length: 7 }, () => ({
    nb: 0,
    ca: 0,
    dates: new Set(),
  }));
  const heatmap = Array.from({ length: 7 }, () =>
    new Array(nbTranches).fill(0),
  );
  const parJourMap = new Map(); // ymd -> { nb, ca }

  let nbFactures = 0;
  let nbAvoirs = 0;
  let caTotal = 0;
  let sansHeure = 0;
  let comptesInternes = 0;

  // ── Agrégation sur l'index colonnaire (en mémoire, quelques ms) ───────────
  // Mémoïsation du jour de semaine : une même date revient des centaines de fois.
  const jsParYmd = new Map();
  const {
    ymd: aYmd,
    minutes: aMin,
    montant: aMontant,
    typ: aTyp,
    tiers: aTiers,
    n,
  } = index;

  for (let i = 0; i < n; i += 1) {
    const ymd = aYmd[i];
    if (ymd < duYmd || ymd > auYmd) continue;

    // Jour de la semaine (mémoïsé) — calculé en premier pour pouvoir filtrer.
    let js = jsParYmd.get(ymd);
    if (js === undefined) {
      js = jourSemaineOf(ymd);
      jsParYmd.set(ymd, js);
    }
    if (jourFiltre !== null && js !== jourFiltre) continue;

    // Comptes internes (TIERS > 9900) : ce ne sont pas des passages client.
    if (aTiers[i] > TIERS_MAX) {
      comptesInternes += 1;
      continue;
    }

    if (aTyp[i] === TYP_A) {
      nbAvoirs += 1;
      continue;
    }

    // Fenêtre d'événement exclue : la vente sort des moyennes et n'est
    // comptée que dans le récapitulatif de l'événement concerné.
    if (exclusions.length) {
      const cle = instantKey(ymd, aMin[i]);
      const zone = exclusions.find((x) => cle >= x.debut && cle <= x.fin);
      if (zone) {
        const acc = exclusParEvt.get(zone.id);
        acc.nb += 1;
        acc.ca += aMontant[i];
        acc.jours.add(ymd);
        nbExclus += 1;
        continue;
      }
    }

    const montant = aMontant[i];
    nbFactures += 1;
    caTotal += montant;

    // Jour
    const jour = parJourMap.get(ymd) || { nb: 0, ca: 0 };
    jour.nb += 1;
    jour.ca += montant;
    parJourMap.set(ymd, jour);

    parJourSem[js].nb += 1;
    parJourSem[js].ca += montant;
    parJourSem[js].dates.add(ymd);

    // Tranche horaire
    const minutes = aMin[i];
    if (minutes < 0) {
      sansHeure += 1;
      continue;
    }
    const t = Math.min(Math.floor(minutes / pasMin), nbTranches - 1);
    parTranche[t].nb += 1;
    parTranche[t].ca += montant;
    heatmap[js][t] += 1;
  }

  // ── Mise en forme ─────────────────────────────────────────────────────────

  // Tranches horaires : on ne garde que l'amplitude réellement fréquentée
  // (de la première à la dernière tranche non vide) pour des graphes lisibles.
  let premiere = parTranche.findIndex((t) => t.nb > 0);
  let derniere = -1;
  parTranche.forEach((t, i) => {
    if (t.nb > 0) derniere = i;
  });
  if (premiere === -1) {
    premiere = 0;
    derniere = -1;
  }

  const tranches = [];
  for (let i = premiere; i <= derniere; i += 1) {
    tranches.push({
      index: i,
      label: labelTranche(i, pasMin),
      nb: parTranche[i].nb,
      ca: Math.round(parTranche[i].ca),
      panierMoyen: parTranche[i].nb
        ? Math.round(parTranche[i].ca / parTranche[i].nb)
        : 0,
      part: nbFactures ? +((parTranche[i].nb / nbFactures) * 100).toFixed(1) : 0,
    });
  }

  const joursSemaine = parJourSem.map((j, i) => ({
    index: i,
    label: JOURS_SEMAINE[i],
    nb: j.nb,
    ca: Math.round(j.ca),
    nbJoursOuverts: j.dates.size,
    moyenneParJour: j.dates.size ? +(j.nb / j.dates.size).toFixed(1) : 0,
    panierMoyen: j.nb ? Math.round(j.ca / j.nb) : 0,
  }));

  const jours = [...parJourMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ymd, v]) => {
      const date = isoFromYmd(ymd);
      const m = contexte.meteoParDate.get(date) || null;
      const evts = contexte.evenements.filter(
        (e) => date >= e.dateDebut && date <= e.dateFin,
      );
      const vac = contexte.vacances.find(
        (p) => date >= p.dateDebut && date <= p.dateFin,
      );
      return {
        date,
        jourSemaine: JOURS_SEMAINE[jourSemaineOf(ymd)],
        nb: v.nb,
        ca: Math.round(v.ca),
        panierMoyen: v.nb ? Math.round(v.ca / v.nb) : 0,
        meteo: m
          ? {
              categorie: m.categorie,
              libelle: m.libelle,
              pluieMm: m.pluieMm,
              soleilHeures: m.soleilHeures,
              tMin: m.tMin,
              tMax: m.tMax,
            }
          : null,
        vacances: vac ? vac.libelle : "",
        evenements: evts.map((e) => ({
          _id: String(e._id),
          libelle: e.libelle,
          type: e.type,
          impact: e.impact,
        })),
      };
    });

  // Carte de chaleur : total par (jour de semaine, tranche) + moyenne par
  // occurrence du jour (plus juste quand la plage couvre un nombre inégal de
  // lundis, mardis…).
  const heat = [];
  for (let j = 0; j < 7; j += 1) {
    const occurrences = parJourSem[j].dates.size;
    for (let i = premiere; i <= derniere; i += 1) {
      heat.push({
        jour: j,
        jourLabel: JOURS_SEMAINE[j],
        tranche: labelTranche(i, pasMin),
        nb: heatmap[j][i],
        moyenne: occurrences ? +(heatmap[j][i] / occurrences).toFixed(1) : 0,
      });
    }
  }

  // ── Croisements : météo / vacances scolaires / événements ─────────────────

  // Météo : moyennes par catégorie de temps (jours sans relevé mis à part).
  const CAT_LABELS = { beau: "Beau temps", mitige: "Mitigé", pluvieux: "Pluvieux" };
  const joursAvecMeteo = jours.filter((j) => j.meteo);
  const parMeteo = ["beau", "mitige", "pluvieux"].map((cat) => {
    const liste = joursAvecMeteo.filter((j) => j.meteo.categorie === cat);
    return { categorie: cat, label: CAT_LABELS[cat], ...statsJours(liste) };
  });
  const refBeau = parMeteo.find((m) => m.categorie === "beau");
  parMeteo.forEach((m) => {
    m.ecartVsBeau =
      m.categorie === "beau" ? 0 : ecartPct(m.moyenneTickets, refBeau?.moyenneTickets);
  });

  // Vacances scolaires : pendant / hors vacances.
  const joursVacances = jours.filter((j) => j.vacances);
  const joursHorsVacances = jours.filter((j) => !j.vacances);
  const vacancesStats = {
    pendant: statsJours(joursVacances),
    hors: statsJours(joursHorsVacances),
    periodes: contexte.vacances.map((p) => {
      const liste = jours.filter(
        (j) => j.date >= p.dateDebut && j.date <= p.dateFin,
      );
      return {
        _id: String(p._id),
        libelle: p.libelle,
        dateDebut: p.dateDebut,
        dateFin: p.dateFin,
        ...statsJours(liste),
      };
    }),
  };
  vacancesStats.ecart = ecartPct(
    vacancesStats.pendant.moyenneTickets,
    vacancesStats.hors.moyenneTickets,
  );

  // Événements : comparaison au MÊME jour de semaine hors événement, la
  // référence la plus honnête (un blocage un samedi ne se compare pas à un mardi).
  const refParJourSem = new Array(7).fill(null).map(() => ({ nb: 0, jours: 0 }));
  jours.forEach((j) => {
    if (j.evenements.length) return;
    const idx = JOURS_SEMAINE.indexOf(j.jourSemaine);
    if (idx < 0) return;
    refParJourSem[idx].nb += j.nb;
    refParJourSem[idx].jours += 1;
  });
  const moyenneRef = (jourLabel) => {
    const idx = JOURS_SEMAINE.indexOf(jourLabel);
    const r = idx >= 0 ? refParJourSem[idx] : null;
    return r && r.jours ? r.nb / r.jours : 0;
  };

  const evenementsStats = contexte.evenements.map((e) => {
    const id = String(e._id);
    // Journées de l'événement restées dans l'analyse (événement non exclu).
    const liste = jours.filter(
      (j) => j.date >= e.dateDebut && j.date <= e.dateFin,
    );
    // Ventes retirées des moyennes pour cet événement (événement exclu).
    const exclu = exclusParEvt.get(id);

    // Jours couverts : ceux visibles + ceux entièrement sortis de l'analyse.
    const joursCouverts = exclu
      ? new Set([
          ...liste.map((j) => j.date),
          ...[...exclu.jours].map((y) => isoFromYmd(y)),
        ])
      : new Set(liste.map((j) => j.date));

    // Référence : moyenne du même jour de semaine, hors événement.
    const attendu = [...joursCouverts].reduce((s, date) => {
      const idx = jourSemaineOf(ymdFromInput(date));
      return s + moyenneRef(JOURS_SEMAINE[idx]);
    }, 0);
    const constate =
      liste.reduce((s, j) => s + j.nb, 0) + (exclu ? exclu.nb : 0);

    return {
      _id: id,
      libelle: e.libelle,
      type: e.type,
      impact: e.impact,
      dateDebut: e.dateDebut,
      dateFin: e.dateFin,
      heureDebut: e.heureDebut || "",
      heureFin: e.heureFin || "",
      exclure: !!e.exclure,
      nbJours: joursCouverts.size,
      ticketsConstates: constate,
      ticketsExclus: exclu ? exclu.nb : 0,
      caExclu: exclu ? Math.round(exclu.ca) : 0,
      ticketsAttendus: Math.round(attendu),
      ecart: attendu ? +(((constate - attendu) / attendu) * 100).toFixed(1) : null,
      jours: liste.map((j) => ({ date: j.date, nb: j.nb })),
    };
  });

  // KPI
  const trancheMax = tranches.reduce(
    (best, t) => (!best || t.nb > best.nb ? t : best),
    null,
  );
  const jourSemMax = joursSemaine.reduce(
    (best, j) => (!best || j.nb > best.nb ? j : best),
    null,
  );
  const jourMax = jours.reduce(
    (best, j) => (!best || j.nb > best.nb ? j : best),
    null,
  );

  const data = {
    periode: {
      du: isoFromYmd(duYmd),
      au: isoFromYmd(auYmd),
      pas: pasMin,
      jour: jourFiltre,
      jourLabel: jourFiltre === null ? "Tous les jours" : JOURS_SEMAINE[jourFiltre],
      lieuMeteo: contexte.lieu.label,
    },
    kpi: {
      nbFactures,
      nbAvoirs,
      caTotal: Math.round(caTotal),
      panierMoyen: nbFactures ? Math.round(caTotal / nbFactures) : 0,
      nbJoursOuverts: jours.length,
      moyenneParJourOuvert: jours.length
        ? +(nbFactures / jours.length).toFixed(1)
        : 0,
      sansHeure,
      comptesInternes,
      tiersMax: TIERS_MAX,
      // Ventes retirées des moyennes (fenêtres d'événements exclues).
      ticketsExclus: nbExclus,
      nbPeriodesExclues: exclusions.length,
      heurePointe: trancheMax ? trancheMax.label : "",
      heurePointeNb: trancheMax ? trancheMax.nb : 0,
      jourSemainePointe: jourSemMax && jourSemMax.nb ? jourSemMax.label : "",
      jourPointe: jourMax ? jourMax.date : "",
      jourPointeNb: jourMax ? jourMax.nb : 0,
      amplitude:
        tranches.length > 0
          ? `${tranches[0].label} – ${labelTranche(derniere + 1, pasMin)}`
          : "",
    },
    tranches,
    joursSemaine,
    heat,
    jours,
    parMeteo,
    joursSansMeteo: jours.length - joursAvecMeteo.length,
    vacances: vacancesStats,
    evenements: evenementsStats,
    _facturesIndexees: index.n,
    _indexCache: !!index.fromCache,
    _queryTime: `${Date.now() - t0}ms`,
  };

  return data;
};

/** Vide l'index en mémoire (tests / libération manuelle). */
export const viderIndexFrequentation = (nomDossierDBF) => {
  if (nomDossierDBF) indexCache.delete(nomDossierDBF);
  else indexCache.clear();
};

export default {
  getFrequentation,
  viderIndexFrequentation,
  PAS_AUTORISES,
  ymdFromInput,
};
