// backend/controllers/demandeReapproController.js
import asyncHandler from "../middleware/asyncHandler.js";
import DemandeReappro from "../models/DemandeReapproModel.js";
import {
  getMagasinArticlesByGisements,
  resolveArticleForReappro,
} from "../services/analyseReapproService.js";
import { getAccessibleEntreprises } from "../middleware/accessControl.js";
import Entreprise from "../models/EntrepriseModel.js";
import articleCacheService from "../services/articleService.js";
import { ecrireTransfertMagasin } from "../services/demandeReapproTransfertService.js";
import { importerProformasReappro } from "../services/reapproProformaImportService.js";

const ACTIF = ["en_attente", "en_cours"];

// Les listes de plus de 15 jours ne sont plus affichées (CDC §1). Constante de
// code volontairement : aucun paramétrage .env / société sur ce lot.
const FENETRE_JOURS_DEFAUT = 15;

const PRIORITES = ["urgent", "a_faire", "normal"];

// Nommage du fichier de transfert .dat (le contenu, lui, ne change jamais).
const NOMMAGES = ["gisement", "proforma", "libre"];

const nomUtilisateur = (u) =>
  [u?.prenom, u?.nom].filter(Boolean).join(" ") || u?.email || "Utilisateur";

// Date plancher d'affichage (null = pas de filtre).
const dateDepuis = (jours) => {
  if (!jours || jours <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() - jours);
  d.setHours(0, 0, 0, 0);
  return d;
};

// @desc    Créer des demandes de réappro MAGASIN pour un ou plusieurs gisements
// @route   POST /api/demande-reappro/:nomDossierDBF
// @access  Private — module analyse_reappro_admin (write) + accès entreprise
// Body : { gisements: string[], priorite?: "urgent"|"a_faire"|"normal", commentaire? }
// Une demande est créée PAR gisement. Un gisement ayant déjà une demande ACTIVE
// est ignoré (anti-doublon) et remonté dans "ignores".
const createDemandes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise || {
    nomDossierDBF: req.params.nomDossierDBF,
  };
  const key = entreprise.nomDossierDBF;

  const gisements = Array.isArray(req.body.gisements) ? req.body.gisements : [];
  const priorite = ["urgent", "a_faire", "normal"].includes(req.body.priorite)
    ? req.body.priorite
    : "a_faire";
  const commentaire = String(req.body.commentaire || "").slice(0, 500);

  if (gisements.length === 0) {
    res.status(400);
    throw new Error("Aucun gisement sélectionné.");
  }

  // Gisements déjà couverts par une demande active -> ignorés.
  const dejaActifs = await DemandeReappro.find({
    entreprise: key,
    type: "magasin",
    gisement: { $in: gisements },
    statut: { $in: ACTIF },
  }).select("gisement");
  const bloques = new Set(dejaActifs.map((d) => d.gisement));

  const aTraiter = gisements.filter((g) => !bloques.has(g));
  const ignores = [...bloques];

  const crees = [];
  if (aTraiter.length > 0) {
    // On récupère tous les articles magasin de ces gisements en une passe.
    const articles = await getMagasinArticlesByGisements(entreprise, aTraiter);
    const parGisement = new Map();
    articles.forEach((a) => {
      const g = a.gisement || "(sans gisement)";
      if (!parGisement.has(g)) parGisement.set(g, []);
      parGisement.get(g).push(a);
    });

    for (const g of aTraiter) {
      const arts = parGisement.get(g) || [];
      if (arts.length === 0) continue; // plus rien à réassortir sur ce gisement
      // eslint-disable-next-line no-await-in-loop
      const d = new DemandeReappro({
        entreprise: key,
        type: "magasin",
        gisement: g,
        nom: `Réappro ${g}`,
        rayon: g === "(sans gisement)" ? "" : g,
        source: "manuel",
        priorite,
        statut: "en_attente",
        articles: arts,
        commentaire,
        createdBy: req.user?._id,
        createdByNom: nomUtilisateur(req.user),
      });
      d.calculerTotaux();
      // eslint-disable-next-line no-await-in-loop
      await d.save();
      crees.push(d);
    }
  }

  res.status(201).json({
    crees: crees.length,
    ignores, // gisements déjà en demande active
    demandes: crees,
  });
});

