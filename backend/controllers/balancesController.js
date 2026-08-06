// backend/controllers/balancesController.js
//
// Module « Balances / clients à bloquer » (portage rqBalances / rqBalancesABloquer).
// Société injectée via checkEntrepriseAccess (:nomDossierDBF -> req.entreprise).
import asyncHandler from "../middleware/asyncHandler.js";
import { getBalances } from "../services/balancesService.js";
import { genererExcelBalances } from "../services/balancesExcelService.js";

/**
 * @desc   Encours clients + drapeau « à bloquer ».
 * @route  GET /api/balances-clients/:nomDossierDBF
 * @access Private (module balances_clients, read)
 */
const getBalancesReport = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { rows, totalSolde, nbABloquer } = await getBalances(entreprise);
  res.json({
    total: rows.length,
    totalSolde,
    nbABloquer,
    rows,
  });
});

/**
 * @desc   Export Excel des balances clients (2 feuilles : toutes / à bloquer).
 * @route  GET /api/balances-clients/:nomDossierDBF/excel
 * @access Private (module balances_clients, read)
 */
const exportExcel = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { rows } = await getBalances(entreprise);

  const buffer = await genererExcelBalances({ rows });
  const fname = `balances_clients_${entreprise.nomDossierDBF}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(Buffer.from(buffer));
});

export { getBalancesReport, exportExcel };
