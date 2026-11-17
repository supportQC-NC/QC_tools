// backend/controllers/preparationController.js
import asyncHandler from "../middleware/asyncHandler.js";
import Preparation from "../models/PreparationModel.js";
import PreparationUrgence from "../models/PreparationUrgenceModel.js";
import FichePreparation from "../models/FichePreparationModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import User from "../models/UserModel.js";
import articleCacheService from "../services/articleService.js";
import preparationService from "../services/preparationService.js";
import { memeNart, memeCodeBarres } from "../utils/codeBarres.js";

// Quantités à 3 décimales (articles vendus au mètre), jamais arrondies à
// l'unité. NaN est conservé pour les gardes « quantité invalide » (l'ancien
// parseInt). Le .dat, lui, reste en entiers (format Stock XL figé).
const parseQte = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : NaN;
};
import preparationReportService from "../services/preparationReportService.js";

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
// `toutStatut` : les écrans de CONSULTATION et la suppression acceptent une
// session abandonnée ; les ACTIONS de préparation (défaut) la refusent — sans
// ce garde-fou, un collecteur resté ouvert sur une session reprise par un
// autre agent continuerait d'y écrire des lignes fantômes.
const loadPreparationOwned = async (id, req, res, { toutStatut = false } = {}) => {
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
  if (!toutStatut && prep.status === "abandonne") {
    res.status(409);
    throw new Error(
      "Cette préparation a été reprise ou clôturée par ailleurs — elle n'est plus modifiable. Repartez de la liste des commandes.",
    );
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
 * Retire les commandes DÉJÀ PRÉPARÉES (demande client du 17/11/2026) : une
 * préparation scannée TERMINÉE ou une fiche papier marquée « préparée » depuis
 * le web. L'ERP ne change pas l'ETAT de la proforma quand on la prépare ici :
 * sans ce filtre, une commande préparée restait proposée « à préparer » pour
 * toujours — sur le panneau priorité du suivi web comme sur l'app mobile.
 * La saisie directe d'un numéro sur le collecteur reste possible (elle ne
 * passe pas par cette liste) si une commande devait être re-préparée.
 */
const exclureDejaPreparees = async (entreprise, proformas) => {
  if (!proformas.length) return proformas;
  const numeros = proformas.map((p) => safeTrim(p.numfact)).filter(Boolean);
  const [terminees, fiches] = await Promise.all([
    Preparation.find({
      entreprise: entreprise._id,
      numpro: { $in: numeros },
      status: "termine",
    })
      .select("numpro")
      .lean(),
    FichePreparation.find({
      entreprise: entreprise._id,
      numfact: { $in: numeros },
      statut: "prepare",
    })
      .select("numfact")
      .lean(),
  ]);
  const preparees = new Set([
    ...terminees.map((p) => safeTrim(p.numpro)),
    ...fiches.map((f) => safeTrim(f.numfact)),
  ]);
  if (!preparees.size) return proformas;
  return proformas.filter((p) => !preparees.has(safeTrim(p.numfact)));
};

/**
 * Marque les proformas URGENTES (drapeau posé depuis le suivi web, modèle
 * PreparationUrgence) et les remonte EN TÊTE de liste — l'ordre relatif du
 * reste ne change pas. L'app mobile les affiche en rouge.
 */
const marquerUrgences = async (entreprise, proformas) => {
  const urgences = await PreparationUrgence.find({
    entreprise: entreprise._id,
  })
    .select("numpro parNom createdAt")
    .lean();
  if (!urgences.length) {
    return proformas.map((p) => ({ ...p, urgent: false }));
  }
  const parNumpro = new Map(urgences.map((u) => [safeTrim(u.numpro), u]));
  const marquees = proformas.map((p) => {
    const u = parNumpro.get(safeTrim(p.numfact));
    return {
      ...p,
      urgent: !!u,
      urgentParNom: u?.parNom || "",
      urgentAt: u?.createdAt || null,
    };
  });
  // Tri STABLE : urgentes d'abord, chacune des deux moitiés dans son ordre.
  return [
    ...marquees.filter((p) => p.urgent),
    ...marquees.filter((p) => !p.urgent),
  ];
};

/**
 * @desc    Liste des proformas à préparer (ETAT = 2). Les commandes marquées
 *          URGENTES sortent en tête, avec `urgent: true`.
 * @route   GET /api/preparations/a-preparer/:nomDossierDBF
 * @query   search, page, limit
 * @access  Private (prep_commande ou prep_commande_manuelle, read)
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

  const restantes = await exclureDejaPreparees(entreprise, proformas);
  res.json({
    entreprise: formatEntreprise(entreprise),
    pagination,
    proformas: await marquerUrgences(entreprise, restantes),
  });
});

/**
 * @desc    Liste des réservations / commandes spéciales à préparer (ETAT < 2).
 *          Même marquage d'urgence que les proformas.
 * @route   GET /api/preparations/reservations/:nomDossierDBF
 * @query   search, page, limit
 * @access  Private (prep_commande ou prep_commande_manuelle, read)
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

  const restantes = await exclureDejaPreparees(entreprise, proformas);
  res.json({
    entreprise: formatEntreprise(entreprise),
    pagination,
    proformas: await marquerUrgences(entreprise, restantes),
  });
});

/**
 * @desc    Poser / lever l'URGENCE d'une commande à préparer (17/11/2026).
 *          Menu déroulant de l'écran web « Suivi des préparations » : une
 *          commande urgente sort EN TÊTE et EN ROUGE sur l'app mobile.
 *          Présence du document = urgente ; repasser en « normale » le
 *          supprime.
 * @route   PUT /api/preparations/urgence/:entrepriseId
 * @body    { numpro, urgent }
 * @access  Private (prep_commande ou prep_commande_manuelle, write)
 */
const setUrgencePreparation = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const numpro = safeTrim(req.body.numpro);
  const urgent = !!req.body.urgent;
  if (!numpro) {
    res.status(400);
    throw new Error("Numéro de commande requis.");
  }

  if (urgent) {
    await PreparationUrgence.findOneAndUpdate(
      { entreprise: entreprise._id, numpro },
      {
        $set: {
          par: req.user._id,
          parNom:
            [req.user.prenom, req.user.nom].filter(Boolean).join(" ") ||
            req.user.email ||
            "",
        },
      },
      { upsert: true },
    );
  } else {
    await PreparationUrgence.deleteOne({
      entreprise: entreprise._id,
      numpro,
    });
  }

  res.json({ numpro, urgent });
});

