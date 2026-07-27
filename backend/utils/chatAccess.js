// backend/utils/chatAccess.js
//
// Contrôle d'accès aux salons de chat, partagé par le REST (historique) et les
// sockets (temps réel).

import Team from "../models/TeamModel.js";
import Task from "../models/TaskModel.js";
import {
  isSuperAdmin,
  getAccessibleEntreprises,
} from "../middleware/accessControl.js";

const idEq = (a, b) => a && b && a.toString() === b.toString();

// Accès au chat d'une ÉQUIPE : membre, responsable, admin de la société, super.
const canAccessTeamChat = async (user, team) => {
  if (!team) return false;
  if (await isSuperAdmin(user)) return true;
  if (idEq(team.responsable, user._id)) return true;
  if ((team.membres || []).some((m) => idEq(m, user._id))) return true;
  if (user.role === "admin") {
    const { all, ids } = await getAccessibleEntreprises(user);
    return all || ids.includes(team.entreprise?.toString());
  }
  return false;
};

// Accès au chat d'une TÂCHE : assigné, auteur, ou gestionnaire de l'équipe.
const canAccessTaskChat = async (user, task) => {
  if (!task) return false;
  if ((task.assignes || []).some((a) => idEq(a, user._id))) return true;
  if (idEq(task.creePar, user._id)) return true;
  if (await isSuperAdmin(user)) return true;
  if (task.equipe) {
    const team = await Team.findById(task.equipe);
    if (team) {
      if (idEq(team.responsable, user._id)) return true;
      if (user.role === "admin") {
        const { all, ids } = await getAccessibleEntreprises(user);
        if (all || ids.includes(team.entreprise?.toString())) return true;
      }
    }
  }
  return false;
};

// Détermine si `user` peut accéder au salon `room`.
export const canAccessRoom = async (user, room) => {
  if (!user || !room) return false;
  if (room === "global") return true;

  const sep = room.indexOf(":");
  if (sep === -1) return false;
  const kind = room.slice(0, sep);
  const id = room.slice(sep + 1);

  if (kind === "team") {
    return canAccessTeamChat(user, await Team.findById(id));
  }
  if (kind === "task") {
    return canAccessTaskChat(user, await Task.findById(id));
  }
  return false;
};
