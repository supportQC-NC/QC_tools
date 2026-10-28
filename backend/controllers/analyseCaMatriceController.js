// backend/controllers/analyseCaMatriceController.js
//
// Analyse CA sur MATRICES Excel (Rcommun STOYANN/CA) — voir le service pour la
// structure des fichiers. Deux dimensions d'accès :
//   - sociétés : module `analyse_ca_admin` + checkEntrepriseAccess (:nomDossierDBF) ;
//   - groupes  : données CONSOLIDÉES multi-sociétés, réservées aux admins
//     (on ne sait pas, depuis le fichier, quelles sociétés composent le groupe,
//     donc impossible de scoper plus finement).

import asyncHandler from "../middleware/asyncHandler.js";
import Entreprise from "../models/EntrepriseModel.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";
import {
  scannerSources,
  lireMatrice,
  libelleGroupe,
} from "../services/analyseCaMatriceService.js";

// Années disponibles d'une source, la plus récente d'abord.
const anneesDesc = (parAnnee) => [...parAnnee.keys()].sort((a, b) => b - a);

// Choisit le fichier d'une source selon ?annee (défaut : la plus récente).
function fichierPourAnnee(parAnnee, anneeDemandee) {
  const annees = anneesDesc(parAnnee);
  const annee = anneeDemandee && parAnnee.has(anneeDemandee) ? anneeDemandee : annees[0];
  return { annee, chemin: parAnnee.get(annee) };
}

// GET /api/analyse-ca-matrices
// Sources disponibles, filtrées par le périmètre de l'utilisateur.
const listerSources = asyncHandler(async (req, res) => {
  const { societes, groupes, accessible, dossier } = scannerSources();

  const scope = await getAccessibleEntreprises(req.user);
  const filtre = scope.all ? {} : { _id: { $in: scope.ids } };
  const entreprises = await Entreprise.find(filtre).select(
    "nomDossierDBF nomComplet trigramme",
  );
  const parDossier = new Map(entreprises.map((e) => [e.nomDossierDBF, e]));

  const sourcesSocietes = [];
  for (const [nomDossierDBF, parAnnee] of societes) {
    const e = parDossier.get(nomDossierDBF);
    if (!e) continue; // société hors périmètre (ou inconnue de l'app)
    sourcesSocietes.push({
      type: "societe",
      id: nomDossierDBF,
      label: e.nomComplet || nomDossierDBF,
      trigramme: e.trigramme || "",
      annees: anneesDesc(parAnnee),
    });
  }
  sourcesSocietes.sort((a, b) => a.label.localeCompare(b.label));

  // Groupes : admins uniquement (données consolidées).
  const sourcesGroupes = [];
  if (req.user?.role === "admin") {
    for (const [id, parAnnee] of groupes) {
      sourcesGroupes.push({
        type: "groupe",
        id,
        label: libelleGroupe(id),
        annees: anneesDesc(parAnnee),
      });
    }
    sourcesGroupes.sort((a, b) => a.label.localeCompare(b.label));
  }

  res.json({
    accessible,
    dossier,
    societes: sourcesSocietes,
    groupes: sourcesGroupes,
  });
});

// GET /api/analyse-ca-matrices/societe/:nomDossierDBF?annee=YYYY
const getMatriceSociete = asyncHandler(async (req, res) => {
  const { societes } = scannerSources();
  const parAnnee = societes.get(req.entreprise.nomDossierDBF);
  if (!parAnnee) {
    res.status(404);
    throw new Error(
      `Aucune matrice CA trouvée pour ${req.entreprise.nomComplet || req.entreprise.nomDossierDBF}.`,
    );
  }
  const { annee, chemin } = fichierPourAnnee(parAnnee, Number(req.query.annee) || null);
  const data = await lireMatrice(chemin);
  res.json({
    source: {
      type: "societe",
      id: req.entreprise.nomDossierDBF,
      label: req.entreprise.nomComplet || req.entreprise.nomDossierDBF,
      annee,
      annees: anneesDesc(parAnnee),
    },
    ...data,
  });
});

// GET /api/analyse-ca-matrices/groupe/:groupeId?annee=YYYY  (admin)
const getMatriceGroupe = asyncHandler(async (req, res) => {
  const { groupes } = scannerSources();
  const id = String(req.params.groupeId || "").toLowerCase();
  const parAnnee = groupes.get(id);
  if (!parAnnee) {
    res.status(404);
    throw new Error(`Groupe inconnu : ${req.params.groupeId}.`);
  }
  const { annee, chemin } = fichierPourAnnee(parAnnee, Number(req.query.annee) || null);
  const data = await lireMatrice(chemin);
  res.json({
    source: {
      type: "groupe",
      id,
      label: libelleGroupe(id),
      annee,
      annees: anneesDesc(parAnnee),
    },
    ...data,
  });
});

export { listerSources, getMatriceSociete, getMatriceGroupe };
