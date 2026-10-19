// backend/controllers/topVentesController.js
//
// Outil « Top Ventes » (groupe Commerciaux). Société résolue par
// checkEntrepriseAccess -> req.entreprise. Lecture seule (article.dbf).
import asyncHandler from "../middleware/asyncHandler.js";
import { getSynthese, getDetail } from "../services/topVentesService.js";
import { buildTopVentesDetailWorkbook } from "../services/topVentesExcelService.js";
import { envoyerClasseur } from "../utils/envoyerClasseur.js";

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

// GET /:nomDossierDBF/export?type=fournisseur|rayon&code=&search=&sort=&dir=&renvoi=
// Export Excel du détail d'UN fournisseur / rayon — mêmes filtres que l'écran,
// sans borne d'affichage (toutes les lignes). Masquage champ par champ appliqué
// à la source (colonnes déclarées avec leur champ DBF) + filet envoyerClasseur.
export const exportDetail = asyncHandler(async (req, res) => {
  const { type, code, search, sort, dir, renvoi } = req.query;
  if (code === undefined || code === null || code === "") {
    res.status(400);
    throw new Error("Code fournisseur ou rayon requis pour l'export.");
  }
  const { workbook, filename, count } = await buildTopVentesDetailWorkbook({
    entreprise: req.entreprise,
    type,
    code,
    search,
    sort,
    dir,
    renvoi,
    masqueDbf: req.masqueDbf,
  });
  await envoyerClasseur(req, res, workbook, filename, { "X-Articles": count });
});
