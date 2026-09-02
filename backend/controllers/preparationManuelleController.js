// backend/controllers/preparationManuelleController.js
//
// Module « Préparation de commande MANUELLE » — version papier de la préparation.
//
// L'utilisateur voit les proformas à préparer (mêmes que le module scanné :
// proforma.dbf, ETAT = 2), puis IMPRIME la fiche de préparation qu'un agent
// remplit à la main dans les allées : le parcours commence TOUJOURS par le dock
// (stock S2) et se poursuit au magasin (stock S1) pour le reliquat.
// L'application ne stocke qu'un suivi léger des impressions et un statut
// (FichePreparationModel) — aucune écriture DBF.
import asyncHandler from "../middleware/asyncHandler.js";
import FichePreparation, {
  FICHE_PREPARATION_STATUTS,
} from "../models/FichePreparationModel.js";
import {
  checkProformaFiles,
  listerProformas,
  getPreparationComplete,
} from "../services/preparationManuelleService.js";
import { genererFichePreparationPDF } from "../services/fichePreparationPdfService.js";

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
        prepareAt: f.prepareAt,
        preparePar: f.preparePar || "",
        commentaire: f.commentaire || "",
      }
    : {
        statut: "a_preparer",
        nbImpressions: 0,
        dernierePrintAt: null,
        dernierePrintPar: "",
        prepareAt: null,
        preparePar: "",
        commentaire: "",
      };

// Assure la présence des DBF de proformas (404 explicite sinon).
const assertProformaFiles = (entreprise, res) => {
  const check = checkProformaFiles(entreprise);
  if (!check.exists) {
    res.status(404);
    throw new Error(check.error);
  }
};

/**
 * @desc    Proformas à préparer (DBF) + statut de suivi des fiches papier.
 * @route   GET /api/preparation-manuelle/:nomDossierDBF/proformas
 * @query   page, limit, search, statut
 * @access  Private (module prep_commande_manuelle, read) + entreprise
 */
const getProformas = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();
  assertProformaFiles(entreprise, res);

  const { proformas, pagination, etatAPreparer } = await listerProformas(
    entreprise,
    {
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search,
    },
  );

  // Suivi Mongo des proformas de la page courante.
  const numfacts = proformas.map((p) => p.numfact);
  const fiches = await FichePreparation.find({
    entreprise: entreprise._id,
    numfact: { $in: numfacts },
  }).lean();
  const parNumfact = new Map(fiches.map((f) => [f.numfact, f]));

  let lignes = proformas.map((p) => ({
    ...p,
    suivi: formatSuivi(parNumfact.get(p.numfact)),
  }));

  // Filtre optionnel sur le statut de suivi (appliqué après fusion).
  const statut = safeTrim(req.query.statut);
  if (statut && FICHE_PREPARATION_STATUTS.includes(statut)) {
    lignes = lignes.filter((p) => p.suivi.statut === statut);
  }

  res.json({
    entreprise: formatEntreprise(entreprise),
    etatAPreparer,
    pagination,
    _queryTime: `${Date.now() - startTime}ms`,
    proformas: lignes,
  });
});

/**
 * @desc    Détail d'une proforma (aperçu du parcours avant impression) :
 *          lignes dock puis lignes magasin, avec la quantité à prendre.
 * @route   GET /api/preparation-manuelle/:nomDossierDBF/proformas/:numfact
 * @access  Private (module prep_commande_manuelle, read) + entreprise
 */
const getProformaDetails = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();
  assertProformaFiles(entreprise, res);

  const { entete, commentaires, lignesDock, lignesMagasin, totaux } =
    await getPreparationComplete(entreprise, req.params.numfact);
  if (!entete) {
    res.status(404);
    throw new Error("Proforma introuvable dans cette société");
  }

  const fiche = await FichePreparation.findOne({
    entreprise: entreprise._id,
    numfact: entete.numfact,
  }).lean();

  res.json({
    entreprise: formatEntreprise(entreprise),
    proforma: entete,
    commentaires,
    totaux,
    suivi: formatSuivi(fiche),
    _queryTime: `${Date.now() - startTime}ms`,
    lignesDock,
    lignesMagasin,
  });
});

/**
 * @desc    Génère la fiche de préparation PDF (à remplir à la main) et trace
 *          l'impression dans le suivi. Contrairement à la fiche de contrôle
 *          réception, les quantités à prendre Y FIGURENT : seule la colonne
 *          « CTRL » est laissée vide pour les écarts.
 * @route   POST /api/preparation-manuelle/:nomDossierDBF/proformas/:numfact/fiche-pdf
 * @access  Private (module prep_commande_manuelle, write) + entreprise
 */
