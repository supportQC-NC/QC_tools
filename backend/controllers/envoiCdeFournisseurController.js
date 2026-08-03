// backend/controllers/envoiCdeFournisseurController.js
//
// Contrôleurs du module « Envoi Commande Fournisseur ».
// La société est résolue par `checkEntrepriseAccess` -> req.entreprise
// (à partir de :nomDossierDBF). Aucune écriture DBF ; les coordonnées d'envoi
// vivent en Mongo.
import asyncHandler from "../middleware/asyncHandler.js";
import {
  getCommandesPreparees,
  getDetailCommande,
  verifierFournisseurs,
  resoudreEnvoi,
  envoyerCommandes,
  appliquerModeTest,
  getParametres,
  setParametres,
  importerReference,
  importerReferenceGlobale,
  compterCiblesMasse,
  envoyerMasse,
  DEFAULT_MESSAGE_F,
  DEFAULT_MESSAGE_A,
} from "../services/envoiCdeFournisseurService.js";

import FournisseurEmail from "../models/FournisseurEmailModel.js";
import MessageFournisseur from "../models/MessageFournisseurModel.js";
import ResponsableCc from "../models/ResponsableCcModel.js";
import EnvoiCdeHistorique from "../models/EnvoiCdeHistoriqueModel.js";

