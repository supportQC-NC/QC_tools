// backend/controllers/menuHintController.js
//
// Personnalisation des onglets sidebar : infobulle (hint), ordre et visibilité.
// Lecture = tout utilisateur connecté (affichage) ; écriture = admin.
import asyncHandler from "../middleware/asyncHandler.js";
import MenuHint from "../models/MenuHintModel.js";

// GET /api/menu-hints -> { "/path": { hint, ordre, masque }, ... }
export const getMenuHints = asyncHandler(async (req, res) => {
  const docs = await MenuHint.find({}, "path hint ordre masque").lean();
  const map = {};
  for (const d of docs) {
    map[d.path] = {
      hint: d.hint || "",
      ordre: d.ordre ?? null,
      masque: d.masque === true,
    };
  }
  res.json(map);
});

// Supprime le document s'il ne contient plus aucune personnalisation.
const cleanupIfEmpty = async (path) => {
  const d = await MenuHint.findOne({ path }).lean();
  if (d && !d.hint && (d.ordre === null || d.ordre === undefined) && !d.masque) {
    await MenuHint.deleteOne({ path });
  }
};

// PUT /api/menu-hints  body: { path, hint?, masque? }  (admin)
export const upsertMenuHint = asyncHandler(async (req, res) => {
  const path = String(req.body.path || "").trim();
  if (!path) {
    res.status(400);
    throw new Error("Le chemin (path) de l'onglet est requis.");
  }
  const set = { updatedBy: req.user?._id || null };
  if (req.body.hint !== undefined) set.hint = String(req.body.hint || "").trim();
  if (req.body.masque !== undefined) set.masque = !!req.body.masque;

  await MenuHint.findOneAndUpdate(
    { path },
    { $set: set },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  await cleanupIfEmpty(path);
  const doc = await MenuHint.findOne({ path }).lean();
  res.json(
    doc
      ? { path, hint: doc.hint || "", ordre: doc.ordre ?? null, masque: !!doc.masque }
      : { path, hint: "", ordre: null, masque: false },
  );
});

// PUT /api/menu-hints/reorder  body: { paths: [orderedPath,...] }  (admin)
// Fixe ordre = index pour chaque chemin fourni (réordonnancement d'un groupe).
export const reorderMenu = asyncHandler(async (req, res) => {
  const paths = Array.isArray(req.body.paths) ? req.body.paths : [];
  if (!paths.length) {
    res.status(400);
    throw new Error("Liste des chemins (paths) requise.");
  }
  await Promise.all(
    paths.map((p, i) =>
      MenuHint.findOneAndUpdate(
        { path: String(p).trim() },
        { $set: { ordre: i, updatedBy: req.user?._id || null } },
        { upsert: true, setDefaultsOnInsert: true },
      ),
    ),
  );
  res.json({ ok: true, count: paths.length });
});
