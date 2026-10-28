// backend/controllers/analyseCaMensuelleController.js
//
// Analyse CA MENSUELLE : classeurs Excel déposés chaque mois sur le Rcommun
// (STOCK/doc_temp/CA_MENSUELLE), un par société, nommés par TRIGRAMME en
// minuscules. Scoping société classique (module + checkEntrepriseAccess).

import asyncHandler from "../middleware/asyncHandler.js";
import Entreprise from "../models/EntrepriseModel.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";
import {
  scannerSources,
  lireClasseur,
} from "../services/analyseCaMensuelleService.js";

// Périodes "AAAA-MM" d'une source, la plus récente d'abord.
const periodesDesc = (parPeriode) => [...parPeriode.keys()].sort().reverse();

// GET /api/analyse-ca-mensuelle
// Sources disponibles (sociétés du périmètre ayant au moins un classeur).
const listerSources = asyncHandler(async (req, res) => {
  const { sources, dossier, accessible } = await scannerSources();

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

  res.json({ accessible, dossier, societes });
});

// GET /api/analyse-ca-mensuelle/societe/:nomDossierDBF?periode=AAAA-MM
// Classeur complet d'une société (défaut : période la plus récente).
const getClasseur = asyncHandler(async (req, res) => {
  const { sources } = await scannerSources();
  const slug = String(req.entreprise.trigramme || "").toLowerCase();
  const parPeriode = slug && sources.get(slug);
  if (!parPeriode) {
    res.status(404);
    throw new Error(
      `Aucune analyse CA mensuelle trouvée pour ${req.entreprise.nomComplet || req.entreprise.nomDossierDBF}.`,
    );
  }

  const periodes = periodesDesc(parPeriode);
  const demandee = String(req.query.periode || "");
  const periode = parPeriode.has(demandee) ? demandee : periodes[0];

  const data = await lireClasseur(parPeriode.get(periode));
  res.json({
    source: {
      nomDossierDBF: req.entreprise.nomDossierDBF,
      label: req.entreprise.nomComplet || req.entreprise.nomDossierDBF,
      trigramme: req.entreprise.trigramme,
      periode,
      periodes,
    },
    ...data,
  });
});

export { listerSources, getClasseur };
