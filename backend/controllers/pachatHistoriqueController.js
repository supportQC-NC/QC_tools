// backend/controllers/pachatHistoriqueController.js
//
// Module « Historique prix d'achat ». Société injectée par checkEntrepriseAccess
// (:nomDossierDBF -> req.entreprise).
import asyncHandler from "../middleware/asyncHandler.js";
import {
  getPachatHistorique,
  getFournisseursCommandes,
  getPachatEvolutions,
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

export { getHistorique, getFournisseurs, getEvolutions };