// Normalise une valeur (tableau | chaîne "a;b, c") en tableau d'emails propres.
const toEmailArray = (v) => {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === "string")
    return v
      .split(/[;,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
};

// ────────────────────────────────────────────────────────────────────────────
// COMMANDES PRÉPARÉES + ENVOI
// ────────────────────────────────────────────────────────────────────────────

// GET /:nomDossierDBF/commandes
export const listCommandes = asyncHandler(async (req, res) => {
  const { search, fourn, bateau } = req.query;
  const data = await getCommandesPreparees(req.entreprise, {
    search: search || "",
    fourn: fourn || undefined,
    bateau: bateau || undefined,
  });
  res.json(data);
});

// POST /:nomDossierDBF/import-reference  (peuple la BDD depuis les fichiers migrés)
export const importReference = asyncHandler(async (req, res) => {
  const result = await importerReference(req.entreprise);
  res.json({
    message: `Import terminé : ${result.emails} email(s), ${result.messages} modèle(s), ${result.responsables} responsable(s).`,
    ...result,
  });
});

// POST /import-reference-global  (admin) — importe TOUTES les sociétés d'un coup
export const importReferenceGlobal = asyncHandler(async (req, res) => {
  const result = await importerReferenceGlobale();
  res.json({
    message: `Import global terminé : ${result.emails} email(s), ${result.messages} modèle(s), ${result.responsables} responsable(s) répartis sur ${result.parSociete.length} société(s).`,
    ...result,
  });
});

// GET /:nomDossierDBF/masse/compter?cible=..&fournIds=..  (aperçu destinataires)
export const compterMasse = asyncHandler(async (req, res) => {
  const { cible = "selection", fournIds } = req.query;
  const ids = fournIds
    ? String(fournIds).split(",").map((s) => parseInt(s)).filter((n) => !isNaN(n))
    : [];
  const counts = await compterCiblesMasse(req.entreprise, cible, ids);
  res.json(counts);
});

// POST /:nomDossierDBF/masse  (envoi groupé — texte simple FR/EN)
export const envoyerMasseCtrl = asyncHandler(async (req, res) => {
  const { cible, fournIds, sujetF, messageF, sujetA, messageA } = req.body;
  if (!["francais", "anglais", "selection"].includes(cible)) {
    res.status(400);
    throw new Error("Cible invalide.");
  }
  if (cible === "selection" && (!Array.isArray(fournIds) || fournIds.length === 0)) {
    res.status(400);
    throw new Error("Aucun fournisseur sélectionné.");
  }
  const result = await envoyerMasse(
    req.entreprise,
    { cible, fournIds, sujetF, messageF, sujetA, messageA },
    req.user,
  );
  res.json(result);
});

// GET /:nomDossierDBF/commandes/:numcde/detail
export const getDetail = asyncHandler(async (req, res) => {
  const detail = await getDetailCommande(req.entreprise, req.params.numcde);
  if (!detail) {
    res.status(404);
    throw new Error("Commande introuvable.");
  }
  res.json(detail);
});

// POST /:nomDossierDBF/verifier   body: { numcdes: [] }
export const verifier = asyncHandler(async (req, res) => {
  const { numcdes = [] } = req.body;
  const result = await verifierFournisseurs(req.entreprise, numcdes);
  res.json(result);
});

// GET /:nomDossierDBF/apercu/:numcde
export const apercu = asyncHandler(async (req, res) => {
  const r = await resoudreEnvoi(req.entreprise, req.params.numcde);
  if (r.erreur) {
    res.status(400);
    throw new Error(r.erreur);
  }
  const params = await getParametres(req.entreprise);
  const envoi = appliquerModeTest(
    {
      destinataires: r.destinataires,
      cc: r.cc,
      sujet: r.sujet,
    },
    params,
  );
  res.json({
    numcde: r.detail.numcde,
    fournNom: r.fournNom,
    langue: r.langue,
    sujet: r.sujet,
    html: r.html,
    nbLignes: r.detail.nbLignes,
    montantPrev: r.detail.montantPrev,
    // Ce qui serait envoyé en production :
    destinatairesReels: r.destinataires,
    ccReels: r.cc,
    // Ce qui sera réellement envoyé (mode test appliqué) :
    envoi: {
      to: envoi.to,
      cc: envoi.cc,
      sujet: envoi.sujet,
      testMode: envoi.testMode,
    },
  });
});

// POST /:nomDossierDBF/envoyer   body: { numcdes: [] }
export const envoyer = asyncHandler(async (req, res) => {
  const { numcdes = [] } = req.body;
  if (!Array.isArray(numcdes) || numcdes.length === 0) {
    res.status(400);
    throw new Error("Aucune commande sélectionnée.");
  }

  // Contrôle bloquant avant tout envoi (comme l'Access).
  const verif = await verifierFournisseurs(req.entreprise, numcdes);
  if (!verif.ok) {
    res.status(400);
    return res.json({
      erreur: "Des fournisseurs ne sont pas correctement renseignés.",
      problemes: verif.problemes,
    });
  }

  const result = await envoyerCommandes(req.entreprise, numcdes, req.user);
  res.json(result);
});

// GET /:nomDossierDBF/parametres  (mode test + adresses de test de la société)
export const getParametresCtrl = asyncHandler(async (req, res) => {
  const params = await getParametres(req.entreprise);
  res.json(params);
});

// PUT /:nomDossierDBF/parametres  body: { testMode?, testEmails? }
export const updateParametresCtrl = asyncHandler(async (req, res) => {
  const { testMode, testEmails } = req.body;
  const params = await setParametres(req.entreprise, {
    testMode: typeof testMode === "boolean" ? testMode : undefined,
    testEmails: testEmails !== undefined ? toEmailArray(testEmails) : undefined,
  });
  res.json(params);
});

// ────────────────────────────────────────────────────────────────────────────
// CRUD EMAILS FOURNISSEURS
// ────────────────────────────────────────────────────────────────────────────

// GET /:nomDossierDBF/emails
export const listEmails = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const filter = { entreprise: req.entreprise._id };
  if (search) {
    const rx = new RegExp(String(search).trim(), "i");
    filter.$or = [{ fournLbl: rx }];
    const asNum = parseInt(search);
    if (!isNaN(asNum)) filter.$or.push({ fournId: asNum });
  }
  const emails = await FournisseurEmail.find(filter).sort({ fournId: 1 }).lean();
  res.json(emails);
});

// POST /:nomDossierDBF/emails
export const createEmail = asyncHandler(async (req, res) => {
  const { fournId, fournLbl, langue, emails, emailsTransitaire, emailsCC, actif } =
    req.body;
  if (fournId === undefined || fournId === null || fournId === "") {
    res.status(400);
    throw new Error("Le code fournisseur (fournId) est requis.");
  }
  const exists = await FournisseurEmail.findOne({
    entreprise: req.entreprise._id,
    fournId: parseInt(fournId),
  });
  if (exists) {
    res.status(409);
    throw new Error(`Le fournisseur ${fournId} existe déjà pour cette société.`);
  }
  const doc = await FournisseurEmail.create({
    entreprise: req.entreprise._id,
    fournId: parseInt(fournId),
    fournLbl: fournLbl || "",
    langue: langue === "A" ? "A" : "F",
    emails: toEmailArray(emails),
    emailsTransitaire: toEmailArray(emailsTransitaire),
    emailsCC: toEmailArray(emailsCC),
    actif: actif !== false,
  });
  res.status(201).json(doc);
});

