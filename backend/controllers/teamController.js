// backend/controllers/teamController.js
//
// Gestion des ÉQUIPES (voir TeamModel). Périmètre :
//   - Super-admin : toutes les équipes.
//   - Admin       : les équipes de ses sociétés.
//   - Responsable : ses propres équipes (responsable === lui).
// L'accès à UNE équipe est garanti en amont par checkTeamAccess (req.team).
// L'ajout d'un membre exige que le membre soit dans le périmètre de l'acteur
// (canManageUser) — un responsable ne rattache que ses propres users.

import asyncHandler from "../middleware/asyncHandler.js";
import Team from "../models/TeamModel.js";
import User from "../models/UserModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import {
  getAccessibleEntreprises,
  isSuperAdmin,
  canManageUser,
} from "../middleware/accessControl.js";

// Populate commun pour renvoyer une équipe lisible côté front.
const populateTeam = (query) =>
  query
    .populate("responsable", "nom prenom email role")
    .populate("membres", "nom prenom email role isActive")
    .populate("entreprise", "nomComplet trigramme nomDossierDBF")
    .populate("createdBy", "nom prenom email");

// @desc    Liste des équipes accessibles à l'acteur
// @route   GET /api/teams
// @access  Admin / Responsable
const getTeams = asyncHandler(async (req, res) => {
  let filter;
  if (await isSuperAdmin(req.user)) {
    filter = {};
  } else if (req.user.role === "admin") {
    const { all, ids } = await getAccessibleEntreprises(req.user);
    filter = all ? {} : { entreprise: { $in: ids } };
  } else {
    // responsable
    filter = { responsable: req.user._id };
  }

  const teams = await populateTeam(Team.find(filter).sort({ createdAt: -1 }));
  res.json(teams);
});

// @desc    Détail d'une équipe
// @route   GET /api/teams/:id
// @access  Admin (société) / Responsable (propriétaire)
const getTeamById = asyncHandler(async (req, res) => {
  // req.team est déjà chargé et autorisé par checkTeamAccess ; on repopule.
  const team = await populateTeam(Team.findById(req.team._id));
  res.json(team);
});

// @desc    Créer une équipe
// @route   POST /api/teams
// @access  Admin (société) / Responsable (pour lui-même)
const createTeam = asyncHandler(async (req, res) => {
  const { nom, entreprise, responsable, membres = [], description } = req.body;

  if (!nom || !entreprise) {
    res.status(400);
    throw new Error("Nom et entreprise requis");
  }

  // Périmètre société : l'entreprise doit être accessible à l'acteur.
  const scope = await getAccessibleEntreprises(req.user);
  const entOk = scope.all || scope.ids.includes(String(entreprise));
  if (!entOk) {
    res.status(403);
    throw new Error("Entreprise hors de votre périmètre");
  }

  const entrepriseDoc = await Entreprise.findById(entreprise);
  if (!entrepriseDoc) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  // Détermination du RESPONSABLE (lead) de l'équipe.
  let leadId;
  if (req.user.role === "responsable") {
    // Un responsable ne crée que des équipes qu'il dirige lui-même.
    leadId = req.user._id;
  } else {
    // Admin / super-admin : doit désigner un responsable valide et dans son scope.
    if (!responsable) {
      res.status(400);
      throw new Error("Responsable requis");
    }
    const lead = await User.findById(responsable);
    if (!lead || lead.role !== "responsable") {
      res.status(400);
      throw new Error("Le responsable désigné doit avoir le rôle « responsable »");
    }
    if (!(await canManageUser(req.user, lead._id))) {
      res.status(403);
      throw new Error("Responsable hors de votre périmètre");
    }
    leadId = lead._id;
  }

  // Membres : chacun doit être dans le périmètre société de l'acteur (cross-société OK).
  const membreIds = [...new Set((membres || []).map(String))];
  for (const m of membreIds) {
    if (!(await canManageUser(req.user, m))) {
      res.status(403);
      throw new Error("Un des membres est hors de votre périmètre");
    }
  }

  const team = await Team.create({
    nom,
    entreprise,
    responsable: leadId,
    membres: membreIds,
    description: description || "",
    createdBy: req.user._id,
  });

  res.status(201).json(await populateTeam(Team.findById(team._id)));
});

// @desc    Mettre à jour une équipe (nom, description, isActive ; responsable = admin)
// @route   PUT /api/teams/:id
// @access  Admin (société) / Responsable (propriétaire)
const updateTeam = asyncHandler(async (req, res) => {
  const team = req.team; // chargé + autorisé par checkTeamAccess

  if (req.body.nom !== undefined) team.nom = req.body.nom;
  if (req.body.description !== undefined) team.description = req.body.description;
  if (req.body.isActive !== undefined) team.isActive = req.body.isActive;

  // Réassignation du responsable : réservée aux admins/super-admins.
  if (req.body.responsable && req.body.responsable !== team.responsable.toString()) {
    if (req.user.role !== "admin") {
      res.status(403);
      throw new Error("Seul un administrateur peut changer le responsable");
    }
    const lead = await User.findById(req.body.responsable);
    if (!lead || lead.role !== "responsable") {
      res.status(400);
      throw new Error("Le responsable désigné doit avoir le rôle « responsable »");
    }
    if (!(await canManageUser(req.user, lead._id))) {
      res.status(403);
      throw new Error("Responsable hors de votre périmètre");
    }
    team.responsable = lead._id;
  }

  await team.save();
  res.json(await populateTeam(Team.findById(team._id)));
});

// @desc    Supprimer une équipe
// @route   DELETE /api/teams/:id
// @access  Admin (société) / Responsable (propriétaire)
const deleteTeam = asyncHandler(async (req, res) => {
  await Team.deleteOne({ _id: req.team._id });
  res.json({ message: "Équipe supprimée" });
});

// @desc    Ajouter un ou plusieurs membres à l'équipe
// @route   POST /api/teams/:id/membres
// @access  Admin (société) / Responsable (propriétaire)
const addMembers = asyncHandler(async (req, res) => {
  const team = req.team;

  // Accepte { userId } ou { userIds: [] }.
  const ids = req.body.userIds || (req.body.userId ? [req.body.userId] : []);
  if (!ids.length) {
    res.status(400);
    throw new Error("Aucun utilisateur fourni");
  }

  for (const id of ids) {
    // Chaque membre ajouté doit être dans le périmètre société de l'acteur.
    if (!(await canManageUser(req.user, id))) {
      res.status(403);
      throw new Error("Un des utilisateurs est hors de votre périmètre");
    }
    const user = await User.findById(id);
    if (!user) {
      res.status(404);
      throw new Error("Utilisateur non trouvé");
    }
    // addToSet : pas de doublon.
    if (!team.membres.some((m) => m.toString() === String(id))) {
      team.membres.push(id);
    }
  }

  await team.save();
  res.json(await populateTeam(Team.findById(team._id)));
});

// @desc    Retirer un membre de l'équipe
// @route   DELETE /api/teams/:id/membres/:userId
// @access  Admin (société) / Responsable (propriétaire)
const removeMember = asyncHandler(async (req, res) => {
  const team = req.team;
  const { userId } = req.params;

  team.membres = team.membres.filter((m) => m.toString() !== String(userId));
  await team.save();

  res.json(await populateTeam(Team.findById(team._id)));
});

export {
  getTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  addMembers,
  removeMember,
};
