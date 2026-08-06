// backend/controllers/resaEntreesController.js
//
// Module « Entrées sur réservation » — société injectée par checkEntrepriseAccess
// (:nomDossierDBF -> req.entreprise).
import asyncHandler from "../middleware/asyncHandler.js";
import { getResaEntrees } from "../services/resaEntreesService.js";
import { genererExcelResaEntrees } from "../services/resaEntreesExcelService.js";

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const pad = (n) => String(n).padStart(2, "0");
// Défaut = la VEILLE (les entrées du jour ne sont pas encore complètes).
const yesterdayIso = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Résout la période depuis la requête. Défaut = hier (start=end).
const resolvePeriode = (q) => {
  const start = isDay(q.start) ? q.start : yesterdayIso();
  const end = isDay(q.end) ? q.end : start;
  return { start, end };
};

const periodeLabel = ({ start, end }) => {
  const fr = (s) => (isDay(s) ? s.split("-").reverse().join("/") : s);
  return start === end ? fr(start) : `du ${fr(start)} au ${fr(end)}`;
};

/**
 * @route  GET /api/resa-entrees/:nomDossierDBF?start&end
 * @access Private (module resa_entrees, read)
 */
const getResaEntreesReport = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const periode = resolvePeriode(req.query);
  const data = await getResaEntrees(entreprise, periode);
  const nbClients = new Set(data.rows.map((r) => r.tiers).filter((t) => t != null))
    .size;
  const nbArticles = new Set(data.rows.map((r) => r.nart)).size;
  res.json({ ...data, nbClients, nbArticles });
});

/**
 * @route  GET /api/resa-entrees/:nomDossierDBF/excel?start&end
 * @access Private (module resa_entrees, read)
 */
const exportExcel = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const periode = resolvePeriode(req.query);
  const { rows } = await getResaEntrees(entreprise, periode);

  const buffer = await genererExcelResaEntrees({
    rows,
    periodeLabel: periodeLabel(periode),
  });
  const fname = `resa_entrees_${entreprise.nomDossierDBF}_${periode.start}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(Buffer.from(buffer));
});

export { getResaEntreesReport, exportExcel };
