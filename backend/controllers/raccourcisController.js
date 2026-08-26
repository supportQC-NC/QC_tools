// backend/controllers/raccourcisController.js
//
// Raccourcis du tableau de bord personnel. Volontairement minimal : le serveur
// ne fait que ranger une liste de chemins, il ne connaît ni les libellés ni les
// icônes (catalogue de menu côté client) et ne vérifie pas les droits ici — ils
// sont réappliqués à l'affichage, ce qui évite de désynchroniser le document
// quand un module est accordé ou retiré.
import asyncHandler from "../middleware/asyncHandler.js";
import UserRaccourcis from "../models/UserRaccourcisModel.js";

const MAX_RACCOURCIS = 40;

// Normalise la liste reçue : chaînes non vides, uniques, bornées.
const nettoyer = (valeur) => {
  if (!Array.isArray(valeur)) return [];
  const vus = new Set();
  const out = [];
  for (const brut of valeur) {
    const chemin = String(brut || "").trim();
    if (!chemin || vus.has(chemin)) continue;
    vus.add(chemin);
    out.push(chemin);
    if (out.length >= MAX_RACCOURCIS) break;
  }
  return out;
};

// GET /api/raccourcis/me
export const getMesRaccourcis = asyncHandler(async (req, res) => {
  const doc = await UserRaccourcis.findOne({ user: req.user._id }).lean();
  res.json({
    personnalise: !!doc?.personnalise,
    raccourcis: doc?.raccourcis || [],
  });
});

// PUT /api/raccourcis/me   body: { raccourcis: [] }
export const setMesRaccourcis = asyncHandler(async (req, res) => {
  const raccourcis = nettoyer(req.body?.raccourcis);
  const doc = await UserRaccourcis.findOneAndUpdate(
    { user: req.user._id },
    { $set: { raccourcis, personnalise: true } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  res.json({ personnalise: true, raccourcis: doc.raccourcis || [] });
});

// DELETE /api/raccourcis/me — retour à « tous mes onglets »
export const resetMesRaccourcis = asyncHandler(async (req, res) => {
  await UserRaccourcis.deleteOne({ user: req.user._id });
  res.json({ personnalise: false, raccourcis: [] });
});
