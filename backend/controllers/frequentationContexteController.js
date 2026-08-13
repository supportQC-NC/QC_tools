// backend/controllers/frequentationContexteController.js
//
// Saisie du CONTEXTE utilisé par l'analyse de fréquentation :
//   - vacances scolaires (saisie manuelle, calendrier commun à la NC) ;
//   - événements spéciaux (grève, blocage, cyclone… saisie manuelle) ;
//   - météo quotidienne (collecte automatique + correction manuelle).
//
// Ces données ne sont PAS scopées société (sauf les événements, qui peuvent
// viser certaines sociétés) : elles décrivent le contexte du territoire.
import asyncHandler from "../middleware/asyncHandler.js";
import VacancesScolaires from "../models/VacancesScolairesModel.js";
import EvenementSpecial, {
  EVENEMENT_TYPES,
  EVENEMENT_TYPE_LABELS,
  EVENEMENT_IMPACTS,
} from "../models/EvenementSpecialModel.js";
import MeteoJour, { METEO_CATEGORIES } from "../models/MeteoJourModel.js";
import {
  LIEUX,
  lieuParSlug,
  collecterMeteo,
  categoriser,
} from "../services/meteoService.js";
import { joursFeriesNC } from "../utils/joursFeries.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const estDateIso = (v) => /^\d{4}-\d{2}-\d{2}$/.test(safeTrim(v));
const userNom = (u) =>
  [u?.prenom, u?.nom].filter(Boolean).join(" ").trim() || u?.email || "";

// Valide un couple d'heures optionnelles ("HH:MM" ou vide).
const validerHeures = (heureDebut, heureFin, res) => {
  const ok = (h) => !safeTrim(h) || /^([01]?\d|2[0-3]):[0-5]\d$/.test(safeTrim(h));
  if (!ok(heureDebut) || !ok(heureFin)) {
    res.status(400);
    throw new Error("Heures invalides (format attendu : HH:MM).");
  }
};

// Valide un couple de dates (format + ordre).
const validerPlage = (dateDebut, dateFin, res) => {
  if (!estDateIso(dateDebut) || !estDateIso(dateFin)) {
    res.status(400);
    throw new Error("Dates invalides (format attendu : AAAA-MM-JJ).");
  }
  if (dateDebut > dateFin) {
    res.status(400);
    throw new Error("La date de début doit précéder la date de fin.");
  }
};

// ===========================================================================
// VACANCES SCOLAIRES
// ===========================================================================

/**
 * @desc   Liste des périodes de vacances scolaires (les plus récentes d'abord).
 * @route  GET /api/frequentation-contexte/vacances
 */
const listVacances = asyncHandler(async (req, res) => {
  const rows = await VacancesScolaires.find().sort({ dateDebut: -1 }).lean();
  res.json(rows);
});

/**
 * @desc   Crée une période de vacances scolaires.
 * @route  POST /api/frequentation-contexte/vacances
 */
const createVacances = asyncHandler(async (req, res) => {
  const { libelle, dateDebut, dateFin, anneeScolaire, commentaire } = req.body;
  if (!safeTrim(libelle)) {
    res.status(400);
    throw new Error("Le libellé est requis.");
  }
  validerPlage(dateDebut, dateFin, res);

  const doc = await VacancesScolaires.create({
    libelle: safeTrim(libelle),
    dateDebut: safeTrim(dateDebut),
    dateFin: safeTrim(dateFin),
    anneeScolaire: safeTrim(anneeScolaire),
    commentaire: safeTrim(commentaire),
    creePar: userNom(req.user),
  });
  res.status(201).json(doc);
});

/**
 * @desc   Modifie une période de vacances scolaires.
 * @route  PUT /api/frequentation-contexte/vacances/:id
 */
