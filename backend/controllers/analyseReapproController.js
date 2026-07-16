// backend/controllers/analyseReapproController.js
import asyncHandler from "../middleware/asyncHandler.js";
import { buildAnalyseReappro } from "../services/analyseReapproService.js";

// @desc    Analyse réappro / ruptures d'une entreprise
// @route   GET /api/analyse-reappro/:nomDossierDBF
// @access  Private — droit d'analyse "analyseReappro" + accès entreprise
// checkEntrepriseAccess attache l'entreprise résolue à req (req.entreprise).
const getAnalyseReappro = asyncHandler(async (req, res) => {
  const entreprise =
    req.entreprise || { nomDossierDBF: req.params.nomDossierDBF };

  const maxRows = Math.min(
    Math.max(parseInt(req.query.maxRows, 10) || 500, 50),
    2000,
  );

  const data = await buildAnalyseReappro(entreprise, { maxRows });
  res.json(data);
});

export { getAnalyseReappro };