// backend/middleware/accessControl.js
//
// Contrôle d'accès CENTRALISÉ par entreprise, valable aussi pour les ADMINS.
//
// Règle (décidée avec le client) :
//   - Un utilisateur (admin OU user) avec `allEntreprises = true` = accès TOTAL
//     (« super-admin » côté admin). Il voit toutes les entreprises.
//   - Sinon, l'accès est limité à sa liste `permission.entreprises`.
//   - SÉCURITÉ anti-verrouillage : un ADMIN hérité SANS document Permission est
//     traité comme super-admin (les admins historiques ne sont pas bloqués tant
//     que la migration n'a pas tourné). Dès qu'il a un Permission, ce dernier fait foi.
//
// La gestion des UTILISATEURS et des ENTREPRISES est réservée aux super-admins
// (voir le middleware `superAdmin`).

import asyncHandler from "./asyncHandler.js";
import Permission from "../models/PermissionModel.js";
import Team from "../models/TeamModel.js";

/**
 * Renvoie le périmètre d'entreprises accessible à un utilisateur.
 * @returns {Promise<{all: boolean, ids: string[]}>}
 *   all = true  -> accès à toutes les entreprises (ids ignoré)
 *   all = false -> accès limité aux ids (tableau de string d'ObjectId)
 */
export const getAccessibleEntreprises = async (user) => {
  if (!user) return { all: false, ids: [] };

  const permission = await Permission.findOne({ user: user._id });

  // Admin hérité sans permissions -> super-admin ; user sans permissions -> rien.
  if (!permission) {
    return user.role === "admin" ? { all: true, ids: [] } : { all: false, ids: [] };
  }

  if (permission.allEntreprises) return { all: true, ids: [] };

  return {
    all: false,
    ids: (permission.entreprises || []).map((e) => e.toString()),
  };
};

/**
 * L'utilisateur est-il super-admin ? (admin + accès à toutes les entreprises,
 * ou admin hérité sans permissions).
 */
export const isSuperAdmin = async (user) => {
  if (!user || user.role !== "admin") return false;
  const permission = await Permission.findOne({ user: user._id });
  if (!permission) return true; // admin hérité
  return permission.allEntreprises === true;
};

/**
 * Middleware : réserve une route aux SUPER-ADMINS
 * (gestion des utilisateurs et des entreprises).
 */
export const superAdmin = asyncHandler(async (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    res.status(403);
    throw new Error("Réservé aux administrateurs");
  }
  const permission = await Permission.findOne({ user: req.user._id });
  const ok = !permission || permission.allEntreprises === true;
  if (!ok) {
    res.status(403);
    throw new Error(
      "Réservé aux super-administrateurs (accès à toutes les entreprises)",
    );
  }
  next();
});

/**
 * Middleware optionnel : attache req.accessScope = { all, ids } pour les
 * contrôleurs transverses qui filtrent eux-mêmes leurs agrégats.
 */
export const attachAccessScope = asyncHandler(async (req, res, next) => {
  req.accessScope = await getAccessibleEntreprises(req.user);
  next();
});

// ---------------------------------------------------------------------------
// ANALYSE — droit d'accès PAR ÉCRAN (admins ET users)
// ---------------------------------------------------------------------------
// Chaque écran d'analyse a sa propre clé. Ce droit N'est PAS couvert par
// allModules ni par le rôle admin : seul un SUPER-ADMIN (allEntreprises) y
// accède d'office ; sinon il faut que permission.analyse[<clé>] soit vrai.
export const ANALYSE_KEYS = [
  "commerciaux",
  "filiales",
  "reapproLocal",
  "debitComptant",
  "doublonsGencode",
  "factures",
  "journalCaisse",
  "topArticles",
  "analyseReappro",
];

// Réseaux de l'analyse Filiales (figés côté service : DQ, QC, LD).
export const FILIALE_RESEAUX = ["DQ", "QC", "LD"];

/**
 * L'utilisateur a-t-il accès à l'écran d'analyse <key> ?
 * Cas particulier « filiales » : accès à l'écran dès qu'AU MOINS un réseau est
 * autorisé (le détail par réseau est vérifié par checkFilialeReseauAccess).
 */
