// backend/controllers/pachatHistoriqueController.js
//
// Module « Historique prix d'achat ». Société injectée par checkEntrepriseAccess
// (:nomDossierDBF -> req.entreprise).
import asyncHandler from "../middleware/asyncHandler.js";
import Entreprise from "../models/EntrepriseModel.js";
import {
  getPachatHistorique,
  getFournisseursCommandes,
  getPachatEvolutions,
  historiserPachatCommandes,
} from "../services/pachatHistoriqueService.js";

/**
 * @desc   Historique du prix d'achat d'un article (dérivé des commandes).
 * @route  GET /api/historique-pachat/:nomDossierDBF/article/:nart
 * @access Private (module historique_pachat, read)
 */
const getHistorique = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { nart } = req.params;
  const result = await getPachatHistorique(entreprise, nart);
  res.json(result);
});

/**
 * @desc   Liste des fournisseurs présents dans les commandes (sélecteur).
 * @route  GET /api/historique-pachat/:nomDossierDBF/fournisseurs
 * @access Private (module historique_pachat, read)
 */
const getFournisseurs = asyncHandler(async (req, res) => {
  const result = await getFournisseursCommandes(req.entreprise);
  res.json(result);
});

/**
 * @desc   Classement des articles par évolution du prix d'achat (hausses
 *         d'abord). Filtre optionnel ?fourn=CODE, ?sens=hausse|baisse, ?limit.
 * @route  GET /api/historique-pachat/:nomDossierDBF/evolutions
 * @access Private (module historique_pachat, read)
 */
const getEvolutions = asyncHandler(async (req, res) => {
  const { fourn, sens, limit } = req.query;
  const result = await getPachatEvolutions(req.entreprise, {
    fournCode: fourn,
    sens: sens === "baisse" ? "baisse" : "hausse",
    limit: limit ? Math.min(Number(limit) || 100, 500) : 100,
  });
  res.json(result);
});

/**
 * @desc   Historise les prix d'achat de TOUTES les sociétés dans Mongo
 *         (persistance pluriannuelle). Opération lourde, réservée admin.
 * @route  POST /api/historique-pachat/historiser
 * @access Private/Admin
 */
const historiserTout = asyncHandler(async (req, res) => {
  const ents = await Entreprise.find({});
  const societes = [];
  let totalInsere = 0;
  let totalMaj = 0;
  for (const e of ents) {
    try {
      const r = await historiserPachatCommandes(e);
      totalInsere += r.inserted;
      totalMaj += r.updated;
      societes.push({ societe: e.nomDossierDBF, ...r });
    } catch (err) {
      societes.push({ societe: e.nomDossierDBF, error: err.message });
    }
  }
  res.json({
    nbSocietes: ents.length,
    totalInsere,
    totalMaj,
    societes,
  });
});

export { getHistorique, getFournisseurs, getEvolutions, historiserTout };
