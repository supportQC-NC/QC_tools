// backend/controllers/preparationController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Preparation from "../models/PreparationModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import User from "../models/UserModel.js";
import articleCacheService from "../services/articleService.js";
import preparationService from "../services/preparationService.js";
import preparationReportService, {
  listerUnitesColisage,
} from "../services/preparationReportService.js";

// ===========================================
// HELPERS
// ===========================================

const safeTrim = (v) => (v == null ? "" : String(v)).trim();

const formatEntreprise = (e) => ({
  _id: e._id,
  nomDossierDBF: e.nomDossierDBF,
  trigramme: e.trigramme,
  nomComplet: e.nomComplet,
});

// Charge une session de préparation et vérifie l'accès de l'utilisateur.
const loadPreparationOwned = async (id, req, res) => {
  const prep = await Preparation.findById(id);
  if (!prep) {
    res.status(404);
    throw new Error("Préparation non trouvée");
  }
  if (
    prep.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    res.status(403);
    throw new Error("Non autorisé");
  }
  return prep;
};

// Suit la chaîne de renvois GENDOUBL (identique au scan réception).
const suivreChaineRenvois = async (entreprise, article) => {
  const MAX = 10;
  let current = article;
  let it = 0;
  while (current && it < MAX) {
    const gendoubl = current.GENDOUBL ? current.GENDOUBL.trim() : "";
    if (!gendoubl) break;
    const next = await articleCacheService.findByNart(entreprise, gendoubl);
    if (!next) break;
    current = next;
    it++;
  }
  return current;
};

// Total réellement préparé d'une ligne (dock + magasin), ou quantité retenue.
const totalPrepare = (l) =>
  l.qteRetenue != null
    ? l.qteRetenue
    : (l.qtePrepareeDock || 0) + (l.qtePrepareeMagasin || 0);

// ===========================================
// SÉLECTION DE LA PROFORMA
// ===========================================

/**
 * @desc    Liste des proformas à préparer (ETAT = 2).
 * @route   GET /api/preparations/a-preparer/:nomDossierDBF
 * @query   search, page, limit
 * @access  Private (prep_commande, read)
 */
const getProformasAPreparer = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const search = safeTrim(req.query.search);
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 100;

  const { pagination, proformas } =
    await preparationService.getProformasAPreparer(entreprise, {
      search,
      page,
      limit,
    });

  res.json({
    entreprise: formatEntreprise(entreprise),
    pagination,
    proformas,
  });
});

/**
 * @desc    Liste des réservations / commandes spéciales à préparer (ETAT < 2).
 * @route   GET /api/preparations/reservations/:nomDossierDBF
 * @query   search, page, limit
 * @access  Private (prep_commande, read)
 */
const getReservationsAPreparer = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const search = safeTrim(req.query.search);
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 100;

  const { pagination, proformas } =
    await preparationService.getReservationsAPreparer(entreprise, {
      search,
      page,
      limit,
    });

  res.json({
    entreprise: formatEntreprise(entreprise),
    pagination,
    proformas,
  });
});

// ===========================================
// SESSIONS
// ===========================================

/**
 * @desc    Créer (ou reprendre) une session de préparation pour une proforma.
 * @route   POST /api/preparations
 * @body    { entrepriseId, numpro }
 * @access  Private (prep_commande, write)
 */
const createPreparation = asyncHandler(async (req, res) => {
  const { entrepriseId, numpro } = req.body;
  if (!numpro || !safeTrim(numpro)) {
    res.status(400);
    throw new Error("Le numéro de proforma est requis");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  const numproTrim = safeTrim(numpro);

  // Reprendre la session en cours si elle existe.
  const enCours = await Preparation.findOne({
    entreprise: entrepriseId,
    user: req.user._id,
    numpro: numproTrim,
    status: "en_cours",
  });
  if (enCours) return res.json(enCours);

  // Analyse de la proforma (répartition dock/magasin + tri).
  let analyse;
  try {
    analyse = await preparationService.analyserProforma(entreprise, numproTrim);
  } catch (error) {
    res.status(error.status || 400);
    throw new Error(error.message || "Analyse de la proforma impossible");
  }

  if (!analyse.lignes || analyse.lignes.length === 0) {
    res.status(400);
    throw new Error("Proforma sans article à préparer");
  }

  // Origine : réservation si l'état de la proforma est < 2, sinon proforma.
  const etat = analyse.proformaInfo?.etat;
  const type = etat != null && etat < 2 ? "reservation" : "proforma";

  const preparation = await Preparation.create({
    entreprise: entrepriseId,
    nomDossierDBF: entreprise.nomDossierDBF,
    user: req.user._id,
    numpro: numproTrim,
    type,
    proformaInfo: analyse.proformaInfo,
    lignes: analyse.lignes,
    phase: "dock",
    status: "en_cours",
  });

  // Précharge le cache articles en arrière-plan.
  articleCacheService.preload(entreprise).catch(() => {});

  res.status(201).json(preparation);
});

/**
 * @desc    Sessions de préparation en cours pour une entreprise (user courant).
 * @route   GET /api/preparations/en-cours/:entrepriseId
 * @access  Private (prep_commande, read)
 */
const getPreparationsEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;
  const preps = await Preparation.find({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  })
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .sort({ updatedAt: -1 });
  res.json(preps);
});