// @desc    Liste des listes de réappro d'une entreprise
// @route   GET /api/demande-reappro/:nomDossierDBF
// @access  Private — module demande_reappro (read) + accès entreprise
// Query : statut? ("en_attente"|"en_cours"|"realisee"|"actif")
//         jours? (fenêtre d'affichage, défaut 15 ; 0 = tout l'historique)
const getDemandes = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise || {
    nomDossierDBF: req.params.nomDossierDBF,
  };
  const filter = { entreprise: entreprise.nomDossierDBF, type: "magasin" };

  if (req.query.statut === "actif") filter.statut = { $in: ACTIF };
  else if (
    ["en_attente", "en_cours", "realisee"].includes(req.query.statut)
  ) {
    filter.statut = req.query.statut;
  }

  // Fenêtre glissante : au-delà, les listes sont masquées (pas supprimées).
  const jours =
    req.query.jours === undefined
      ? FENETRE_JOURS_DEFAUT
      : parseInt(req.query.jours, 10) || 0;
  const depuis = dateDepuis(jours);
  if (depuis) filter.createdAt = { $gte: depuis };

  // On ne renvoie pas le détail des articles ici (allège la liste).
  const demandes = await DemandeReappro.find(filter)
    .select("-articles")
    .sort({ createdAt: -1 })
    .limit(500);

  res.json(demandes);
});

// @desc    Lancer tout de suite l'import des proformas « reappro » d'une société
// @route   POST /api/demande-reappro/:nomDossierDBF/import-proformas
// @access  Private — module demande_reappro (write) + accès entreprise
// Le job tourne déjà toutes les heures ; ce bouton évite d'attendre.
const importerProformas = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }
  const resultat = await importerProformasReappro(entreprise);
  res.json(resultat);
});

// @desc    Statistiques de préparation par opérateur (CDC §1)
// @route   GET /api/demande-reappro/:nomDossierDBF/stats
// @query   debut, fin (AAAA-MM-JJ) — défaut : 30 derniers jours
// @access  Private — module demande_reappro (read) + accès entreprise
//
// Deux durées, volontairement affichées côte à côte :
//  - tempsActif : somme des intervalles entre lignes validées, pauses de plus
//    de 5 min exclues (`PAUSE_MS`) — c'est le « temps de réappro effectif » ;
//  - tempsBrut  : fin - ouverture de la liste, pauses comprises.
// Les listes préparées avant l'horodatage par ligne n'ont pas de temps actif :
// elles sont comptées à part (`listesSansTemps`) plutôt que faussées à 0.
const getStatsPreparateurs = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise || {
    nomDossierDBF: req.params.nomDossierDBF,
  };

  const fin = req.query.fin ? new Date(req.query.fin) : new Date();
  fin.setHours(23, 59, 59, 999);
  const debut = req.query.debut
    ? new Date(req.query.debut)
    : dateDepuis(30) || new Date(0);
  debut.setHours(0, 0, 0, 0);

  const listes = await DemandeReappro.find({
    entreprise: entreprise.nomDossierDBF,
    statut: "realisee",
    realisedAt: { $gte: debut, $lte: fin },
  }).lean();

  const parOperateur = new Map();
  for (const l of listes) {
    const nom = l.operateur?.nom || l.realisedByNom || "Inconnu";
    const cle = l.operateur?.user?.toString() || l.realisedBy?.toString() || nom;

    if (!parOperateur.has(cle)) {
      parOperateur.set(cle, {
        operateur: nom,
        nbListes: 0,
        nbLignes: 0,
        nbPrises: 0,
        nbIntrouvables: 0,
        unites: 0,
        tempsActifMs: 0,
        tempsBrutMs: 0,
        listesSansTemps: 0,
      });
    }
    const s = parOperateur.get(cle);

    const traitees = (l.articles || []).filter(
      (a) => (a.statutLigne || "a_faire") !== "a_faire",
    );
    s.nbListes += 1;
    s.nbLignes += traitees.length;
    s.nbPrises += traitees.filter((a) => a.statutLigne === "prise").length;
    s.nbIntrouvables += traitees.filter(
      (a) => a.statutLigne === "introuvable",
    ).length;
    s.unites += traitees.reduce((t, a) => t + (Number(a.quantitePrise) || 0), 0);
    s.tempsActifMs += Number(l.tempsActifMs) || 0;
    if (!Number(l.tempsActifMs)) s.listesSansTemps += 1;

    const ouverture = l.operateur?.debutAt || l.createdAt;
    const brut = l.realisedAt && ouverture
      ? new Date(l.realisedAt) - new Date(ouverture)
      : 0;
    if (brut > 0) s.tempsBrutMs += brut;
  }

  const operateurs = [...parOperateur.values()]
    .map((s) => ({
      ...s,
      tempsMoyenLigneMs: s.nbLignes > 0 ? Math.round(s.tempsActifMs / s.nbLignes) : 0,
    }))
    .sort((a, b) => b.nbLignes - a.nbLignes);

  const totaux = operateurs.reduce(
    (t, s) => ({
      nbListes: t.nbListes + s.nbListes,
      nbLignes: t.nbLignes + s.nbLignes,
      nbPrises: t.nbPrises + s.nbPrises,
      nbIntrouvables: t.nbIntrouvables + s.nbIntrouvables,
      unites: t.unites + s.unites,
      tempsActifMs: t.tempsActifMs + s.tempsActifMs,
      tempsBrutMs: t.tempsBrutMs + s.tempsBrutMs,
      listesSansTemps: t.listesSansTemps + s.listesSansTemps,
    }),
    {
      nbListes: 0, nbLignes: 0, nbPrises: 0, nbIntrouvables: 0,
      unites: 0, tempsActifMs: 0, tempsBrutMs: 0, listesSansTemps: 0,
    },
  );
  totaux.tempsMoyenLigneMs =
    totaux.nbLignes > 0 ? Math.round(totaux.tempsActifMs / totaux.nbLignes) : 0;

  res.json({
    periode: { debut, fin },
    operateurs,
    totaux,
    seuilPauseMs: PAUSE_MS,
  });
});

