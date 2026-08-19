// backend/controllers/veilleController.js
//
// Module « Veille ». Tout est PERSONNEL : chaque requête est filtrée sur
// req.user._id, y compris pour un admin — une veille et ses rapports
// n'appartiennent qu'à leur auteur.
import asyncHandler from "../middleware/asyncHandler.js";
import VeilleConfig, { JOURS, calculerProchainRun } from "../models/VeilleConfigModel.js";
import VeilleRapport from "../models/VeilleRapportModel.js";
import {
  isConfigured,
  rechercheWebConfiguree,
  construirePrompt,
  lancerGeneration,
  normaliserZone,
  ZONES,
  VEILLE_PROMPT_TEMPLATE,
  VEILLE_DEFAUTS,
  VEILLE_CHAMPS,
} from "../services/veilleService.js";

// Champs que l'utilisateur peut écrire (liste blanche : le reste est calculé).
const CHAMPS_EDITABLES = [
  "nom",
  "actif",
  "jour",
  "heure",
  "domaine",
  "zone",
  "thematiques",
  "activite",
  "topX",
  "style",
  "reference",
  "couleurs",
  "typoTexte",
  "typoTitres",
  "promptPersonnalise",
  "qualite",
];

const appliquerChamps = (doc, body) => {
  for (const cle of CHAMPS_EDITABLES) {
    if (body[cle] === undefined) continue;
    if (cle === "couleurs") {
      doc.couleurs = (Array.isArray(body.couleurs) ? body.couleurs : [])
        .map((c) => String(c).trim())
        .filter(Boolean)
        .slice(0, 6);
    } else if (cle === "jour") {
      const j = parseInt(body.jour, 10);
      doc.jour = Number.isInteger(j) && j >= 0 && j <= 6 ? j : doc.jour;
    } else if (cle === "topX") {
      const n = parseInt(body.topX, 10);
      doc.topX = Number.isFinite(n) ? Math.min(Math.max(n, 1), 20) : doc.topX;
    } else if (cle === "actif") {
      doc.actif = !!body.actif;
    } else if (cle === "zone") {
      // Liste fermée : une valeur inconnue (ou une saisie libre d'avant la
      // liste déroulante) est ramenée sur la zone la plus proche.
      doc.zone = normaliserZone(body.zone);
    } else {
      doc[cle] = body[cle];
    }
  }
};

// Les veilles créées avant la liste déroulante ont une zone en texte libre :
// on la normalise à la lecture pour que l'écran ait toujours une option qui
// correspond. La valeur en base est corrigée au premier enregistrement.
const normaliserSortie = (config) => ({
  ...config,
  zone: normaliserZone(config.zone),
});