export const hasAnalyseAccess = async (user, key) => {
  if (!user) return false;
  const permission = await Permission.findOne({ user: user._id });
  // Super-admin : admin + toutes entreprises (ou admin hérité sans permissions).
  if (user.role === "admin" && (!permission || permission.allEntreprises === true)) {
    return true;
  }
  if (key === "filiales") {
    const f = permission?.analyse?.filiales;
    return !!(f && FILIALE_RESEAUX.some((r) => f[r] === true));
  }
  return permission?.analyse?.[key] === true;
};

/** Accès à UN réseau précis de l'analyse Filiales (DQ | QC | LD). */
export const hasFilialeReseauAccess = async (user, reseau) => {
  if (!user) return false;
  const permission = await Permission.findOne({ user: user._id });
  if (user.role === "admin" && (!permission || permission.allEntreprises === true)) {
    return true;
  }
  return permission?.analyse?.filiales?.[reseau] === true;
};

/** Middleware : réserve une route d'analyse aux utilisateurs autorisés. */
export const checkAnalyseAccess = (key) =>
  asyncHandler(async (req, res, next) => {
    const ok = await hasAnalyseAccess(req.user, key);
    if (!ok) {
      res.status(403);
      throw new Error("Vous n'avez pas accès à cette analyse");
    }
    next();
  });

/** Middleware : réserve une route filiales au réseau :reseau autorisé. */
export const checkFilialeReseauAccess = asyncHandler(async (req, res, next) => {
  const ok = await hasFilialeReseauAccess(req.user, req.params.reseau);
  if (!ok) {
    res.status(403);
    throw new Error("Vous n'avez pas accès à ce réseau");
  }
  next();
});

// ---------------------------------------------------------------------------
// COMMERCIAUX — restriction PAR ENTREPRISE aux codes attribués
// ---------------------------------------------------------------------------
/**
 * Renvoie les codes commerciaux visibles par l'utilisateur pour une entreprise.
 * @returns {Promise<null | string[]>}
 *   null     -> accès à TOUS les commerciaux (super-admin)
 *   string[] -> liste des codes autorisés (peut être vide = aucun commercial)
 */
export const getCommerciauxCodes = async (user, entrepriseId) => {
  if (!user) return [];
  const permission = await Permission.findOne({ user: user._id });
  // Super-admin (admin + toutes entreprises, ou admin hérité) : tout.
  if (user.role === "admin" && (!permission || permission.allEntreprises === true)) {
    return null;
  }
  const scope = permission?.commerciauxScope || {};
  const codes = scope[String(entrepriseId)];
  return Array.isArray(codes) ? codes.map((c) => String(c)) : [];
};

// ---------------------------------------------------------------------------
// HIÉRARCHIE — périmètre des UTILISATEURS gérables (admin société / responsable)
// ---------------------------------------------------------------------------
/**
 * Renvoie l'ensemble des utilisateurs que l'acteur peut VOIR et GÉRER.
 *   - Super-admin           -> { all: true, userIds: null }  (tout le monde, inchangé)
 *   - Admin scopé           -> users rattachés à SES sociétés (+ lui-même)
 *   - Responsable           -> membres de SES équipes (+ lui-même)
 *   - User simple           -> lui-même uniquement
 * @returns {Promise<{ all: boolean, userIds: string[] | null }>}
 */
export const getManageableUserScope = async (actor) => {
  if (!actor) return { all: false, userIds: [] };

  // Super-admin : voit et gère tout le monde (comportement historique préservé).
  if (await isSuperAdmin(actor)) return { all: true, userIds: null };

  const selfId = actor._id.toString();

  // Détenteur du module users_admin (ou allModules) sans être admin/responsable :
  // il gère aussi les utilisateurs de ses sociétés (il a explicitement ce droit).
  const permission = await Permission.findOne({ user: actor._id });
  const hasUsersAdmin = !!(
    permission?.allModules || permission?.modules?.users_admin?.read
  );

  // Admin scopé, Responsable OU détenteur users_admin : tous les utilisateurs dont
  // le périmètre société recoupe le leur (+ eux-mêmes). Décision client : un
  // responsable gère TOUS les utilisateurs de ses sociétés — pour les modifier
  // comme pour les rattacher à une équipe. Périmètre basé sur les SOCIÉTÉS
  // accessibles (multi-sociétés inclus).
  if (
    actor.role === "admin" ||
    actor.role === "responsable" ||
    hasUsersAdmin
  ) {
    const { all, ids } = await getAccessibleEntreprises(actor);
    if (all) return { all: true, userIds: null };
    const perms = await Permission.find({
      entreprises: { $in: ids },
    }).select("user");
    const userIds = new Set(perms.map((p) => p.user.toString()));
    userIds.add(selfId);
    return { all: false, userIds: [...userIds] };
  }

  // User simple : lui-même uniquement.
  return { all: false, userIds: [selfId] };
};

