// backend/controllers/localisationInventaireController.js
//
// Module LOCALISATION INVENTAIRE (Terrain) : retrouver un article en magasin
// grâce aux bipages d'un inventaire, actif ou archivé. La logique vit dans
// services/localisationInventaireService.js ; ici, validation et plomberie.

import asyncHandler from "../middleware/asyncHandler.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import {
  listerInventaires,
  listerEmplacements,
  rechercherArticle,
  suggererArticles,
  construirePlan,
} from "../services/localisationInventaireService.js";

// Charge une session en vérifiant qu'elle appartient bien à la société de la
// route — sans ce contrôle, un id de session d'une AUTRE société passerait.
const chargerSession = async (req, res) => {
  const session = await InventaireZoneSession.findOne({
    _id: req.params.sessionId,
    entreprise: req.params.entrepriseId,
  }).lean();
  if (!session) {
    res.status(404);
    throw new Error("Inventaire introuvable pour cette société.");
  }
  return session;
};

// GET /api/localisation-inventaire/:entrepriseId/inventaires
export const getInventaires = asyncHandler(async (req, res) => {
  res.json(await listerInventaires(req.params.entrepriseId));
});

// GET /api/localisation-inventaire/:entrepriseId/inventaires/:sessionId/emplacements
export const getEmplacements = asyncHandler(async (req, res) => {
  const session = await chargerSession(req, res);
  res.json(listerEmplacements(session));
});

// GET /api/localisation-inventaire/:entrepriseId/inventaires/:sessionId/recherche
//   ?code=<NART ou gencod>&emplacement=<type|tous>
export const rechercher = asyncHandler(async (req, res) => {
  const code = String(req.query.code || "").trim();
  if (!code) {
    res.status(400);
    throw new Error("Saisissez un code article (NART ou code-barres).");
  }
  const session = await chargerSession(req, res);
  const resultat = await rechercherArticle({
    session,
    code,
    emplacement: String(req.query.emplacement || "").trim(),
  });
  res.json({
    session: { _id: session._id, nom: session.nom, statut: session.statut },
    code,
    ...resultat,
  });
});

// GET /api/localisation-inventaire/:entrepriseId/inventaires/:sessionId/suggestions
//   ?q=<début de code OU mots de la désignation>
// Recherche ASSISTÉE : on ne sait pas toujours le code de l'article qu'on a en
// main. Renvoie des articles bipés dans CET inventaire, avec leurs zones.
export const getSuggestions = asyncHandler(async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    res.json({ suggestions: [] });
    return;
  }
  const session = await chargerSession(req, res);
  res.json(await suggererArticles({ session, q }));
});

// GET /api/localisation-inventaire/:entrepriseId/inventaires/:sessionId/plan
// Plan SCHÉMATIQUE de l'inventaire : emplacements → allées → zones, dans
// l'ordre de parcours, avec le nombre de lignes bipées par zone.
export const getPlan = asyncHandler(async (req, res) => {
  const session = await chargerSession(req, res);
  res.json(await construirePlan(session));
});

// PATCH /api/localisation-inventaire/:entrepriseId/inventaires/:sessionId/nom
// Renommer un inventaire (ex. « QC 2026 ») : le NOM d'affichage seulement —
// le slug du dossier (partage + FTP) ne bouge JAMAIS, c'est la clé de
// relecture des .dat et des fiches des inventaires passés.
export const renommerInventaire = asyncHandler(async (req, res) => {
  const nom = String(req.body?.nom || "").trim();
  if (!nom) {
    res.status(400);
    throw new Error("Le nom ne peut pas être vide.");
  }
  if (nom.length > 80) {
    res.status(400);
    throw new Error("Le nom est limité à 80 caractères.");
  }
  await chargerSession(req, res);
  await InventaireZoneSession.updateOne(
    { _id: req.params.sessionId, entreprise: req.params.entrepriseId },
    { $set: { nom } },
  );
  res.json({ message: "Inventaire renommé.", nom });
});
