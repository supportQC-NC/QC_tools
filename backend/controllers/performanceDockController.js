// backend/controllers/performanceDockController.js
//
// Performance réappro magasin — combien d'articles, chaque jour, n'ont rien en
// rayon (S1 = 0) alors qu'il reste du stock ailleurs (S2..S5 > 0).
//
// La série est lue dans les photos quotidiennes `ReapproSnapshot`
// (`performanceReapproService`), plus dans les classeurs reapro_mag du partage :
// l'écran fonctionne donc depuis le VPS, pour toutes les sociétés, et la règle
// de comptage est la MÊME que celle de la liste « rayon vide ».
//
// Les critères de l'écran (période, jours de semaine, tranche de ventes,
// fournisseur, base de la moyenne) arrivent en query et sont normalisés par le
// service : écran et export Excel partagent ainsi le même calcul.

import asyncHandler from "../middleware/asyncHandler.js";
import performanceReapproService from "../services/performanceReapproService.js";
import articleService from "../services/articleService.js";
import { genererExcelPerformanceDock } from "../services/performanceDockExcelService.js";

// `checkEntrepriseAccess` a déjà chargé ET validé la société dans `req.entreprise`
// — pas de second aller-retour Mongo.
const chargerEntreprise = async (req) => req.entreprise;

// GET /api/performance-dock/:nomDossierDBF
//     ?debut=&fin=&jours=1,2&exclureZero=1&tranches=forte,moyenne&fourn=&baseMoyenne=
const getReport = asyncHandler(async (req, res) => {
  const entreprise = await chargerEntreprise(req);
  const data = await performanceReapproService.getRapport(entreprise, req.query);
  res.json(data);
});

// GET /api/performance-dock/:nomDossierDBF/excel (mêmes paramètres)
const exportExcel = asyncHandler(async (req, res) => {
  const entreprise = await chargerEntreprise(req);
  const data = await performanceReapproService.getRapport(entreprise, req.query);
  if (!data.rows.length) {
    res.status(409);
    throw new Error(
      data.message || "Aucune journée ne correspond aux critères : rien à exporter.",
    );
  }

  const buffer = await genererExcelPerformanceDock(data);

  const c = data.criteres || {};
  const suffixe =
    c.debut || c.fin
      ? `_${c.debut || data.bornes.premiere}_${c.fin || data.bornes.derniere}`
      : "";
  const fname = `reappro_magasin_${entreprise.nomDossierDBF}${suffixe}.xlsx`;
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
  res.send(Buffer.from(buffer));
});

// POST /api/performance-dock/:nomDossierDBF/photo
// Refait le relevé du jour à la demande, sans attendre le passage de 18:00.
// Utile après une correction de stock, et pour amorcer une société qui vient
// d'être ajoutée.
const prendrePhotoMaintenant = asyncHandler(async (req, res) => {
  const entreprise = await chargerEntreprise(req);
  // Le cache article a un TTL de 5 min : sans invalidation, une photo « à la
  // demande » recompterait les mêmes enregistrements que la précédente et le
  // bouton donnerait l'illusion d'avoir rafraîchi quelque chose.
  articleService.invalidate(entreprise.nomDossierDBF);
  const photo = await performanceReapproService.prendrePhoto(entreprise);
  res.json({
    message: `Photo du ${photo.date} enregistrée : ${photo.total} article(s) à réapprovisionner.`,
    photo,
  });
});

// POST /api/performance-dock/:nomDossierDBF/rattrapage?force=1
// Rejoue les journées déjà archivées dans reapro_mag, avec la même règle, pour
// que la série ne démarre pas vide. Ne touche pas aux photos déjà en base sauf
// `force` — une photo DBF vaut mieux qu'une journée rejouée.
const rattraperHistorique = asyncHandler(async (req, res) => {
  const entreprise = await chargerEntreprise(req);
  const resultat = await performanceReapproService.rejouerArchives(entreprise, {
    force: req.query.force === "1" || req.query.force === "true",
  });
  res.json(resultat);
});

export {
  getReport,
  exportExcel,
  prendrePhotoMaintenant,
  rattraperHistorique,
};
