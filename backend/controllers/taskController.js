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
import {
  uploadBufferToGridFS,
  deleteFromGridFS,
  findGridFSFile,
  openDownloadStream,
} from "../utils/gridfsBucket.js";

const TASK_DOCS_BUCKET = "taskdocs";

// multer décode le nom en latin1 : on rétablit l'UTF-8 (accents/spéciaux).
const decodeName = (name = "") => {
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
};

const kindFromMime = (mime = "") => {
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime === "text/csv"
  )
    return "tableur";
  return "autre";
};

const populateTask = (query) =>
  query
    .populate("assignes", "nom prenom email")
    .populate("creePar", "nom prenom email")
    .populate("equipe", "nom entreprise")
    .populate("entreprise", "nomComplet trigramme")
    .populate("documents.uploadedBy", "nom prenom");

// L'acteur gère-t-il cette tâche (responsable de l'équipe / admin société / super) ?
const canManageTask = async (actor, task) => {
  const team = await Team.findById(task.equipe);
  if (!team) return false;
  return canAccessTeam(actor, team);
};

// Propriétaire d'une tâche PERSO (l'a créée pour lui-même).
const isPersoOwner = (actor, task) =>
  task.type === "perso" &&
  task.creePar?.toString() === actor._id.toString();

// L'acteur peut-il CONSULTER/enrichir la tâche (assigné, propriétaire, gestion) ?
const isAssignee = (actor, task) =>
  (task.assignes || []).some((a) => (a?._id || a)?.toString() === actor._id.toString());

const canAccessTask = async (actor, task) => {
  if (isAssignee(actor, task)) return true;
  if (isPersoOwner(actor, task)) return true;
  return canManageTask(actor, task);
};

// Règles de SUPPRESSION :
//   - tâche perso : son propriétaire ;
//   - super-admin : tout ;
//   - admin       : tâches de ses sociétés ;
//   - responsable : UNIQUEMENT les tâches qu'il a créées/assignées.
const canDeleteTask = async (actor, task) => {
  if (isPersoOwner(actor, task)) return true;
  if (await isSuperAdmin(actor)) return true;
  if (actor.role === "admin") {
    const { all, ids } = await getAccessibleEntreprises(actor);
    return all || (task.entreprise && ids.includes(task.entreprise.toString()));
  }
  if (actor.role === "responsable") {
    return task.creePar?.toString() === actor._id.toString();
  }
  return false;
};

// Applique un statut en tenant à jour completedAt + l'ARCHIVAGE.
// Une tâche "termine" est archivée ; toute autre valeur la désarchive.
const applyStatut = (task, statut) => {
  task.statut = statut;
  if (statut === "termine") {
    const now = new Date();
    task.completedAt = now;
    task.archive = true;
    task.archivedAt = now;
  } else {
    task.completedAt = null;
    task.archive = false;
    task.archivedAt = null;
  }
};

// @desc    Liste des tâches accessibles
// @route   GET /api/tasks
// @access  Privé (scopé par rôle)
const getTasks = asyncHandler(async (req, res) => {
  const q = {};
  if (req.query.statut) q.statut = req.query.statut;
  if (req.query.equipe) q.equipe = req.query.equipe;
  // Filtre par membre assigné (l'array `assignes` matche s'il contient l'id).
  if (req.query.assigneA) q.assignes = req.query.assigneA;

  // Vue PERSONNELLE (?mine=true) : uniquement les tâches assignées à l'utilisateur
  // (ses tâches d'équipe + ses tâches perso), quel que soit son rôle. Sert au
  // tableau « Mes tâches ».
  if (req.query.mine === "true") {
    const tasks = await populateTask(
      Task.find({ ...q, assignes: req.user._id }).sort({
        deadline: 1,
        createdAt: -1,
      }),
    );
    return res.json(tasks);
  }

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
    filter = { ...q, assignes: req.user._id };
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
  if (!isAssignee(req.user, task) && !(await canManageTask(req.user, task))) {
    res.status(403);
    throw new Error("Tâche hors de votre périmètre");
  }
  res.json(await populateTask(Task.findById(task._id)));
});

