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

export default { getAccessibleEntreprises, isSuperAdmin, superAdmin, attachAccessScope };