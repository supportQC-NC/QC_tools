// debitComptantController.js
// Rapport ventes comptant / débit-comptant (admin uniquement).
// req.entreprise injecté par checkEntrepriseAccess.

import asyncHandler from "../middleware/asyncHandler.js";
import debitComptantService from "../services/debitComptantService.js";

// Normalise / valide dateFin (YYYY-MM-DD) ; défaut = veille.
function resolveDateFin(raw) {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// GET /api/debit-comptant/:nomDossierDBF/progress
const getProgress = asyncHandler(async (req, res) => {
  res.json(debitComptantService.getProgress(req.params.nomDossierDBF));
});

// GET /api/debit-comptant/:nomDossierDBF?dateFin=YYYY-MM-DD&nbJours=7
const getReport = asyncHandler(async (req, res) => {
  const dateFin = resolveDateFin(req.query.dateFin);
  let nbJours = parseInt(req.query.nbJours, 10);
  if (!Number.isFinite(nbJours) || nbJours < 1) nbJours = 7;
  if (nbJours > 366) nbJours = 366;

  const data = await debitComptantService.getReport(req.entreprise, dateFin, nbJours);
  res.json(data);
});

// POST /api/debit-comptant/:nomDossierDBF/refresh
const refreshReport = asyncHandler(async (req, res) => {
  debitComptantService.invalidate(req.params.nomDossierDBF);
  res.json({ message: "Cache débit/comptant invalidé" });
});

export { getReport, getProgress, refreshReport };