// backend/utils/chatAccess.js
//
// Contrôle d'accès aux salons de chat, partagé par le REST (historique) et les
// sockets (temps réel).

import Team from "../models/TeamModel.js";
import Task from "../models/TaskModel.js";
import Conversation from "../models/ConversationModel.js";
import User from "../models/UserModel.js";
import {
  isSuperAdmin,
  getAccessibleEntreprises,
} from "../middleware/accessControl.js";

const idEq = (a, b) => a && b && a.toString() === b.toString();

// Accès au chat d'une CONVERSATION user : MEMBRES UNIQUEMENT (décision client du
// 26/10/2026 — seuls les membres d'une discussion la voient et y interagissent,
// AUCUN bypass admin / super-admin). Participant explicite, ou — conversation
// rattachée à une ÉQUIPE — membre/responsable de l'équipe (un membre ajouté à
// l'équipe APRÈS la création voit donc aussi la discussion).
const canAccessConvChat = async (user, conv) => {
  if (!conv) return false;
  if ((conv.participants || []).some((p) => idEq(p, user._id))) return true;
  if (conv.equipe) {
    return canAccessTeamChat(user, await Team.findById(conv.equipe));
  }
  return false;
};

// Accès au chat d'une ÉQUIPE : MEMBRES UNIQUEMENT — responsable ou membre.
// (Même décision : un admin de la société / super-admin non membre n'y accède
// plus ; la GESTION de l'équipe reste, elle, soumise à canAccessTeam.)
const canAccessTeamChat = async (user, team) => {
  if (!team) return false;
  if (idEq(team.responsable, user._id)) return true;
  return (team.membres || []).some((m) => idEq(m, user._id));
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
      // Les MEMBRES de l'équipe voient les tâches de leur équipe (même non
      // assignés) : ils accèdent donc aussi au chat de ces tâches.
      if ((team.membres || []).some((m) => idEq(m, user._id))) return true;
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
  if (kind === "conv") {
    return canAccessConvChat(user, await Conversation.findById(id));
  }
  return false;
};

// Peut MODÉRER le salon = supprimer n'importe quel message (au-delà de son
// propre message, toujours autorisé). Un modérateur est forcément un MEMBRE du
// salon (même décision du 26/10/2026 : plus de bypass admin/super-admin sur les
// discussions). Règles :
//   - global : super-admin uniquement ;
//   - team:<id> : responsable de l'équipe ;
//   - conv:<id> : créateur de la conversation ; conversation d'équipe : le
//     responsable de l'équipe modère aussi ;
//   - task:<id> : auteur de la tâche, ou super-admin.
export const canModerateRoom = async (user, room) => {
  if (!user || !room) return false;
  if (room === "global") return isSuperAdmin(user);

  const sep = room.indexOf(":");
  if (sep === -1) return false;
  const kind = room.slice(0, sep);
  const id = room.slice(sep + 1);

  if (kind === "team") {
    const team = await Team.findById(id);
    return team ? idEq(team.responsable, user._id) : false;
  }
  if (kind === "conv") {
    const conv = await Conversation.findById(id);
    if (!conv) return false;
    if (idEq(conv.createdBy, user._id)) return true;
    // Conversation d'équipe : le responsable de l'équipe modère aussi.
    if (conv.equipe) {
      const team = await Team.findById(conv.equipe);
      return team ? idEq(team.responsable, user._id) : false;
    }
    return false;
  }
  if (kind === "task") {
    const task = await Task.findById(id);
    if (!task) return false;
    if (idEq(task.creePar, user._id)) return true;
    return isSuperAdmin(user);
  }
  return false;
};

// Destinataires d'un message = ids des users concernés par le salon (pour pousser
// une notification « message non lu » sur leur salon personnel `user:<id>`).
//   - global    -> tous les utilisateurs actifs
//   - team:<id> -> membres + responsable
//   - task:<id> -> assignés + auteur
//   - conv:<id> -> participants
// Centralisé ici : utilisé par le socket (message:send) ET le REST (POST /messages).
export const roomRecipients = async (room) => {
  if (room === "global") {
    const users = await User.find({ isActive: true }).select("_id");
    return users.map((u) => u._id.toString());
  }
  const sep = room.indexOf(":");
  if (sep === -1) return [];
  const kind = room.slice(0, sep);
  const id = room.slice(sep + 1);
  if (kind === "team") {
    const team = await Team.findById(id).select("membres responsable");
    if (!team) return [];
    return [...(team.membres || []), team.responsable]
      .filter(Boolean)
      .map((x) => x.toString());
  }
  if (kind === "task") {
    const task = await Task.findById(id).select("assignes creePar");
    if (!task) return [];
    return [...(task.assignes || []), task.creePar]
      .filter(Boolean)
      .map((x) => x.toString());
  }
  if (kind === "conv") {
    const conv = await Conversation.findById(id).select("participants equipe");
    if (!conv) return [];
    const ids = new Set(
      (conv.participants || []).filter(Boolean).map((x) => x.toString()),
    );
    // Conversation d'équipe : membres + responsable sont aussi destinataires.
    if (conv.equipe) {
      const team = await Team.findById(conv.equipe).select("membres responsable");
      if (team) {
        for (const m of [...(team.membres || []), team.responsable]) {
          if (m) ids.add(m.toString());
        }
      }
    }
    return [...ids];
  }
  return [];
};