// PUT /:nomDossierDBF/emails/:id
export const updateEmail = asyncHandler(async (req, res) => {
  const doc = await FournisseurEmail.findOne({
    _id: req.params.id,
    entreprise: req.entreprise._id,
  });
  if (!doc) {
    res.status(404);
    throw new Error("Fiche email introuvable.");
  }
  const b = req.body;
  if (b.fournId !== undefined) doc.fournId = parseInt(b.fournId);
  if (b.fournLbl !== undefined) doc.fournLbl = b.fournLbl;
  if (b.langue !== undefined) doc.langue = b.langue === "A" ? "A" : "F";
  if (b.emails !== undefined) doc.emails = toEmailArray(b.emails);
  if (b.emailsTransitaire !== undefined)
    doc.emailsTransitaire = toEmailArray(b.emailsTransitaire);
  if (b.emailsCC !== undefined) doc.emailsCC = toEmailArray(b.emailsCC);
  if (b.actif !== undefined) doc.actif = !!b.actif;
  await doc.save();
  res.json(doc);
});

// DELETE /:nomDossierDBF/emails/:id
export const deleteEmail = asyncHandler(async (req, res) => {
  const doc = await FournisseurEmail.findOneAndDelete({
    _id: req.params.id,
    entreprise: req.entreprise._id,
  });
  if (!doc) {
    res.status(404);
    throw new Error("Fiche email introuvable.");
  }
  res.json({ message: "Supprimé." });
});

// ────────────────────────────────────────────────────────────────────────────
// MODÈLES DE MESSAGE (par langue)
// ────────────────────────────────────────────────────────────────────────────

// GET /:nomDossierDBF/messages
export const getMessages = asyncHandler(async (req, res) => {
  const messages = await MessageFournisseur.find({
    entreprise: req.entreprise._id,
  }).lean();
  // On renvoie aussi les modèles par défaut : l'UI pré-remplit les langues qui
  // n'ont pas encore de modèle propre pour la société.
  res.json({
    messages,
    defauts: { F: DEFAULT_MESSAGE_F, A: DEFAULT_MESSAGE_A },
  });
});

// PUT /:nomDossierDBF/messages   body: { langue, message }
export const upsertMessage = asyncHandler(async (req, res) => {
  const { langue, message } = req.body;
  const lang = langue === "A" ? "A" : "F";
  const doc = await MessageFournisseur.findOneAndUpdate(
    { entreprise: req.entreprise._id, langue: lang },
    { $set: { message: message || "" } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  res.json(doc);
});

// ────────────────────────────────────────────────────────────────────────────
// RESPONSABLE / CC
// ────────────────────────────────────────────────────────────────────────────

// GET /:nomDossierDBF/responsable
export const getResponsable = asyncHandler(async (req, res) => {
  const doc = await ResponsableCc.findOne({
    entreprise: req.entreprise._id,
  }).lean();
  res.json(doc || { nom: "", emails: [] });
});

// PUT /:nomDossierDBF/responsable   body: { nom, emails }
export const upsertResponsable = asyncHandler(async (req, res) => {
  const { nom, emails } = req.body;
  const doc = await ResponsableCc.findOneAndUpdate(
    { entreprise: req.entreprise._id },
    { $set: { nom: nom || "", emails: toEmailArray(emails) } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  res.json(doc);
});

// ────────────────────────────────────────────────────────────────────────────
// HISTORIQUE
// ────────────────────────────────────────────────────────────────────────────

// GET /:nomDossierDBF/historique
export const getHistorique = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const p = parseInt(page) || 1;
  const l = parseInt(limit) || 50;
  const filter = { entreprise: req.entreprise._id };
  const [rows, total] = await Promise.all([
    EnvoiCdeHistorique.find(filter)
      .populate("envoyePar", "nom prenom email")
      .sort({ createdAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .lean(),
    EnvoiCdeHistorique.countDocuments(filter),
  ]);
  res.json({ total, page: p, limit: l, historique: rows });
});