// ===========================================
// SESSIONS
// ===========================================

// Une session « en cours » sans la moindre activité depuis ce délai est
// considérée ABANDONNÉE : un autre agent peut reprendre la commande (l'ancienne
// session passe en statut abandonne). En dessous, la commande est VERROUILLÉE
// par son porteur — deux agents ne préparent jamais la même commande en même
// temps.
const INACTIVITE_REPRISE_MS = 30 * 60 * 1000;

/**
 * @desc    Créer (ou reprendre) une session de préparation pour une proforma.
 *          UNE SEULE session en cours par commande (17/11/2026) : la sienne
 *          est reprise ; celle d'un autre agent bloque (409) tant qu'elle est
 *          active, et n'est reprise qu'après 30 min d'inactivité. Un index
 *          unique partiel barre les créations en rafale (double-tap/retry),
 *          qui créaient jusqu'à 6 sessions identiques la même seconde.
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

  // Session en cours sur cette commande — QUEL QUE SOIT l'agent.
  const enCours = await Preparation.findOne({
    entreprise: entrepriseId,
    numpro: numproTrim,
    status: "en_cours",
  }).populate("user", "nom prenom email");
  if (enCours) {
    const memeUser = String(enCours.user?._id ?? enCours.user) === String(req.user._id);
    if (memeUser) return res.json(enCours);

    const inactiveDepuis = Date.now() - new Date(enCours.updatedAt).getTime();
    if (inactiveDepuis < INACTIVITE_REPRISE_MS) {
      const porteur =
        `${safeTrim(enCours.user?.prenom)} ${safeTrim(enCours.user?.nom)}`.trim() ||
        enCours.user?.email ||
        "un autre agent";
      res.status(409);
      throw new Error(
        `Commande déjà en cours de préparation par ${porteur}. Elle sera reprenable après 30 min sans activité.`,
      );
    }
    // Session inactive : l'autre agent l'a visiblement abandonnée — elle est
    // fermée et la préparation REPART DE ZÉRO pour le nouvel agent.
    enCours.status = "abandonne";
    enCours.abandonAt = new Date();
    enCours.abandonMotif = `Reprise par ${
      `${safeTrim(req.user.prenom)} ${safeTrim(req.user.nom)}`.trim() ||
      req.user.email ||
      "un autre agent"
    } après inactivité`;
    await enCours.save();
  }

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

  let preparation;
  try {
    preparation = await Preparation.create({
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
  } catch (error) {
    // RAFALE (double-tap / retry réseau) : l'index unique partiel n'a laissé
    // passer qu'une création, les autres requêtes atterrissent ici. On renvoie
    // la session gagnante — c'est forcément « la sienne » si elle vient d'être
    // créée par la requête jumelle.
    if (error?.code === 11000) {
      const gagnante = await Preparation.findOne({
        entreprise: entrepriseId,
        numpro: numproTrim,
        status: "en_cours",
      });
      if (gagnante && String(gagnante.user) === String(req.user._id)) {
        return res.json(gagnante);
      }
      res.status(409);
      throw new Error("Commande déjà en cours de préparation par un autre agent.");
    }
    throw error;
  }

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
  const prep = await loadPreparationOwned(req.params.id, req, res, {
    toutStatut: true,
  });
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

  // Comparaison tolérante aux écritures du NART : la ligne vient de la
  // proforma, le NART résolu d'article.dbf ; « 012345 » et « 12345 »
  // désignent le même article et ne doivent pas déclencher un refus.
  const ok = !!nartResolu && memeNart(nartResolu, ligne.nart);

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

  const q = parseQte(quantite);
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
      const q = parseQte(quantite);
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
      const q = parseQte(quantite);
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
      const q = parseQte(quantite);
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
 * @desc    Enregistre / met à jour le colisage : le NOMBRE de colis, palettes
 *          et longueurs qui partent. Rien d'autre — la répartition article par
 *          article et les feuilles de colisage ont été retirées (décision
 *          client du 09/09/2026).
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

  // ── IDEMPOTENCE (17/11/2026) : constaté en production, le rapport ET le
  // mail commercial partaient EN DOUBLE — la route est rappelée (re-tap, ou
  // retry de l'app quand la génération dépasse son timeout : PDF + 2 emails +
  // dépôts FTP) et rien n'empêchait de tout régénérer et tout réexpédier. Le
  // second envoi pouvait en plus viser un AUTRE commercial, le REPRES de la
  // proforma ayant bougé dans l'ERP entre-temps. Un rapport déjà généré est
  // donc RENVOYÉ tel quel : aucun email ne repart, le commercial reste celui
  // du premier envoi.
  const dejaGenere = (p) =>
    res.json({
      message: "Rapport déjà généré — aucun nouvel envoi.",
      preparation: p,
      rapport: p.rapport,
      transfert: p.fichierTransfert,
      colisage: null,
      dejaGenere: true,
    });
  if (prep.status === "termine" && prep.rapport?.generatedAt) {
    return dejaGenere(prep);
  }

  // VERROU anti-appels SIMULTANÉS : un seul appel gagne le droit de générer
  // (bascule ATOMIQUE en_cours → termine) ; l'appel jumeau arrivé pendant la
  // génération est rejeté proprement au lieu de doubler les envois.
  const gagne = await Preparation.findOneAndUpdate(
    { _id: prep._id, status: "en_cours" },
    { $set: { status: "termine" } },
  );
  if (!gagne) {
    const actuel = await Preparation.findById(prep._id);
    if (actuel?.status === "termine" && actuel?.rapport?.generatedAt) {
      return dejaGenere(actuel);
    }
    res.status(409);
    throw new Error(
      "La génération du rapport est déjà en cours pour cette préparation.",
    );
  }

  const entreprise = await Entreprise.findById(prep.entreprise);
  if (!entreprise) {
    // Verrou rendu : la préparation redevient clôturable.
    await Preparation.updateOne(
      { _id: prep._id },
      { $set: { status: "en_cours" } },
    ).catch(() => {});
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
    // Échec AVANT toute sortie : on rend le verrou pour permettre un nouvel
    // essai — sans ça la préparation resterait « terminée » sans rapport.
    await Preparation.updateOne(
      { _id: prep._id },
      { $set: { status: "en_cours" } },
    ).catch(() => {});
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
    // Trace de l'email « commande prête » au commercial de la proforma.
    emailCommercial: sorties.rapport.emailCommercial,
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

  // ── NETTOYAGE À LA CLÔTURE (17/11/2026) : la commande est PRÉPARÉE, rien
  // d'autre ne doit rester « en cours » pour elle au suivi. ──
  // 1) Les AUTRES sessions en_cours du même numpro (doublons de rafale,
  //    sessions abandonnées) passent « abandonne ».
  const nomOperateur = operateur
    ? `${safeTrim(operateur.prenom)} ${safeTrim(operateur.nom)}`.trim()
    : "";
  await Preparation.updateMany(
    {
      entreprise: prep.entreprise,
      numpro: prep.numpro,
      status: "en_cours",
      _id: { $ne: prep._id },
    },
    {
      $set: {
        status: "abandonne",
        abandonAt: new Date(),
        abandonMotif: `Commande préparée par ailleurs${
          nomOperateur ? ` (${nomOperateur})` : ""
        }`,
      },
    },
  ).catch(() => {});
  // 2) Une FICHE PAPIER imprimée pour la même commande est soldée : la
  //    préparation a été faite au collecteur, laisser la fiche « en cours »
  //    ferait sortir la commande en double (préparée + en cours).
  await FichePreparation.updateOne(
    {
      entreprise: prep.entreprise,
      numfact: prep.numpro,
      statut: { $ne: "prepare" },
    },
    {
      $set: {
        statut: "prepare",
        prepareAt: new Date(),
        preparePar: `Collecteur${nomOperateur ? ` — ${nomOperateur}` : ""}`,
      },
    },
  ).catch(() => {});
  // 3) Le drapeau d'URGENCE n'a plus d'objet : la commande quitte la liste
  //    « à préparer » (exclureDejaPreparees), on ne laisse pas traîner le doc.
  await PreparationUrgence.deleteOne({
    entreprise: prep.entreprise,
    numpro: prep.numpro,
  }).catch(() => {});

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
  const prep = await loadPreparationOwned(req.params.id, req, res, {
    toutStatut: true,
  });
  await Preparation.deleteOne({ _id: prep._id });
  res.json({ message: "Préparation supprimée" });
});

export {
  // Sélection
  getProformasAPreparer,
  getReservationsAPreparer,
  setUrgencePreparation,
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