const updateVacances = asyncHandler(async (req, res) => {
  const doc = await VacancesScolaires.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error("Période introuvable.");
  }
  const { libelle, dateDebut, dateFin, anneeScolaire, commentaire } = req.body;
  if (dateDebut || dateFin) {
    validerPlage(dateDebut || doc.dateDebut, dateFin || doc.dateFin, res);
  }
  if (libelle !== undefined) doc.libelle = safeTrim(libelle);
  if (dateDebut !== undefined) doc.dateDebut = safeTrim(dateDebut);
  if (dateFin !== undefined) doc.dateFin = safeTrim(dateFin);
  if (anneeScolaire !== undefined) doc.anneeScolaire = safeTrim(anneeScolaire);
  if (commentaire !== undefined) doc.commentaire = safeTrim(commentaire);
  await doc.save();
  res.json(doc);
});

/**
 * @desc   Supprime une période de vacances scolaires.
 * @route  DELETE /api/frequentation-contexte/vacances/:id
 */
const deleteVacances = asyncHandler(async (req, res) => {
  const r = await VacancesScolaires.deleteOne({ _id: req.params.id });
  if (!r.deletedCount) {
    res.status(404);
    throw new Error("Période introuvable.");
  }
  res.json({ _id: req.params.id, supprime: true });
});

// ===========================================================================
// ÉVÉNEMENTS SPÉCIAUX
// ===========================================================================

/**
 * @desc   Types et impacts disponibles (alimente les listes déroulantes).
 * @route  GET /api/frequentation-contexte/evenements/types
 */
const getEvenementTypes = asyncHandler(async (req, res) => {
  res.json({
    types: EVENEMENT_TYPES.map((t) => ({ value: t, label: EVENEMENT_TYPE_LABELS[t] })),
    impacts: EVENEMENT_IMPACTS,
  });
});

/**
 * @desc   Liste des événements spéciaux (les plus récents d'abord).
 * @route  GET /api/frequentation-contexte/evenements
 */
const listEvenements = asyncHandler(async (req, res) => {
  const rows = await EvenementSpecial.find()
    .populate("entreprises", "nomComplet trigramme nomDossierDBF")
    .sort({ dateDebut: -1 })
    .lean();
  res.json(rows);
});

/**
 * @desc   Crée un événement spécial.
 * @route  POST /api/frequentation-contexte/evenements
 */
const createEvenement = asyncHandler(async (req, res) => {
  const {
    libelle,
    type,
    dateDebut,
    dateFin,
    heureDebut,
    heureFin,
    impact,
    exclure,
    entreprises,
    commentaire,
  } = req.body;
  if (!safeTrim(libelle)) {
    res.status(400);
    throw new Error("Le libellé est requis.");
  }
  validerPlage(dateDebut, dateFin, res);
  validerHeures(heureDebut, heureFin, res);
  if (type && !EVENEMENT_TYPES.includes(type)) {
    res.status(400);
    throw new Error(`Type invalide (attendu : ${EVENEMENT_TYPES.join(", ")}).`);
  }
  if (impact && !EVENEMENT_IMPACTS.includes(impact)) {
    res.status(400);
    throw new Error(`Impact invalide (attendu : ${EVENEMENT_IMPACTS.join(", ")}).`);
  }

  const doc = await EvenementSpecial.create({
    libelle: safeTrim(libelle),
    type: type || "autre",
    dateDebut: safeTrim(dateDebut),
    dateFin: safeTrim(dateFin),
    heureDebut: safeTrim(heureDebut),
    heureFin: safeTrim(heureFin),
    impact: impact || "perturbation",
    exclure: exclure === true || exclure === "true",
    entreprises: Array.isArray(entreprises) ? entreprises : [],
    commentaire: safeTrim(commentaire),
    creePar: userNom(req.user),
  });
  res.status(201).json(doc);
});

/**
 * @desc   Modifie un événement spécial.
 * @route  PUT /api/frequentation-contexte/evenements/:id
 */
