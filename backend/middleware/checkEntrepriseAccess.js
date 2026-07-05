// // backend/middleware/checkEntrepriseAccess.js
// import asyncHandler from "./asyncHandler.js";
// import Entreprise from "../models/EntrepriseModel.js";
// import Permission from "../models/PermissionModel.js";

// /**
//  * Middleware pour vérifier si l'utilisateur a accès à une entreprise spécifique
//  * Utilise le paramètre :entrepriseId ou :nomDossierDBF de la route
//  */
// const checkEntrepriseAccess = asyncHandler(async (req, res, next) => {
//   const { entrepriseId, nomDossierDBF } = req.params;

//   // Trouver l'entreprise par ID ou nomDossierDBF
//   let entreprise;
//   if (entrepriseId) {
//     entreprise = await Entreprise.findById(entrepriseId);
//   } else if (nomDossierDBF) {
//     entreprise = await Entreprise.findOne({ nomDossierDBF });
//   }

//   if (!entreprise) {
//     res.status(404);
//     throw new Error("Entreprise non trouvée");
//   }

//   // Vérifier si l'entreprise est active
//   if (!entreprise.isActive) {
//     res.status(403);
//     throw new Error("Cette entreprise est désactivée");
//   }

//   // Admin a accès à tout
//   if (req.user.role === "admin") {
//     req.entreprise = entreprise;
//     return next();
//   }

//   // Vérifier les permissions de l'utilisateur
//   const permission = await Permission.findOne({ user: req.user._id });

//   if (!permission) {
//     res.status(403);
//     throw new Error("Vous n'avez pas les permissions nécessaires");
//   }

//   // Si l'utilisateur a accès à toutes les entreprises
//   if (permission.allEntreprises) {
//     req.entreprise = entreprise;
//     return next();
//   }

//   // Vérifier si l'entreprise est dans la liste des entreprises autorisées
//   const hasAccess = permission.entreprises.some(
//     (e) => e.toString() === entreprise._id.toString(),
//   );

//   if (!hasAccess) {
//     res.status(403);
//     throw new Error("Vous n'avez pas accès à cette entreprise");
//   }

//   // Attacher l'entreprise à la requête pour utilisation ultérieure
//   req.entreprise = entreprise;
//   next();
// });

// /**
//  * Middleware pour vérifier l'accès en lecture à un module spécifique
//  */
// const checkModuleAccess = (moduleName, action = "read") => {
//   return asyncHandler(async (req, res, next) => {
//     // Admin a accès à tout
//     if (req.user.role === "admin") {
//       return next();
//     }

//     const permission = await Permission.findOne({ user: req.user._id });

//     if (!permission) {
//       res.status(403);
//       throw new Error("Vous n'avez pas les permissions nécessaires");
//     }

//     // Si accès à tous les modules
//     if (permission.allModules) {
//       return next();
//     }

//     // Vérifier le module spécifique
//     const modulePermission = permission.modules?.[moduleName];

//     if (!modulePermission || !modulePermission[action]) {
//       res.status(403);
//       throw new Error(
//         `Vous n'avez pas la permission de ${action === "read" ? "lire" : action === "write" ? "modifier" : "supprimer"} les ${moduleName}`,
//       );
//     }

//     next();
//   });
// };

// export { checkEntrepriseAccess, checkModuleAccess };

// backend/middleware/checkEntrepriseAccess.js
import asyncHandler from "./asyncHandler.js";
import Entreprise from "../models/EntrepriseModel.js";
import Permission from "../models/PermissionModel.js";
import { getAccessibleEntreprises } from "./accessControl.js";

/**
 * Vérifie que l'utilisateur a accès à une entreprise donnée
 * (paramètre :entrepriseId ou :nomDossierDBF de la route).
 *
 * IMPORTANT : les ADMINS ne court-circuitent PLUS ce contrôle. Un admin n'accède
 * qu'aux entreprises de son périmètre (allEntreprises = accès total ; sinon la
 * liste permission.entreprises). Voir middleware/accessControl.js.
 */
const checkEntrepriseAccess = asyncHandler(async (req, res, next) => {
  const { entrepriseId, nomDossierDBF } = req.params;

  // Résoudre l'entreprise par ID ou nomDossierDBF.
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

  if (!entreprise.isActive) {
    res.status(403);
    throw new Error("Cette entreprise est désactivée");
  }

  // Périmètre d'accès (admin inclus).
  const access = await getAccessibleEntreprises(req.user);
  const autorise =
    access.all || access.ids.includes(entreprise._id.toString());

  if (!autorise) {
    res.status(403);
    throw new Error("Vous n'avez pas accès à cette entreprise");
  }

  req.entreprise = entreprise;
  next();
});

/**
 * Vérifie l'accès à un MODULE (read/write/delete).
 * Les admins conservent l'accès à tous les modules (décision : le périmètre
 * ENTREPRISE change pour les admins, pas le périmètre MODULE).
 */
const checkModuleAccess = (moduleName, action = "read") => {
  return asyncHandler(async (req, res, next) => {
    // Admin : accès à tous les modules.
    if (req.user.role === "admin") {
      return next();
    }

    const permission = await Permission.findOne({ user: req.user._id });

    if (!permission) {
      res.status(403);
      throw new Error("Vous n'avez pas les permissions nécessaires");
    }

    // Accès à tous les modules.
    if (permission.allModules) {
      return next();
    }

    // Module spécifique.
    const modulePermission = permission.modules?.[moduleName];

    if (!modulePermission || !modulePermission[action]) {
      res.status(403);
      throw new Error(
        `Vous n'avez pas la permission de ${action === "read" ? "lire" : action === "write" ? "modifier" : "supprimer"} les ${moduleName}`,
      );
    }

    next();
  });
};

export { checkEntrepriseAccess, checkModuleAccess };
