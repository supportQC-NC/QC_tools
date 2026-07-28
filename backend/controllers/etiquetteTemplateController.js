// backend/controllers/etiquetteTemplateController.js
//
// CRUD des TEMPLATES d'étiquettes personnalisées, SCOPÉS PAR SOCIÉTÉ. Les routes
// (etiquetteRoutes) passent `checkEntrepriseAccess` (→ req.entreprise) + le module
// « etiquettes », donc tout utilisateur ayant accès à la société peut lister/
// créer/modifier/supprimer les templates de cette société.
import asyncHandler from "../middleware/asyncHandler.js";
import EtiquetteTemplate from "../models/EtiquetteTemplateModel.js";

const populate = (q) => q.populate("user", "nom prenom email");

// @route GET /api/etiquettes/:nomDossierDBF/templates
const getTemplates = asyncHandler(async (req, res) => {
  const list = await populate(
    EtiquetteTemplate.find({ entreprise: req.entreprise._id }).sort({
      updatedAt: -1,
    }),
  );
  res.json(list);
});

// @route POST /api/etiquettes/:nomDossierDBF/templates
const createTemplate = asyncHandler(async (req, res) => {
  const { nom, description, dataMode, config } = req.body;
  if (!nom || !String(nom).trim()) {
    res.status(400);
    throw new Error("Nom du template requis.");
  }
  const tpl = await EtiquetteTemplate.create({
    user: req.user._id,
    entreprise: req.entreprise._id,
    nom: String(nom).trim(),
    description: description || "",
    dataMode: !!dataMode,
    config: config || {},
  });
  res.status(201).json(await populate(EtiquetteTemplate.findById(tpl._id)));
});

// Charge un template et vérifie qu'il appartient à la société du chemin.
const loadScoped = async (req, res) => {
  const tpl = await EtiquetteTemplate.findById(req.params.id);
  if (!tpl || String(tpl.entreprise) !== String(req.entreprise._id)) {
    res.status(404);
    throw new Error("Template introuvable pour cette société.");
  }
  return tpl;
};

// @route PUT /api/etiquettes/:nomDossierDBF/templates/:id
const updateTemplate = asyncHandler(async (req, res) => {
  const tpl = await loadScoped(req, res);
  const { nom, description, dataMode, config } = req.body;
  if (nom !== undefined) tpl.nom = String(nom).trim();
  if (description !== undefined) tpl.description = description;
  if (dataMode !== undefined) tpl.dataMode = !!dataMode;
  if (config !== undefined) tpl.config = config;
  await tpl.save();
  res.json(await populate(EtiquetteTemplate.findById(tpl._id)));
});

// @route DELETE /api/etiquettes/:nomDossierDBF/templates/:id
const deleteTemplate = asyncHandler(async (req, res) => {
  const tpl = await loadScoped(req, res);
  await EtiquetteTemplate.deleteOne({ _id: tpl._id });
  res.json({ message: "Template supprimé" });
});

export { getTemplates, createTemplate, updateTemplate, deleteTemplate };
