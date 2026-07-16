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

export default {
  getAccessibleEntreprises,
  isSuperAdmin,
  superAdmin,
  attachAccessScope,
  ANALYSE_KEYS,
  FILIALE_RESEAUX,
  hasAnalyseAccess,
  checkAnalyseAccess,
  hasFilialeReseauAccess,
  checkFilialeReseauAccess,
  getCommerciauxCodes,
};