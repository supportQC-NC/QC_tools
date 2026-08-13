// backend/controllers/frequentationController.js
//
// Module « Fréquentation du magasin » : plages de fréquentation reconstituées
// depuis les factures éditées. Société injectée par checkEntrepriseAccess
// (:nomDossierDBF -> req.entreprise).
import asyncHandler from "../middleware/asyncHandler.js";
import { getFrequentation } from "../services/frequentationService.js";
import { genererExcelFrequentation } from "../services/frequentationExcelService.js";

// Période demandée : ?du=YYYY-MM-DD&au=YYYY-MM-DD&pas=15|30|60&jour=0..6
// Défaut : les 30 derniers jours, pas horaire, tous les jours de la semaine.
const resolvePeriode = (req) => {
  const iso = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  const aujourdhui = new Date();
  const ilYa30j = new Date();
  ilYa30j.setDate(ilYa30j.getDate() - 30);

  const jourBrut = req.query.jour;
  const jour =
    jourBrut === undefined || jourBrut === "" || jourBrut === "all"
      ? null
      : parseInt(jourBrut, 10);

  return {
    du: req.query.du || iso(ilYa30j),
    au: req.query.au || iso(aujourdhui),
    pas: parseInt(req.query.pas, 10) || 60,
    jour: Number.isInteger(jour) ? jour : null,
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

  const suffixeJour =
    data.periode.jour === null ? "" : `_${data.periode.jourLabel.toLowerCase()}`;
  const fname = `frequentation_${entreprise.nomDossierDBF}_${data.periode.du}_${data.periode.au}${suffixeJour}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(Buffer.from(buffer));
});

export { getAnalyse, exportExcel };
