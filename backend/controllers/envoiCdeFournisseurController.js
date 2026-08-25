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
  importerEmailsExcel,
  supprimerEmails,
  compterCiblesMasse,
  envoyerMasse,
  resoudreRelances,
  envoyerRelances,
  resoudreDemandesFacture,
  envoyerDemandesFacture,
  getListeAr,
  resoudreAr,
  confirmerAr,
  annulerAr,
  compterPurgeHistorique,
  purgerHistorique,
  TYPES_HISTORIQUE,
  FILTRE_TYPE_COMMANDE,
  nettoyerHtmlMessage,
  DEFAULT_MESSAGE_F,
  DEFAULT_MESSAGE_A,
  DEFAULT_RELANCE_F,
  DEFAULT_RELANCE_A,
  DEFAULT_SUJET_RELANCE_F,
  DEFAULT_SUJET_RELANCE_A,
  DEFAULT_AR_F,
  DEFAULT_AR_A,
  DEFAULT_SUJET_AR_F,
  DEFAULT_SUJET_AR_A,
  DEFAULT_FACTURE_F,
  DEFAULT_FACTURE_A,
  DEFAULT_SUJET_FACTURE_F,
  DEFAULT_SUJET_FACTURE_A,
  VARIABLES_RELANCE,
  VARIABLES_AR,
  VARIABLES_FACTURE,
} from "../services/envoiCdeFournisseurService.js";
import { genererModeleEmailsExcel } from "../services/envoiCdeReportService.js";

import FournisseurEmail from "../models/FournisseurEmailModel.js";
import MessageFournisseur, {
  assurerSchemaMessages,
} from "../models/MessageFournisseurModel.js";
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
    montantTotal: r.detail.montantTotal,
    devise: r.detail.devise,
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

// GET /:nomDossierDBF/emails/modele-excel  (télécharge un modèle d'import)
export const modeleExcelEmails = asyncHandler(async (req, res) => {
  const buffer = await genererModeleEmailsExcel();
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="modele_import_fournisseurs.xlsx"',
  );
  res.send(buffer);
});

// POST /:nomDossierDBF/emails/import-excel  (multipart, champ "file")
export const importEmailsExcel = asyncHandler(async (req, res) => {
  if (!req.file || !req.file.buffer) {
    res.status(400);
    throw new Error("Aucun fichier reçu.");
  }
  const result = await importerEmailsExcel(req.entreprise, req.file.buffer);
  res.json({
    message: `${result.importes} fournisseur(s) importé(s) sur ${result.total} ligne(s).`,
    ...result,
  });
});

// POST /:nomDossierDBF/emails/delete-bulk  body: { ids?: [], all?: bool }
export const deleteEmailsBulk = asyncHandler(async (req, res) => {
  const { ids, all } = req.body;
  const result = await supprimerEmails(req.entreprise, { ids, all });
  res.json({ message: `${result.deleted} fournisseur(s) supprimé(s).`, ...result });
});

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
  await assurerSchemaMessages();
  const messages = await MessageFournisseur.find({
    entreprise: req.entreprise._id,
  }).lean();
  // On renvoie aussi les modèles par défaut : l'UI pré-remplit les (type, langue)
  // qui n'ont pas encore de modèle propre pour la société.
  res.json({
    messages,
    defauts: {
      commande: { F: DEFAULT_MESSAGE_F, A: DEFAULT_MESSAGE_A },
      relance: {
        F: { message: DEFAULT_RELANCE_F, sujet: DEFAULT_SUJET_RELANCE_F },
        A: { message: DEFAULT_RELANCE_A, sujet: DEFAULT_SUJET_RELANCE_A },
      },
      ar: {
        F: { message: DEFAULT_AR_F, sujet: DEFAULT_SUJET_AR_F },
        A: { message: DEFAULT_AR_A, sujet: DEFAULT_SUJET_AR_A },
      },
      facture: {
        F: { message: DEFAULT_FACTURE_F, sujet: DEFAULT_SUJET_FACTURE_F },
        A: { message: DEFAULT_FACTURE_A, sujet: DEFAULT_SUJET_FACTURE_A },
      },
    },
    // Champs insérables dans le sujet/corps (menu « Insérer un champ »).
    variablesRelance: VARIABLES_RELANCE,
    variablesAr: VARIABLES_AR,
    variablesFacture: VARIABLES_FACTURE,
  });
});

