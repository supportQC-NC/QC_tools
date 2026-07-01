// filialesController.js
// Analyse Filiales — consolidation réseau (admin uniquement).

import asyncHandler from "../middleware/asyncHandler.js";
import filialesService from "../services/filialesService.js";

// GET /api/filiales — liste des réseaux disponibles (DQ, QC, LD)
const getReseaux = asyncHandler(async (req, res) => {
  res.json(filialesService.getReseaux());
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