/** L'acteur peut-il gérer l'utilisateur cible (par son id) ? */
export const canManageUser = async (actor, targetUserId) => {
  const scope = await getManageableUserScope(actor);
  if (scope.all) return true;
  return scope.userIds.includes(String(targetUserId));
};

/**
 * ANNUAIRE société : tous les utilisateurs des sociétés accessibles à l'acteur
 * (+ lui-même). DÉCOUPLÉ de la gestion : n'importe quel utilisateur peut ainsi
 * DISCUTER avec ses collègues (créer une discussion), sans droit de gestion.
 * @returns {Promise<{ all: boolean, userIds: string[] | null }>}
 */
export const getCompanyDirectoryScope = async (actor) => {
  if (!actor) return { all: false, userIds: [] };
  if (await isSuperAdmin(actor)) return { all: true, userIds: null };

  const selfId = actor._id.toString();
  const { all, ids } = await getAccessibleEntreprises(actor);
  if (all) return { all: true, userIds: null };
  if (!ids.length) return { all: false, userIds: [selfId] };

  const perms = await Permission.find({
    entreprises: { $in: ids },
  }).select("user");
  const userIds = new Set(perms.map((p) => p.user.toString()));
  userIds.add(selfId);
  return { all: false, userIds: [...userIds] };
};

/** L'acteur peut-il DISCUTER avec la cible (même société) ? */
export const canChatWith = async (actor, targetUserId) => {
  const scope = await getCompanyDirectoryScope(actor);
  if (scope.all) return true;
  return scope.userIds.includes(String(targetUserId));
};

/**
 * ATTÉNUATION : vérifie qu'un lot de permissions DEMANDÉ pour un membre reste
 * ⊆ des permissions de l'ACTEUR. Empêche l'escalade (accorder plus que ce qu'on
 * possède). Un super-admin/allModules+allEntreprises passe tout ; sinon on
 * contrôle module par module (read/write/delete) et société par société.
 * @returns {{ ok: boolean, message?: string }}
 */
export const assertGrantWithinScope = (actorPerm, requested) => {
  if (!requested) return { ok: true };

  const actorAllModules = !!actorPerm?.allModules;
  const actorAllEnt = !!actorPerm?.allEntreprises;

  // allModules / allEntreprises ne peuvent être accordés que si l'acteur les a.
  if (requested.allModules && !actorAllModules) {
    return {
      ok: false,
      message: "Vous ne pouvez pas accorder l'accès à tous les modules.",
    };
  }
  if (requested.allEntreprises && !actorAllEnt) {
    return {
      ok: false,
      message: "Vous ne pouvez pas accorder l'accès à toutes les entreprises.",
    };
  }

  // Entreprises : sous-ensemble strict du périmètre de l'acteur.
  if (!actorAllEnt) {
    const actorEnt = new Set(
      (actorPerm?.entreprises || []).map((e) => e.toString()),
    );
    const reqEnt = (requested.entreprises || []).map((e) => e.toString());
    const bad = reqEnt.find((id) => !actorEnt.has(id));
    if (bad) {
      return { ok: false, message: "Entreprise hors de votre périmètre." };
    }
  }

  // Modules : chaque action demandée (read/write/delete) doit être détenue.
  if (!actorAllModules) {
    const reqModules = requested.modules || {};
    for (const [key, actions] of Object.entries(reqModules)) {
      if (!actions) continue;
      for (const action of ["read", "write", "delete"]) {
        if (actions[action] && !actorPerm?.modules?.[key]?.[action]) {
          return {
            ok: false,
            message: `Droit « ${action} » sur « ${key} » hors de votre périmètre.`,
          };
        }
      }
    }
  }

  // NB (Phase 2) : `analyse` et `commerciauxScope` ne sont pas déclarés dans
  // PermissionModel -> non persistés (strict mode). Safe-by-default ici : tant
  // qu'ils ne sont pas dans le schéma, l'acteur ne « possède » rien à accorder.

  return { ok: true };
};

