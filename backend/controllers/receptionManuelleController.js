// backend/controllers/receptionManuelleController.js
//
// Module « Contrôle réception MANUEL » — version papier du contrôle de réception.
//
// L'utilisateur voit les commandes à contrôler (mêmes que le module scanné :
// cmdref, ETAT >= 4), puis IMPRIME la fiche de contrôle de la commande qu'il
// remplit à la main. L'application ne stocke qu'un suivi léger des impressions
// et un statut (FicheReceptionModel) — aucune écriture DBF.
import asyncHandler from "../middleware/asyncHandler.js";
import FicheReception, {
  FICHE_RECEPTION_STATUTS,
} from "../models/FicheReceptionModel.js";
import {
  checkCommandeFiles,
  listerCommandes,
  getCommandeComplete,
} from "../services/receptionManuelleService.js";
import { genererFicheReceptionPDF } from "../services/ficheReceptionPdfService.js";

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

// Nom affichable de l'utilisateur courant.
const userNom = (u) =>
  [u?.prenom, u?.nom].filter(Boolean).join(" ").trim() || u?.email || "";

const formatEntreprise = (entreprise) => ({
  _id: entreprise._id,
  nomDossierDBF: entreprise.nomDossierDBF,
  trigramme: entreprise.trigramme,
  nomComplet: entreprise.nomComplet,
});

// Projection du suivi Mongo renvoyée au front.
const formatSuivi = (f) =>
  f
    ? {
        statut: f.statut,
        nbImpressions: f.nbImpressions || 0,
        dernierePrintAt: f.dernierePrintAt,
        dernierePrintPar: f.dernierePrintPar || "",
        controleAt: f.controleAt,
        controlePar: f.controlePar || "",
        commentaire: f.commentaire || "",
      }
    : {
        statut: "a_controler",
        nbImpressions: 0,
        dernierePrintAt: null,
        dernierePrintPar: "",
        controleAt: null,
        controlePar: "",
        commentaire: "",
      };

// Assure la présence des DBF de commandes (404 explicite sinon).
const assertCommandeFiles = (entreprise, res) => {
  const check = checkCommandeFiles(entreprise);
  if (!check.exists) {
    res.status(404);
    throw new Error(check.error);
  }
};

/**
 * @desc    Commandes à contrôler (DBF) + statut de suivi des fiches papier.
 * @route   GET /api/reception-manuelle/:nomDossierDBF/commandes
 * @query   page, limit, search, statut
 * @access  Private (module reception_manuelle, read) + entreprise
 */
const getCommandes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();
  assertCommandeFiles(entreprise, res);

  const { commandes, pagination, etatMin } = await listerCommandes(entreprise, {
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
  });

  // Suivi Mongo des commandes de la page courante.
  const numcdes = commandes.map((c) => c.numcde);
  const fiches = await FicheReception.find({
    entreprise: entreprise._id,
    numcde: { $in: numcdes },
  }).lean();
  const parNumcde = new Map(fiches.map((f) => [f.numcde, f]));

  let lignes = commandes.map((c) => ({
    ...c,
    suivi: formatSuivi(parNumcde.get(c.numcde)),
  }));

  // Filtre optionnel sur le statut de suivi (appliqué après fusion).
  const statut = safeTrim(req.query.statut);
  if (statut && FICHE_RECEPTION_STATUTS.includes(statut)) {
    lignes = lignes.filter((c) => c.suivi.statut === statut);
  }

  res.json({
    entreprise: formatEntreprise(entreprise),
    etatMin,
    pagination,
    _queryTime: `${Date.now() - startTime}ms`,
    commandes: lignes,
  });
});

/**
 * @desc    Détail d'une commande (aperçu avant impression de la fiche).
 * @route   GET /api/reception-manuelle/:nomDossierDBF/commandes/:numcde
 * @access  Private (module reception_manuelle, read) + entreprise
 */
const getCommandeDetails = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();
  assertCommandeFiles(entreprise, res);

  const { entete, commentaires, lignes, resaDisponible } =
    await getCommandeComplete(entreprise, req.params.numcde);
  if (!entete) {
    res.status(404);
    throw new Error("Commande introuvable dans cette société");
  }

  const fiche = await FicheReception.findOne({
    entreprise: entreprise._id,
    numcde: entete.numcde,
  }).lean();

  res.json({
    entreprise: formatEntreprise(entreprise),
    commande: entete,
    commentaires,
    totalLignes: lignes.length,
    totalUnites: Math.round(
      lignes.reduce((s, l) => s + (Number(l.qteCommandee) || 0), 0),
    ),
    nbNouveautes: lignes.filter((l) => l.estNouveau).length,
    nbReservations: lignes.filter((l) => l.estReserve).length,
    // false = index des réservations pas encore chaud : la fiche sort sans
    // les « R », il faut réactualiser dans un instant.
    resaDisponible,
    suivi: formatSuivi(fiche),
    _queryTime: `${Date.now() - startTime}ms`,
    lignes,
  });
});

