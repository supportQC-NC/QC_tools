// backend/routes/taskRoutes.js
import express from "express";
import {
  getTasks,
  getTaskById,
  createTask,
  updateTask,
  updateTaskStatut,
  deleteTask,
} from "../controllers/taskController.js";
import { protect } from "../middleware/authMiddleware.js";
import { allowTeamManagement } from "../middleware/accessControl.js";

const router = express.Router();

// Connexion requise pour tout.
router.use(protect);

// Lecture : tout utilisateur connecté (résultats scopés dans le contrôleur :
// un membre ne voit que SES tâches). Création : admins/responsables seulement.
router.route("/").get(getTasks).post(allowTeamManagement, createTask);

// Changement de statut : membre assigné OU gestionnaire (vérifié en contrôleur).
router.patch("/:id/statut", updateTaskStatut);

// Détail / édition / suppression.
router
  .route("/:id")
  .get(getTaskById)
  .put(allowTeamManagement, updateTask)
  .delete(allowTeamManagement, deleteTask);

export default router;