// @desc    Créer une tâche
// @route   POST /api/tasks
// @access  Responsable (ses équipes) / Admin (ses sociétés)
const createTask = asyncHandler(async (req, res) => {
  const { titre, description, equipe, deadline, priorite } = req.body;
  // Accepte `assignes` (tableau) ou `assigneA` (rétro-compat, mono).
  const assignes = Array.isArray(req.body.assignes)
    ? req.body.assignes
    : req.body.assigneA
      ? [req.body.assigneA]
      : [];

  if (!titre || !equipe || assignes.length === 0) {
    res.status(400);
    throw new Error("Titre, équipe et au moins un assigné sont requis");
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

  // Chaque assigné doit être un membre de l'équipe.
  const membreIds = new Set(team.membres.map((m) => m.toString()));
  if (!assignes.every((a) => membreIds.has(String(a)))) {
    res.status(400);
    throw new Error("Les assignés doivent être des membres de l'équipe");
  }

  const task = await Task.create({
    titre,
    description: description || "",
    equipe,
    assignes,
    creePar: req.user._id,
    entreprise: team.entreprise,
    deadline: deadline || null,
    priorite: priorite || "normale",
    statut: "a_faire",
  });

  // Notification « nouvelle tâche » : poussée à chaque assigné (hors créateur)
  // sur son salon personnel, pour rafraîchir le badge « Mes tâches ».
  const io = req.app.get("io");
  if (io) {
    for (const a of assignes) {
      if (String(a) === String(req.user._id)) continue;
      io.to(`user:${a}`).emit("notif:task", { taskId: task._id });
    }
  }

  res.status(201).json(await populateTask(Task.findById(task._id)));
});

// @desc    Créer une tâche PERSONNELLE (pour soi-même)
// @route   POST /api/tasks/perso
// @access  Tout utilisateur connecté
const createPersonalTask = asyncHandler(async (req, res) => {
  const { titre, description, deadline, priorite } = req.body;
  if (!titre || !titre.trim()) {
    res.status(400);
    throw new Error("Le titre est requis");
  }

  const task = await Task.create({
    titre: titre.trim(),
    description: description || "",
    type: "perso",
    equipe: null,
    entreprise: null,
    assignes: [req.user._id],
    creePar: req.user._id,
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
  // Gestionnaire d'équipe OU propriétaire d'une tâche perso.
  if (!isPersoOwner(req.user, task) && !(await canManageTask(req.user, task))) {
    res.status(403);
    throw new Error("Tâche hors de votre périmètre");
  }

  if (req.body.titre !== undefined) task.titre = req.body.titre;
  if (req.body.description !== undefined)
    task.description = req.body.description;
  if (req.body.deadline !== undefined) task.deadline = req.body.deadline || null;
  if (req.body.priorite !== undefined) task.priorite = req.body.priorite;

  // Réassignation : uniquement pour les tâches d'ÉQUIPE ; les assignés doivent
  // être membres de l'équipe. Accepte `assignes` (tableau) ou `assigneA` (mono).
  // On mémorise les assignés AJOUTÉS pour les notifier après sauvegarde.
  let newlyAssigned = [];
  if (task.type !== "perso" && (req.body.assignes || req.body.assigneA)) {
    const nouveaux = Array.isArray(req.body.assignes)
      ? req.body.assignes
      : req.body.assigneA
        ? [req.body.assigneA]
        : [];
    if (nouveaux.length === 0) {
      res.status(400);
      throw new Error("Au moins un assigné est requis");
    }
    const team = await Team.findById(task.equipe);
    const membreIds = new Set((team?.membres || []).map((m) => m.toString()));
    if (!nouveaux.every((a) => membreIds.has(String(a)))) {
      res.status(400);
      throw new Error("Les assignés doivent être des membres de l'équipe");
    }
    const anciens = new Set((task.assignes || []).map((a) => String(a)));
    newlyAssigned = nouveaux.filter((a) => !anciens.has(String(a)));
    task.assignes = nouveaux;
  }

  if (req.body.statut !== undefined) {
    if (!TASK_STATUTS.includes(req.body.statut)) {
      res.status(400);
      throw new Error("Statut invalide");
    }
    applyStatut(task, req.body.statut);
  }

  await task.save();

  // Notification « nouvelle tâche » aux assignés AJOUTÉS lors de cette mise à
  // jour (hors l'acteur), sur leur salon personnel → badge + bandeau bureau.
  const io = req.app.get("io");
  if (io) {
    for (const a of newlyAssigned) {
      if (String(a) === String(req.user._id)) continue;
      io.to(`user:${a}`).emit("notif:task", { taskId: task._id });
    }
  }

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

  if (!isAssignee(req.user, task) && !(await canManageTask(req.user, task))) {
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
  if (!(await canDeleteTask(req.user, task))) {
    res.status(403);
    throw new Error(
      "Suppression non autorisée (vous ne pouvez supprimer que vos tâches perso ou celles que vous avez assignées).",
    );
  }
  // Nettoyage des documents GridFS liés.
  await Promise.all(
    (task.documents || []).map((d) => deleteFromGridFS(d.fileId, TASK_DOCS_BUCKET)),
  );
  await Task.deleteOne({ _id: task._id });
  res.json({ message: "Tâche supprimée" });
});

// @desc    Ajouter un ou plusieurs documents à une tâche
// @route   POST /api/tasks/:id/documents
// @access  Assigné, propriétaire (perso) ou gestionnaire
const addTaskDocuments = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    res.status(404);
    throw new Error("Tâche non trouvée");
  }
  if (!(await canAccessTask(req.user, task))) {
    res.status(403);
    throw new Error("Tâche hors de votre périmètre");
  }

  const files = req.files || [];
  if (!files.length) {
    res.status(400);
    throw new Error("Aucun document fourni");
  }

  for (const f of files) {
    const fileName = decodeName(f.originalname);
    const fileId = await uploadBufferToGridFS(
      f.buffer,
      fileName,
      f.mimetype || "application/octet-stream",
      TASK_DOCS_BUCKET,
    );
    task.documents.push({
      fileId,
      fileName,
      mimeType: f.mimetype || "application/octet-stream",
      size: f.size || f.buffer.length || 0,
      kind: kindFromMime(f.mimetype),
      uploadedBy: req.user._id,
    });
  }

  await task.save();
  res.status(201).json(await populateTask(Task.findById(task._id)));
});

// @desc    Télécharger / afficher un document d'une tâche
// @route   GET /api/tasks/:id/documents/:docId
// @access  Assigné, propriétaire ou gestionnaire
const downloadTaskDocument = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id).lean();
  if (!task) {
    res.status(404);
    throw new Error("Tâche non trouvée");
  }
  if (!(await canAccessTask(req.user, task))) {
    res.status(403);
    throw new Error("Tâche hors de votre périmètre");
  }

  const doc = (task.documents || []).find(
    (d) => d._id.toString() === req.params.docId,
  );
  if (!doc) {
    res.status(404);
    throw new Error("Document non trouvé");
  }

  const gridFile = await findGridFSFile(doc.fileId, TASK_DOCS_BUCKET);
  if (!gridFile) {
    res.status(404);
    throw new Error("Document introuvable dans GridFS");
  }

  const safeName = encodeURIComponent(doc.fileName || "document");
  const inline = doc.kind === "pdf" || doc.kind === "image";
  res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${safeName}`,
  );
  if (gridFile.length) res.setHeader("Content-Length", gridFile.length);

  const stream = openDownloadStream(doc.fileId, TASK_DOCS_BUCKET);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500);
    res.end();
  });
  stream.pipe(res);
});

// @desc    Supprimer un document d'une tâche
// @route   DELETE /api/tasks/:id/documents/:docId
// @access  Celui qui l'a déposé, le propriétaire ou un gestionnaire
const deleteTaskDocument = asyncHandler(async (req, res) => {
  const task = await Task.findById(req.params.id);
  if (!task) {
    res.status(404);
    throw new Error("Tâche non trouvée");
  }
  const doc = task.documents.id(req.params.docId);
  if (!doc) {
    res.status(404);
    throw new Error("Document non trouvé");
  }

  const isUploader = doc.uploadedBy?.toString() === req.user._id.toString();
  const canManage = isPersoOwner(req.user, task) || (await canManageTask(req.user, task));
  if (!isUploader && !canManage) {
    res.status(403);
    throw new Error("Suppression du document non autorisée");
  }

  await deleteFromGridFS(doc.fileId, TASK_DOCS_BUCKET);
  doc.deleteOne();
  await task.save();
  res.json(await populateTask(Task.findById(task._id)));
});

export {
  getTasks,
  getTaskById,
  createTask,
  createPersonalTask,
  updateTask,
  updateTaskStatut,
  deleteTask,
  addTaskDocuments,
  downloadTaskDocument,
  deleteTaskDocument,
};
