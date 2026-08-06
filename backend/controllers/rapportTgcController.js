// backend/controllers/rapportTgcController.js
//
// Module « Rapports TGC mensuels ». Société injectée par checkEntrepriseAccess
// (:nomDossierDBF -> req.entreprise).
import asyncHandler from "../middleware/asyncHandler.js";
import {
  getRapportTgc,
  previousMonth,
} from "../services/rapportTgcService.js";
import { genererExcelRapportTgc } from "../services/rapportTgcExcelService.js";

// Résout {year, month} depuis ?year=YYYY&month=MM (défaut = mois précédent).
const resolvePeriode = (req) => {
  const y = parseInt(req.query.year, 10);
  const m = parseInt(req.query.month, 10);
  if (Number.isInteger(y) && y > 2000 && Number.isInteger(m) && m >= 1 && m <= 12) {
    return { year: y, month: m };
  }
  return previousMonth();
};

/**
 * @desc   Rapport TGC d'une société pour un mois.
 * @route  GET /api/rapport-tgc/:nomDossierDBF?year=YYYY&month=MM
 * @access Private (module rapport_tgc, read)
 */
const getRapport = asyncHandler(async (req, res) => {
  const periode = resolvePeriode(req);
  const data = await getRapportTgc(req.entreprise, periode);
  res.json(data);
});

/**
 * @desc   Export Excel du rapport TGC.
 * @route  GET /api/rapport-tgc/:nomDossierDBF/excel?year=YYYY&month=MM
 * @access Private (module rapport_tgc, read)
 */
const exportExcel = asyncHandler(async (req, res) => {
  const periode = resolvePeriode(req);
  const entreprise = req.entreprise;
  const data = await getRapportTgc(entreprise, periode);
  const buffer = await genererExcelRapportTgc({
    data,
    nomSociete: entreprise.nomComplet || entreprise.nomDossierDBF,
  });
  const fname = `rapport_tgc_${entreprise.nomDossierDBF}_${periode.year}-${String(
    periode.month,
  ).padStart(2, "0")}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(Buffer.from(buffer));
});

export { getRapport, exportExcel };
