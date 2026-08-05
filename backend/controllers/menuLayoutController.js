// backend/controllers/menuLayoutController.js
//
// Organisation de la sidebar (chapitres) : lecture par tout utilisateur connecté
// (pour construire son menu), écriture réservée aux admins (constructeur).
import asyncHandler from "../middleware/asyncHandler.js";
import MenuLayout from "../models/MenuLayoutModel.js";
import UserMenuLayout from "../models/UserMenuLayoutModel.js";

const trim = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Nettoyage/validation partagé : un `path` ne peut apparaître qu'une seule fois
// au total (dans un chapitre OU dans les masqués). Renvoie { chapitres, masques }.
const sanitizeLayout = (rawChapitres, rawMasques) => {
  const vus = new Set();
  const chapitres = [];
  (Array.isArray(rawChapitres) ? rawChapitres : []).forEach((c, i) => {
    const key = trim(c.key) || `chap_${i}`;
    const items = [];
    (Array.isArray(c.items) ? c.items : []).forEach((p) => {
      const path = trim(p);
      if (path && !vus.has(path)) {
        vus.add(path);
        items.push(path);
      }
    });
    chapitres.push({ key, label: trim(c.label), icon: trim(c.icon), items });
  });
  const masques = [];
  (Array.isArray(rawMasques) ? rawMasques : []).forEach((p) => {
    const path = trim(p);
    if (path && !vus.has(path) && !masques.includes(path)) masques.push(path);
  });
  return { chapitres, masques };
};

// GET /api/menu-layout -> { chapitres, masques } ou null si non défini.
export const getMenuLayout = asyncHandler(async (req, res) => {
  const doc = await MenuLayout.findOne({ scope: "default" }).lean();
  if (!doc) return res.json(null);
  res.json({ chapitres: doc.chapitres || [], masques: doc.masques || [] });
});

// PUT /api/menu-layout  body: { chapitres:[{key,label,icon,items:[path]}], masques:[path] }
export const saveMenuLayout = asyncHandler(async (req, res) => {
  const { chapitres, masques } = sanitizeLayout(req.body.chapitres, req.body.masques);

  const doc = await MenuLayout.findOneAndUpdate(
    { scope: "default" },
    { $set: { chapitres, masques, updatedBy: req.user?._id || null } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  res.json({ chapitres: doc.chapitres || [], masques: doc.masques || [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// Organisation PERSONNELLE (par utilisateur) — switch « Défaut / Perso ».
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/menu-layout/me
// -> { useCustom, chapitres, masques } ou null si l'utilisateur n'a rien défini.
export const getMyMenuLayout = asyncHandler(async (req, res) => {
  const doc = await UserMenuLayout.findOne({ user: req.user._id }).lean();
  if (!doc) return res.json(null);
  res.json({
    useCustom: !!doc.useCustom,
    chapitres: doc.chapitres || [],
    masques: doc.masques || [],
  });
});

// PUT /api/menu-layout/me
// body: { chapitres:[{key,label,icon,items:[path]}], masques:[path], useCustom? }
// Enregistre l'organisation perso. Si `useCustom` est fourni, il est appliqué ;
// sinon on active automatiquement la config perso (l'utilisateur vient de l'éditer).
export const saveMyMenuLayout = asyncHandler(async (req, res) => {
  const { chapitres, masques } = sanitizeLayout(req.body.chapitres, req.body.masques);
  const useCustom =
    req.body.useCustom === undefined ? true : !!req.body.useCustom;

  const doc = await UserMenuLayout.findOneAndUpdate(
    { user: req.user._id },
    { $set: { chapitres, masques, useCustom } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  res.json({
    useCustom: !!doc.useCustom,
    chapitres: doc.chapitres || [],
    masques: doc.masques || [],
  });
});

// PATCH /api/menu-layout/me/mode  body: { useCustom: bool }
// Bascule le switch sans toucher au contenu rangé (utilisé par la sidebar).
export const setMyMenuMode = asyncHandler(async (req, res) => {
  const useCustom = !!req.body.useCustom;
  const doc = await UserMenuLayout.findOneAndUpdate(
    { user: req.user._id },
    { $set: { useCustom } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  res.json({
    useCustom: !!doc.useCustom,
    chapitres: doc.chapitres || [],
    masques: doc.masques || [],
  });
});

// DELETE /api/menu-layout/me
// Réinitialise : supprime l'organisation perso -> retour à la config par défaut.
export const resetMyMenuLayout = asyncHandler(async (req, res) => {
  await UserMenuLayout.deleteOne({ user: req.user._id });
  res.json(null);
});