// @desc    Changer l'urgence d'une liste (ex. pas faite depuis 1 semaine)
// @route   PATCH /api/demande-reappro/:id/urgence
// @access  Private — module demande_reappro (write)
// Body : { priorite: "urgent"|"a_faire"|"normal" }
const updateUrgence = asyncHandler(async (req, res) => {
  const { priorite } = req.body;
  if (!PRIORITES.includes(priorite)) {
    res.status(400);
    throw new Error("Urgence invalide.");
  }

  const d = await DemandeReappro.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Liste introuvable");
  }
  if (d.statut === "realisee") {
    res.status(400);
    throw new Error("Cette liste est terminée : son urgence n'a plus d'objet.");
  }

  if (d.priorite !== priorite) {
    d.historiqueUrgence.push({
      de: d.priorite,
      vers: priorite,
      par: req.user?._id,
      parNom: nomUtilisateur(req.user),
    });
    d.priorite = priorite;
    await d.save();
  }
  res.json(d);
});

// @desc    Modifier l'entête d'une liste (nom, rayon, observation)
// @route   PATCH /api/demande-reappro/:id
// @access  Private — module demande_reappro (write)
// Modifiable tant que la préparation n'a pas commencé.
const updateDemande = asyncHandler(async (req, res) => {
  const d = await DemandeReappro.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Liste introuvable");
  }
  if (d.statut !== "en_attente") {
    res.status(400);
    throw new Error(
      "Cette liste est en cours ou terminée : elle n'est plus modifiable.",
    );
  }

  if (req.body.nom !== undefined) d.nom = String(req.body.nom).slice(0, 120);
  if (req.body.rayon !== undefined)
    d.rayon = String(req.body.rayon).slice(0, 80);
  if (req.body.commentaire !== undefined)
    d.commentaire = String(req.body.commentaire).slice(0, 500);
  if (NOMMAGES.includes(req.body.nommageTransfert))
    d.nommageTransfert = req.body.nommageTransfert;
  if (req.body.nomTransfertLibre !== undefined)
    d.nomTransfertLibre = String(req.body.nomTransfertLibre).slice(0, 60);

  await d.save();
  res.json(d);
});

