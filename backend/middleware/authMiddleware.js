// backend/middleware/authMiddleware.js
import jwt from "jsonwebtoken";
import asyncHandler from "./asyncHandler.js";
import User from "../models/UserModel.js";
import { masqueUtilisateur } from "../services/dbfChampsService.js";

// Protect routes
const protect = asyncHandler(async (req, res, next) => {
  let token = req.cookies.token;

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.userId).select("-password");

      // Champs DBF interdits à cet utilisateur. Posé ici — seul endroit
      // traversé par TOUTES les routes authentifiées — et consommé de façon
      // synchrone par l'enveloppe res.json (middleware/masquerChampsDbf.js).
      // null = aucune restriction, coût nul.
      req.masqueDbf = await masqueUtilisateur(req.user);

      next();
    } catch (error) {
      res.status(401);
      throw new Error("Token non valide");
    }
  } else {
    res.status(401);
    throw new Error("Non autorisé, pas de token");
  }
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
