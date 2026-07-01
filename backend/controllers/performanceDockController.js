// backend/controllers/performanceDockController.js
// Performance Dock (QC uniquement) — lecture des fichiers reapro_mag.

import asyncHandler from "../middleware/asyncHandler.js";
import performanceDockService from "../services/performanceDockService.js";

// GET /api/performance-dock
const getReport = asyncHandler(async (req, res) => {
  const data = await performanceDockService.getReport();
  res.json(data);
});

// POST /api/performance-dock/refresh
const refreshReport = asyncHandler(async (req, res) => {
  performanceDockService.invalidate();
  res.json({ message: "Cache Performance Dock invalidé" });
});

export { getReport, refreshReport };