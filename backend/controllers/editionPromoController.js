// backend/controllers/editionPromoController.js
import asyncHandler from "../middleware/asyncHandler.js";
import proformaCacheService from "../services/proformaCacheService.js";
import articleCacheService from "../services/articleService.js";
import {
  construireCsvPromo,
  ecrireFichierPromo,
  formatDateFr,
  nomFichierPromo,
} from "../services/editionPromoService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();
const toNum = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Une ligne proforma est un commentaire si son NART contient "!".
const estCommentaire = (record) => safeTrim(record.NART).includes("!");

/**
 * @desc    Génère un fichier CSV de mise en promotion à partir d'une proforma
 *          et le dépose dans collect_sec (promo_<mois_suivant>.csv).
 * @route   POST /api/edition-promo/:nomDossierDBF/generer
 * @body    { numfact, dateDebut, dateFin }   (dates au format "YYYY-MM-DD")
 * @access  Private (module edition_promo, write) — entreprise via :nomDossierDBF
 */
const genererPromo = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise; // injecté par checkEntrepriseAccess
  const numfact = safeTrim(req.body.numfact);
  const dpromodFr = formatDateFr(req.body.dateDebut);
  const dpromofFr = formatDateFr(req.body.dateFin);

  // 1) Validations
  if (!numfact) {
    res.status(400);
    throw new Error("N° de proforma requis");
  }
  if (!dpromodFr) {
    res.status(400);
    throw new Error("Date de début de promo invalide");
  }
  if (!dpromofFr) {
    res.status(400);
    throw new Error("Date de fin de promo invalide");
  }

  // 2) Lignes de la proforma (triées par NL), commentaires exclus
  const cache = await proformaCacheService.getProformas(entreprise);
  const rows = (cache.prodetByNumfact.get(numfact) || []).slice();
  if (rows.length === 0) {
    res.status(404);
    throw new Error(`Aucun article pour la proforma ${numfact}`);
  }
  rows.sort((a, b) => toNum(a.NL) - toNum(b.NL));

  // 3) Résolution NART + GENCOD + DESIGN — TOUJOURS depuis la base article
  //    (pas la ligne proforma, dont la désignation peut contenir du texte promo).
  const articles = [];
  const introuvables = [];
  const vus = new Set();
  for (const r of rows) {
    if (estCommentaire(r)) continue;
    const nart = safeTrim(r.NART);
    if (!nart || vus.has(nart)) continue;
    vus.add(nart);

    let art = null;
    try {
      art = await articleCacheService.findByNart(entreprise, nart);
    } catch {
      art = null;
    }
    if (!art) introuvables.push(nart);

    articles.push({
      nart,
      gencod: art ? safeTrim(art.GENCOD) : "",
      design: art ? safeTrim(art.DESIGN) : "",
    });
  }

  if (articles.length === 0) {
    res.status(404);
    throw new Error(`Aucun article exploitable pour la proforma ${numfact}`);
  }

  // 4) Construction + écriture du CSV dans collect_sec
  const contenu = construireCsvPromo(articles, dpromodFr, dpromofFr);

  let ecrit;
  try {
    ecrit = ecrireFichierPromo(entreprise, contenu);
  } catch (error) {
    res.status(500);
    throw new Error(
      `Impossible d'écrire le fichier promo dans collect_sec : ${error.message}`,
    );
  }

  res.status(201).json({
    message: `Fichier promo généré : ${ecrit.fileName}`,
    fileName: ecrit.fileName,
    filePath: ecrit.filePath,
    dossier: ecrit.dossier,
    numfact,
    dateDebut: dpromodFr,
    dateFin: dpromofFr,
    nbArticles: articles.length,
    introuvables,
  });
});

export { genererPromo };
export default { genererPromo };