// @desc    Détail d'une demande (avec ses articles)
// @route   GET /api/demande-reappro/detail/:id
// @access  Private
const getDemandeById = asyncHandler(async (req, res) => {
  const d = await DemandeReappro.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Demande introuvable");
  }
  res.json(d);
});

// @desc    Supprimer une demande (annulation depuis le web)
// @route   DELETE /api/demande-reappro/:id
// @access  Private — module analyse_reappro_admin (delete)
const deleteDemande = asyncHandler(async (req, res) => {
  const d = await DemandeReappro.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Demande introuvable");
  }
  await d.deleteOne();
  res.json({ ok: true });
});

// @desc    Résout un NART (saisie manuelle) -> article + stock par entrepôt
// @route   GET /api/demande-reappro/:nomDossierDBF/article/:nart
// @access  Private — module analyse_reappro_admin (read) + accès entreprise
const getArticleReappro = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise || {
    nomDossierDBF: req.params.nomDossierDBF,
  };
  const art = await resolveArticleForReappro(entreprise, req.params.nart);
  if (!art) {
    res.status(404);
    throw new Error("Article introuvable (NART inconnu).");
  }
  res.json(art);
});

// @desc    Crée UNE liste de réappro à partir d'un panier d'articles + quantités
// @route   POST /api/demande-reappro/:nomDossierDBF/panier
// @access  Private — module demande_reappro (write) + accès entreprise
// Body : { articles: [{ nart, quantite }], nom?, rayon?, priorite?, commentaire? }
// Le code de chaque ligne peut être un NART, un gencode ou une référence
// fournisseur. La quantité N'EST PAS bornée au stock (CDC §4 : on demande la
// quantité voulue, la disponibilité n'est pas contrôlée), le stock reste
// affiché à titre indicatif.
const createDemandePanier = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise || {
    nomDossierDBF: req.params.nomDossierDBF,
  };
  const key = entreprise.nomDossierDBF;
  const priorite = PRIORITES.includes(req.body.priorite)
    ? req.body.priorite
    : "a_faire";
  const commentaire = String(req.body.commentaire || "").slice(0, 500);
  const nom = String(req.body.nom || "").slice(0, 120).trim();
  const rayon = String(req.body.rayon || "").slice(0, 80).trim();
  const items = Array.isArray(req.body.articles) ? req.body.articles : [];
  if (items.length === 0) {
    res.status(400);
    throw new Error("Panier vide.");
  }

  const articles = [];
  const gisements = new Set();
  const inconnus = [];
  for (const it of items) {
    // eslint-disable-next-line no-await-in-loop
    const art = await resolveArticleForReappro(entreprise, it.nart);
    if (!art) {
      inconnus.push(String(it.nart || "").trim());
      continue; // code inconnu -> ignoré, remonté à l'appelant
    }
    const q = Math.round(Number(it.quantite) || 0);
    if (q <= 0) continue;
    gisements.add(art.gisement);
    articles.push({
      nart: art.nart,
      design: art.design,
      fourn: art.fourn,
      fournNom: art.fournNom,
      gencod: art.gencod,
      refer: art.refer,
      s1: art.s1, s2: art.s2, s3: art.s3, s4: art.s4, s5: art.s5,
      stock: art.stock,
      quantiteDemandee: q,
      vteMoyMois: art.vteMoyMois,
    });
  }
  if (articles.length === 0) {
    res.status(400);
    throw new Error("Aucun article valide (code inconnu ou quantité nulle).");
  }

  const gisList = [...gisements].filter(Boolean);
  const gisementLabel =
    gisList.length === 1 ? gisList[0] : gisList.length > 1 ? "Multi-gisements" : "Manuelle";

  const demande = new DemandeReappro({
    entreprise: key,
    type: "magasin",
    gisement: gisementLabel,
    nom: nom || `Réappro du ${new Date().toLocaleDateString("fr-FR")}`,
    rayon,
    source: "manuel",
    priorite,
    statut: "en_attente",
    articles,
    commentaire,
    nommageTransfert: NOMMAGES.includes(req.body.nommageTransfert)
      ? req.body.nommageTransfert
      : "gisement",
    nomTransfertLibre: String(req.body.nomTransfertLibre || "").slice(0, 60),
    createdBy: req.user?._id,
    createdByNom: nomUtilisateur(req.user),
  });
  demande.calculerTotaux();
  await demande.save();

  res.status(201).json({ crees: 1, demande, inconnus });
});

