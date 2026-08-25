// backend/controllers/topVentesController.js
//
// Outil « Top Ventes » (groupe Commerciaux). Société résolue par
// checkEntrepriseAccess -> req.entreprise. Lecture seule (article.dbf).
import asyncHandler from "../middleware/asyncHandler.js";
import { getSynthese, getDetail } from "../services/topVentesService.js";

// GET /:nomDossierDBF/synthese?groupBy=fournisseur|rayon
export const synthese = asyncHandler(async (req, res) => {
  const data = await getSynthese(req.entreprise, { groupBy: req.query.groupBy });
  res.json(data);
});

// GET /:nomDossierDBF/detail?type=fournisseur|rayon&code=&search=&sort=&dir=&limit=&renvoi=
// renvoi : "1" = uniquement les articles qui renvoient vers un autre article
// (GENDOUBL renseigné), "0" = les exclure.
export const detail = asyncHandler(async (req, res) => {
  const { type, code, search, sort, dir, limit, renvoi } = req.query;
  const data = await getDetail(req.entreprise, {
    type,
    code,
    search,
    sort,
    dir,
    limit,
    renvoi,
  });
  res.json(data);
});
