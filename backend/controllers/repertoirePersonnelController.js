// backend/controllers/repertoirePersonnelController.js
//
// Module « Dictionnaires » — répertoires du personnel.
// ⚠️ PAS de checkEntrepriseAccess ici, c'est VOULU (décision client du
// 02/11/2026) : tout utilisateur ayant le module voit et télécharge les
// répertoires de TOUTES les sociétés, le scoping société ne s'applique pas.

import asyncHandler from "../middleware/asyncHandler.js";
import RepertoirePersonnel from "../models/RepertoirePersonnelModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import { ecrirePdfRepertoire } from "../services/repertoirePersonnelPdfService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

const sanitizeEntrees = (entrees) =>
  (Array.isArray(entrees) ? entrees : [])
    .map((e, i) => ({
      nom: safeTrim(e.nom),
      service: safeTrim(e.service),
      poste: safeTrim(e.poste),
      telExterieur: safeTrim(e.telExterieur),
      portable: safeTrim(e.portable),
      email: safeTrim(e.email),
      ordre: Number.isFinite(Number(e.ordre)) ? Number(e.ordre) : i,
    }))
    .filter((e) => e.nom);

// @desc    Toutes les sociétés actives + leur répertoire (null si aucun)
// @route   GET /api/repertoire-personnel
const getRepertoires = asyncHandler(async (req, res) => {
  const [entreprises, repertoires] = await Promise.all([
    Entreprise.find({ isActive: true })
      .select("trigramme nomComplet nomDossierDBF")
      .sort({ trigramme: 1 }),
    RepertoirePersonnel.find({}),
  ]);
  const parEntreprise = new Map(
    repertoires.map((r) => [String(r.entreprise), r]),
  );
  res.json(
    entreprises.map((e) => {
      const r = parEntreprise.get(String(e._id)) || null;
      return {
        entreprise: {
          _id: e._id,
          trigramme: e.trigramme,
          nomComplet: e.nomComplet,
        },
        repertoire: r
          ? {
              standard: r.standard,
              note: r.note,
              entrees: r.entrees,
              majLe: r.updatedAt,
            }
          : null,
      };
    }),
  );
});

// @desc    Créer / remplacer le répertoire d'une société
// @route   PUT /api/repertoire-personnel/:entrepriseId
const upsertRepertoire = asyncHandler(async (req, res) => {
  const entreprise = await Entreprise.findById(req.params.entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Société introuvable.");
  }
  const repertoire = await RepertoirePersonnel.findOneAndUpdate(
    { entreprise: entreprise._id },
    {
      $set: {
        standard: safeTrim(req.body.standard),
        note: safeTrim(req.body.note),
        entrees: sanitizeEntrees(req.body.entrees),
        updatedBy: req.user._id,
      },
    },
    { upsert: true, new: true },
  );
  res.json({
    standard: repertoire.standard,
    note: repertoire.note,
    entrees: repertoire.entrees,
    majLe: repertoire.updatedAt,
  });
});

// @desc    PDF du répertoire (reproduction du répertoire papier)
// @route   GET /api/repertoire-personnel/:entrepriseId/pdf
const getRepertoirePdf = asyncHandler(async (req, res) => {
  const entreprise = await Entreprise.findById(req.params.entrepriseId).select(
    "trigramme nomComplet couleurPrimaire",
  );
  if (!entreprise) {
    res.status(404);
    throw new Error("Société introuvable.");
  }
  const repertoire = await RepertoirePersonnel.findOne({
    entreprise: entreprise._id,
  });
  if (!repertoire || repertoire.entrees.length === 0) {
    res.status(404);
    throw new Error("Aucun répertoire renseigné pour cette société.");
  }

  const nom = `repertoire_personnel_${entreprise.trigramme}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${req.query.download === "1" ? "attachment" : "inline"}; filename="${nom}"`,
  );
  ecrirePdfRepertoire(res, {
    societe: entreprise.nomComplet || entreprise.trigramme,
    standard: repertoire.standard,
    note: repertoire.note,
    entrees: repertoire.entrees,
    majLe: repertoire.updatedAt,
    couleur: entreprise.couleurPrimaire,
  });
});

export { getRepertoires, upsertRepertoire, getRepertoirePdf };