const PRIO_RANK = { urgent: 0, a_faire: 1, normal: 2 };

// Au-delà de ce silence entre deux lignes, on considère que l'opérateur a fait
// autre chose : l'intervalle n'entre pas dans le « temps de réappro effectif ».
const PAUSE_MS = 5 * 60 * 1000;

const cleanCode = (v) => String(v ?? "").trim().toUpperCase();

// Dossiers DBF auxquels l'utilisateur a droit (null = tous).
const dossiersAutorises = async (user) => {
  const scope = await getAccessibleEntreprises(user);
  if (scope.all) return null;
  const ents = await Entreprise.find({ _id: { $in: scope.ids } }).select(
    "nomDossierDBF",
  );
  return new Set(ents.map((e) => e.nomDossierDBF));
};

// Charge une liste pour le collecteur en vérifiant l'accès société.
const chargerListeMobile = async (req, res) => {
  const d = await DemandeReappro.findById(req.params.id);
  if (!d) {
    res.status(404);
    throw new Error("Liste introuvable");
  }
  const autorises = await dossiersAutorises(req.user);
  if (autorises && !autorises.has(d.entreprise)) {
    res.status(403);
    throw new Error("Vous n'avez pas accès à cette société");
  }
  return d;
};

// Verrou : une liste ouverte appartient à son opérateur jusqu'à la fin.
const verrouAutreOperateur = (d, user) =>
  d.statut === "en_cours" &&
  d.operateur?.user &&
  d.operateur.user.toString() !== user._id.toString();

// Comptabilise le temps ACTIF depuis la dernière validation de ligne.
const cumulerTempsActif = (d) => {
  const now = Date.now();
  const ref = d.derniereActiviteAt ? new Date(d.derniereActiviteAt).getTime() : null;
  if (ref) {
    const delta = now - ref;
    if (delta > 0 && delta <= PAUSE_MS) d.tempsActifMs += delta;
  }
  d.derniereActiviteAt = new Date(now);
};

// @desc    (MOBILE) Listes à préparer pour les sociétés de l'opérateur
// @route   GET /api/demande-reappro/mobile/list
// @access  Private — module demande_reappro (read)
// Triées par urgence (urgent d'abord) puis date croissante (CDC §4). Articles
// inclus. On masque les listes VERROUILLÉES par quelqu'un d'autre et celles de
// plus de 15 jours.
const getMobileDemandes = asyncHandler(async (req, res) => {
  const filter = {
    type: "magasin",
    statut: { $in: ACTIF },
    createdAt: { $gte: dateDepuis(FENETRE_JOURS_DEFAUT) },
  };
  const autorises = await dossiersAutorises(req.user);
  if (autorises) filter.entreprise = { $in: [...autorises] };

  const demandes = await DemandeReappro.find(filter).limit(200).lean();
  const moi = req.user._id.toString();
  const visibles = demandes.filter(
    (d) =>
      d.statut !== "en_cours" ||
      !d.operateur?.user ||
      d.operateur.user.toString() === moi,
  );
  visibles.sort(
    (a, b) =>
      (PRIO_RANK[a.priorite] ?? 9) - (PRIO_RANK[b.priorite] ?? 9) ||
      new Date(a.createdAt) - new Date(b.createdAt),
  );
  res.json(visibles);
});

