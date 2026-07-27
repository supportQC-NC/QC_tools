// backend/routes/taskRoutes.js
import express from "express";
import multer from "multer";
import {
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
} from "../controllers/taskController.js";
import { protect } from "../middleware/authMiddleware.js";
import { allowTeamManagement } from "../middleware/accessControl.js";

const router = express.Router();

// Upload en mémoire (le buffer part vers GridFS). PDF/Excel/images, 25 Mo/doc.
const uploadDocs = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
}).array("documents", 10);

// Connexion requise pour tout.
router.use(protect);

// Lecture : tout utilisateur connecté (résultats scopés dans le contrôleur :
// ?mine=true -> ses tâches). Création d'équipe : admins/responsables seulement.
router.route("/").get(getTasks).post(allowTeamManagement, createTask);

// Création d'une tâche PERSONNELLE (pour soi-même) : tout utilisateur.
router.post("/perso", createPersonalTask);

// Changement de statut : membre assigné OU gestionnaire (vérifié en contrôleur).
router.patch("/:id/statut", updateTaskStatut);

// Documents joints (assigné/propriétaire/gestionnaire — vérifié en contrôleur).
router.post("/:id/documents", uploadDocs, addTaskDocuments);
router.get("/:id/documents/:docId", downloadTaskDocument);
router.delete("/:id/documents/:docId", deleteTaskDocument);

// Détail / édition / suppression. L'autorisation (gestionnaire d'équipe OU
// propriétaire d'une tâche perso) est vérifiée dans le contrôleur.
router
  .route("/:id")
  .get(getTaskById)
  .put(updateTask)
  .delete(deleteTask);

export default router;
