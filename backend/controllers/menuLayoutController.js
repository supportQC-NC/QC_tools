// backend/controllers/menuLayoutController.js
//
// Organisation de la sidebar (chapitres) : lecture par tout utilisateur connecté
// (pour construire son menu), écriture réservée aux admins (constructeur).
import asyncHandler from "../middleware/asyncHandler.js";
import MenuLayout from "../models/MenuLayoutModel.js";
import UserMenuLayout from "../models/UserMenuLayoutModel.js";

const trim = (v) => (v === null || v === undefined ? "" : String(v).trim());

// Profondeur maximale de l'arborescence : dossier > sous-dossier. Au-delà, la
// sidebar devient illisible (indentation) et le constructeur ingérable.
const PROFONDEUR_MAX = 2;

// Nettoyage/validation partagé : un `path` ne peut apparaître qu'une seule fois
// au total (dans un chapitre OU dans les masqués). Les dossiers sont renvoyés à
// plat, chacun avec sa `key` de parent, dans l'ordre d'affichage (un enfant
// suit toujours son parent). Renvoie { chapitres, masques }.
const sanitizeLayout = (rawChapitres, rawMasques) => {
  const vus = new Set();
  const brut = [];
  const cles = new Set();
  (Array.isArray(rawChapitres) ? rawChapitres : []).forEach((c, i) => {
    let key = trim(c.key) || `chap_${i}`;
    // Deux dossiers ne peuvent pas partager la même clé : c'est elle qui porte
    // le rattachement des sous-dossiers.
    while (cles.has(key)) key = `${key}_${i}`;
    cles.add(key);
    const items = [];
    (Array.isArray(c.items) ? c.items : []).forEach((p) => {
      const path = trim(p);
      if (path && !vus.has(path)) {
        vus.add(path);
        items.push(path);
      }
    });
    brut.push({
      key,
      label: trim(c.label),
      icon: trim(c.icon),
      parent: trim(c.parent) || null,
      items,
    });
  });

  // Un parent inconnu, un auto-rattachement ou un cycle ramènent le dossier à
  // la racine : mieux vaut un dossier mal placé qu'une arborescence perdue.
  const parKey = new Map(brut.map((c) => [c.key, c]));
  const profondeur = (c, vus2 = new Set()) => {
    if (!c.parent || vus2.has(c.key)) return 1;
    const p = parKey.get(c.parent);
    if (!p) return 1;
    vus2.add(c.key);
    return 1 + profondeur(p, vus2);
  };
  brut.forEach((c) => {
    if (!c.parent) return;
    if (c.parent === c.key || !parKey.has(c.parent)) c.parent = null;
  });
  brut.forEach((c) => {
    if (c.parent && profondeur(c) > PROFONDEUR_MAX) c.parent = null;
  });

  // Remise en ordre « parent puis ses enfants », l'ordre d'arrivée faisant foi
  // entre frères : le front n'a plus qu'à lire le tableau de haut en bas.
  const chapitres = [];
  const empiler = (parent) => {
    brut
      .filter((c) => (c.parent || null) === parent)
      .forEach((c) => {
        chapitres.push(c);
        empiler(c.key);
      });
  };
  empiler(null);
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
