// backend/controllers/topArticlesController.js
// Top 100 des articles vendus (CA HT = QTE × PVTE, ou quantité) sur une plage.
// req.entreprise injecté par checkEntrepriseAccess.

import asyncHandler from "../middleware/asyncHandler.js";
import topArticlesService from "../services/topArticlesService.js";

// GET /api/top-articles/:nomDossierDBF?dateDebut=YYYY-MM-DD&dateFin=YYYY-MM-DD
const getTopArticles = asyncHandler(async (req, res) => {
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

  const data = await topArticlesService.analyser(
    req.entreprise,
    dateDebut,
    dateFin,
  );
  res.json(data);
});

export { getTopArticles };