/**
 * L'acteur a-t-il le droit d'attribuer/promouvoir vers le rôle `targetRole` ?
 *   - Super-admin -> n'importe quel rôle (admin/responsable/user)
 *   - Admin scopé -> "responsable" ou "user" (jamais créer un admin)
 *   - Responsable -> "user" uniquement
 * @returns {Promise<boolean>}
 */
export const canAssignRole = async (actor, targetRole) => {
  if (!targetRole) return true; // pas de changement de rôle
  if (await isSuperAdmin(actor)) return true;
  if (actor.role === "admin") return ["user", "responsable"].includes(targetRole);
  if (actor.role === "responsable") return targetRole === "user";
  return false;
};

/**
 * Middleware d'ACCÈS aux routes de gestion des utilisateurs.
 * Autorise : les admins (comme checkModuleAccess), les détenteurs du module
 * `users_admin` pour l'action, ET les responsables (dont le périmètre fin
 * — équipe + atténuation — est vérifié DANS le contrôleur).
 */
export const allowUserManagement = (action = "read") =>
  asyncHandler(async (req, res, next) => {
    if (req.user.role === "admin" || req.user.role === "responsable") {
      return next();
    }
    const permission = await Permission.findOne({ user: req.user._id });
    if (permission?.allModules || permission?.modules?.users_admin?.[action]) {
      return next();
    }
    res.status(403);
    throw new Error("Vous n'avez pas la permission de gérer les utilisateurs");
  });

// ---------------------------------------------------------------------------
// ÉQUIPES — accès à une équipe donnée
// ---------------------------------------------------------------------------
/**
 * L'acteur peut-il accéder à (gérer) cette équipe ?
 *   - Super-admin -> oui
 *   - Admin       -> si l'équipe est dans une de ses sociétés
 *   - Responsable -> si c'est SON équipe (responsable === lui)
 *   - User        -> non
 */
export const canAccessTeam = async (actor, team) => {
  if (!actor || !team) return false;
  if (await isSuperAdmin(actor)) return true;
  if (actor.role === "admin") {
    const { all, ids } = await getAccessibleEntreprises(actor);
    return all || ids.includes(team.entreprise.toString());
  }
  if (actor.role === "responsable") {
    return team.responsable.toString() === actor._id.toString();
  }
  return false;
};

/** Middleware : charge l'équipe (:id), vérifie l'accès, l'attache à req.team. */
export const checkTeamAccess = asyncHandler(async (req, res, next) => {
  const team = await Team.findById(req.params.id);
  if (!team) {
    res.status(404);
    throw new Error("Équipe non trouvée");
  }
  if (!(await canAccessTeam(req.user, team))) {
    res.status(403);
    throw new Error("Équipe hors de votre périmètre");
  }
  req.team = team;
  next();
});

/** Middleware : réserve les routes de gestion d'équipes aux admins/responsables. */
export const allowTeamManagement = asyncHandler(async (req, res, next) => {
  if (req.user.role === "admin" || req.user.role === "responsable") {
    return next();
  }
  res.status(403);
  throw new Error("Réservé aux responsables et administrateurs");
});

export default {
  getAccessibleEntreprises,
  isSuperAdmin,
  superAdmin,
  attachAccessScope,
  getManageableUserScope,
  canManageUser,
  getCompanyDirectoryScope,
  canChatWith,
  assertGrantWithinScope,
  canAssignRole,
  allowUserManagement,
  canAccessTeam,
  checkTeamAccess,
  allowTeamManagement,
  ANALYSE_KEYS,
  FILIALE_RESEAUX,
  hasAnalyseAccess,
  checkAnalyseAccess,
  hasFilialeReseauAccess,
  checkFilialeReseauAccess,
  getCommerciauxCodes,
};