/**
 * @desc    Génère la fiche de contrôle PDF (à remplir à la main) et trace
 *          l'impression dans le suivi. La quantité commandée n'y figure
 *          JAMAIS : le comptage est toujours à l'aveugle.
 * @route   POST /api/reception-manuelle/:nomDossierDBF/commandes/:numcde/fiche-pdf
 * @access  Private (module reception_manuelle, write) + entreprise
 */
const genererFiche = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  assertCommandeFiles(entreprise, res);

  const { entete, commentaires, lignes, resaDisponible } =
    await getCommandeComplete(entreprise, req.params.numcde);
  if (!entete) {
    res.status(404);
    throw new Error("Commande introuvable dans cette société");
  }

  // Trace AVANT le streaming : une fois les octets partis, on ne peut plus
  // renvoyer d'erreur JSON au client.
  const nom = userNom(req.user);
  const maintenant = new Date();
  await FicheReception.findOneAndUpdate(
    { entreprise: entreprise._id, numcde: entete.numcde },
    {
      $set: {
        nomDossierDBF: entreprise.nomDossierDBF,
        statut: "imprime",
        dernierePrintAt: maintenant,
        dernierePrintPar: nom,
        commandeInfo: {
          fourn: entete.fourn,
          fournisseurNom: entete.fournisseurNom,
          bateau: entete.bateau,
          arrivee: entete.arrivee,
          datcde: entete.datcde,
          etat: entete.etat,
        },
      },
      $inc: { nbImpressions: 1 },
      $push: {
        impressions: {
          $each: [
            {
              user: req.user._id,
              nom,
              at: maintenant,
              nbLignes: lignes.length,
            },
          ],
          $slice: -50, // on ne garde que les 50 dernières impressions
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const fileName = `fiche_controle_${safeTrim(entete.numcde).replace(
    /[\\/:*?"<>|]/g,
    "_",
  )}_${safeTrim(entreprise.trigramme).toUpperCase() || "XXX"}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

  await genererFicheReceptionPDF({
    entreprise,
    commande: entete,
    lignes,
    commentaires,
    options: { editePar: nom, resaDisponible },
    stream: res,
  });
});

/**
 * @desc    Change le statut de suivi d'une commande (à contrôler / imprimé /
 *          contrôlé) et son commentaire.
 * @route   PUT /api/reception-manuelle/:nomDossierDBF/commandes/:numcde/statut
 * @body    { statut, commentaire? }
 * @access  Private (module reception_manuelle, write) + entreprise
 */
const updateStatut = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const statut = safeTrim(req.body?.statut);

  if (!FICHE_RECEPTION_STATUTS.includes(statut)) {
    res.status(400);
    throw new Error(
      `Statut invalide (attendu : ${FICHE_RECEPTION_STATUTS.join(", ")})`,
    );
  }

  const numcde = safeTrim(req.params.numcde);
  const nom = userNom(req.user);
  const set = {
    nomDossierDBF: entreprise.nomDossierDBF,
    statut,
  };
  if (req.body?.commentaire !== undefined) {
    set.commentaire = safeTrim(req.body.commentaire).slice(0, 1000);
  }
  if (statut === "controle") {
    set.controleAt = new Date();
    set.controlePar = nom;
  } else {
    set.controleAt = null;
    set.controlePar = "";
  }

  const fiche = await FicheReception.findOneAndUpdate(
    { entreprise: entreprise._id, numcde },
    { $set: set },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  res.json({ numcde, suivi: formatSuivi(fiche) });
});

/**
 * @desc    Historique des fiches imprimées / contrôlées de la société.
 * @route   GET /api/reception-manuelle/:nomDossierDBF/historique
 * @access  Private (module reception_manuelle, read) + entreprise
 */
const getHistorique = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 200);

  const fiches = await FicheReception.find({ entreprise: entreprise._id })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  res.json(
    fiches.map((f) => ({
      numcde: f.numcde,
      fournisseurNom: f.commandeInfo?.fournisseurNom || "",
      bateau: f.commandeInfo?.bateau || "",
      arrivee: f.commandeInfo?.arrivee || null,
      updatedAt: f.updatedAt,
      derniereImpression: (f.impressions || []).slice(-1)[0] || null,
      ...formatSuivi(f),
    })),
  );
});

/**
 * @desc    Supprime le suivi d'une commande (remise à « à contrôler »).
 * @route   DELETE /api/reception-manuelle/:nomDossierDBF/commandes/:numcde/suivi
 * @access  Private (module reception_manuelle, delete) + entreprise
 */
const resetSuivi = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const numcde = safeTrim(req.params.numcde);
  await FicheReception.deleteOne({ entreprise: entreprise._id, numcde });
  res.json({ numcde, suivi: formatSuivi(null) });
});

export {
  getCommandes,
  getCommandeDetails,
  genererFiche,
  updateStatut,
  getHistorique,
  resetSuivi,
};
