// backend/controllers/menuLayoutController.js
//
// Organisation de la sidebar (chapitres) : lecture par tout utilisateur connecté
// (pour construire son menu), écriture réservée aux admins (constructeur).
import asyncHandler from "../middleware/asyncHandler.js";
import MenuLayout from "../models/MenuLayoutModel.js";

const trim = (v) => (v === null || v === undefined ? "" : String(v).trim());

// GET /api/menu-layout -> { chapitres, masques } ou null si non défini.
export const getMenuLayout = asyncHandler(async (req, res) => {
  const doc = await MenuLayout.findOne({ scope: "default" }).lean();
  if (!doc) return res.json(null);
  res.json({ chapitres: doc.chapitres || [], masques: doc.masques || [] });
});

// PUT /api/menu-layout  body: { chapitres:[{key,label,icon,items:[path]}], masques:[path] }
export const saveMenuLayout = asyncHandler(async (req, res) => {
  const rawChapitres = Array.isArray(req.body.chapitres) ? req.body.chapitres : [];
  const rawMasques = Array.isArray(req.body.masques) ? req.body.masques : [];

  // Nettoyage/validation : un path ne peut apparaître qu'une seule fois au total.
  const vus = new Set();
  const chapitres = [];
  rawChapitres.forEach((c, i) => {
    const key = trim(c.key) || `chap_${i}`;
    const items = [];
    (Array.isArray(c.items) ? c.items : []).forEach((p) => {
      const path = trim(p);
      if (path && !vus.has(path)) {
        vus.add(path);
        items.push(path);
      }
    });
    chapitres.push({
      key,
      label: trim(c.label),
      icon: trim(c.icon),
      items,
    });
  });

  const masques = [];
  rawMasques.forEach((p) => {
    const path = trim(p);
    if (path && !vus.has(path) && !masques.includes(path)) masques.push(path);
  });

  const doc = await MenuLayout.findOneAndUpdate(
    { scope: "default" },
    { $set: { chapitres, masques, updatedBy: req.user?._id || null } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  res.json({ chapitres: doc.chapitres || [], masques: doc.masques || [] });
});