const updateEvenement = asyncHandler(async (req, res) => {
  const doc = await EvenementSpecial.findById(req.params.id);
  if (!doc) {
    res.status(404);
    throw new Error("Événement introuvable.");
  }
  const {
    libelle,
    type,
    dateDebut,
    dateFin,
    heureDebut,
    heureFin,
    impact,
    exclure,
    entreprises,
    commentaire,
  } = req.body;
  if (dateDebut || dateFin) {
    validerPlage(dateDebut || doc.dateDebut, dateFin || doc.dateFin, res);
  }
  if (heureDebut !== undefined || heureFin !== undefined) {
    validerHeures(
      heureDebut === undefined ? doc.heureDebut : heureDebut,
      heureFin === undefined ? doc.heureFin : heureFin,
      res,
    );
  }
  if (type && !EVENEMENT_TYPES.includes(type)) {
    res.status(400);
    throw new Error("Type invalide.");
  }
  if (impact && !EVENEMENT_IMPACTS.includes(impact)) {
    res.status(400);
    throw new Error("Impact invalide.");
  }
  if (libelle !== undefined) doc.libelle = safeTrim(libelle);
  if (type !== undefined) doc.type = type;
  if (dateDebut !== undefined) doc.dateDebut = safeTrim(dateDebut);
  if (dateFin !== undefined) doc.dateFin = safeTrim(dateFin);
  if (heureDebut !== undefined) doc.heureDebut = safeTrim(heureDebut);
  if (heureFin !== undefined) doc.heureFin = safeTrim(heureFin);
  if (impact !== undefined) doc.impact = impact;
  if (exclure !== undefined) doc.exclure = exclure === true || exclure === "true";
  if (entreprises !== undefined) {
    doc.entreprises = Array.isArray(entreprises) ? entreprises : [];
  }
  if (commentaire !== undefined) doc.commentaire = safeTrim(commentaire);
  await doc.save();
  res.json(doc);
});

/**
 * @desc   Génère les JOURS FÉRIÉS de Nouvelle-Calédonie d'une année sous forme
 *         d'événements (type « ferie »). Idempotent : un férié déjà présent à
 *         la même date n'est pas dupliqué.
 * @route  POST /api/frequentation-contexte/evenements/feries
 * @body   { annee?: number, impact?: string }
 */
const genererFeries = asyncHandler(async (req, res) => {
  const annee = parseInt(req.body?.annee, 10) || new Date().getFullYear();
  if (annee < 2000 || annee > 2100) {
    res.status(400);
    throw new Error("Année invalide.");
  }
  const impact = EVENEMENT_IMPACTS.includes(req.body?.impact)
    ? req.body.impact
    : "fermeture";

  const feries = joursFeriesNC(annee);
  const existants = new Set(
    (
      await EvenementSpecial.find({
        type: "ferie",
        dateDebut: { $gte: `${annee}-01-01`, $lte: `${annee}-12-31` },
      })
        .select("dateDebut")
        .lean()
    ).map((e) => e.dateDebut),
  );

  const aCreer = feries.filter((f) => !existants.has(f.date));
  if (aCreer.length) {
    await EvenementSpecial.insertMany(
      aCreer.map((f) => ({
        libelle: f.libelle,
        type: "ferie",
        dateDebut: f.date,
        dateFin: f.date,
        impact,
        entreprises: [],
        creePar: userNom(req.user),
      })),
    );
  }

  res.status(201).json({
    annee,
    total: feries.length,
    crees: aCreer.length,
    existants: feries.length - aCreer.length,
    jours: feries,
  });
});

/**
 * @desc   Supprime un événement spécial.
 * @route  DELETE /api/frequentation-contexte/evenements/:id
 */
const deleteEvenement = asyncHandler(async (req, res) => {
  const r = await EvenementSpecial.deleteOne({ _id: req.params.id });
  if (!r.deletedCount) {
    res.status(404);
    throw new Error("Événement introuvable.");
  }
  res.json({ _id: req.params.id, supprime: true });
});

// ===========================================================================
// MÉTÉO
// ===========================================================================

/**
 * @desc   Météo enregistrée d'un lieu sur une plage (+ liste des lieux).
 * @route  GET /api/frequentation-contexte/meteo?lieu=noumea&du=&au=
 */
