// backend/controllers/statsCommerciauxController.js
//
// STATS COMMERCIAUX : classeurs `stats_<TRIG>.xlsx` du FTPS robot-documents
// (dossier stats_commerciaux/, un par société, régénérés chaque soir).
// Scoping société classique (module + checkEntrepriseAccess) ; le fichier
// d'une société est retrouvé par son TRIGRAMME.

import asyncHandler from "../middleware/asyncHandler.js";
import Entreprise from "../models/EntrepriseModel.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";
import {
  scannerSources,
  lireStats,
  construireSynthese,
  clientsDuCommercial,
} from "../services/statsCommerciauxService.js";
import {
  analyserPortefeuille,
  genererExcelPortefeuille,
  genererPdfPortefeuille,
} from "../services/statsCommerciauxExportService.js";
import { envoyerClasseur } from "../utils/envoyerClasseur.js";

// Résout le chemin du classeur de la société de la requête (404 sinon).
async function cheminPourEntreprise(req, res) {
  const { sources } = await scannerSources();
  const slug = String(req.entreprise.trigramme || "").toLowerCase();
  const chemin = slug && sources.get(slug);
  if (!chemin) {
    res.status(404);
    throw new Error(
      `Aucun classeur stats commerciaux trouvé pour ${req.entreprise.nomComplet || req.entreprise.nomDossierDBF}.`,
    );
  }
  return chemin;
}

// GET /api/stats-commerciaux
// Sociétés du périmètre ayant un classeur stats.
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
    if (!slug || !sources.has(slug)) continue;
    societes.push({
      nomDossierDBF: e.nomDossierDBF,
      label: e.nomComplet || e.nomDossierDBF,
      trigramme: e.trigramme,
    });
  }
  societes.sort((a, b) => a.label.localeCompare(b.label));

  res.json({ accessible, erreurFtp, societes });
});

// GET /api/stats-commerciaux/societe/:nomDossierDBF
// Synthèse société : totaux, agrégats par commercial, catégories client.
const getSynthese = asyncHandler(async (req, res) => {
  const chemin = await cheminPourEntreprise(req, res);
  const data = await lireStats(chemin);
  res.json({
    source: {
      nomDossierDBF: req.entreprise.nomDossierDBF,
      label: req.entreprise.nomComplet || req.entreprise.nomDossierDBF,
      trigramme: req.entreprise.trigramme,
    },
    ...construireSynthese(data),
  });
});

// GET /api/stats-commerciaux/societe/:nomDossierDBF/clients?commercial=NOM
// Portefeuille clients d'un commercial ("GLOBAL" = toute la société),
// trié CA N décroissant. ~4 000 lignes chez QC pour GLOBAL/MAGASIN : le
// filtrage/tri d'écran se fait côté client, pas de pagination serveur.
const getClients = asyncHandler(async (req, res) => {
  const chemin = await cheminPourEntreprise(req, res);
  const data = await lireStats(chemin);
  const commercial = String(req.query.commercial || "GLOBAL");
  res.json({
    commercial,
    modifieLe: data.modifieLe,
    annee: data.annee,
    clients: clientsDuCommercial(data, commercial),
  });
});

// GET /api/stats-commerciaux/societe/:nomDossierDBF/portefeuille-export
//     ?commercial=<sélection>&format=xlsx|pdf
// Télécharge le portefeuille SÉLECTIONNÉ : Excel (synthèse + liste complète)
// ou PDF A4 paysage (graphiques pdfkit + analyses + tableau plafonné).
const exportPortefeuille = asyncHandler(async (req, res) => {
  const chemin = await cheminPourEntreprise(req, res);
  const data = await lireStats(chemin);
  const selection = String(req.query.commercial || "GLOBAL");
  const clients = clientsDuCommercial(data, selection);
  const analyses = analyserPortefeuille(clients);
  const source = {
    label: req.entreprise.nomComplet || req.entreprise.nomDossierDBF,
    trigramme: req.entreprise.trigramme,
  };

  const datePourNom = new Date().toISOString().slice(0, 10);
  const nomBase = `portefeuille_${req.entreprise.trigramme || "societe"}_${datePourNom}`;

  if (req.query.format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${nomBase}.pdf"`,
    );
    await genererPdfPortefeuille({ source, selection, clients, analyses }, res);
    return;
  }

  const wb = genererExcelPortefeuille({ source, selection, clients, analyses });
  await envoyerClasseur(req, res, wb, `${nomBase}.xlsx`);
});

export { listerSources, getSynthese, getClients, exportPortefeuille };