// @desc    (MOBILE) Ouvrir une liste : pose le verrou et passe « en cours »
// @route   POST /api/demande-reappro/mobile/:id/ouvrir
// @access  Private — module demande_reappro (write)
const ouvrirDemande = asyncHandler(async (req, res) => {
  const d = await chargerListeMobile(req, res);
  if (d.statut === "realisee") {
    res.status(400);
    throw new Error("Cette liste est déjà terminée");
  }
  if (verrouAutreOperateur(d, req.user)) {
    res.status(409);
    throw new Error(`Liste en cours de préparation par ${d.operateur.nom}`);
  }

  if (d.statut !== "en_cours") {
    d.statut = "en_cours";
    d.operateur = {
      user: req.user._id,
      nom: nomUtilisateur(req.user),
      debutAt: new Date(),
    };
    d.derniereActiviteAt = new Date();
    await d.save();
  }
  res.json(d);
});

// @desc    (MOBILE) Rendre une liste (quitte sans terminer, libère le verrou)
// @route   POST /api/demande-reappro/mobile/:id/liberer
// @access  Private — module demande_reappro (write)
// L'avancement déjà saisi est conservé ; seul le porteur du verrou (ou un
// admin) peut rendre la liste.
const libererDemande = asyncHandler(async (req, res) => {
  const d = await chargerListeMobile(req, res);
  if (d.statut !== "en_cours") {
    res.json(d);
    return;
  }
  if (verrouAutreOperateur(d, req.user) && req.user.role !== "admin") {
    res.status(403);
    throw new Error("Cette liste est verrouillée par un autre opérateur");
  }
  d.statut = "en_attente";
  d.operateur = { user: null, nom: "", debutAt: null };
  await d.save();
  res.json(d);
});

// @desc    (MOBILE) Identifier un code DANS la liste (scan ou saisie NART/REFER)
// @route   POST /api/demande-reappro/mobile/:id/scan
// @body    { code }
// @access  Private — module demande_reappro (write)
// 200 { ligne, index } si le code désigne un article de la liste.
// 409 si l'article existe mais n'est PAS dans la liste (refus explicite).
// 404 si le code est totalement inconnu (l'app propose alors NART / REFER).
const scanDemande = asyncHandler(async (req, res) => {
  const d = await chargerListeMobile(req, res);
  if (verrouAutreOperateur(d, req.user)) {
    res.status(409);
    throw new Error(`Liste en cours de préparation par ${d.operateur.nom}`);
  }

  const code = cleanCode(req.body.code);
  if (!code) {
    res.status(400);
    throw new Error("Code vide");
  }

  // 1) Correspondance directe avec une ligne de la liste (NART, gencode, réf.).
  let index = (d.articles || []).findIndex(
    (a) =>
      cleanCode(a.nart) === code ||
      cleanCode(a.gencod) === code ||
      cleanCode(a.refer) === code,
  );

  // 2) Sinon : le code désigne-t-il un article du catalogue ?
  let articleCatalogue = null;
  if (index < 0) {
    const entreprise = await Entreprise.findOne({ nomDossierDBF: d.entreprise });
    if (entreprise) {
      try {
        articleCatalogue =
          (await articleCacheService.findByCode(entreprise, code)) || null;
        if (!articleCatalogue) {
          // Référence fournisseur : balayage exact du cache (search() tronque
          // avant de filtrer sur REFER, cf. module réappro).
          const cache = await articleCacheService.getArticles(entreprise);
          articleCatalogue =
            (cache.records || []).find((a) => cleanCode(a.REFER) === code) || null;
        }
      } catch (error) {
        console.error("[REAPPRO scan] recherche article:", error.message);
      }
    }
    if (articleCatalogue) {
      const nart = cleanCode(articleCatalogue.NART);
      index = (d.articles || []).findIndex((a) => cleanCode(a.nart) === nart);
    }
  }

  if (index < 0) {
    // `motif` : le terminal doit distinguer ces cas d'un 404 d'Express
    // (route absente = backend pas à jour).
    if (articleCatalogue) {
      res.status(409).json({
        message: `${cleanCode(articleCatalogue.NART)} n'est pas dans cette liste`,
        motif: "hors_liste",
        nart: cleanCode(articleCatalogue.NART),
      });
      return;
    }
    res.status(404).json({ message: "Code inconnu", motif: "code_inconnu" });
    return;
  }

  res.json({ index, ligne: d.articles[index] });
});