/**
 * @desc    Session en cours pour une proforma précise (user courant).
 * @route   GET /api/preparations/en-cours/:entrepriseId/:numpro
 * @access  Private (prep_commande, read)
 */
const getPreparationEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId, numpro } = req.params;
  const prep = await Preparation.findOne({
    entreprise: entrepriseId,
    user: req.user._id,
    numpro: safeTrim(numpro),
    status: "en_cours",
  });
  res.json(prep);
});

/**
 * @desc    Détail d'une session par id.
 * @route   GET /api/preparations/:id
 * @access  Private (prep_commande, read)
 */
const getPreparationById = asyncHandler(async (req, res) => {
  const prep = await loadPreparationOwned(req.params.id, req, res);
  res.json(prep);
});

// ===========================================
// SCAN & CONTRÔLE GENCODE
// ===========================================

/**
 * @desc    Vérifie qu'un gencode bipé correspond bien à l'article d'une ligne
 *          (résolution GENDOUBL identique au scan). Aucune persistance.
 * @route   POST /api/preparations/:id/lignes/:ligneId/scan
 * @body    { code }
 * @access  Private (prep_commande, write)
 */
const scanControleLigne = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const prep = await loadPreparationOwned(req.params.id, req, res);
  const ligne = prep.lignes.id(req.params.ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  const entreprise = await Entreprise.findById(prep.entreprise);
  const codeTrim = safeTrim(code);

  let article = null;
  try {
    article = await articleCacheService.findByCode(entreprise, codeTrim);
  } catch {
    /* ignore */
  }

  let nartResolu = "";
  if (article) {
    const final = await suivreChaineRenvois(entreprise, article);
    nartResolu = final && final.NART ? final.NART.trim() : "";
  }

  const ok = !!nartResolu && nartResolu === safeTrim(ligne.nart);

  res.json({
    ok,
    gencodeScanne: codeTrim,
    nartAttendu: ligne.nart,
    nartResolu,
    message: ok
      ? "Gencode conforme"
      : "Ce produit ne correspond pas à l'article demandé. Merci de rechercher le bon produit.",
  });
});

// ===========================================
// PRÉPARATION D'UNE LIGNE (DOCK / MAGASIN)
// ===========================================

/**
 * @desc    Enregistre la quantité préparée d'une ligne pour une phase donnée.
 *          Dock : gère le reliquat (report du restant vers le magasin) et le
 *          cas « quantité dock dépassée » (mise à jour du magasin restant).
 * @route   POST /api/preparations/:id/lignes/:ligneId/preparer
 * @body    { phase: "dock" | "magasin", quantite, gencodeBipe, cumul? }
 * @access  Private (prep_commande, write)
 */