const listMeteo = asyncHandler(async (req, res) => {
  const lieu = lieuParSlug(req.query.lieu);
  const du = estDateIso(req.query.du) ? req.query.du : "0000-00-00";
  const au = estDateIso(req.query.au) ? req.query.au : "9999-12-31";

  const rows = await MeteoJour.find({ lieu: lieu.slug, date: { $gte: du, $lte: au } })
    .sort({ date: -1 })
    .limit(400)
    .lean();

  res.json({
    lieu: { slug: lieu.slug, label: lieu.label },
    lieux: Object.values(LIEUX).map((l) => ({ slug: l.slug, label: l.label })),
    total: rows.length,
    jours: rows,
  });
});

/**
 * @desc   Lance une collecte météo (rattrapage d'historique ou du jour).
 * @route  POST /api/frequentation-contexte/meteo/collecte
 * @body   { lieu?, du, au }
 */
const collecteMeteo = asyncHandler(async (req, res) => {
  const lieu = lieuParSlug(req.body?.lieu);
  const { du, au } = req.body || {};
  validerPlage(du, au, res);

  // Garde-fou : 3 ans par collecte (le service météo est gratuit, restons sobres).
  const nbJours = Math.round((new Date(au) - new Date(du)) / 86400000) + 1;
  if (nbJours > 1100) {
    res.status(400);
    throw new Error("Plage trop large : 3 ans maximum par collecte.");
  }

  // Collecte manuelle : jamais le jour en cours (valeur encore prévisionnelle).
  const resultat = await collecterMeteo(lieu, du, au);
  res.json({ ...resultat, label: lieu.label });
});

/**
 * @desc   Corrige (ou crée) la météo d'un jour à la main. La ligne est alors
 *         VERROUILLÉE : la collecte automatique ne l'écrasera plus.
 * @route  PUT /api/frequentation-contexte/meteo/:lieu/:date
 */
const upsertMeteoJour = asyncHandler(async (req, res) => {
  const lieu = lieuParSlug(req.params.lieu);
  const date = safeTrim(req.params.date);
  if (!estDateIso(date)) {
    res.status(400);
    throw new Error("Date invalide (format attendu : AAAA-MM-JJ).");
  }

  const { pluieMm, pluieHeures, soleilHeures, tMin, tMax, libelle, categorie } =
    req.body || {};

  const valeurs = {
    pluieMm: Number(pluieMm) || 0,
    pluieHeures: Number(pluieHeures) || 0,
    soleilHeures: Number(soleilHeures) || 0,
  };
  const cat = METEO_CATEGORIES.includes(categorie)
    ? categorie
    : categoriser(valeurs);

  const doc = await MeteoJour.findOneAndUpdate(
    { lieu: lieu.slug, date },
    {
      $set: {
        ...valeurs,
        tMin: tMin === "" || tMin === undefined ? null : Number(tMin),
        tMax: tMax === "" || tMax === undefined ? null : Number(tMax),
        libelle: safeTrim(libelle),
        categorie: cat,
        source: "manuel",
        verrouille: true,
        modifiePar: userNom(req.user),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  res.json(doc);
});

/**
 * @desc   Déverrouille un jour corrigé à la main (la collecte reprend la main).
 * @route  DELETE /api/frequentation-contexte/meteo/:lieu/:date/verrou
 */
const deverrouillerMeteoJour = asyncHandler(async (req, res) => {
  const lieu = lieuParSlug(req.params.lieu);
  const doc = await MeteoJour.findOneAndUpdate(
    { lieu: lieu.slug, date: safeTrim(req.params.date) },
    { $set: { verrouille: false } },
    { new: true },
  );
  if (!doc) {
    res.status(404);
    throw new Error("Jour introuvable.");
  }
  res.json(doc);
});

export {
  listVacances,
  createVacances,
  updateVacances,
  deleteVacances,
  getEvenementTypes,
  listEvenements,
  createEvenement,
  updateEvenement,
  deleteEvenement,
  genererFeries,
  listMeteo,
  collecteMeteo,
  upsertMeteoJour,
  deverrouillerMeteoJour,
};