// @desc    (MOBILE) Enregistrer une ligne préparée (prise ou introuvable)
// @route   POST /api/demande-reappro/mobile/:id/lignes
// @body    { nart, quantite?, introuvable? }
// @access  Private — module demande_reappro (write)
const enregistrerLigne = asyncHandler(async (req, res) => {
  const d = await chargerListeMobile(req, res);
  if (d.statut === "realisee") {
    res.status(400);
    throw new Error("Cette liste est déjà terminée");
  }
  if (verrouAutreOperateur(d, req.user)) {
    res.status(409);
    throw new Error(`Liste en cours de préparation par ${d.operateur.nom}`);
  }

  const nart = cleanCode(req.body.nart);
  const ligne = (d.articles || []).find((a) => cleanCode(a.nart) === nart);
  if (!ligne) {
    res.status(404);
    throw new Error("Cet article n'est pas dans la liste");
  }

  const introuvable = Boolean(req.body.introuvable);
  const quantite = Math.round(Number(req.body.quantite) || 0);
  if (!introuvable && quantite <= 0) {
    res.status(400);
    throw new Error("Quantité invalide");
  }

  ligne.statutLigne = introuvable ? "introuvable" : "prise";
  ligne.quantitePrise = introuvable ? 0 : quantite;
  ligne.traiteAt = new Date();

  cumulerTempsActif(d);
  d.calculerTotaux();
  await d.save();

  res.json(d);
});

// @desc    (MOBILE) Terminer une liste : fichier de transfert + clôture
// @route   PATCH /api/demande-reappro/mobile/:id/realiser
// @access  Private — module demande_reappro (write)
// Les quantités viennent des lignes saisies (`articles[].quantitePrise`). Le
// corps { lignes } reste accepté pour les versions déjà déployées de l'app.
const realiserDemande = asyncHandler(async (req, res) => {
  const d = await chargerListeMobile(req, res);
  if (verrouAutreOperateur(d, req.user)) {
    res.status(409);
    throw new Error(`Liste en cours de préparation par ${d.operateur.nom}`);
  }

  if (d.statut !== "realisee") {
    // Compat : ancienne app qui envoie tout à la fin.
    const lignesBody = (Array.isArray(req.body?.lignes) ? req.body.lignes : [])
      .map((l) => ({
        nart: String(l.nart || "").trim(),
        quantite: Math.round(Number(l.quantite) || 0),
      }))
      .filter((l) => l.nart && l.quantite > 0);

    if (lignesBody.length > 0) {
      const parNart = new Map(lignesBody.map((l) => [cleanCode(l.nart), l.quantite]));
      (d.articles || []).forEach((a) => {
        const q = parNart.get(cleanCode(a.nart));
        if (q) {
          a.quantitePrise = q;
          a.statutLigne = "prise";
          if (!a.traiteAt) a.traiteAt = new Date();
        }
      });
    }

    const lignes = (d.articles || [])
      .filter((a) => (Number(a.quantitePrise) || 0) > 0)
      .map((a) => ({ nart: a.nart, quantite: Math.round(a.quantitePrise) }));

    // Fichier de transfert (réserve -> rayon), même format/endroit que la prépa.
    if (lignes.length > 0) {
      const tsf = await ecrireTransfertMagasin(d, lignes);
      d.lignesRealisees = lignes;
      d.transfertFichier = tsf.fileName;
    }

    d.statut = "realisee";
    d.realisedBy = req.user?._id;
    d.realisedByNom = nomUtilisateur(req.user);
    d.realisedAt = new Date();
    if (!d.operateur?.user) {
      d.operateur = {
        user: req.user?._id,
        nom: nomUtilisateur(req.user),
        debutAt: d.operateur?.debutAt || new Date(),
      };
    }
    d.calculerTotaux();
    await d.save();
  }
  res.json(d);
});

export {
  createDemandes,
  createDemandePanier,
  getArticleReappro,
  getDemandes,
  getDemandeById,
  importerProformas,
  getStatsPreparateurs,
  updateDemande,
  updateUrgence,
  deleteDemande,
  getMobileDemandes,
  ouvrirDemande,
  libererDemande,
  scanDemande,
  enregistrerLigne,
  realiserDemande,
};