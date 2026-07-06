// backend/controllers/factureAnalyseController.js
// Analyse des factures de type "F" sur une plage de dates.
// req.entreprise injecté par checkEntrepriseAccess.

import asyncHandler from "../middleware/asyncHandler.js";
import factureAnalyseService from "../services/factureAnalyseService.js";

// GET /api/facture-analyse/:nomDossierDBF?dateDebut=YYYY-MM-DD&dateFin=YYYY-MM-DD
const getReport = asyncHandler(async (req, res) => {
  const { dateDebut, dateFin } = req.query;

  const valide = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!valide(dateDebut) || !valide(dateFin)) {
    res.status(400);
    throw new Error(
      "Paramètres requis : dateDebut et dateFin au format YYYY-MM-DD.",
    );
  }
  if (dateDebut > dateFin) {
    res.status(400);
    throw new Error("La date de début doit précéder la date de fin.");
  }

  const data = await factureAnalyseService.analyser(
    req.entreprise,
    dateDebut,
    dateFin,
  );
  res.json(data);
});

export { getReport };