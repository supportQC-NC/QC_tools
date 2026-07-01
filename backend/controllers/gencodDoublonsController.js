// gencodDoublonsController.js
// Doublons GENCODE dans la base article (admin). req.entreprise via checkEntrepriseAccess.

import asyncHandler from "../middleware/asyncHandler.js";
import gencodDoublonsService from "../services/gencodDoublonsService.js";

// GET /api/gencod-doublons/:nomDossierDBF
const getReport = asyncHandler(async (req, res) => {
  const data = await gencodDoublonsService.getReport(req.entreprise);
  res.json(data);
});

// POST /api/gencod-doublons/:nomDossierDBF/refresh
const refreshReport = asyncHandler(async (req, res) => {
  gencodDoublonsService.invalidate(req.params.nomDossierDBF);
  res.json({ message: "Cache doublons GENCODE invalidé" });
});

export { getReport, refreshReport };