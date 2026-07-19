// backend/controllers/taskController.js
//
// Tâches (voir TaskModel). Périmètre :
//   - Super-admin : toutes les tâches.
//   - Admin       : tâches de ses sociétés.
//   - Responsable : tâches de ses équipes.
//   - Membre      : ses tâches assignées (lecture + changement de STATUT).
//
// Création/édition/suppression : responsable de l'équipe ou admin de la société.
// Le membre assigné ne peut QUE faire évoluer le statut de SES tâches.

import asyncHandler from "../middleware/asyncHandler.js";
import Task, { TASK_STATUTS } from "../models/TaskModel.js";
import Team from "../models/TeamModel.js";
import {
  isSuperAdmin,
  getAccessibleEntreprises,
  canAccessTeam,
} from "../middleware/accessControl.js";

const populateTask = (query) =>
  query
    .populate("assigneA", "nom prenom email")
    .populate("creePar", "nom prenom email")
    .populate("equipe", "nom entreprise")
    .populate("entreprise", "nomComplet trigramme");

// L'acteur gère-t-il cette tâche (responsable de l'équipe / admin société / super) ?
const canManageTask = async (actor, task) => {
  const team = await Team.findById(task.equipe);
  if (!team) return false;
  return canAccessTeam(actor, team);
};

// Applique un statut en tenant à jour completedAt.
const applyStatut = (task, statut) => {
  task.statut = statut;
  task.completedAt = statut === "termine" ? new Date() : null;
};

// @desc    Liste des tâches accessibles
// @route   GET /api/tasks
// @access  Privé (scopé par rôle)
const getTasks = asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.statut) q.statut = req.query.statut;
  if (req.query.equipe) q.equipe = req.query.equipe;
  if (req.query.assigneA) q.assigneA = req.query.assigneA;

  let filter;
  if (await isSuperAdmin(req.user)) {
    filter = q;
  } else if (req.user.role === "admin") {
    const { all, ids } = await getAccessibleEntreprises(req.user);
    filter = all ? q : { ...q, entreprise: { $in: ids } };
  } else if (req.user.role === "responsable") {
    const teams = await Team.find({ responsable: req.user._id }).select("_id");
    filter = { ...q, equipe: { $in: teams.map((t) => t._id) } };
  } else {
    // Membre : uniquement ses tâches (on ignore un éventuel ?assigneA).
    filter = { ...q, assigneA: req.user._id };
  }

  const tasks = await populateTask(
    Task.find(filter).sort({ deadline: 1, createdAt: -1 }),
  );
  res.json(tasks);
});

// @desc    Détail d'une tâche
// @route   GET /api/tasks/:id
// @access  Gestionnaire de la tâche OU membre assigné
const getTaskById = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    res.status(404);
    throw new Error("Tâche non trouvée");
  }
  const isAssignee = task.assigneA.toString() === req.user._id.toString();
  if (!isAssignee && !(await canManageTask(req.user, task))) {
    res.status(403);
    throw new Error("Tâche hors de votre périmètre");
  }
  res.json(await populateTask(Task.findById(task._id)));
});

// @desc    Créer une tâche
// @route   POST /api/tasks
// @access  Responsable (ses équipes) / Admin (ses sociétés)
const createTask = asyncHandler(async (req, res) => {
  const { titre, description, equipe, assigneA, deadline, priorite } = req.body;

  if (!titre || !equipe || !assigneA) {
    res.status(400);
    throw new Error("Titre, équipe et assigné sont requis");
  }

  const team = await Team.findById(equipe);
  if (!team) {
    res.status(404);
    throw new Error("Équipe non trouvée");
  }

  // L'acteur doit gérer l'équipe.
  if (!(await canAccessTeam(req.user, team))) {
    res.status(403);
    throw new Error("Équipe hors de votre périmètre");
  }

  // L'assigné doit être un membre de l'équipe.
  if (!team.membres.some((m) => m.toString() === String(assigneA))) {
    res.status(400);
    throw new Error("L'assigné doit être un membre de l'équipe");
  }

  const task = await Task.create({
    titre,
    description: description || "",
    equipe,
    assigneA,
    creePar: req.user._id,
    entreprise: team.entreprise,
    deadline: deadline || null,
    priorite: priorite || "normale",
    statut: "a_faire",
  });

  res.status(201).json(await populateTask(Task.findById(task._id)));
});

// @desc    Mettre à jour une tâche (gestionnaire)
// @route   PUT /api/tasks/:id
// @access  Responsable (équipe) / Admin (société)
const updateTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    res.status(404);
    throw new Error("Tâche non trouvée");
  }
  if (!(await canManageTask(req.user, task))) {
    res.status(403);
    throw new Error("Tâche hors de votre périmètre");
  }

  if (req.body.titre !== undefined) task.titre = req.body.titre;
  if (req.body.description !== undefined)
    task.description = req.body.description;
  if (req.body.deadline !== undefined) task.deadline = req.body.deadline || null;
  if (req.body.priorite !== undefined) task.priorite = req.body.priorite;

  // Réassignation : le nouvel assigné doit être membre de l'équipe de la tâche.
  if (req.body.assigneA && req.body.assigneA !== task.assigneA.toString()) {
    const team = await Team.findById(task.equipe);
    if (!team?.membres.some((m) => m.toString() === String(req.body.assigneA))) {
      res.status(400);
      throw new Error("L'assigné doit être un membre de l'équipe");
    }
    task.assigneA = req.body.assigneA;
  }

  if (req.body.statut !== undefined) {
    if (!TASK_STATUTS.includes(req.body.statut)) {
      res.status(400);
      throw new Error("Statut invalide");
    }
    applyStatut(task, req.body.statut);
  }

  await task.save();
  res.json(await populateTask(Task.findById(task._id)));
});

// @desc    Changer le STATUT d'une tâche
// @route   PATCH /api/tasks/:id/statut
// @access  Membre assigné OU gestionnaire
const updateTaskStatut = asyncHandler(async (req, res) => {
  const { statut } = req.body;
  if (!TASK_STATUTS.includes(statut)) {
    res.status(400);
    throw new Error("Statut invalide");
  }

  const task = await Task.findById(req.params.id);
  if (!task) {
    res.status(404);
    throw new Error("Tâche non trouvée");
  }

  const isAssignee = task.assigneA.toString() === req.user._id.toString();
  if (!isAssignee && !(await canManageTask(req.user, task))) {
    res.status(403);
    throw new Error("Tâche hors de votre périmètre");
  }

  applyStatut(task, statut);
  await task.save();
  res.json(await populateTask(Task.findById(task._id)));
});

// @desc    Supprimer une tâche (gestionnaire)
// @route   DELETE /api/tasks/:id
// @access  Responsable (équipe) / Admin (société)
const deleteTask = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    res.status(404);
    throw new Error("Tâche non trouvée");
  }
  if (!(await canManageTask(req.user, task))) {
    res.status(403);
    throw new Error("Tâche hors de votre périmètre");
  }
  await Task.deleteOne({ _id: task._id });
  res.json({ message: "Tâche supprimée" });
});

export {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  updateTaskStatut,
  deleteTask,
};
