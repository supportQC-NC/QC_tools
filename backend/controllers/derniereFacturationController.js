// derniereFacturationController.js
// Liste des clients de la société avec la date de leur dernière facture.
// req.entreprise est injecté par checkEntrepriseAccess.

import asyncHandler from "../middleware/asyncHandler.js";
import { getDerniereFacturation } from "../services/derniereFacturationService.js";
import { invaliderIndexFactures } from "../services/commercialService.js";

// GET /api/derniere-facturation/:nomDossierDBF
const getRapport = asyncHandler(async (req, res) => {
  const data = await getDerniereFacturation(req.entreprise);
  res.json(data);
});

// POST /api/derniere-facturation/:nomDossierDBF/refresh
// Force la reconstruction de l'index facture (scan complet : plusieurs dizaines
// de secondes). Réservé à une demande explicite de l'utilisateur.
const refreshRapport = asyncHandler(async (req, res) => {
  invaliderIndexFactures(req.params.nomDossierDBF);
  res.json({ message: "Index facture invalidé" });
});

export { getRapport, refreshRapport };
