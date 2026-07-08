// backend/controllers/analyseCaController.js
//
// Module ANALYSE CA (admin uniquement). req.entreprise injecté par
// checkEntrepriseAccess. Reproduit le pipeline Python (13 onglets) pour le mois
// de coupure choisi.
//
//   GET  /api/analyse-ca/:nomDossierDBF?moisCoupure=YYYY-MM   -> aperçu JSON (dashboard)
//   POST /api/analyse-ca/:nomDossierDBF/generer?moisCoupure=… -> fichier .xlsx

import asyncHandler from "../middleware/asyncHandler.js";
import analyseCaGenerator from "../services/analyseCaGenerator.js";

// Valide / normalise le mois de coupure (YYYY-MM). Défaut = mois précédent.
function resolveMoisCoupure(raw) {
  if (typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw)) return raw;
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1); // mois précédent
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}`;
}

// GET /api/analyse-ca/:nomDossierDBF?moisCoupure=YYYY-MM
// Aperçu pour le dashboard : période, KPIs, onglets produits / omis.
const getApercu = asyncHandler(async (req, res) => {
  const moisCoupure = resolveMoisCoupure(req.query.moisCoupure);
  const { meta, kpis } = await analyseCaGenerator.apercu(req.entreprise, moisCoupure);
  res.json({ moisCoupure, meta, kpis });
});

// POST /api/analyse-ca/:nomDossierDBF/generer?moisCoupure=YYYY-MM
// Génère le classeur et le renvoie en téléchargement (.xlsx). Les métadonnées
// (période, onglets, KPIs) sont exposées dans l'en-tête X-Analyse-Meta (base64).
const genererRapport = asyncHandler(async (req, res) => {
  const moisCoupure = resolveMoisCoupure(req.query.moisCoupure || req.body?.moisCoupure);
  const { buffer, filename, meta, kpis } = await analyseCaGenerator.generer(
    req.entreprise,
    moisCoupure,
  );

  const metaB64 = Buffer.from(JSON.stringify({ moisCoupure, meta, kpis }), "utf8").toString("base64");

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-Analyse-Meta", metaB64);
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, X-Analyse-Meta");
  res.send(buffer);
});

export { getApercu, genererRapport };