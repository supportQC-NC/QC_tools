// backend/controllers/historiquePromosController.js
//
// HISTORIQUE PROMOS : fichiers JSON `<trig>.json` du FTPS robot-documents
// (dossier historique_promos/), un bloc par mois et par société. Scoping
// société classique (module + checkEntrepriseAccess), fichier retrouvé par
// TRIGRAMME — même convention que l'analyse stock.

import asyncHandler from "../middleware/asyncHandler.js";
import Entreprise from "../models/EntrepriseModel.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";
import {
  scannerSources,
  lireHistorique,
} from "../services/historiquePromosService.js";

// GET /api/historique-promos
// Sociétés du périmètre ayant un fichier d'historique, avec leurs périodes.
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
    const chemin = slug && sources.get(slug);
    if (!chemin) continue;
    const { mois } = lireHistorique(chemin);
    societes.push({
      nomDossierDBF: e.nomDossierDBF,
      label: e.nomComplet || e.nomDossierDBF,
      trigramme: e.trigramme,
      periodes: mois.map((m) => m.periode),
    });
  }
  societes.sort((a, b) => a.label.localeCompare(b.label));

  res.json({ accessible, erreurFtp, societes });
});

// GET /api/historique-promos/societe/:nomDossierDBF
// Historique complet de la société (tous les mois, du plus récent au plus
// ancien) — les fichiers sont minuscules, pas besoin de paginer.
const getHistorique = asyncHandler(async (req, res) => {
  const { sources } = await scannerSources();
  const slug = String(req.entreprise.trigramme || "").toLowerCase();
  const chemin = slug && sources.get(slug);
  if (!chemin) {
    res.status(404);
    throw new Error(
      `Aucun historique de promotions trouvé pour ${req.entreprise.nomComplet || req.entreprise.nomDossierDBF}.`,
    );
  }
  const { nom, mois } = lireHistorique(chemin);
  res.json({
    source: {
      nomDossierDBF: req.entreprise.nomDossierDBF,
      label: req.entreprise.nomComplet || nom || req.entreprise.nomDossierDBF,
      trigramme: req.entreprise.trigramme,
    },
    mois,
  });
});

export { listerSources, getHistorique };
