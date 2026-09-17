// backend/controllers/performanceDockController.js
// Performance Dock (QC uniquement) — performance du réappro magasin, lue dans
// les fichiers reapro_mag. Les critères de l'écran (période, jours de semaine,
// seuils, base de la moyenne) arrivent en query et sont normalisés par le
// service : écran et export Excel partagent ainsi le MÊME calcul.

import asyncHandler from "../middleware/asyncHandler.js";
import performanceDockService from "../services/performanceDockService.js";
import { genererExcelPerformanceDock } from "../services/performanceDockExcelService.js";

// GET /api/performance-dock?debut=&fin=&jours=1,2&exclureZero=1&min=&max=&baseMoyenne=
const getReport = asyncHandler(async (req, res) => {
  const data = await performanceDockService.getReport(req.query);
  res.json(data);
});

// GET /api/performance-dock/excel (mêmes paramètres que le rapport)
const exportExcel = asyncHandler(async (req, res) => {
  const data = await performanceDockService.getReport(req.query);
  if (!data.dossierExiste) {
    res.status(409);
    throw new Error(data.message || "Dossier reapro_mag inaccessible.");
  }
  if (!data.rows.length) {
    res.status(409);
    throw new Error(
      "Aucune journée ne correspond aux critères : rien à exporter.",
    );
  }

  const buffer = await genererExcelPerformanceDock(data);

  const c = data.criteres || {};
  const suffixe =
    c.debut || c.fin
      ? `_${c.debut || data.bornes.premiere}_${c.fin || data.bornes.derniere}`
      : "";
  const fname = `performance_reappro_magasin${suffixe}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(Buffer.from(buffer));
});

// POST /api/performance-dock/refresh
const refreshReport = asyncHandler(async (req, res) => {
  performanceDockService.invalidate();
  res.json({ message: "Cache Performance Dock invalidé" });
});

export { getReport, exportExcel, refreshReport };
