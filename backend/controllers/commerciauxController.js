// commerciauxController.js
// Endpoints d'analyse des ventes par commercial (admin uniquement).
// req.entreprise est injecté par le middleware checkEntrepriseAccess.

import asyncHandler from "../middleware/asyncHandler.js";
import commerciauxService from "../services/commerciauxService.js";

// GET /api/commerciaux/:nomDossierDBF
// Liste des commerciaux + KPI agrégés (sans la liste détaillée des clients).
const getCommerciaux = asyncHandler(async (req, res) => {
  const data = await commerciauxService.getCommerciauxSummary(req.entreprise);
  res.json(data);
});

// GET /api/commerciaux/:nomDossierDBF/full
// Analyse complète AVEC la liste des clients par commercial (export Excel global).
const getCommerciauxFull = asyncHandler(async (req, res) => {
  const data = await commerciauxService.getAnalyse(req.entreprise);
  res.json(data);
});

// GET /api/commerciaux/:nomDossierDBF/:code
// Détail d'un commercial : KPI + comparaison portefeuille + clients + mensuel.
const getCommercialDetail = asyncHandler(async (req, res) => {
  const data = await commerciauxService.getCommercialDetail(
    req.entreprise,
    req.params.code,
  );
  if (!data) {
    res.status(404);
    throw new Error("Commercial introuvable pour cette entreprise");
  }
  res.json(data);
});

// POST /api/commerciaux/:nomDossierDBF/refresh
// Invalide le cache (recalcul au prochain appel).
const refreshCommerciaux = asyncHandler(async (req, res) => {
  commerciauxService.invalidate(req.entreprise.nomDossierDBF);
  res.json({ message: "Cache des commerciaux invalidé" });
});

export {
  getCommerciaux,
  getCommerciauxFull,
  getCommercialDetail,
  refreshCommerciaux,
};