const preparerLigne = asyncHandler(async (req, res) => {
  const { phase, quantite, gencodeBipe, cumul } = req.body;
  const prep = await loadPreparationOwned(req.params.id, req, res);
  if (prep.status === "termine") {
    res.status(400);
    throw new Error("Cette préparation est déjà terminée");
  }

  const ligne = prep.lignes.id(req.params.ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  const q = parseInt(quantite, 10);
  if (isNaN(q) || q < 0) {
    res.status(400);
    throw new Error("Quantité invalide");
  }

  if (phase === "dock") {
    const nouveauDock = cumul ? (ligne.qtePrepareeDock || 0) + q : q;
    // Reliquat : le restant non prélevé au dock bascule vers le magasin
    // (delta > 0). Si on dépasse la quantité dock prévue (delta < 0), la
    // quantité magasin restant à préparer diminue d'autant.
    const delta = (ligne.qteDockAPreparer || 0) - nouveauDock;
    ligne.qtePrepareeDock = nouveauDock;
    ligne.gencodeBipeDock = safeTrim(gencodeBipe) || ligne.gencodeBipeDock;
    ligne.statutDock = "prepare";
    ligne.qteMagasinAPreparer = Math.max(
      0,
      (ligne.qteMagasinAPreparer || 0) + delta,
    );
  } else if (phase === "magasin") {
    const nouveauMag = cumul ? (ligne.qtePrepareeMagasin || 0) + q : q;
    ligne.qtePrepareeMagasin = nouveauMag;
    ligne.gencodeBipeMagasin = safeTrim(gencodeBipe) || ligne.gencodeBipeMagasin;
    ligne.statutMagasin = "prepare";
  } else {
    res.status(400);
    throw new Error("Phase invalide (dock | magasin)");
  }

  prep.markModified("lignes");
  await prep.save();

  res.json({ preparation: prep, ligneId: ligne._id });
});

/**
 * @desc    Marquer une ligne « non trouvée » pour une phase (réponse « Non » à
 *          la confirmation de présence). Elle ressortira au contrôle final.
 * @route   POST /api/preparations/:id/lignes/:ligneId/passer
 * @body    { phase: "dock" | "magasin" }
 * @access  Private (prep_commande, write)
 */
const passerLigne = asyncHandler(async (req, res) => {
  const { phase } = req.body;
  const prep = await loadPreparationOwned(req.params.id, req, res);
  const ligne = prep.lignes.id(req.params.ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }
  if (phase === "dock") ligne.statutDock = "introuvable";
  else if (phase === "magasin") ligne.statutMagasin = "introuvable";
  else {
    res.status(400);
    throw new Error("Phase invalide (dock | magasin)");
  }
  prep.markModified("lignes");
  await prep.save();
  res.json({ preparation: prep });
});

// ===========================================
// TRANSITIONS DE PHASE
// ===========================================

/**
 * @desc    Termine le DOCK -> passe au MAGASIN et (ré)ordonne le magasin en
 *          tenant compte des reliquats.
 * @route   POST /api/preparations/:id/terminer-dock
 * @access  Private (prep_commande, write)
 */
const terminerDock = asyncHandler(async (req, res) => {
  const prep = await loadPreparationOwned(req.params.id, req, res);
  preparationService.ordonnerMagasin(prep.lignes);
  prep.phase = "magasin";
  prep.markModified("lignes");
  await prep.save();
  res.json({ preparation: prep });
});

/**
 * @desc    Termine le MAGASIN -> passe au CONTRÔLE FINAL.
 * @route   POST /api/preparations/:id/terminer-preparation
 * @access  Private (prep_commande, write)
 */
const terminerPreparation = asyncHandler(async (req, res) => {
  const prep = await loadPreparationOwned(req.params.id, req, res);
  prep.phase = "final";
  await prep.save();
  res.json({ preparation: prep, controle: computeControleFinal(prep) });
});

// Calcule les listes du contrôle final (sous-préparés / sur-préparés).
const computeControleFinal = (prep) => {
  const sousPrepares = [];
  const surPrepares = [];
  prep.lignes.forEach((l) => {
    if (l.introuvable) return; // déjà traité comme introuvable
    const total = totalPrepare(l);
    if (total < l.qteCommandee) {
      sousPrepares.push({
        ligneId: l._id,
        nart: l.nart,
        designation: l.designation,
        refer: l.refer,
        gencod: l.gencod,
        rayon: l.rayon,
        sousRayon: l.sousRayon,
        gism1: l.gism1,
        // Emplacement DOCK aussi : au contrôle final l'opérateur choisit lui-même
        // la zone où il retourne chercher, il lui faut les deux codes.
        rayonDock: l.rayonDock,
        sousRayonDock: l.sousRayonDock,
        gism2: l.gism2,
        qteCommandee: l.qteCommandee,
        qtePrepareeDock: l.qtePrepareeDock,
        qtePrepareeMagasin: l.qtePrepareeMagasin,
        totalPrepare: total,
        manquant: l.qteCommandee - total,
        stockDock: l.stockDock,
        stockMagasin: l.stockMagasin,
      });
    } else if (total > l.qteCommandee) {
      surPrepares.push({
        ligneId: l._id,
        nart: l.nart,
        designation: l.designation,
        qteCommandee: l.qteCommandee,
        totalPrepare: total,
        surplus: total - l.qteCommandee,
      });
    }
  });
  return { sousPrepares, surPrepares };
};

/**
 * @desc    Contrôle final : lignes sous-préparées et sur-préparées.
 * @route   GET /api/preparations/:id/controle-final
 * @access  Private (prep_commande, read)
 */
const getControleFinal = asyncHandler(async (req, res) => {
  const prep = await loadPreparationOwned(req.params.id, req, res);
  res.json({ preparationId: prep._id, ...computeControleFinal(prep) });
});

/**
 * @desc    Traite une ligne au contrôle final.
 * @route   POST /api/preparations/:id/controle-final
 * @body    { ligneId, action, quantite?, gencodeBipe? }
 *          action ∈ retour_dock | retour_magasin | introuvable |
 *                   confirmer_qte | corriger_qte
 * @access  Private (prep_commande, write)
 */
const traiterControleFinal = asyncHandler(async (req, res) => {
  const { ligneId, action, quantite, gencodeBipe } = req.body;
  const prep = await loadPreparationOwned(req.params.id, req, res);
  const ligne = prep.lignes.id(ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  switch (action) {
    case "retour_dock": {
      // L'opérateur retourne chercher au dock : on cumule la quantité prélevée.
      const q = parseInt(quantite, 10);
      if (isNaN(q) || q < 0) {
        res.status(400);
        throw new Error("Quantité invalide");
      }
      ligne.qtePrepareeDock = (ligne.qtePrepareeDock || 0) + q;
      if (safeTrim(gencodeBipe)) ligne.gencodeBipeDock = safeTrim(gencodeBipe);
      ligne.statutDock = "prepare";
      ligne.introuvable = false;
      break;
    }
    case "retour_magasin": {
      const q = parseInt(quantite, 10);
      if (isNaN(q) || q < 0) {
        res.status(400);
        throw new Error("Quantité invalide");
      }
      ligne.qtePrepareeMagasin = (ligne.qtePrepareeMagasin || 0) + q;
      if (safeTrim(gencodeBipe)) ligne.gencodeBipeMagasin = safeTrim(gencodeBipe);
      ligne.statutMagasin = "prepare";
      ligne.introuvable = false;
      break;
    }
    case "introuvable": {
      ligne.introuvable = true;
      break;
    }
    case "confirmer_qte": {
      // Sur-préparation confirmée : on retient le total réellement préparé.
      ligne.qteRetenue = (ligne.qtePrepareeDock || 0) + (ligne.qtePrepareeMagasin || 0);
      break;
    }
    case "corriger_qte": {
      // Sur-préparation corrigée : la quantité retenue est celle validée.
      const q = parseInt(quantite, 10);
      if (isNaN(q) || q < 0) {
        res.status(400);
        throw new Error("Quantité invalide");
      }
      ligne.qteRetenue = q;
      break;
    }
    default:
      res.status(400);
      throw new Error("Action de contrôle final invalide");
  }

  prep.markModified("lignes");
  await prep.save();
  res.json({ preparation: prep, controle: computeControleFinal(prep) });
});

/**
 * @desc    Enregistre / met à jour le commentaire de fin de préparation.
 * @route   PUT /api/preparations/:id/commentaire
 * @body    { commentaire }
 * @access  Private (prep_commande, write)
 */
const updateCommentaire = asyncHandler(async (req, res) => {
  const prep = await loadPreparationOwned(req.params.id, req, res);
  prep.commentaire = safeTrim(req.body.commentaire);
  await prep.save();
  res.json(prep);
});

/**
 * @desc    Enregistre / met à jour le colisage (nb colis / palettes / longueurs).
 * @route   PUT /api/preparations/:id/colisage
 * @body    { nbColis, nbPalettes, nbLongueurs }
 * @access  Private (prep_commande, write)
 */
const updateColisage = asyncHandler(async (req, res) => {
  const prep = await loadPreparationOwned(req.params.id, req, res);
  const toInt = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const colisage = {
    nbColis: toInt(req.body.nbColis),
    nbPalettes: toInt(req.body.nbPalettes),
    nbLongueurs: toInt(req.body.nbLongueurs),
  };
  prep.colisage = colisage;

  // Répartition facultative : [{ ligneId, unites: [{ unite, quantite }] }].
  // Absente => on ne touche à rien (les versions déjà déployées de l'app
  // mobile n'envoient que les compteurs).
  if (Array.isArray(req.body.repartition)) {
    const unitesValides = new Set(
      listerUnitesColisage(colisage).map((u) => u.key),
    );
    // Une seule passe : on remet à zéro puis on applique, sinon une
    // répartition partiellement rejouée laisserait d'anciennes affectations.
    prep.lignes.forEach((l) => {
      l.repartitionColis = [];
    });
    for (const entree of req.body.repartition) {
      const ligne = prep.lignes.id(entree?.ligneId);
      if (!ligne) continue;
      const affectations = [];
      let cumul = 0;
      for (const u of entree.unites || []) {
        const unite = String(u?.unite || "").trim();
        const quantite = Number(u?.quantite);
        if (!unitesValides.has(unite)) {
          res.status(400);
          throw new Error(
            `Unité de colisage inconnue « ${unite} » (colisage : ${colisage.nbColis} colis, ${colisage.nbPalettes} palette(s), ${colisage.nbLongueurs} longueur(s)).`,
          );
        }
        if (!Number.isFinite(quantite) || quantite <= 0) continue;
        cumul += quantite;
        const existante = affectations.find((a) => a.unite === unite);
        if (existante) existante.quantite += quantite;
        else affectations.push({ unite, quantite });
      }
      // Garde-fou : on ne colise pas plus que ce qui a été préparé.
      const prepare =
        ligne.qteRetenue != null
          ? Number(ligne.qteRetenue)
          : Number(ligne.qtePrepareeDock || 0) +
            Number(ligne.qtePrepareeMagasin || 0);
      if (cumul - prepare > 0.001) {
        res.status(400);
        throw new Error(
          `Article ${ligne.nart} : ${cumul} coli(s)é(s) pour ${prepare} préparé(s).`,
        );
      }
      ligne.repartitionColis = affectations;
    }
    prep.markModified("lignes");
  }

  await prep.save();
  res.json(prep);
});

/**
 * @desc    Générer les sorties de fin de préparation : PDF (-> prepa_cmd) + email
 *          + fichier de transfert dock (-> collect_sec). Clôture la préparation.
 * @route   POST /api/preparations/:id/generer-rapport
 * @access  Private (prep_commande, write)
 */
const genererRapport = asyncHandler(async (req, res) => {
  const prep = await loadPreparationOwned(req.params.id, req, res);

  const entreprise = await Entreprise.findById(prep.entreprise);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  let operateur = null;
  try {
    operateur = await User.findById(prep.user).select("nom prenom");
  } catch {
    /* ignore */
  }

  if (!prep.preparationFinAt) prep.preparationFinAt = new Date();

  let sorties;
  try {
    sorties = await preparationReportService.genererSorties(
      prep,
      entreprise,
      operateur,
    );
  } catch (error) {
    res.status(400);
    throw new Error(`Génération des sorties impossible: ${error.message}`);
  }

  prep.status = "termine";
  prep.rapport = {
    fileName: sorties.rapport.fileName,
    filePath: sorties.rapport.filePath,
    generatedAt: sorties.rapport.generatedAt,
    emailTo: sorties.rapport.emailTo,
    emailSentAt: sorties.rapport.emailSentAt,
    emailError: sorties.rapport.emailError,
  };
  prep.fichierTransfert = {
    fileName: sorties.transfert.fileName || "",
    filePath: sorties.transfert.filePath || "",
    generatedAt: new Date(),
  };
  prep.feuillesColisage = (sorties.colisage?.feuilles || []).map((f) => ({
    libelle: f.libelle,
    fileName: f.fileName,
    filePath: f.filePath,
    generatedAt: f.generatedAt || new Date(),
  }));
  await prep.save();

  res.json({
    message: sorties.rapport.emailSentAt
      ? "Rapport généré et envoyé"
      : "Rapport généré (email non envoyé)",
    preparation: prep,
    rapport: sorties.rapport,
    transfert: sorties.transfert,
    colisage: sorties.colisage,
  });
});

/**
 * @desc    Supprimer / annuler une session de préparation.
 * @route   DELETE /api/preparations/:id
 * @access  Private (prep_commande, delete)
 */
const deletePreparation = asyncHandler(async (req, res) => {
  const prep = await loadPreparationOwned(req.params.id, req, res);
  await Preparation.deleteOne({ _id: prep._id });
  res.json({ message: "Préparation supprimée" });
});

export {
  // Sélection
  getProformasAPreparer,
  getReservationsAPreparer,
  // Sessions
  createPreparation,
  getPreparationsEnCours,
  getPreparationEnCours,
  getPreparationById,
  // Scan & préparation
  scanControleLigne,
  preparerLigne,
  passerLigne,
  // Phases
  terminerDock,
  terminerPreparation,
  getControleFinal,
  traiterControleFinal,
  // Commentaire / colisage / suppression
  updateCommentaire,
  updateColisage,
  genererRapport,
  deletePreparation,
};