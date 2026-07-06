// commerciauxController.js
// Endpoints d'analyse des ventes par commercial.
// req.entreprise est injecté par le middleware checkEntrepriseAccess.
// Restriction PAR ENTREPRISE : un utilisateur ne voit que les commerciaux dont
// le code lui est attribué (permission.commerciauxScope). Un super-admin voit tout.

import asyncHandler from "../middleware/asyncHandler.js";
import commerciauxService from "../services/commerciauxService.js";
import { getCommerciauxCodes } from "../middleware/accessControl.js";

// Normalise un code REPRES en entier pour comparaison (0 = MAGASIN).
const toInt = (c) => {
  const n = parseInt(String(c).trim(), 10);
  return Number.isFinite(n) ? n : null;
};

// Filtre la liste des commerciaux sur les codes autorisés et RECALCULE les
// totaux pour n'exposer que le périmètre de l'utilisateur.
const filtrerParCodes = (data, codes) => {
  const autorises = new Set(codes.map(toInt).filter((n) => n !== null));
  const commerciaux = (data.commerciaux || []).filter((c) =>
    autorises.has(toInt(c.code)),
  );
  const caN = commerciaux.reduce((s, x) => s + (x.caN || 0), 0);
  const caN1 = commerciaux.reduce((s, x) => s + (x.caN1 || 0), 0);
  const margeN = commerciaux.reduce((s, x) => s + (x.margeN || 0), 0);
  return {
    ...data,
    totaux: {
      caN,
      caN1,
      margeN,
      pctMarge: caN !== 0 ? (margeN / caN) * 100 : 0,
      nbCommerciaux: commerciaux.length,
    },
    commerciaux,
  };
};

// GET /api/commerciaux/:nomDossierDBF
// Liste des commerciaux + KPI agrégés (sans la liste détaillée des clients).
const getCommerciaux = asyncHandler(async (req, res) => {
  const data = await commerciauxService.getCommerciauxSummary(req.entreprise);
  const codes = await getCommerciauxCodes(req.user, req.entreprise._id.toString());
  res.json(codes === null ? data : filtrerParCodes(data, codes));
});

// GET /api/commerciaux/:nomDossierDBF/full
// Analyse complète AVEC la liste des clients par commercial (export Excel global).
const getCommerciauxFull = asyncHandler(async (req, res) => {
  const data = await commerciauxService.getAnalyse(req.entreprise);
  const codes = await getCommerciauxCodes(req.user, req.entreprise._id.toString());
  res.json(codes === null ? data : filtrerParCodes(data, codes));
});

// GET /api/commerciaux/:nomDossierDBF/:code
// Détail d'un commercial : KPI + comparaison portefeuille + clients + mensuel.
const getCommercialDetail = asyncHandler(async (req, res) => {
  const codes = await getCommerciauxCodes(req.user, req.entreprise._id.toString());
  if (codes !== null) {
    const autorises = new Set(codes.map(toInt).filter((n) => n !== null));
    if (!autorises.has(toInt(req.params.code))) {
      res.status(403);
      throw new Error("Vous n'avez pas accès à ce commercial");
    }
  }

  const data = await commerciauxService.getCommercialDetail(
    req.entreprise,
    req.params.code,
  );
  if (!data) {
    res.status(404);
    throw new Error("Commercial introuvable pour cette entreprise");
  }
  res.json(data);
});

// POST /api/commerciaux/:nomDossierDBF/refresh
// Invalide le cache (recalcul au prochain appel).
const refreshCommerciaux = asyncHandler(async (req, res) => {
  commerciauxService.invalidate(req.entreprise.nomDossierDBF);
  res.json({ message: "Cache des commerciaux invalidé" });
});

export {
  getCommerciaux,
  getCommerciauxFull,
  getCommercialDetail,
  refreshCommerciaux,
};