// PUT /:nomDossierDBF/messages   body: { type, langue, message, sujet }
export const upsertMessage = asyncHandler(async (req, res) => {
  await assurerSchemaMessages();
  const { type, langue, message, sujet } = req.body;
  const lang = langue === "A" ? "A" : "F";
  const typ = ["relance", "ar", "facture"].includes(type) ? type : "commande";
  const set = { message: nettoyerHtmlMessage(message) };
  // Le sujet n'a de sens que pour la relance et l'AR (celui d'une commande est
  // calculé à l'envoi, par fidélité à l'Access d'origine).
  if (typ !== "commande") set.sujet = String(sujet || "").trim();
  const doc = await MessageFournisseur.findOneAndUpdate(
    { entreprise: req.entreprise._id, type: typ, langue: lang },
    { $set: set },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  res.json(doc);
});

// ────────────────────────────────────────────────────────────────────────────
// RELANCES (depuis l'onglet Historique)
// ────────────────────────────────────────────────────────────────────────────

// POST /:nomDossierDBF/relance/apercu   body: { numcdes: [] }
// Renvoie ce qui partirait, groupé par fournisseur (aperçu avant envoi).
export const apercuRelance = asyncHandler(async (req, res) => {
  const { numcdes = [] } = req.body;
  if (!Array.isArray(numcdes) || numcdes.length === 0) {
    res.status(400);
    throw new Error("Aucune commande sélectionnée.");
  }
  const groupes = await resoudreRelances(req.entreprise, numcdes);
  const params = await getParametres(req.entreprise);

  res.json({
    testMode: params.testMode,
    testEmails: params.testEmails,
    groupes: groupes.map((g) => {
      if (g.erreur) {
        return { fournId: g.fournId, fournNom: g.fournNom, numcdes: g.numcdes, erreur: g.erreur };
      }
      const envoi = appliquerModeTest(
        { destinataires: g.destinataires, cc: g.cc, sujet: g.sujet },
        params,
      );
      return {
        fournId: g.fournId,
        fournNom: g.fournNom,
        langue: g.langue,
        numcdes: g.numcdes,
        // Les lignes de commande ne servent qu'aux pièces jointes : inutile de
        // les faire transiter jusqu'à l'écran d'aperçu.
        commandes: g.commandes.map(({ lignes, ...c }) => c),
        sujet: g.sujet,
        html: g.html,
        destinatairesReels: g.destinataires,
        ccReels: g.cc,
        envoi: { to: envoi.to, cc: envoi.cc, sujet: envoi.sujet, testMode: envoi.testMode },
      };
    }),
  });
});

// POST /:nomDossierDBF/relance   body: { numcdes: [], avecPieces? }
export const envoyerRelanceCtrl = asyncHandler(async (req, res) => {
  const { numcdes = [], avecPieces } = req.body;
  if (!Array.isArray(numcdes) || numcdes.length === 0) {
    res.status(400);
    throw new Error("Aucune commande sélectionnée.");
  }
  const result = await envoyerRelances(
    req.entreprise,
    numcdes,
    { avecPieces: avecPieces !== false },
    req.user,
  );
  res.json(result);
});

// ────────────────────────────────────────────────────────────────────────────
// DEMANDES DE FACTURE (onglet Accusés de réception, commandes confirmées)
// ────────────────────────────────────────────────────────────────────────────

// POST /:nomDossierDBF/facture/apercu   body: { numcdes: [] }
// Même forme de réponse que l'aperçu de relance : groupé par fournisseur, avec
// les commandes refusées (AR non confirmé) remontées comme erreurs.
export const apercuDemandeFacture = asyncHandler(async (req, res) => {
  const { numcdes = [] } = req.body;
  if (!Array.isArray(numcdes) || numcdes.length === 0) {
    res.status(400);
    throw new Error("Aucune commande sélectionnée.");
  }
  const groupes = await resoudreDemandesFacture(req.entreprise, numcdes);
  const params = await getParametres(req.entreprise);

  res.json({
    testMode: params.testMode,
    testEmails: params.testEmails,
    groupes: groupes.map((g) => {
      if (g.erreur) {
        return {
          fournId: g.fournId,
          fournNom: g.fournNom,
          numcdes: g.numcdes,
          erreur: g.erreur,
        };
      }
      const envoi = appliquerModeTest(
        { destinataires: g.destinataires, cc: g.cc, sujet: g.sujet },
        params,
      );
      return {
        fournId: g.fournId,
        fournNom: g.fournNom,
        langue: g.langue,
        numcdes: g.numcdes,
        montantTotalLibelle: g.montantTotalLibelle,
        // Les lignes ne servent qu'aux pièces jointes : inutile de les faire
        // transiter jusqu'à l'écran d'aperçu.
        commandes: g.commandes.map(({ lignes, ...c }) => c),
        sujet: g.sujet,
        html: g.html,
        destinatairesReels: g.destinataires,
        ccReels: g.cc,
        envoi: { to: envoi.to, cc: envoi.cc, sujet: envoi.sujet, testMode: envoi.testMode },
      };
    }),
  });
});

// POST /:nomDossierDBF/facture   body: { numcdes: [], avecPieces? }
// ⚠️ Pièces jointes par défaut ABSENTES (contrairement à la relance) : le
// fournisseur a déjà la commande, on ne lui réclame que la facture.
export const envoyerDemandeFactureCtrl = asyncHandler(async (req, res) => {
  const { numcdes = [], avecPieces } = req.body;
  if (!Array.isArray(numcdes) || numcdes.length === 0) {
    res.status(400);
    throw new Error("Aucune commande sélectionnée.");
  }
  const result = await envoyerDemandesFacture(
    req.entreprise,
    numcdes,
    { avecPieces: avecPieces === true },
    req.user,
  );
  res.json(result);
});

// ────────────────────────────────────────────────────────────────────────────
// ACCUSÉS DE RÉCEPTION (onglet dédié)
// ────────────────────────────────────────────────────────────────────────────

// Normalise le corps { commandes: [{numcde, montantTotal?}] } — accepte aussi
// une simple liste de n° de commande.
const toCommandesAr = (body = {}) => {
  const { commandes, numcdes } = body;
  if (Array.isArray(commandes) && commandes.length) {
    return commandes
      .map((c) =>
        typeof c === "string"
          ? { numcde: c }
          : { numcde: String(c?.numcde || "").trim(), montantTotal: c?.montantTotal },
      )
      .filter((c) => c.numcde);
  }
  if (Array.isArray(numcdes)) {
    return numcdes.map((n) => ({ numcde: String(n || "").trim() })).filter((c) => c.numcde);
  }
  return [];
};

// GET /:nomDossierDBF/ar?statut=&search=&page=&limit=
export const listAr = asyncHandler(async (req, res) => {
  const { statut, search, page, limit } = req.query;
  const data = await getListeAr(req.entreprise, { statut, search, page, limit });
  res.json(data);
});

// POST /:nomDossierDBF/ar/apercu   body: { commandes: [{numcde, montantTotal?}] }
export const apercuAr = asyncHandler(async (req, res) => {
  const commandes = toCommandesAr(req.body);
  if (!commandes.length) {
    res.status(400);
    throw new Error("Aucune commande sélectionnée.");
  }
  const prepares = await resoudreAr(req.entreprise, commandes);
  const params = await getParametres(req.entreprise);

  res.json({
    testMode: params.testMode,
    testEmails: params.testEmails,
    commandes: prepares.map((a) => {
      if (a.erreur) return a;
      const envoi = appliquerModeTest(
        { destinataires: a.destinataires, cc: a.cc, sujet: a.sujet },
        params,
      );
      return {
        ...a,
        destinatairesReels: a.destinataires,
        ccReels: a.cc,
        envoi: { to: envoi.to, cc: envoi.cc, sujet: envoi.sujet, testMode: envoi.testMode },
      };
    }),
  });
});

// POST /:nomDossierDBF/ar/confirmer  body: { commandes: [...], envoyerMail? }
export const confirmerArCtrl = asyncHandler(async (req, res) => {
  const commandes = toCommandesAr(req.body);
  if (!commandes.length) {
    res.status(400);
    throw new Error("Aucune commande sélectionnée.");
  }
  const result = await confirmerAr(
    req.entreprise,
    commandes,
    { envoyerMail: req.body.envoyerMail !== false },
    req.user,
  );
  res.json(result);
});

// POST /:nomDossierDBF/ar/annuler   body: { numcdes: [] }
export const annulerArCtrl = asyncHandler(async (req, res) => {
  const { numcdes = [] } = req.body;
  if (!Array.isArray(numcdes) || numcdes.length === 0) {
    res.status(400);
    throw new Error("Aucune commande sélectionnée.");
  }
  const result = await annulerAr(req.entreprise, numcdes);
  res.json({
    message: `${result.modifies} accusé(s) de réception repassé(s) en attente.`,
    ...result,
  });
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
  const { page = 1, limit = 50, type, search } = req.query;
  const p = parseInt(page) || 1;
  const l = parseInt(limit) || 50;
  const filter = { entreprise: req.entreprise._id };
  // Les plus vieilles lignes n'ont pas de `type` : elles s'affichent comme des
  // commandes (badge par défaut), le filtre « Commandes » doit les inclure.
  if (TYPES_HISTORIQUE.includes(type))
    Object.assign(filter, type === "commande" ? FILTRE_TYPE_COMMANDE : { type });
  if (search) {
    const rx = new RegExp(String(search).trim(), "i");
    filter.$or = [{ numcde: rx }, { fournNom: rx }, { sujet: rx }];
  }
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

// ────────────────────────────────────────────────────────────────────────────
// PURGE DE L'HISTORIQUE
// ────────────────────────────────────────────────────────────────────────────

// Normalise les options de purge reçues en query (aperçu) ou en body (purge).
// `avant` (JJ/MM/AAAA côté écran, "AAAA-MM-JJ" en transit) l'emporte sur `mois`.
// Une date "AAAA-MM-JJ" est comprise à MINUIT LOCAL (fuseau du serveur) : on
// supprime bien tout ce qui précède ce jour, sans décalage d'une demi-journée.
const parserOptionsPurge = (src = {}) => {
  const { avant, mois, types, garderArNonConfirme } = src;

  let date = null;
  const brut = typeof avant === "string" ? avant.trim() : avant;
  if (brut) {
    const jour = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(brut));
    date = jour
      ? new Date(+jour[1], +jour[2] - 1, +jour[3])
      : new Date(brut);
  } else if (mois !== undefined && mois !== null && mois !== "") {
    const n = parseInt(mois, 10);
    if (!isNaN(n) && n > 0) {
      date = new Date();
      date.setMonth(date.getMonth() - n);
    }
  }
  if (!date || isNaN(date.getTime())) {
    const err = new Error(
      "Précisez la période à purger (une date ou un nombre de mois).",
    );
    err.statusCode = 400;
    throw err;
  }

  const liste = Array.isArray(types)
    ? types
    : typeof types === "string" && types.trim()
      ? types.split(",")
      : [];

  return {
    avant: date,
    types: liste.map((t) => String(t).trim()).filter(Boolean),
    // Coché par défaut : on n'ampute pas le suivi d'AR sans le vouloir.
    garderArNonConfirme: String(garderArNonConfirme) !== "false",
  };
};

// GET /:nomDossierDBF/historique/purge  — aperçu, ne supprime rien
export const apercuPurgeHistorique = asyncHandler(async (req, res) => {
  try {
    const options = parserOptionsPurge(req.query);
    res.json(await compterPurgeHistorique(req.entreprise, options));
  } catch (e) {
    // Le `statusCode` posé par le service/parseur doit atteindre errorHandler,
    // qui lit celui de la RÉPONSE, pas celui de l'erreur.
    res.status(e.statusCode || 500);
    throw e;
  }
});

// POST /:nomDossierDBF/historique/purge   body: { avant | mois, types[], garderArNonConfirme }
export const purgerHistoriqueCtrl = asyncHandler(async (req, res) => {
  let result;
  try {
    result = await purgerHistorique(req.entreprise, parserOptionsPurge(req.body));
  } catch (e) {
    res.status(e.statusCode || 500);
    throw e;
  }
  res.json({
    message:
      `${result.supprimes} ligne(s) d'historique supprimée(s)` +
      (result.arSupprimes
        ? `, ${result.arSupprimes} suivi(s) d'AR devenu(s) sans objet.`
        : "."),
    ...result,
  });
});
