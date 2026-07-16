// backend/controllers/ficheArticleController.js
import asyncHandler from "../middleware/asyncHandler.js";
import { genererFicheArticle } from "../services/ficheArticleService.js";

// @desc    Fiche article PDF (identité visuelle de l'entreprise)
// @route   GET /api/fiche-article/:nomDossierDBF/:nart
// @access  Private — module stock (read) + accès entreprise
const getFicheArticle = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise || {
    nomDossierDBF: req.params.nomDossierDBF,
  };
  const nart = String(req.params.nart || "").trim();

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="fiche_article_${nart}.pdf"`,
  );
  await genererFicheArticle(entreprise, nart, res);
});

export { getFicheArticle };