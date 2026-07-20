// backend/middleware/checkEntrepriseAccess.js
import asyncHandler from "./asyncHandler.js";
import Entreprise from "../models/EntrepriseModel.js";
import Permission from "../models/PermissionModel.js";

/**
 * Vérifie l'accès de l'utilisateur à une entreprise (param :entrepriseId ou
 * :nomDossierDBF). L'accès aux SOCIÉTÉS est TOUJOURS limité aux entreprises
 * explicitement accordées — Y COMPRIS pour les administrateurs (un admin a tous
 * les modules, mais seulement les sociétés qu'on lui attribue).
 */
const checkEntrepriseAccess = asyncHandler(async (req, res, next) => {
  const { entrepriseId, nomDossierDBF } = req.params;

  // Trouver l'entreprise par ID ou nomDossierDBF
  let entreprise;
  if (entrepriseId) {
    entreprise = await Entreprise.findById(entrepriseId);
  } else if (nomDossierDBF) {
    entreprise = await Entreprise.findOne({ nomDossierDBF });
  }

  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  // Vérifier si l'entreprise est active
  if (!entreprise.isActive) {
    res.status(403);
    throw new Error("Cette entreprise est désactivée");
  }

  // Permissions de l'utilisateur (admin compris : plus de bypass société).
  const permission = await Permission.findOne({ user: req.user._id });

  if (!permission) {
    res.status(403);
    throw new Error("Vous n'avez pas les permissions nécessaires");
  }

  // Accès à toutes les entreprises
  if (permission.allEntreprises) {
    req.entreprise = entreprise;
    return next();
  }

  // Sinon : l'entreprise doit être dans la liste autorisée
  const hasAccess = permission.entreprises.some(
    (e) => e.toString() === entreprise._id.toString(),
  );

  if (!hasAccess) {
    res.status(403);
    throw new Error("Vous n'avez pas accès à cette entreprise");
  }

  req.entreprise = entreprise;
  next();
});

/**
 * Vérifie l'accès en lecture/écriture/suppression à un MODULE.
 * Ici l'admin conserve son bypass : un administrateur a accès à tous les modules
 * (le périmètre par société est géré séparément par checkEntrepriseAccess).
 *
 * `moduleName` accepte une chaîne OU un tableau de modules : dans ce dernier cas
 * l'accès est accordé si l'utilisateur possède l'action demandée sur AU MOINS UN
 * des modules (ex. une donnée partagée entre "stock" et "etiquettes").
 */
const checkModuleAccess = (moduleName, action = "read") => {
  const moduleNames = Array.isArray(moduleName) ? moduleName : [moduleName];
  return asyncHandler(async (req, res, next) => {
    // Admin : accès à tous les modules
    if (req.user.role === "admin") {
      return next();
    }

    const permission = await Permission.findOne({ user: req.user._id });

    if (!permission) {
      res.status(403);
      throw new Error("Vous n'avez pas les permissions nécessaires");
    }

    // Accès à tous les modules
    if (permission.allModules) {
      return next();
    }

    // Accès accordé si AU MOINS UN des modules autorise l'action
    const hasAccess = moduleNames.some(
      (name) => permission.modules?.[name]?.[action],
    );

    if (!hasAccess) {
      res.status(403);
      throw new Error(
        `Vous n'avez pas la permission de ${action === "read" ? "lire" : action === "write" ? "modifier" : "supprimer"} les ${moduleNames.join(" / ")}`,
      );
    }

    next();
  });
};

export { checkEntrepriseAccess, checkModuleAccess };