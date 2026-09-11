// filialesController.js
// Analyse Filiales — consolidation réseau. Accès PAR RÉSEAU (DQ, QC, LD) :
// la liste ne renvoie que les réseaux autorisés, et chaque route :reseau est
// protégée par checkFilialeReseauAccess (voir filialesRoutes.js).

import asyncHandler from "../middleware/asyncHandler.js";
import filialesService from "../services/filialesService.js";
import { hasFilialeReseauAccess } from "../middleware/accessControl.js";
import {
  ecrireClasseur,
  nomFichier,
} from "../services/filialesExcelService.js";

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

// GET /api/filiales/:reseau/export — le classeur du script de référence.
// Le fichier est écrit DIRECTEMENT dans la réponse (writer en flux d'ExcelJS) :
// le réseau QC fait 101 000 lignes × 36 colonnes, le monter en mémoire avant de
// l'envoyer coûterait plus d'un Go.
const exportReseau = asyncHandler(async (req, res) => {
  const data = await filialesService.getReseau(req.params.reseau);
  const nom = nomFichier(data.mere);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${nom}"`);
  await ecrireClasseur(data, res);
});

export { getReseaux, getReseauProgress, refreshReseau, getReseau, exportReseau };