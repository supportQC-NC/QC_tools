// backend/controllers/frequentationController.js
//
// Module « Fréquentation du magasin » : plages de fréquentation reconstituées
// depuis les factures éditées. Société injectée par checkEntrepriseAccess
// (:nomDossierDBF -> req.entreprise).
import asyncHandler from "../middleware/asyncHandler.js";
import { getFrequentation } from "../services/frequentationService.js";
import { genererExcelFrequentation } from "../services/frequentationExcelService.js";

// Période demandée : ?du=YYYY-MM-DD&au=YYYY-MM-DD&pas=15|30|60
// Défaut : les 30 derniers jours, pas horaire.
const resolvePeriode = (req) => {
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const aujourdhui = new Date();
  const ilYa30j = new Date();
  ilYa30j.setDate(ilYa30j.getDate() - 30);

  return {
    du: req.query.du || iso(ilYa30j),
    au: req.query.au || iso(aujourdhui),
    pas: parseInt(req.query.pas, 10) || 60,
  };
};

/**
 * @desc   Analyse de fréquentation sur une plage de dates.
 * @route  GET /api/frequentation/:nomDossierDBF?du=&au=&pas=
 * @access Private (module frequentation_admin, read) + entreprise
 */
const getAnalyse = asyncHandler(async (req, res) => {
  const data = await getFrequentation(req.entreprise, resolvePeriode(req));
  res.json({
    entreprise: {
      _id: req.entreprise._id,
      nomDossierDBF: req.entreprise.nomDossierDBF,
      trigramme: req.entreprise.trigramme,
      nomComplet: req.entreprise.nomComplet,
    },
    ...data,
  });
});

/**
 * @desc   Export Excel de l'analyse de fréquentation.
 * @route  GET /api/frequentation/:nomDossierDBF/excel?du=&au=&pas=
 * @access Private (module frequentation_admin, read) + entreprise
 */
const exportExcel = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const periode = resolvePeriode(req);
  const data = await getFrequentation(entreprise, periode);

  const buffer = await genererExcelFrequentation({
    data,
    nomSociete: entreprise.nomComplet || entreprise.nomDossierDBF,
  });

  const fname = `frequentation_${entreprise.nomDossierDBF}_${data.periode.du}_${data.periode.au}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(Buffer.from(buffer));
});

export { getAnalyse, exportExcel };
