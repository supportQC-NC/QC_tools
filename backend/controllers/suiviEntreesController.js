// backend/controllers/suiviEntreesController.js
//
// Module « Suivi des entrées » (mode manuel, multi-sociétés) — portage de
// l'outil Access QC_SUIVI_ENTREES. Société injectée par checkEntrepriseAccess
// (:nomDossierDBF -> req.entreprise).
import asyncHandler from "../middleware/asyncHandler.js";
import {
  getEntreesForDate,
  getReservedNartSet,
} from "../services/entreesService.js";
import { genererExcelEntrees } from "../services/entreesExcelService.js";

// "YYYY-MM-DD" (input date HTML) ou "YYYYMMDD" -> "YYYYMMDD" (vide si invalide).
const ymdFromParam = (raw) => {
  const s = (raw == null ? "" : String(raw)).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, "");
  if (/^\d{8}$/.test(s)) return s;
  return "";
};

// Aujourd'hui (date locale serveur).
const todayYmd = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
};

/**
 * @desc   Grille des entrées d'une société à une date (défaut aujourd'hui).
 * @route  GET /api/suivi-entrees/:nomDossierDBF?date=YYYY-MM-DD
 * @access Private (module suivi_entrees, read)
 */
const getEntrees = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const dateYmd = ymdFromParam(req.query.date) || todayYmd();
  const { dateFr, rows } = await getEntreesForDate(entreprise, dateYmd);

  const anomaliesTgc = rows.filter((r) => r.pbTgc).length;
  res.json({
    date: dateYmd,
    dateFr,
    total: rows.length,
    anomaliesTgc,
    rows,
  });
});

/**
 * @desc   NART réservés parmi les entrées d'une date (flag Résa, chargé à part).
 *         Scan lourd de detail.dbf (≈ 1,17 Go chez QC) mis en cache 10 min ;
 *         on ne renvoie que les NART réservés PRÉSENTS dans les entrées du jour.
 * @route  GET /api/suivi-entrees/:nomDossierDBF/reservations?date=YYYY-MM-DD
 * @access Private (module suivi_entrees, read)
 */
const getReservations = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const dateYmd = ymdFromParam(req.query.date) || todayYmd();
  const [{ rows }, reserved] = await Promise.all([
    getEntreesForDate(entreprise, dateYmd),
    getReservedNartSet(entreprise),
  ]);
  const narts = rows
    .map((r) => r.nart)
    .filter((n) => reserved.has(String(n).toUpperCase()));
  res.json({ date: dateYmd, narts });
});

/**
 * @desc   Export Excel de la grille des entrées (avec flag Résa).
 * @route  GET /api/suivi-entrees/:nomDossierDBF/excel?date=YYYY-MM-DD
 * @access Private (module suivi_entrees, read)
 */
const exportExcel = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const dateYmd = ymdFromParam(req.query.date) || todayYmd();
  const { dateFr, rows } = await getEntreesForDate(entreprise, dateYmd, {
    includeResa: true,
  });

  const buffer = await genererExcelEntrees({ rows, dateFr });
  const fname = `suivi_entrees_${entreprise.nomDossierDBF}_${dateYmd}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(Buffer.from(buffer));
});

export { getEntrees, getReservations, exportExcel };
