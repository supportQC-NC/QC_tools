// backend/middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import asyncHandler from "./asyncHandler.js";
import User from "../models/UserModel.js";
import { masqueUtilisateur } from "../services/dbfChampsService.js";

// ⚠️ Les messages des 401 sont lus TELS QUELS par les écrans web et par l'app
// mobile (aucun des deux ne réécrit l'erreur) : ils doivent dire à l'utilisateur
// ce qu'il a à faire. « Token non valide » ne veut rien dire pour un agent au
// rayon — il faut lui demander de se déconnecter puis de se reconnecter.
const MSG_SESSION =
  "Session expirée : déconnectez-vous puis reconnectez-vous.";

// Protect routes
const protect = asyncHandler(async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    res.status(401);
    throw new Error(MSG_SESSION);
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    res.status(401);
    // Jeton illisible ou expiré : le cookie est encore là, mais il ne vaut
    // plus rien. Se reconnecter en pose un neuf.
    throw new Error(MSG_SESSION);
  }

  req.user = await User.findById(decoded.userId).select("-password");

  // Jeton valide mais compte INCONNU : compte supprimé, ou jeton émis sur une
  // AUTRE base de données (le JWT_SECRET est partagé entre environnements, pas
  // les utilisateurs). Sans ce garde-fou `req.user` restait null et la première
  // lecture de `.role` renvoyait une 500 illisible, que les clients — l'app
  // mobile en particulier — affichent comme « aucune donnée » au lieu de
  // redemander une connexion.
  if (!req.user) {
    res.status(401);
    throw new Error(MSG_SESSION);
  }

  // Champs DBF interdits à cet utilisateur. Posé ici — seul endroit traversé
  // par TOUTES les routes authentifiées — et consommé de façon synchrone par
  // l'enveloppe res.json (middleware/masquerChampsDbf.js).
  // null = aucune restriction, coût nul.
  req.masqueDbf = await masqueUtilisateur(req.user);

  next();
});

// Admin middleware
const admin = (req, res, next) => {
  // ✅ Vérifie role === "admin" au lieu de isAdmin
  if (req.user && req.user.role === "admin") {
    next();
  } else {
    res.status(401);
    throw new Error("Non autorisé en tant qu'admin");
  }
};

export { protect, admin };
