// backend/controllers/configRapportsController.js
//
// CRUD générique du « Socle config rapports ». Chaque ressource (URL) est mappée
// à un modèle Mongo via le registre RESOURCES. Config transverse admin : gate par
// le module de permission `config_rapports` (pas de scope société côté route ;
// le champ `entreprise` des collections scopées est porté par le document).
import asyncHandler from "../middleware/asyncHandler.js";
import { runMasterConfigSeed } from "../services/masterConfigSeedService.js";

import AbonnementRapportClient from "../models/masterConfig/AbonnementRapportClientModel.js";
import GroupePrioritaire from "../models/masterConfig/GroupePrioritaireModel.js";
import GroupeSpecial from "../models/masterConfig/GroupeSpecialModel.js";
import MailCompta from "../models/masterConfig/MailComptaModel.js";
import ListEnvoiFactAuto from "../models/masterConfig/ListEnvoiFactAutoModel.js";

// nom de ressource (URL) -> { model, entrepriseScoped, hasUser }
// NB : les libellés d'états (commande/facture/proforma/réservation) et la config
// société vivent désormais sur le modèle Entreprise (édités via EntrepriseModal),
// pas ici — on ne garde que les données PAR CLIENT / référentiels.
const RESOURCES = {
  abonnements: { model: AbonnementRapportClient, entrepriseScoped: true, hasUser: true },
  "groupes-prioritaires": { model: GroupePrioritaire, entrepriseScoped: false, hasUser: false },
  "groupes-speciaux": { model: GroupeSpecial, entrepriseScoped: true, hasUser: false },
  "mails-compta": { model: MailCompta, entrepriseScoped: true, hasUser: true },
  "factures-auto": { model: ListEnvoiFactAuto, entrepriseScoped: true, hasUser: true },
};

// Récupère l'entrée du registre ou lève une 400.
const getResource = (req, res) => {
  const entry = RESOURCES[req.params.resource];
  if (!entry) {
    res.status(400);
    throw new Error(`Ressource de config inconnue : ${req.params.resource}`);
  }
  return entry;
};

// GET /:resource  (?entrepriseId=... pour filtrer les ressources scopées)
const listResource = asyncHandler(async (req, res) => {
  const { model, entrepriseScoped, hasUser } = getResource(req, res);
  const filter = {};
  if (entrepriseScoped && req.query.entrepriseId) {
    filter.entreprise = req.query.entrepriseId;
  }
  let query = model.find(filter).sort({ updatedAt: -1 });
  if (entrepriseScoped) {
    query = query.populate("entreprise", "trigramme nomComplet nom");
  }
  if (hasUser) {
    query = query.populate("user", "nom prenom email");
  }
  const items = await query.lean();
  res.json(items);
});

// POST /:resource
const createResource = asyncHandler(async (req, res) => {
  const { model } = getResource(req, res);
  const created = await model.create(req.body);
  res.status(201).json(created);
});

// PUT /:resource/:id
const updateResource = asyncHandler(async (req, res) => {
  const { model } = getResource(req, res);
  const updated = await model.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!updated) {
    res.status(404);
    throw new Error("Enregistrement introuvable");
  }
  res.json(updated);
});

// DELETE /:resource/:id
const deleteResource = asyncHandler(async (req, res) => {
  const { model } = getResource(req, res);
  const deleted = await model.findByIdAndDelete(req.params.id);
  if (!deleted) {
    res.status(404);
    throw new Error("Enregistrement introuvable");
  }
  res.json({ message: "Supprimé", _id: req.params.id });
});

// POST /seed — importe la config initiale depuis les JSON (NON-DESTRUCTIF :
// n'ajoute que ce qui manque, ne modifie jamais l'existant). Pour la prod.
const seedConfig = asyncHandler(async (req, res) => {
  const result = await runMasterConfigSeed();
  res.json({
    message: "Import terminé (non-destructif).",
    ...result,
  });
});

export { listResource, createResource, updateResource, deleteResource, seedConfig };
