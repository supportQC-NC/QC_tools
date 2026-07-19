// backend/routes/teamRoutes.js
import express from "express";
import {
  getTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  addMembers,
  removeMember,
} from "../controllers/teamController.js";
import { protect } from "../middleware/authMiddleware.js";
import {
  allowTeamManagement,
  checkTeamAccess,
} from "../middleware/accessControl.js";

const router = express.Router();

// Toutes les routes exigent d'être connecté ET admin/responsable.
router.use(protect, allowTeamManagement);

// Collection
router.route("/").get(getTeams).post(createTeam);

// Un élément — checkTeamAccess charge req.team et vérifie le périmètre.
router
  .route("/:id")
  .get(checkTeamAccess, getTeamById)
  .put(checkTeamAccess, updateTeam)
  .delete(checkTeamAccess, deleteTeam);

// Membres
router.post("/:id/membres", checkTeamAccess, addMembers);
router.delete("/:id/membres/:userId", checkTeamAccess, removeMember);

export default router;