// Retrouve une veille de l'utilisateur courant, ou 404.
const trouverConfig = async (req, res) => {
  const doc = await VeilleConfig.findOne({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!doc) {
    res.status(404);
    throw new Error("Veille introuvable.");
  }
  return doc;
};

// ────────────────────────────────────────────────────────────────────────────
// ÉTAT DU MODULE + VALEURS PAR DÉFAUT (alimente le formulaire de l'écran)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/veille/etat
export const getEtat = asyncHandler(async (req, res) => {
  res.json({
    iaConfiguree: isConfigured(),
    rechercheWebConfiguree: rechercheWebConfiguree(),
    jours: JOURS,
    // Liste fermée des zones géographiques (l'écran en fait une liste
    // déroulante) — définie une seule fois, côté service.
    zones: ZONES.map((z) => z.valeur),
    defauts: VEILLE_DEFAUTS,
    champs: VEILLE_CHAMPS,
    trame: VEILLE_PROMPT_TEMPLATE,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CONFIGURATIONS (mes veilles)
// ────────────────────────────────────────────────────────────────────────────

// GET /api/veille/configs
export const listConfigs = asyncHandler(async (req, res) => {
  const configs = await VeilleConfig.find({ user: req.user._id })
    .sort({ createdAt: 1 })
    .lean();
  res.json(configs.map(normaliserSortie));
});

// POST /api/veille/configs
export const createConfig = asyncHandler(async (req, res) => {
  const doc = new VeilleConfig({ ...VEILLE_DEFAUTS, user: req.user._id });
  appliquerChamps(doc, req.body || {});
  doc.prochainRunAt = doc.actif ? doc.calculerProchainRun() : null;
  await doc.save();
  res.status(201).json(doc);
});

// PUT /api/veille/configs/:id
export const updateConfig = asyncHandler(async (req, res) => {
  const doc = await trouverConfig(req, res);
  const ancienPlanning = `${doc.jour}|${doc.heure}|${doc.actif}`;
  appliquerChamps(doc, req.body || {});
  // On ne recalcule la prochaine exécution QUE si le planning a changé :
  // sinon, éditer un texte repousserait la veille d'une semaine.
  if (`${doc.jour}|${doc.heure}|${doc.actif}` !== ancienPlanning) {
    doc.prochainRunAt = doc.actif ? doc.calculerProchainRun() : null;
  }
  await doc.save();
  res.json(doc);
});

// DELETE /api/veille/configs/:id
export const deleteConfig = asyncHandler(async (req, res) => {
  const doc = await trouverConfig(req, res);
  await VeilleRapport.deleteMany({ config: doc._id, user: req.user._id });
  await doc.deleteOne();
  res.json({ message: "Veille supprimée (avec ses rapports)." });
});

// GET /api/veille/configs/:id/apercu-prompt
// Le prompt exact qui sera envoyé au modèle — pour que l'utilisateur voie
// l'effet de ses réglages avant de lancer une génération.
export const apercuPrompt = asyncHandler(async (req, res) => {
  const doc = await trouverConfig(req, res);
  res.json({ prompt: construirePrompt(doc) });
});

// POST /api/veille/configs/:id/generer
// Lance une génération immédiate. Répond tout de suite : la génération dure
// souvent plus d'une minute (recherches web + rédaction d'une page complète),
// l'écran suit l'avancement via le statut du rapport.
export const genererMaintenant = asyncHandler(async (req, res) => {
  if (!isConfigured()) {
    res.status(503);
    throw new Error(
      "OPENAI_API_KEY manquant dans le .env — le module Veille est indisponible.",
    );
  }
  const doc = await trouverConfig(req, res);

  const dejaEnCours = await VeilleRapport.findOne({
    config: doc._id,
    statut: "en_cours",
  }).lean();
  if (dejaEnCours) {
    res.status(409);
    throw new Error("Une génération est déjà en cours pour cette veille.");
  }

  const rapport = await lancerGeneration(doc, "manuel");
  res.status(202).json({
    message: "Génération lancée — le rapport apparaîtra dans quelques minutes.",
    rapportId: rapport._id,
  });
});

// ────────────────────────────────────────────────────────────────────────────
// RAPPORTS
// ────────────────────────────────────────────────────────────────────────────

// GET /api/veille/rapports?configId=&limit=
// Le HTML complet est EXCLU de la liste (plusieurs dizaines de Ko par rapport).
export const listRapports = asyncHandler(async (req, res) => {
  const { configId, limit = 30 } = req.query;
  const filter = { user: req.user._id };
  if (configId) filter.config = configId;
  const rapports = await VeilleRapport.find(filter)
    .select("-html")
    .sort({ createdAt: -1 })
    .limit(Math.min(parseInt(limit, 10) || 30, 100))
    .lean();
  res.json(rapports);
});

// GET /api/veille/rapports/:id  (métadonnées + sources, sans le HTML)
export const getRapport = asyncHandler(async (req, res) => {
  const doc = await VeilleRapport.findOne({
    _id: req.params.id,
    user: req.user._id,
  })
    .select("-html")
    .lean();
  if (!doc) {
    res.status(404);
    throw new Error("Rapport introuvable.");
  }
  res.json(doc);
});

// GET /api/veille/rapports/:id/html
//
// LE LIVRABLE : la page est ouverte telle quelle dans un nouvel onglet.
// Le HTML vient d'un LLM ; même s'il est nettoyé au stockage, on le sert avec
// une CSP verrouillée. `sandbox` sans `allow-same-origin` place le document
// dans une origine opaque : même un script qui passerait entre les mailles ne
// pourrait ni lire les cookies ni appeler l'API à la place de l'utilisateur.
export const getRapportHtml = asyncHandler(async (req, res) => {
  const doc = await VeilleRapport.findOne({
    _id: req.params.id,
    user: req.user._id,
  }).lean();
  if (!doc) {
    res.status(404);
    throw new Error("Rapport introuvable.");
  }
  if (doc.statut !== "termine" || !doc.html) {
    res.status(409);
    throw new Error(
      doc.statut === "en_cours"
        ? "Rapport encore en cours de génération."
        : doc.erreur || "Rapport indisponible.",
    );
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "style-src 'unsafe-inline' https:",
      "font-src https: data:",
      "img-src data: https:",
      "script-src 'none'",
      "sandbox allow-popups allow-top-navigation-by-user-activation",
    ].join("; "),
  );
  res.send(doc.html);
});

// DELETE /api/veille/rapports/:id
export const deleteRapport = asyncHandler(async (req, res) => {
  const doc = await VeilleRapport.findOneAndDelete({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!doc) {
    res.status(404);
    throw new Error("Rapport introuvable.");
  }
  res.json({ message: "Rapport supprimé." });
});

export { calculerProchainRun };
