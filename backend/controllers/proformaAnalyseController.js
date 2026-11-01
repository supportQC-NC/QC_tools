// backend/controllers/proformaAnalyseController.js
// Analyse proforma : entêtes de proforma.dbf sur une plage de dates,
// filtrées par code vendeur (REPRES). req.entreprise injecté par
// checkEntrepriseAccess.

import asyncHandler from "../middleware/asyncHandler.js";
import { analyserProformas } from "../services/proformaAnalyseService.js";

// GET /api/proforma-analyse/:nomDossierDBF?dateDebut=YYYY-MM-DD&dateFin=YYYY-MM-DD&vendeur=12
// `vendeur` vide ou absent = tous les codes.
const getAnalyse = asyncHandler(async (req, res) => {
  const { dateDebut, dateFin, vendeur } = req.query;

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

  const data = await analyserProformas(
    req.entreprise,
    dateDebut,
    dateFin,
    vendeur || "",
  );
  res.json(data);
});

export { getAnalyse };
