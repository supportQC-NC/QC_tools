// reapproLocalController.js
// Rapport de réappro sur fournisseurs locaux (admin uniquement).
// req.entreprise injecté par checkEntrepriseAccess.

import asyncHandler from "../middleware/asyncHandler.js";
import reapproLocalService from "../services/reapproLocalService.js";

// GET /api/reappro-local/:nomDossierDBF/progress
const getProgress = asyncHandler(async (req, res) => {
  res.json(reapproLocalService.getProgress(req.params.nomDossierDBF));
});

// POST /api/reappro-local/:nomDossierDBF/refresh
const refreshReport = asyncHandler(async (req, res) => {
  reapproLocalService.invalidate(req.params.nomDossierDBF);
  res.json({ message: "Cache réappro local invalidé" });
});

// GET /api/reappro-local/:nomDossierDBF
const getReport = asyncHandler(async (req, res) => {
  const data = await reapproLocalService.getReport(req.entreprise);
  res.json(data);
});

export { getProgress, refreshReport, getReport };