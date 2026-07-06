// filialesController.js
// Analyse Filiales — consolidation réseau. Accès PAR RÉSEAU (DQ, QC, LD) :
// la liste ne renvoie que les réseaux autorisés, et chaque route :reseau est
// protégée par checkFilialeReseauAccess (voir filialesRoutes.js).

import asyncHandler from "../middleware/asyncHandler.js";
import filialesService from "../services/filialesService.js";
import { hasFilialeReseauAccess } from "../middleware/accessControl.js";

// GET /api/filiales — liste des réseaux AUTORISÉS pour l'utilisateur (DQ, QC, LD)
const getReseaux = asyncHandler(async (req, res) => {
  const tous = filialesService.getReseaux();
  const autorises = [];
  for (const r of tous) {
    if (await hasFilialeReseauAccess(req.user, r.code)) autorises.push(r);
  }
  res.json(autorises);
});

// GET /api/filiales/:reseau/progress — progression du calcul
const getReseauProgress = asyncHandler(async (req, res) => {
  res.json(filialesService.getProgress(req.params.reseau));
});

// POST /api/filiales/:reseau/refresh — invalide le cache
const refreshReseau = asyncHandler(async (req, res) => {
  filialesService.invalidate(req.params.reseau);
  res.json({ message: "Cache réseau invalidé" });
});

// GET /api/filiales/:reseau — consolidation complète du réseau
const getReseau = asyncHandler(async (req, res) => {
  const data = await filialesService.getReseau(req.params.reseau);
  res.json(data);
});

export { getReseaux, getReseauProgress, refreshReseau, getReseau };