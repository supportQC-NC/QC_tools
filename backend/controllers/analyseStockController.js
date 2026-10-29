// backend/controllers/analyseStockController.js
//
// ANALYSE STOCK : classeurs Excel mensuels `analyse_stock_<trig>_<MM>_<AAAA>.xlsx`
// du FTPS robot-documents (dossier analyse_stock/, régénéré chaque mois pour le
// mois précédent ; le cache local accumule l'historique). Scoping société
// classique (module + checkEntrepriseAccess), fichier retrouvé par TRIGRAMME.

import asyncHandler from "../middleware/asyncHandler.js";
import Entreprise from "../models/EntrepriseModel.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";
import {
  scannerSources,
  lireAnalyse,
  construireSynthese,
  filtrerArticles,
  listerFiltres,
} from "../services/analyseStockService.js";

// Périodes "AAAA-MM" d'une source, la plus récente d'abord.
const periodesDesc = (parPeriode) => [...parPeriode.keys()].sort().reverse();

// Résout le classeur (chemin + période retenue) de la société de la requête.
async function classeurPourEntreprise(req, res) {
  const { sources } = await scannerSources();
  const slug = String(req.entreprise.trigramme || "").toLowerCase();
  const parPeriode = slug && sources.get(slug);
  if (!parPeriode) {
    res.status(404);
    throw new Error(
      `Aucune analyse de stock trouvée pour ${req.entreprise.nomComplet || req.entreprise.nomDossierDBF}.`,
    );
  }
  const periodes = periodesDesc(parPeriode);
  const demandee = String(req.query.periode || "");
  const periode = parPeriode.has(demandee) ? demandee : periodes[0];
  return { chemin: parPeriode.get(periode), periode, periodes };
}

// GET /api/analyse-stock
// Sources disponibles (sociétés du périmètre ayant au moins un classeur).
const listerSources = asyncHandler(async (req, res) => {
  const { sources, accessible, erreurFtp } = await scannerSources();

  const scope = await getAccessibleEntreprises(req.user);
  const filtre = scope.all ? {} : { _id: { $in: scope.ids } };
  const entreprises = await Entreprise.find(filtre).select(
    "nomDossierDBF nomComplet trigramme",
  );

  const societes = [];
  for (const e of entreprises) {
    const slug = String(e.trigramme || "").toLowerCase();
    const parPeriode = slug && sources.get(slug);
    if (!parPeriode) continue;
    societes.push({
      nomDossierDBF: e.nomDossierDBF,
      label: e.nomComplet || e.nomDossierDBF,
      trigramme: e.trigramme,
      periodes: periodesDesc(parPeriode),
    });
  }
  societes.sort((a, b) => a.label.localeCompare(b.label));

  res.json({ accessible, erreurFtp, societes });
});

// GET /api/analyse-stock/societe/:nomDossierDBF?periode=AAAA-MM
// Synthèse complète d'une société (défaut : période la plus récente) :
// KPI, répartition par code filtre, évolution 12 mois, rotation, ancienneté
// des ventes, tops fournisseurs/groupes/articles + valeurs de filtres.
const getSynthese = asyncHandler(async (req, res) => {
  const { chemin, periode, periodes } = await classeurPourEntreprise(req, res);
  const data = await lireAnalyse(chemin);
  res.json({
    source: {
      nomDossierDBF: req.entreprise.nomDossierDBF,
      label: req.entreprise.nomComplet || req.entreprise.nomDossierDBF,
      trigramme: req.entreprise.trigramme,
      periode,
      periodes,
    },
    filtres: listerFiltres(data),
    ...construireSynthese(data, periode),
  });
});

// GET /api/analyse-stock/societe/:nomDossierDBF/articles
//     ?periode&q&codeFiltre&fournisseur&groupe&flag&tri&dir&page&taille
// Explorateur d'articles : filtre + tri + pagination CÔTÉ SERVEUR
// (46 000 lignes chez QC, le front ne reçoit qu'une page).
const getArticles = asyncHandler(async (req, res) => {
  const { chemin, periode } = await classeurPourEntreprise(req, res);
  const data = await lireAnalyse(chemin);
  res.json({
    periode,
    ...filtrerArticles(data, {
      q: String(req.query.q || ""),
      codeFiltre: String(req.query.codeFiltre || ""),
      fournisseur: String(req.query.fournisseur || ""),
      groupe: String(req.query.groupe || ""),
      flag: String(req.query.flag || ""),
      tri: String(req.query.tri || "valeurStock"),
      dir: String(req.query.dir || "desc"),
      page: req.query.page,
      taille: req.query.taille,
    }),
  });
});

export { listerSources, getSynthese, getArticles };
