// backend/controllers/journalCaisseController.js
// Journal de caisse (factures F + avoirs A d'UN JOUR, par moyen de paiement).
// req.entreprise injecté par checkEntrepriseAccess.

import asyncHandler from "../middleware/asyncHandler.js";
import journalCaisseService from "../services/journalCaisseService.js";

// Jour par défaut : aujourd'hui (YYYY-MM-DD)
const todayYmd = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// GET /api/journal-caisse/:nomDossierDBF?date=YYYY-MM-DD
const getJournal = asyncHandler(async (req, res) => {
  const raw = req.query.date;
  const date =
    typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayYmd();

  const data = await journalCaisseService.getJournal(req.entreprise, date);
  res.json(data);
});

export { getJournal };