const genererFiche = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  assertProformaFiles(entreprise, res);

  const { entete, commentaires, lignesDock, lignesMagasin, totaux } =
    await getPreparationComplete(entreprise, req.params.numfact);
  if (!entete) {
    res.status(404);
    throw new Error("Proforma introuvable dans cette société");
  }

  // Trace AVANT le streaming : une fois les octets partis, on ne peut plus
  // renvoyer d'erreur JSON au client.
  const nom = userNom(req.user);
  const maintenant = new Date();
  const nbLignes = lignesDock.length + lignesMagasin.length;
  await FichePreparation.findOneAndUpdate(
    { entreprise: entreprise._id, numfact: entete.numfact },
    {
      $set: {
        nomDossierDBF: entreprise.nomDossierDBF,
        statut: "imprime",
        dernierePrintAt: maintenant,
        dernierePrintPar: nom,
        proformaInfo: {
          clientNom: entete.clientNom,
          clientCode: entete.clientCode,
          vendeurCode: entete.vendeurCode,
          vendeurNom: entete.vendeurNom,
          datfact: entete.datfact,
          etat: entete.etat,
        },
      },
      $inc: { nbImpressions: 1 },
      $push: {
        impressions: {
          $each: [{ user: req.user._id, nom, at: maintenant, nbLignes }],
          $slice: -50, // on ne garde que les 50 dernières impressions
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const fileName = `fiche_preparation_${safeTrim(entete.numfact).replace(
    /[\\/:*?"<>|]/g,
    "_",
  )}_${safeTrim(entreprise.trigramme).toUpperCase() || "XXX"}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

  await genererFichePreparationPDF({
    entreprise,
    proforma: entete,
    lignesDock,
    lignesMagasin,
    commentaires,
    totaux,
    options: { editePar: nom },
    stream: res,
  });
});

/**
 * @desc    Change le statut de suivi d'une proforma (à préparer / imprimée /
 *          préparée) et son commentaire.
 * @route   PUT /api/preparation-manuelle/:nomDossierDBF/proformas/:numfact/statut
 * @body    { statut, commentaire? }
 * @access  Private (module prep_commande_manuelle, write) + entreprise
 */
const updateStatut = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const statut = safeTrim(req.body?.statut);

  if (!FICHE_PREPARATION_STATUTS.includes(statut)) {
    res.status(400);
    throw new Error(
      `Statut invalide (attendu : ${FICHE_PREPARATION_STATUTS.join(", ")})`,
    );
  }

  const numfact = safeTrim(req.params.numfact);
  const nom = userNom(req.user);
  const set = {
    nomDossierDBF: entreprise.nomDossierDBF,
    statut,
  };
  if (req.body?.commentaire !== undefined) {
    set.commentaire = safeTrim(req.body.commentaire).slice(0, 1000);
  }
  if (statut === "prepare") {
    set.prepareAt = new Date();
    set.preparePar = nom;
  } else {
    set.prepareAt = null;
    set.preparePar = "";
  }

  const fiche = await FichePreparation.findOneAndUpdate(
    { entreprise: entreprise._id, numfact },
    { $set: set },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  res.json({ numfact, suivi: formatSuivi(fiche) });
});

/**
 * @desc    Historique des fiches de préparation imprimées / préparées.
 * @route   GET /api/preparation-manuelle/:nomDossierDBF/historique
 * @access  Private (module prep_commande_manuelle, read) + entreprise
 */
const getHistorique = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 200);

  const fiches = await FichePreparation.find({ entreprise: entreprise._id })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  res.json(
    fiches.map((f) => ({
      numfact: f.numfact,
      clientNom: f.proformaInfo?.clientNom || "",
      vendeurNom: f.proformaInfo?.vendeurNom || "",
      datfact: f.proformaInfo?.datfact || null,
      updatedAt: f.updatedAt,
      derniereImpression: (f.impressions || []).slice(-1)[0] || null,
      ...formatSuivi(f),
    })),
  );
});

/**
 * @desc    Supprime le suivi d'une proforma (remise à « à préparer »).
 * @route   DELETE /api/preparation-manuelle/:nomDossierDBF/proformas/:numfact/suivi
 * @access  Private (module prep_commande_manuelle, delete) + entreprise
 */
const resetSuivi = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const numfact = safeTrim(req.params.numfact);
  await FichePreparation.deleteOne({ entreprise: entreprise._id, numfact });
  res.json({ numfact, suivi: formatSuivi(null) });
});

export {
  getProformas,
  getProformaDetails,
  genererFiche,
  updateStatut,
  getHistorique,
  resetSuivi,
};
