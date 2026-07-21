// // backend/controllers/receptionController.js
// import asyncHandler from "../middleware/asyncHandler.js";
// import commandeCacheService from "../services/commandeService.js";
// import articleCacheService from "../services/articleService.js";
// import fournissCacheService from "../services/fournissCacheService.js";
// import receptionReportService from "../services/receptionReportService.js";
// import receptionExportService from "../services/receptionExportService.js";
// import Reception from "../models/ReceptionModel.js";
// import Entreprise from "../models/EntrepriseModel.js";
// import User from "../models/UserModel.js";
// import {
//   SIGNALEMENT_TYPES,
//   SIGNALEMENT_VALUES,
//   buildControleCmdDir,
//   buildSignalementFileName,
// } from "../utils/receptionPaths.js";
// import path from "path";
// import fs from "fs";

// // ===========================================
// // CONSTANTES
// // ===========================================

// // Seuil d'état des commandes éligibles au contrôle de réception.
// // Cahier des charges : commandes dont l'état est >= 4 (Bateau / Avion / Local).
// // Centralisé ici pour ajustement facile.
// const ETAT_MIN_RECEPTION = 4;

// // ===========================================
// // HELPERS
// // ===========================================

// const safeTrim = (value) => {
//   if (value === null || value === undefined) return "";
//   if (typeof value === "string") return value.trim();
//   return String(value).trim();
// };

// // Extension de fichier image à partir du type MIME (repli sur "jpg").
// const extFromMime = (mime) => {
//   const map = {
//     "image/jpeg": "jpg",
//     "image/jpg": "jpg",
//     "image/png": "png",
//     "image/webp": "webp",
//     "image/heic": "heic",
//     "image/heif": "heif",
//     "image/gif": "gif",
//     "image/bmp": "bmp",
//   };
//   return map[String(mime || "").toLowerCase()] || "jpg";
// };

// const checkCommandeFiles = (entreprise) => {
//   const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
//   const cmdrefPath = path.join(basePath, "cmdref.dbf");
//   const cmdetailPath = path.join(basePath, "cmdetail.dbf");

//   if (!fs.existsSync(cmdrefPath)) {
//     return {
//       exists: false,
//       error: `Fichier cmdref.dbf non trouvé pour ${entreprise.nomComplet}`,
//     };
//   }
//   if (!fs.existsSync(cmdetailPath)) {
//     return {
//       exists: false,
//       error: `Fichier cmdetail.dbf non trouvé pour ${entreprise.nomComplet}`,
//     };
//   }
//   return { exists: true };
// };

// const formatEntreprise = (entreprise) => ({
//   _id: entreprise._id,
//   nomDossierDBF: entreprise.nomDossierDBF,
//   trigramme: entreprise.trigramme,
//   nomComplet: entreprise.nomComplet,
// });

// // Une ligne de détail est un commentaire si son NART contient "!".
// const estCommentaire = (record) => safeTrim(record.NART).includes("!");

// // Convertit une valeur DBF (Date, AAAAMMJJ, ...) en objet Date ou null.
// const toDate = (v) => {
//   if (!v) return null;
//   if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
//   return commandeCacheService.parseDbfDate(v);
// };

// const dateToIso = (d) => (d instanceof Date && !isNaN(d.getTime()) ? d.toISOString() : null);

// // Libellé d'état depuis le mapping personnalisé de l'entreprise (Map).
// const etatLabel = (entreprise, etat) => {
//   try {
//     const map = entreprise.mappingEtatsCommande;
//     if (map && typeof map.get === "function") {
//       return map.get(String(etat)) || "";
//     }
//     if (map && typeof map === "object") {
//       return map[String(etat)] || "";
//     }
//   } catch {
//     /* ignore */
//   }
//   return "";
// };

// // Résout le nom du fournisseur (module fournisseurs), repli silencieux.
// const resolveFournisseurNom = async (entreprise, fourn) => {
//   if (fourn === undefined || fourn === null || fourn === "") return "";
//   try {
//     const f = await fournissCacheService.findByFourn(entreprise, fourn);
//     return f ? safeTrim(f.NOM) : "";
//   } catch {
//     return "";
//   }
// };

// /**
//  * Suit la chaîne de renvois d'articles via GENDOUBL (recherche O(1) via cache).
//  * Identique à la logique des modules réappro / contrôle commande.
//  */
// const suivreChaineRenvois = async (entreprise, article) => {
//   const MAX_ITERATIONS = 10;
//   let currentArticle = article;
//   let iterations = 0;
//   const chaineRenvois = [];

//   const articleOriginal = {
//     nart: article.NART ? article.NART.trim() : "",
//     gencod: article.GENCOD ? article.GENCOD.trim() : "",
//     designation: article.DESIGN ? article.DESIGN.trim() : "",
//   };

//   while (currentArticle && iterations < MAX_ITERATIONS) {
//     const gendoubl = currentArticle.GENDOUBL
//       ? currentArticle.GENDOUBL.trim()
//       : "";

//     if (!gendoubl) break;

//     chaineRenvois.push({
//       nart: currentArticle.NART ? currentArticle.NART.trim() : "",
//       gencod: currentArticle.GENCOD ? currentArticle.GENCOD.trim() : "",
//       designation: currentArticle.DESIGN ? currentArticle.DESIGN.trim() : "",
//       renvoisVers: gendoubl,
//     });

//     const nextArticle = await articleCacheService.findByNart(entreprise, gendoubl);
//     if (!nextArticle) {
//       console.warn(`Renvoi vers article inexistant (NART): ${gendoubl}`);
//       break;
//     }
//     currentArticle = nextArticle;
//     iterations++;
//   }

//   const isRenvoi = chaineRenvois.length > 0;
//   return {
//     articleFinal: currentArticle,
//     isRenvoi,
//     articleOriginal: isRenvoi ? articleOriginal : null,
//     chaineRenvois: isRenvoi ? chaineRenvois : null,
//     nombreRenvois: chaineRenvois.length,
//   };
// };

// // Lecture robuste d'un champ DBF (insensible à la casse / aux espaces de clés).
// const lireChamp = (rec, ...names) => {
//   if (!rec) return undefined;
//   for (const name of names) {
//     if (rec[name] !== undefined) return rec[name];
//   }
//   const targets = names.map((n) => n.toUpperCase());
//   for (const k of Object.keys(rec)) {
//     if (targets.includes(k.toUpperCase().trim())) return rec[k];
//   }
//   return undefined;
// };

// // Nouveauté : un article est une nouveauté si V1..V12 sont TOUS = 0.
// // (On exige qu'au moins un champ V soit présent pour éviter de tout signaler
// //  lorsque ces colonnes n'existent pas dans le DBF.)
// const estArticleNouveau = (art) => {
//   if (!art) return false;
//   let auMoinsUnPresent = false;
//   for (let i = 1; i <= 12; i++) {
//     const v = lireChamp(art, `V${i}`, `V${String(i).padStart(2, "0")}`);
//     if (v !== undefined) {
//       auMoinsUnPresent = true;
//       if ((parseFloat(v) || 0) !== 0) return false;
//     }
//   }
//   return auMoinsUnPresent;
// };

// // Construit le payload "articleInfo" à partir d'un record article résolu.
// const buildArticleInfo = (entreprise, code, resultatRenvoi) => {
//   const stocksLabels = entreprise.mappingEntrepots || {
//     S1: "Magasin",
//     S2: "S2",
//     S3: "S3",
//     S4: "S4",
//     S5: "S5",
//   };

//   if (!resultatRenvoi || !resultatRenvoi.articleFinal) {
//     return {
//       nart: code,
//       gencod: "",
//       designation: "Article inconnu",
//       refer: "",
//       stocks: { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 },
//       stocksLabels,
//       reserv: 0,
//       enReservation: false,
//       estNouveau: false,
//       isUnknown: true,
//       isRenvoi: false,
//       articleOriginal: null,
//       chaineRenvois: null,
//       nombreRenvois: 0,
//     };
//   }

//   const a = resultatRenvoi.articleFinal;
//   // Réservations : champ article.RESERV.
//   // Lecture robuste : on cherche la clé sans dépendre de la casse/espaces
//   // exposées par dbffile (RESERV, et variantes éventuelles).
//   const getField = (rec, ...names) => {
//     if (!rec) return undefined;
//     for (const name of names) {
//       if (rec[name] !== undefined) return rec[name];
//     }
//     const targets = names.map((n) => n.toUpperCase());
//     for (const k of Object.keys(rec)) {
//       if (targets.includes(k.toUpperCase().trim())) return rec[k];
//     }
//     return undefined;
//   };
//   const reserv =
//     parseFloat(getField(a, "RESERV", "RESERVE", "RESERVED", "RESA", "RESERVQTE")) ||
//     0;
//   return {
//     nart: a.NART ? a.NART.trim() : code,
//     gencod: a.GENCOD ? a.GENCOD.trim() : "",
//     designation: a.DESIGN ? a.DESIGN.trim() : "",
//     refer: a.REFER ? a.REFER.trim() : "",
//     fourn: a.FOURN !== undefined && a.FOURN !== null ? a.FOURN : null,
//     reserv, // article.RESERV (nombre de réservations)
//     enReservation: reserv > 0,
//     estNouveau: estArticleNouveau(a), // V1..V12 tous = 0
//     stocks: {
//       S1: parseFloat(a.S1) || 0,
//       S2: parseFloat(a.S2) || 0,
//       S3: parseFloat(a.S3) || 0,
//       S4: parseFloat(a.S4) || 0,
//       S5: parseFloat(a.S5) || 0,
//     },
//     stocksLabels,
//     isUnknown: false,
//     isRenvoi: resultatRenvoi.isRenvoi,
//     articleOriginal: resultatRenvoi.articleOriginal,
//     chaineRenvois: resultatRenvoi.chaineRenvois,
//     nombreRenvois: resultatRenvoi.nombreRenvois,
//   };
// };

// // Calcule l'analyse des écarts (articles non trouvés + écarts trouvés).
// const computeAnalyse = (reception) => {
//   const comptagesByNart = new Map();
//   reception.comptages.forEach((c) => {
//     if (c.nart) comptagesByNart.set(c.nart, c);
//   });

//   // Articles présents dans la commande mais jamais comptés
//   const nonTrouves = reception.lignesCommande
//     .filter((l) => !comptagesByNart.has(l.nart))
//     .map((l) => ({
//       nart: l.nart,
//       designation: l.designation,
//       refer: l.refer,
//       gencod: l.gencod,
//       qteCommandee: l.qteCommandee,
//     }));

//   // Écarts : comptages de la commande dont la quantité retenue diffère de la commandée.
//   // Présentés du DERNIER article contrôlé au PREMIER.
//   const qteCmdByNart = new Map(
//     reception.lignesCommande.map((l) => [l.nart, l.qteCommandee]),
//   );

//   const ecarts = reception.comptages
//     .filter((c) => c.dansCommande && c.nart)
//     .slice()
//     .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt))
//     .map((c) => {
//       const qteCommandee = qteCmdByNart.get(c.nart) ?? 0;
//       const qteRetenue = c.qteValidee != null ? c.qteValidee : c.qteComptee;
//       return {
//         comptageId: c._id,
//         nart: c.nart,
//         designation: c.designation,
//         refer: c.refer,
//         gencod: c.gencod,
//         gencodeScanne: c.gencodeScanne,
//         qteCommandee,
//         qteComptee: c.qteComptee,
//         qteValidee: c.qteValidee,
//         enReservation: !!c.enReservation,
//         nbReservations: c.nbReservations || 0,
//         estNouveau: !!c.estNouveau,
//         ecart: qteRetenue - qteCommandee,
//       };
//     })
//     .filter((e) => e.ecart !== 0);

//   return { nonTrouves, ecarts };
// };

// // Charge une session et vérifie l'accès utilisateur.
// const loadReceptionOwned = async (id, req, res) => {
//   const reception = await Reception.findById(id);
//   if (!reception) {
//     res.status(404);
//     throw new Error("Réception non trouvée");
//   }
//   if (
//     reception.user.toString() !== req.user._id.toString() &&
//     req.user.role !== "admin"
//   ) {
//     res.status(403);
//     throw new Error("Non autorisé");
//   }
//   return reception;
// };

// // ===========================================
// // LECTURE — COMMANDES À CONTRÔLER (DBF)
// // ===========================================

// /**
//  * @desc    Liste paginée des commandes éligibles (ETAT >= ETAT_MIN_RECEPTION).
//  * @route   GET /api/receptions/a-controler/:nomDossierDBF
//  * @query   page, limit, search
//  * @access  Private (module reception, read)
//  */
// const getCommandesAControler = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   const startTime = Date.now();

//   const check = checkCommandeFiles(entreprise);
//   if (!check.exists) {
//     res.status(404);
//     throw new Error(check.error);
//   }

//   const page = parseInt(req.query.page) || 1;
//   const limit = parseInt(req.query.limit) || 50;
//   const search = safeTrim(req.query.search).toUpperCase();

//   const cache = await commandeCacheService.getCmdRef(entreprise);

//   // Filtre ETAT >= seuil
//   let resultats = cache.records.filter((record) => {
//     const etat = parseInt(record.ETAT);
//     if (isNaN(etat) || etat < ETAT_MIN_RECEPTION) return false;
//     if (search) {
//       const numcde = safeTrim(record.NUMCDE).toUpperCase();
//       const bateau = safeTrim(record.BATEAU).toUpperCase();
//       if (!numcde.includes(search) && !bateau.includes(search)) return false;
//     }
//     return true;
//   });

//   // Tri par date d'arrivée croissante puis numéro de commande
//   resultats.sort((a, b) => {
//     const da = toDate(a.ARRIVEE);
//     const db = toDate(b.ARRIVEE);
//     const ta = da ? da.getTime() : Infinity;
//     const tb = db ? db.getTime() : Infinity;
//     if (ta !== tb) return ta - tb;
//     return safeTrim(a.NUMCDE).localeCompare(safeTrim(b.NUMCDE));
//   });

//   const totalRecords = resultats.length;
//   const totalPages = Math.ceil(totalRecords / limit);
//   const startIndex = (page - 1) * limit;
//   const paginated = resultats.slice(startIndex, startIndex + limit);

//   // Résolution du nom fournisseur pour la page courante uniquement
//   const commandes = [];
//   for (const record of paginated) {
//     const fourn =
//       record.FOURN !== undefined && record.FOURN !== null ? record.FOURN : null;
//     const arrivee = toDate(record.ARRIVEE);
//     const datcde = toDate(record.DATCDE);
//     const etat = parseInt(record.ETAT);
//     commandes.push({
//       numcde: safeTrim(record.NUMCDE),
//       fourn,
//       fournisseurNom: await resolveFournisseurNom(entreprise, fourn),
//       bateau: safeTrim(record.BATEAU),
//       arrivee: dateToIso(arrivee),
//       datcde: dateToIso(datcde),
//       observ: safeTrim(record.OBSERV),
//       etat: isNaN(etat) ? null : etat,
//       etatLabel: etatLabel(entreprise, etat),
//     });
//   }

//   res.json({
//     entreprise: formatEntreprise(entreprise),
//     etatMin: ETAT_MIN_RECEPTION,
//     pagination: {
//       page,
//       limit,
//       totalRecords,
//       totalPages,
//       hasNextPage: startIndex + limit < totalRecords,
//       hasPrevPage: page > 1,
//     },
//     _queryTime: `${Date.now() - startTime}ms`,
//     commandes,
//   });
// });

// /**
//  * @desc    Détails (lignes) d'une commande (vérification avant contrôle).
//  *          Commentaires (NART contient "!") en tête, puis articles triés par NL.
//  *          Inclut la quantité commandée (QTE).
//  * @route   GET /api/receptions/a-controler/:nomDossierDBF/:numcde/details
//  * @access  Private (module reception, read)
//  */
// const getDetailsCommande = asyncHandler(async (req, res) => {
//   const entreprise = req.entreprise;
//   const { numcde } = req.params;
//   const startTime = Date.now();

//   const check = checkCommandeFiles(entreprise);
//   if (!check.exists) {
//     res.status(404);
//     throw new Error(check.error);
//   }

//   const entete = await commandeCacheService.findByNumcde(entreprise, numcde);
//   const lignesBrutes = await commandeCacheService.getDetailsByNumcde(
//     entreprise,
//     numcde,
//   );

//   const commentaires = [];
//   const articles = [];

//   for (const ligne of lignesBrutes) {
//     const isComment = estCommentaire(ligne);
//     const formatted = {
//       NL: ligne.NL,
//       NART: safeTrim(ligne.NART),
//       DESIGN: safeTrim(ligne.DESIGN),
//       REFER: safeTrim(ligne.REFER),
//       QTE: parseFloat(ligne.QTE) || 0,
//       isCommentaire: isComment,
//     };
//     if (isComment) commentaires.push(formatted);
//     else articles.push(formatted);
//   }

//   articles.sort((a, b) => (parseFloat(a.NL) || 0) - (parseFloat(b.NL) || 0));
//   const lignes = [...commentaires, ...articles];

//   res.json({
//     entreprise: formatEntreprise(entreprise),
//     numcde: safeTrim(numcde),
//     entete: entete || null,
//     totalLignes: lignes.length,
//     totalArticles: articles.length,
//     totalCommentaires: commentaires.length,
//     _queryTime: `${Date.now() - startTime}ms`,
//     lignes,
//   });
// });

// // ===========================================
// // SESSIONS DE RÉCEPTION
// // ===========================================

// /**
//  * @desc    Créer (ou reprendre) une session de réception pour une commande.
//  * @route   POST /api/receptions
//  * @body    { entrepriseId, numcde, mode? }
//  * @access  Private (module reception, write)
//  */
// const createReception = asyncHandler(async (req, res) => {
//   const { entrepriseId, numcde, mode } = req.body;

//   if (!numcde || !numcde.trim()) {
//     res.status(400);
//     throw new Error("Le numéro de commande (numcde) est requis");
//   }

//   // Le mode "avec réappro" n'est pas encore implémenté (cahier : hors périmètre).
//   if (mode && mode !== "sans_reappro") {
//     res.status(400);
//     throw new Error("Mode de contrôle non disponible");
//   }

//   const entreprise = await Entreprise.findById(entrepriseId);
//   if (!entreprise) {
//     res.status(404);
//     throw new Error("Entreprise non trouvée");
//   }

//   const numcdeTrim = numcde.trim();

//   const checkFiles = checkCommandeFiles(entreprise);
//   if (!checkFiles.exists) {
//     res.status(404);
//     throw new Error(checkFiles.error);
//   }

//   const entete = await commandeCacheService.findByNumcde(entreprise, numcdeTrim);
//   if (!entete) {
//     res.status(404);
//     throw new Error(
//       "ce numéro de commande n'existe pas, veuillez vérifier ou sélectionner une commande dans la liste",
//     );
//   }

//   // Reprendre la session en cours si elle existe déjà
//   const enCours = await Reception.findOne({
//     entreprise: entrepriseId,
//     user: req.user._id,
//     numcde: numcdeTrim,
//     status: { $in: ["en_cours", "analyse_ecarts"] },
//   });
//   if (enCours) {
//     return res.json(enCours);
//   }

//   // Snapshot entête
//   const fourn =
//     entete.FOURN !== undefined && entete.FOURN !== null ? entete.FOURN : null;
//   const commandeInfo = {
//     fourn,
//     fournisseurNom: await resolveFournisseurNom(entreprise, fourn),
//     bateau: safeTrim(entete.BATEAU),
//     arrivee: toDate(entete.ARRIVEE),
//     datcde: toDate(entete.DATCDE),
//     observ: safeTrim(entete.OBSERV),
//     etat:
//       entete.ETAT !== undefined && entete.ETAT !== null
//         ? parseInt(entete.ETAT)
//         : null,
//   };

//   // Snapshot des lignes de commande (référence "Y"), gencode résolu best-effort.
//   const lignesBrutes = await commandeCacheService.getDetailsByNumcde(
//     entreprise,
//     numcdeTrim,
//   );

//   const lignesCommande = [];
//   for (const ligne of lignesBrutes) {
//     if (estCommentaire(ligne)) continue;
//     const nart = safeTrim(ligne.NART);
//     let gencod = "";
//     let estNouveau = false;
//     try {
//       const art = await articleCacheService.findByNart(entreprise, nart);
//       if (art && art.GENCOD) gencod = art.GENCOD.trim();
//       estNouveau = estArticleNouveau(art);
//     } catch {
//       /* ignore */
//     }
//     lignesCommande.push({
//       nl: parseFloat(ligne.NL) || 0,
//       nart,
//       designation: safeTrim(ligne.DESIGN),
//       refer: safeTrim(ligne.REFER),
//       gencod,
//       qteCommandee: parseFloat(ligne.QTE) || 0,
//       estNouveau,
//     });
//   }
//   lignesCommande.sort((a, b) => a.nl - b.nl);

//   const reception = await Reception.create({
//     entreprise: entrepriseId,
//     nomDossierDBF: entreprise.nomDossierDBF,
//     user: req.user._id,
//     numcde: numcdeTrim,
//     mode: "sans_reappro",
//     commandeInfo,
//     lignesCommande,
//     comptages: [],
//     signalements: [],
//   });

//   // Précharger le cache des articles (arrière-plan)
//   articleCacheService.preload(entreprise).catch((err) => {
//     console.error("Erreur préchargement cache:", err);
//   });

//   res.status(201).json(reception);
// });

// /**
//  * @desc    Sessions de réception EN COURS pour une entreprise (user courant).
//  * @route   GET /api/receptions/en-cours/:entrepriseId
//  * @access  Private (module reception, read)
//  */
// const getReceptionsEnCours = asyncHandler(async (req, res) => {
//   const { entrepriseId } = req.params;
//   const receptions = await Reception.find({
//     entreprise: entrepriseId,
//     user: req.user._id,
//     status: { $in: ["en_cours", "analyse_ecarts"] },
//   })
//     .populate("entreprise", "nomDossierDBF trigramme nomComplet")
//     .sort({ updatedAt: -1 });
//   res.json(receptions);
// });

// /**
//  * @desc    Session EN COURS pour une commande précise (user courant).
//  * @route   GET /api/receptions/en-cours/:entrepriseId/:numcde
//  * @access  Private (module reception, read)
//  */
// const getReceptionEnCours = asyncHandler(async (req, res) => {
//   const { entrepriseId, numcde } = req.params;
//   const reception = await Reception.findOne({
//     entreprise: entrepriseId,
//     user: req.user._id,
//     numcde: numcde.trim(),
//     status: { $in: ["en_cours", "analyse_ecarts"] },
//   }).populate(
//     "entreprise",
//     "nomDossierDBF trigramme nomComplet cheminBase mappingEntrepots mappingEtatsCommande",
//   );

//   if (reception?.entreprise) {
//     articleCacheService.preload(reception.entreprise).catch((err) => {
//       console.error("Erreur préchargement cache:", err);
//     });
//   }

//   res.json(reception);
// });

// /**
//  * @desc    Obtenir une session de réception par ID.
//  * @route   GET /api/receptions/:id
//  * @access  Private (module reception, read)
//  */
// const getReceptionById = asyncHandler(async (req, res) => {
//   const reception = await Reception.findById(req.params.id).populate(
//     "entreprise",
//     "nomDossierDBF trigramme nomComplet mappingEntrepots mappingEtatsCommande",
//   );
//   if (!reception) {
//     res.status(404);
//     throw new Error("Réception non trouvée");
//   }
//   if (
//     reception.user.toString() !== req.user._id.toString() &&
//     req.user.role !== "admin"
//   ) {
//     res.status(403);
//     throw new Error("Non autorisé");
//   }
//   res.json(reception);
// });

// /**
//  * @desc    Liste des articles de la commande triés alphabétiquement (liste déroulante).
//  * @route   GET /api/receptions/:id/articles-commande
//  * @access  Private (module reception, read)
//  */
// const getArticlesCommande = asyncHandler(async (req, res) => {
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   const articles = reception.lignesCommande
//     .slice()
//     .sort((a, b) =>
//       safeTrim(a.designation).localeCompare(safeTrim(b.designation), "fr", {
//         sensitivity: "base",
//       }),
//     );
//   res.json({ numcde: reception.numcde, articles });
// });

// /**
//  * @desc    Historique des réceptions de l'utilisateur.
//  * @route   GET /api/receptions/historique
//  * @query   entrepriseId?, numcde?
//  * @access  Private (module reception, read)
//  */
// const getHistoriqueReceptions = asyncHandler(async (req, res) => {
//   const { entrepriseId, numcde } = req.query;
//   const query = { user: req.user._id };
//   if (entrepriseId) query.entreprise = entrepriseId;
//   if (numcde) query.numcde = numcde.trim();

//   const receptions = await Reception.find(query)
//     .populate("entreprise", "nomDossierDBF trigramme nomComplet")
//     .sort({ createdAt: -1 })
//     .limit(50);
//   res.json(receptions);
// });

// // ===========================================
// // SCAN & IDENTIFICATION
// // ===========================================

// /**
//  * @desc    Scanner un article (lecture seule : aucune persistance).
//  *          Renvoie l'identification + si l'article est dans la commande.
//  * @route   POST /api/receptions/:id/scan
//  * @body    { code }
//  * @access  Private (module reception, write)
//  */
// const scanArticle = asyncHandler(async (req, res) => {
//   const { code } = req.body;
//   const startTime = Date.now();

//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   if (reception.status === "termine") {
//     res.status(400);
//     throw new Error("Cette réception est déjà terminée");
//   }

//   const entreprise = await Entreprise.findById(reception.entreprise);
//   const codeTrim = safeTrim(code);

//   let resultatRenvoi = null;
//   try {
//     const article = await articleCacheService.findByCode(entreprise, codeTrim);
//     if (article) {
//       resultatRenvoi = await suivreChaineRenvois(entreprise, article);
//     }
//   } catch (error) {
//     console.error("Erreur recherche article:", error);
//   }

//   const articleInfo = buildArticleInfo(entreprise, codeTrim, resultatRenvoi);

//   // Présence dans la commande (par NART)
//   let dansCommande = false;
//   if (!articleInfo.isUnknown && articleInfo.nart) {
//     dansCommande = reception.lignesCommande.some(
//       (l) => l.nart === articleInfo.nart,
//     );
//   }

//   // statut : reconnu (dans/hors commande) ou inconnu
//   const statut = articleInfo.isUnknown
//     ? "inconnu"
//     : dansCommande
//       ? "reconnu_dans_commande"
//       : "reconnu_hors_commande";

//   // --- Diagnostic réservation (temporaire) ---
//   const _af = resultatRenvoi?.articleFinal;
//   const _reservKeys = _af
//     ? Object.keys(_af).filter((k) => /reserv|resa/i.test(k))
//     : [];
//   const _debugReserv = {
//     reserv: articleInfo.reserv,
//     clesReserv: _reservKeys,
//     valeursReserv: _reservKeys.map((k) => _af[k]),
//     toutesLesCles: _af ? Object.keys(_af) : [],
//   };
//   console.log(
//     `[RECEPTION scan] code=${codeTrim} nart=${articleInfo.nart} ` +
//       `reserv=${articleInfo.reserv} clesReserv=${JSON.stringify(_reservKeys)} ` +
//       `valeurs=${JSON.stringify(_debugReserv.valeursReserv)}`,
//   );

//   res.json({
//     receptionId: reception._id,
//     statut,
//     dansCommande,
//     gencodeScanne: codeTrim,
//     articleInfo,
//     _debugReserv,
//     _queryTime: `${Date.now() - startTime}ms`,
//   });
// });

// /**
//  * @desc    Recherche par référence fournisseur (gencode inconnu).
//  *          Recherche parmi TOUTES les références du fournisseur de la commande.
//  * @route   POST /api/receptions/:id/recherche-ref
//  * @body    { refer }
//  * @access  Private (module reception, write)
//  */
// const rechercheParRef = asyncHandler(async (req, res) => {
//   const { refer } = req.body;
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   const entreprise = await Entreprise.findById(reception.entreprise);

//   const referTrim = safeTrim(refer);
//   if (!referTrim) {
//     res.status(400);
//     throw new Error("La référence fournisseur est requise");
//   }

//   const fourn = reception.commandeInfo?.fourn;
//   let trouve = null;
//   try {
//     const { articles } = await articleCacheService.search(
//       entreprise,
//       referTrim,
//       { fourn: fourn ?? undefined, limit: 50 },
//     );
//     // Correspondance exacte de la référence fournisseur (insensible à la casse)
//     trouve =
//       articles.find(
//         (a) => safeTrim(a.REFER).toUpperCase() === referTrim.toUpperCase(),
//       ) || null;
//   } catch (error) {
//     console.error("Erreur recherche référence:", error);
//   }

//   if (!trouve) {
//     res.status(404);
//     throw new Error("référence inconnue");
//   }

//   const resultatRenvoi = await suivreChaineRenvois(entreprise, trouve);
//   const articleInfo = buildArticleInfo(entreprise, referTrim, resultatRenvoi);
//   const dansCommande = reception.lignesCommande.some(
//     (l) => l.nart === articleInfo.nart,
//   );

//   res.json({ receptionId: reception._id, articleInfo, dansCommande });
// });

// /**
//  * @desc    Recherche par code article (gencode inconnu).
//  * @route   POST /api/receptions/:id/recherche-code
//  * @body    { nart }
//  * @access  Private (module reception, write)
//  */
// const rechercheParCode = asyncHandler(async (req, res) => {
//   const { nart } = req.body;
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   const entreprise = await Entreprise.findById(reception.entreprise);

//   const nartTrim = safeTrim(nart);
//   if (!nartTrim) {
//     res.status(400);
//     throw new Error("Le code article est requis");
//   }

//   let article = null;
//   try {
//     article = await articleCacheService.findByNart(entreprise, nartTrim);
//   } catch (error) {
//     console.error("Erreur recherche code article:", error);
//   }

//   if (!article) {
//     res.status(404);
//     throw new Error("Code article inconnu");
//   }

//   const resultatRenvoi = await suivreChaineRenvois(entreprise, article);
//   const articleInfo = buildArticleInfo(entreprise, nartTrim, resultatRenvoi);
//   const dansCommande = reception.lignesCommande.some(
//     (l) => l.nart === articleInfo.nart,
//   );

//   res.json({ receptionId: reception._id, articleInfo, dansCommande });
// });

// // ===========================================
// // COMPTAGE
// // ===========================================

// /**
//  * @desc    Ajouter un comptage (cumul si l'article a déjà été compté).
//  * @route   POST /api/receptions/:id/comptages
//  * @body    { nart, gencod, designation, refer, gencodeScanne, quantite,
//  *            dansCommande, isInconnu, nouveauGencode, stocks, trouveEnPhaseFinale }
//  * @access  Private (module reception, write)
//  */
// const addComptage = asyncHandler(async (req, res) => {
//   const {
//     nart,
//     gencod,
//     designation,
//     refer,
//     gencodeScanne,
//     quantite,
//     dansCommande,
//     isInconnu,
//     nouveauGencode,
//     stocks,
//     trouveEnPhaseFinale,
//     enReservation,
//     nbReservations,
//     estNouveau,
//     isRenvoi,
//     renvoiGencodeBipe,
//     renvoiNartOrigine,
//   } = req.body;

//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   if (reception.status === "termine") {
//     res.status(400);
//     throw new Error("Cette réception est déjà terminée");
//   }

//   const q = parseInt(quantite, 10);
//   if (isNaN(q) || q < 1) {
//     res.status(400);
//     throw new Error("Quantité invalide");
//   }

//   const nartTrim = safeTrim(nart);
//   const gencodeScanneTrim = safeTrim(gencodeScanne);

//   // Recherche d'un comptage existant (réunification)
//   let existing;
//   if (isInconnu) {
//     existing = reception.comptages.find(
//       (c) => c.isInconnu && c.gencodeScanne === gencodeScanneTrim,
//     );
//   } else if (nartTrim) {
//     existing = reception.comptages.find((c) => c.nart && c.nart === nartTrim);
//   }

//   let reunification = false;
//   let comptage;

//   if (existing) {
//     reunification = true;
//     existing.qteComptee += q;
//     existing.scannedAt = new Date();
//     if (nouveauGencode && !existing.nouveauGencode) {
//       existing.nouveauGencode = nouveauGencode;
//     }
//     // Renseigne l'info renvoi si elle n'était pas encore captée sur ce comptage.
//     if (isRenvoi && !existing.isRenvoi) {
//       existing.isRenvoi = true;
//       existing.renvoiGencodeBipe = safeTrim(renvoiGencodeBipe) || gencodeScanneTrim;
//       existing.renvoiNartOrigine = safeTrim(renvoiNartOrigine);
//     }
//     reception.markModified("comptages");
//     comptage = existing;
//   } else {
//     reception.comptages.push({
//       nart: nartTrim,
//       gencod: safeTrim(gencod),
//       designation: safeTrim(designation),
//       refer: safeTrim(refer),
//       gencodeScanne: gencodeScanneTrim,
//       qteComptee: q,
//       qteValidee: null,
//       dansCommande: !!dansCommande,
//       isInconnu: !!isInconnu,
//       nouveauGencode: nouveauGencode || null,
//       stocksSnapshot: stocks || { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 },
//       enReservation: !!enReservation,
//       nbReservations: parseInt(nbReservations, 10) || 0,
//       estNouveau: !!estNouveau,
//       trouveEnPhaseFinale: !!trouveEnPhaseFinale,
//       isRenvoi: !!isRenvoi,
//       renvoiGencodeBipe: isRenvoi
//         ? safeTrim(renvoiGencodeBipe) || gencodeScanneTrim
//         : "",
//       renvoiNartOrigine: isRenvoi ? safeTrim(renvoiNartOrigine) : "",
//     });
//     comptage = reception.comptages[reception.comptages.length - 1];
//   }

//   reception.recalcTotaux();
//   await reception.save();

//   // Contrôle de quantité : cumul > quantité commandée ?
//   let depassement = null;
//   if (!isInconnu && nartTrim) {
//     const ligne = reception.lignesCommande.find((l) => l.nart === nartTrim);
//     if (ligne && comptage.qteComptee > ligne.qteCommandee) {
//       depassement = {
//         qteCommandee: ligne.qteCommandee,
//         qteComptee: comptage.qteComptee,
//       };
//     }
//   }

//   res.json({
//     reception,
//     comptageId: comptage._id,
//     reunification,
//     depassement,
//   });
// });

// /**
//  * @desc    Modifier la quantité d'un comptage (valeur ABSOLUE).
//  *          Utilisé pour les choix "Non" / "Annuler et remplacer" du dialogue
//  *          de dépassement.
//  * @route   PUT /api/receptions/:id/comptages/:comptageId
//  * @body    { quantite }
//  * @access  Private (module reception, write)
//  */
// const updateComptage = asyncHandler(async (req, res) => {
//   const { quantite } = req.body;
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   if (reception.status === "termine") {
//     res.status(400);
//     throw new Error("Cette réception est déjà terminée");
//   }

//   const comptage = reception.comptages.id(req.params.comptageId);
//   if (!comptage) {
//     res.status(404);
//     throw new Error("Comptage non trouvé");
//   }

//   const q = parseInt(quantite, 10);
//   if (isNaN(q) || q < 0) {
//     res.status(400);
//     throw new Error("Quantité invalide");
//   }

//   comptage.qteComptee = q;
//   comptage.scannedAt = new Date();
//   reception.markModified("comptages");
//   reception.recalcTotaux();
//   await reception.save();

//   let depassement = null;
//   if (!comptage.isInconnu && comptage.nart) {
//     const ligne = reception.lignesCommande.find((l) => l.nart === comptage.nart);
//     if (ligne && comptage.qteComptee > ligne.qteCommandee) {
//       depassement = {
//         qteCommandee: ligne.qteCommandee,
//         qteComptee: comptage.qteComptee,
//       };
//     }
//   }

//   res.json({ reception, depassement });
// });

// /**
//  * @desc    Supprimer un comptage.
//  * @route   DELETE /api/receptions/:id/comptages/:comptageId
//  * @access  Private (module reception, delete)
//  */
// const deleteComptage = asyncHandler(async (req, res) => {
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   if (reception.status === "termine") {
//     res.status(400);
//     throw new Error("Cette réception est déjà terminée");
//   }
//   reception.comptages.pull(req.params.comptageId);
//   reception.recalcTotaux();
//   await reception.save();
//   res.json(reception);
// });

// // ===========================================
// // SIGNALEMENTS (PROBLÈMES ARTICLES + PHOTOS RCOMMUN)
// // ===========================================

// /**
//  * @desc    Liste des types de problème (menu déroulant mobile).
//  *          Renvoie { value: label } pour rester synchronisé avec le backend.
//  * @route   GET /api/receptions/signalement-types
//  * @access  Private
//  */
// const getSignalementTypes = asyncHandler(async (req, res) => {
//   res.json({ types: SIGNALEMENT_TYPES });
// });

// /**
//  * @desc    Créer / remplacer le signalement d'un article (1 max par article) et
//  *          déposer la PHOTO directement sur RCOMMUN (dans le dossier de la
//  *          commande). La photo est transmise en multipart/form-data (champ "photo").
//  * @route   POST /api/receptions/:id/signalements
//  * @body    multipart : { type, refKey?, nart?, gencod?, designation?, refer?, photo (fichier) }
//  * @access  Private (module reception, write)
//  */
// const upsertSignalement = asyncHandler(async (req, res) => {
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   if (reception.status === "termine") {
//     res.status(400);
//     throw new Error("Cette réception est déjà terminée");
//   }

//   const type = safeTrim(req.body.type).toLowerCase();
//   if (!SIGNALEMENT_VALUES.includes(type)) {
//     res.status(400);
//     throw new Error(
//       `Type de problème invalide. Valeurs autorisées : ${SIGNALEMENT_VALUES.join(", ")}`,
//     );
//   }

//   // Clé d'unicité : NART si connu, sinon gencode scanné / refKey fourni.
//   const nart = safeTrim(req.body.nart);
//   const refKey = safeTrim(req.body.refKey) || nart || safeTrim(req.body.gencodeScanne);
//   if (!refKey) {
//     res.status(400);
//     throw new Error("Article non identifié (nart / refKey manquant)");
//   }

//   // Photo obligatoire (le dépôt de la photo est l'objet du signalement).
//   if (!req.file || !req.file.buffer || !req.file.buffer.length) {
//     res.status(400);
//     throw new Error("Photo manquante");
//   }
//   if (!String(req.file.mimetype || "").toLowerCase().startsWith("image/")) {
//     res.status(400);
//     throw new Error("Le fichier envoyé n'est pas une image");
//   }

//   // Entreprise (pour trigramme + base collecteur via getter)
//   const entreprise = await Entreprise.findById(reception.entreprise);
//   if (!entreprise) {
//     res.status(404);
//     throw new Error("Entreprise non trouvée");
//   }

//   // Dossier de la commande sur RCOMMUN (créé si absent)
//   let dossier;
//   try {
//     dossier = buildControleCmdDir(entreprise, reception);
//     // [DIAGNOSTIC] Chemin exact où la photo va être déposée. À retirer une fois validé.
//     console.log(
//       `[RECEPTION signalement] base=${entreprise.cheminRapportReception} | trigramme=${entreprise.trigramme} | dossier=${dossier}`,
//     );
//     if (!fs.existsSync(dossier)) {
//       fs.mkdirSync(dossier, { recursive: true });
//     }
//   } catch (error) {
//     res.status(400);
//     throw new Error(
//       `Impossible d'accéder au dossier de dépôt: ${error.message}`,
//     );
//   }

//   const ext = extFromMime(req.file.mimetype);
//   const fileName = buildSignalementFileName(refKey, type, ext);
//   const filePath = path.join(dossier, fileName);

//   // Signalement existant pour cet article ?
//   const existing = reception.signalements.find(
//     (s) => safeTrim(s.refKey) === refKey,
//   );

//   // Si un ancien fichier photo porte un autre nom, on le supprime (best-effort).
//   if (existing && existing.photoFileName && existing.photoFileName !== fileName) {
//     const ancien = existing.photoPath || path.join(dossier, existing.photoFileName);
//     try {
//       if (ancien && fs.existsSync(ancien)) fs.unlinkSync(ancien);
//     } catch (e) {
//       console.warn("Suppression ancienne photo signalement impossible:", e.message);
//     }
//   }

//   // Écriture directe de la photo sur RCOMMUN
//   try {
//     fs.writeFileSync(filePath, req.file.buffer);
//     console.log(`[RECEPTION signalement] photo écrite: ${filePath} (${req.file.size || req.file.buffer.length} octets)`);
//   } catch (error) {
//     res.status(400);
//     throw new Error(`Écriture de la photo impossible: ${error.message}`);
//   }

//   const now = new Date();
//   const payload = {
//     refKey,
//     nart,
//     gencod: safeTrim(req.body.gencod),
//     designation: safeTrim(req.body.designation),
//     refer: safeTrim(req.body.refer),
//     type,
//     photoFileName: fileName,
//     photoPath: filePath,
//     mimeType: safeTrim(req.file.mimetype),
//     taille: req.file.size || req.file.buffer.length || 0,
//     user: req.user._id,
//     updatedAt: now,
//   };

//   let signalement;
//   if (existing) {
//     Object.assign(existing, payload);
//     reception.markModified("signalements");
//     signalement = existing;
//   } else {
//     reception.signalements.push({ ...payload, createdAt: now });
//     signalement = reception.signalements[reception.signalements.length - 1];
//   }

//   await reception.save();

//   res.status(201).json({ reception, signalement });
// });

// /**
//  * @desc    Supprimer un signalement (et sa photo sur RCOMMUN).
//  * @route   DELETE /api/receptions/:id/signalements/:signalementId
//  * @access  Private (module reception, delete)
//  */
// const deleteSignalement = asyncHandler(async (req, res) => {
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   if (reception.status === "termine") {
//     res.status(400);
//     throw new Error("Cette réception est déjà terminée");
//   }

//   const signalement = reception.signalements.id(req.params.signalementId);
//   if (!signalement) {
//     res.status(404);
//     throw new Error("Signalement non trouvé");
//   }

//   // Suppression du fichier photo (best-effort)
//   const photo = signalement.photoPath || "";
//   if (photo) {
//     try {
//       if (fs.existsSync(photo)) fs.unlinkSync(photo);
//     } catch (e) {
//       console.warn("Suppression photo signalement impossible:", e.message);
//     }
//   }

//   reception.signalements.pull(req.params.signalementId);
//   await reception.save();

//   res.json({ reception });
// });

// // ===========================================
// // PHASE FINALE (ANALYSE DES ÉCARTS)
// // ===========================================

// /**
//  * @desc    Terminer le scan -> passe en phase d'analyse des écarts.
//  * @route   POST /api/receptions/:id/terminer-scan
//  * @access  Private (module reception, write)
//  */
// const terminerScan = asyncHandler(async (req, res) => {
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   if (reception.status === "termine") {
//     res.status(400);
//     throw new Error("Cette réception est déjà terminée");
//   }
//   reception.status = "analyse_ecarts";
//   await reception.save();
//   const analyse = computeAnalyse(reception);
//   res.json({ reception, analyse });
// });

// /**
//  * @desc    Obtenir l'analyse des écarts (recalcul à la volée).
//  * @route   GET /api/receptions/:id/analyse
//  * @access  Private (module reception, read)
//  */
// const getAnalyse = asyncHandler(async (req, res) => {
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   const analyse = computeAnalyse(reception);
//   res.json({ receptionId: reception._id, ...analyse });
// });

// /**
//  * @desc    Valider la quantité retenue d'un comptage en écart.
//  * @route   POST /api/receptions/:id/valider-ecart
//  * @body    { comptageId, qteValidee }
//  * @access  Private (module reception, write)
//  */
// const validerEcart = asyncHandler(async (req, res) => {
//   const { comptageId, qteValidee } = req.body;
//   const reception = await loadReceptionOwned(req.params.id, req, res);

//   const comptage = reception.comptages.id(comptageId);
//   if (!comptage) {
//     res.status(404);
//     throw new Error("Comptage non trouvé");
//   }

//   const q = parseInt(qteValidee, 10);
//   if (isNaN(q) || q < 0) {
//     res.status(400);
//     throw new Error("Quantité validée invalide");
//   }

//   comptage.qteValidee = q;
//   comptage.validatedAt = new Date();
//   reception.markModified("comptages");
//   await reception.save();

//   res.json(reception);
// });

// /**
//  * @desc    Enregistrer / mettre à jour le commentaire libre de fin de contrôle.
//  * @route   PUT /api/receptions/:id/commentaire
//  * @body    { commentaire }
//  * @access  Private (module reception, write)
//  */
// const updateCommentaire = asyncHandler(async (req, res) => {
//   const { commentaire } = req.body;
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   reception.commentaire = safeTrim(commentaire);
//   await reception.save();
//   res.json(reception);
// });

// // ===========================================
// // GÉNÉRATION DU RAPPORT (PDF + dépôt RCOMMUN + email)
// // ===========================================

// /**
//  * @desc    Générer le rapport PDF, le déposer sur RCOMMUN et l'envoyer par email.
//  *          Clôture la réception (status = "termine").
//  * @route   POST /api/receptions/:id/generer-rapport
//  * @access  Private (module reception, write)
//  */
// const genererRapport = asyncHandler(async (req, res) => {
//   const reception = await loadReceptionOwned(req.params.id, req, res);

//   // Entreprise avec getters (cheminRapportReception) + emails destinataires
//   const entreprise = await Entreprise.findById(reception.entreprise);
//   if (!entreprise) {
//     res.status(404);
//     throw new Error("Entreprise non trouvée");
//   }

//   if (
//     reception.comptages.length === 0 &&
//     reception.lignesCommande.length === 0
//   ) {
//     res.status(400);
//     throw new Error("Réception vide : rien à rapporter");
//   }

//   // Opérateur = utilisateur de la session
//   let operateur = null;
//   try {
//     operateur = await User.findById(reception.user).select("nom prenom");
//   } catch {
//     /* ignore */
//   }

//   // Date de fin de contrôle
//   if (!reception.controleFinAt) reception.controleFinAt = new Date();

//   let resultat;
//   try {
//     resultat = await receptionReportService.genererEtEnvoyerRapport(
//       reception,
//       entreprise,
//       operateur,
//     );
//   } catch (error) {
//     res.status(400);
//     throw new Error(`Génération du rapport impossible: ${error.message}`);
//   }

//   // Fichiers CSV Stock XL (régul d'inventaire + switch renvoi) déposés dans
//   // collect_sec. Ne bloque jamais la clôture de la réception si l'écriture échoue.
//   let fichiersStockXL = null;
//   try {
//     fichiersStockXL = receptionExportService.genererFichiersStockXL(
//       reception,
//       entreprise,
//     );
//   } catch (error) {
//     console.error("[RECEPTION] génération fichiers Stock XL:", error.message);
//     fichiersStockXL = { error: error.message };
//   }

//   reception.status = "termine";
//   reception.rapport = {
//     fileName: resultat.fileName,
//     filePath: resultat.filePath,
//     generatedAt: new Date(),
//     emailTo: resultat.emailTo,
//     emailSentAt: resultat.emailSentAt,
//     emailError: resultat.emailError,
//   };
//   await reception.save();

//   res.json({
//     message: resultat.emailSentAt
//       ? "Rapport généré et envoyé"
//       : "Rapport généré (email non envoyé)",
//     reception,
//     rapport: resultat,
//     fichiersStockXL,
//   });
// });

// /**
//  * @desc    Supprimer / annuler une session de réception.
//  * @route   DELETE /api/receptions/:id
//  * @access  Private (module reception, delete)
//  */
// const deleteReception = asyncHandler(async (req, res) => {
//   const reception = await loadReceptionOwned(req.params.id, req, res);
//   await Reception.deleteOne({ _id: reception._id });
//   res.json({ message: "Réception supprimée" });
// });

// export {
//   // Lecture (commandes à contrôler — DBF)
//   getCommandesAControler,
//   getDetailsCommande,
//   // Sessions
//   createReception,
//   getReceptionsEnCours,
//   getReceptionEnCours,
//   getReceptionById,
//   getArticlesCommande,
//   getHistoriqueReceptions,
//   // Scan & identification
//   scanArticle,
//   rechercheParRef,
//   rechercheParCode,
//   // Comptage
//   addComptage,
//   updateComptage,
//   deleteComptage,
//   // Signalements (problèmes + photos)
//   getSignalementTypes,
//   upsertSignalement,
//   deleteSignalement,
//   // Phase finale
//   terminerScan,
//   getAnalyse,
//   validerEcart,
//   updateCommentaire,
//   // Rapport
//   genererRapport,
//   // Suppression
//   deleteReception,
// };

// backend/controllers/receptionController.js
import asyncHandler from "../middleware/asyncHandler.js";
import commandeCacheService from "../services/commandeService.js";
import articleCacheService from "../services/articleService.js";
import fournissCacheService from "../services/fournissCacheService.js";
import receptionReportService from "../services/receptionReportService.js";
import receptionExportService from "../services/receptionExportService.js";
import Reception from "../models/ReceptionModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import User from "../models/UserModel.js";
import {
  SIGNALEMENT_TYPES,
  SIGNALEMENT_VALUES,
  buildControleCmdDir,
  buildSignalementFileName,
} from "../utils/receptionPaths.js";
import path from "path";
import fs from "fs";

// ===========================================
// CONSTANTES
// ===========================================

// Seuil d'état des commandes éligibles au contrôle de réception.
// Cahier des charges : commandes dont l'état est >= 4 (Bateau / Avion / Local).
// Centralisé ici pour ajustement facile.
const ETAT_MIN_RECEPTION = 4;

// ===========================================
// HELPERS
// ===========================================

const safeTrim = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
};

// Extension de fichier image à partir du type MIME (repli sur "jpg").
const extFromMime = (mime) => {
  const map = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/gif": "gif",
    "image/bmp": "bmp",
  };
  return map[String(mime || "").toLowerCase()] || "jpg";
};

const checkCommandeFiles = (entreprise) => {
  const basePath = path.join(entreprise.cheminBase, entreprise.nomDossierDBF);
  const cmdrefPath = path.join(basePath, "cmdref.dbf");
  const cmdetailPath = path.join(basePath, "cmdetail.dbf");

  if (!fs.existsSync(cmdrefPath)) {
    return {
      exists: false,
      error: `Fichier cmdref.dbf non trouvé pour ${entreprise.nomComplet}`,
    };
  }
  if (!fs.existsSync(cmdetailPath)) {
    return {
      exists: false,
      error: `Fichier cmdetail.dbf non trouvé pour ${entreprise.nomComplet}`,
    };
  }
  return { exists: true };
};

const formatEntreprise = (entreprise) => ({
  _id: entreprise._id,
  nomDossierDBF: entreprise.nomDossierDBF,
  trigramme: entreprise.trigramme,
  nomComplet: entreprise.nomComplet,
});

// Une ligne de détail est un commentaire si son NART contient "!".
const estCommentaire = (record) => safeTrim(record.NART).includes("!");

// Convertit une valeur DBF (Date, AAAAMMJJ, ...) en objet Date ou null.
const toDate = (v) => {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  return commandeCacheService.parseDbfDate(v);
};

const dateToIso = (d) => (d instanceof Date && !isNaN(d.getTime()) ? d.toISOString() : null);

// Libellé d'état depuis le mapping personnalisé de l'entreprise (Map).
const etatLabel = (entreprise, etat) => {
  try {
    const map = entreprise.mappingEtatsCommande;
    if (map && typeof map.get === "function") {
      return map.get(String(etat)) || "";
    }
    if (map && typeof map === "object") {
      return map[String(etat)] || "";
    }
  } catch {
    /* ignore */
  }
  return "";
};

// Résout le nom du fournisseur (module fournisseurs), repli silencieux.
const resolveFournisseurNom = async (entreprise, fourn) => {
  if (fourn === undefined || fourn === null || fourn === "") return "";
  try {
    const f = await fournissCacheService.findByFourn(entreprise, fourn);
    return f ? safeTrim(f.NOM) : "";
  } catch {
    return "";
  }
};

/**
 * Suit la chaîne de renvois d'articles via GENDOUBL (recherche O(1) via cache).
 * Identique à la logique des modules réappro / contrôle commande.
 */
const suivreChaineRenvois = async (entreprise, article) => {
  const MAX_ITERATIONS = 10;
  let currentArticle = article;
  let iterations = 0;
  const chaineRenvois = [];

  const articleOriginal = {
    nart: article.NART ? article.NART.trim() : "",
    gencod: article.GENCOD ? article.GENCOD.trim() : "",
    designation: article.DESIGN ? article.DESIGN.trim() : "",
  };

  while (currentArticle && iterations < MAX_ITERATIONS) {
    const gendoubl = currentArticle.GENDOUBL
      ? currentArticle.GENDOUBL.trim()
      : "";

    if (!gendoubl) break;

    chaineRenvois.push({
      nart: currentArticle.NART ? currentArticle.NART.trim() : "",
      gencod: currentArticle.GENCOD ? currentArticle.GENCOD.trim() : "",
      designation: currentArticle.DESIGN ? currentArticle.DESIGN.trim() : "",
      renvoisVers: gendoubl,
    });

    const nextArticle = await articleCacheService.findByNart(entreprise, gendoubl);
    if (!nextArticle) {
      console.warn(`Renvoi vers article inexistant (NART): ${gendoubl}`);
      break;
    }
    currentArticle = nextArticle;
    iterations++;
  }

  const isRenvoi = chaineRenvois.length > 0;
  return {
    articleFinal: currentArticle,
    isRenvoi,
    articleOriginal: isRenvoi ? articleOriginal : null,
    chaineRenvois: isRenvoi ? chaineRenvois : null,
    nombreRenvois: chaineRenvois.length,
  };
};

// Lecture robuste d'un champ DBF (insensible à la casse / aux espaces de clés).
const lireChamp = (rec, ...names) => {
  if (!rec) return undefined;
  for (const name of names) {
    if (rec[name] !== undefined) return rec[name];
  }
  const targets = names.map((n) => n.toUpperCase());
  for (const k of Object.keys(rec)) {
    if (targets.includes(k.toUpperCase().trim())) return rec[k];
  }
  return undefined;
};

// Nouveauté : un article est une nouveauté si V1..V12 sont TOUS = 0.
// (On exige qu'au moins un champ V soit présent pour éviter de tout signaler
//  lorsque ces colonnes n'existent pas dans le DBF.)
const estArticleNouveau = (art) => {
  if (!art) return false;
  let auMoinsUnPresent = false;
  for (let i = 1; i <= 12; i++) {
    const v = lireChamp(art, `V${i}`, `V${String(i).padStart(2, "0")}`);
    if (v !== undefined) {
      auMoinsUnPresent = true;
      if ((parseFloat(v) || 0) !== 0) return false;
    }
  }
  return auMoinsUnPresent;
};

// Construit le payload "articleInfo" à partir d'un record article résolu.
const buildArticleInfo = (entreprise, code, resultatRenvoi) => {
  const stocksLabels = entreprise.mappingEntrepots || {
    S1: "Magasin",
    S2: "S2",
    S3: "S3",
    S4: "S4",
    S5: "S5",
  };

  if (!resultatRenvoi || !resultatRenvoi.articleFinal) {
    return {
      nart: code,
      gencod: "",
      designation: "Article inconnu",
      refer: "",
      stocks: { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 },
      stocksLabels,
      reserv: 0,
      enReservation: false,
      estNouveau: false,
      isUnknown: true,
      isRenvoi: false,
      articleOriginal: null,
      chaineRenvois: null,
      nombreRenvois: 0,
    };
  }

  const a = resultatRenvoi.articleFinal;
  // Réservations : champ article.RESERV.
  // Lecture robuste : on cherche la clé sans dépendre de la casse/espaces
  // exposées par dbffile (RESERV, et variantes éventuelles).
  const getField = (rec, ...names) => {
    if (!rec) return undefined;
    for (const name of names) {
      if (rec[name] !== undefined) return rec[name];
    }
    const targets = names.map((n) => n.toUpperCase());
    for (const k of Object.keys(rec)) {
      if (targets.includes(k.toUpperCase().trim())) return rec[k];
    }
    return undefined;
  };
  const reserv =
    parseFloat(getField(a, "RESERV", "RESERVE", "RESERVED", "RESA", "RESERVQTE")) ||
    0;
  return {
    nart: a.NART ? a.NART.trim() : code,
    gencod: a.GENCOD ? a.GENCOD.trim() : "",
    designation: a.DESIGN ? a.DESIGN.trim() : "",
    refer: a.REFER ? a.REFER.trim() : "",
    fourn: a.FOURN !== undefined && a.FOURN !== null ? a.FOURN : null,
    reserv, // article.RESERV (nombre de réservations)
    enReservation: reserv > 0,
    estNouveau: estArticleNouveau(a), // V1..V12 tous = 0
    stocks: {
      S1: parseFloat(a.S1) || 0,
      S2: parseFloat(a.S2) || 0,
      S3: parseFloat(a.S3) || 0,
      S4: parseFloat(a.S4) || 0,
      S5: parseFloat(a.S5) || 0,
    },
    stocksLabels,
    isUnknown: false,
    isRenvoi: resultatRenvoi.isRenvoi,
    articleOriginal: resultatRenvoi.articleOriginal,
    chaineRenvois: resultatRenvoi.chaineRenvois,
    nombreRenvois: resultatRenvoi.nombreRenvois,
  };
};

// Calcule l'analyse des écarts (articles non trouvés + écarts trouvés).
const computeAnalyse = (reception) => {
  const comptagesByNart = new Map();
  reception.comptages.forEach((c) => {
    if (c.nart) comptagesByNart.set(c.nart, c);
  });

  // Articles présents dans la commande mais jamais comptés
  const nonTrouves = reception.lignesCommande
    .filter((l) => !comptagesByNart.has(l.nart))
    .map((l) => ({
      nart: l.nart,
      designation: l.designation,
      refer: l.refer,
      gencod: l.gencod,
      qteCommandee: l.qteCommandee,
    }));

  // Écarts : comptages de la commande dont la quantité retenue diffère de la commandée.
  // Présentés du DERNIER article contrôlé au PREMIER.
  const qteCmdByNart = new Map(
    reception.lignesCommande.map((l) => [l.nart, l.qteCommandee]),
  );

  const ecarts = reception.comptages
    .filter((c) => c.dansCommande && c.nart)
    .slice()
    .sort((a, b) => new Date(b.scannedAt) - new Date(a.scannedAt))
    .map((c) => {
      const qteCommandee = qteCmdByNart.get(c.nart) ?? 0;
      const qteRetenue = c.qteValidee != null ? c.qteValidee : c.qteComptee;
      return {
        comptageId: c._id,
        nart: c.nart,
        designation: c.designation,
        refer: c.refer,
        gencod: c.gencod,
        gencodeScanne: c.gencodeScanne,
        qteCommandee,
        qteComptee: c.qteComptee,
        qteValidee: c.qteValidee,
        enReservation: !!c.enReservation,
        nbReservations: c.nbReservations || 0,
        estNouveau: !!c.estNouveau,
        ecart: qteRetenue - qteCommandee,
      };
    })
    .filter((e) => e.ecart !== 0);

  return { nonTrouves, ecarts };
};

// Nom affichable d'un utilisateur (participants / contributions de conflit).
const userNom = (u) =>
  [u?.prenom, u?.nom].filter(Boolean).join(" ").trim() || u?.email || "";

// L'utilisateur participe-t-il déjà au contrôle partagé ? (créateur ou participant)
const estParticipant = (reception, userId) => {
  const uid = userId.toString();
  if (reception.user && reception.user.toString() === uid) return true;
  return (reception.participants || []).some(
    (p) => p.user && p.user.toString() === uid,
  );
};

// Incrémente le compteur de révision -> déclencheur du polling (5 s).
const bumpRevision = (reception) => {
  reception.revision = (reception.revision || 0) + 1;
};

// Ajoute (ou rafraîchit) le participant courant de façon ATOMIQUE (heartbeat).
const touchParticipant = async (receptionId, req) => {
  const uid = req.user._id;
  const now = new Date();
  // Rafraîchit lastSeenAt si déjà participant...
  const upd = await Reception.updateOne(
    { _id: receptionId, "participants.user": uid },
    { $set: { "participants.$.lastSeenAt": now } },
  );
  // ...sinon l'ajoute (sans écraser les autres participants).
  if (!upd.matchedCount) {
    await Reception.updateOne(
      { _id: receptionId, "participants.user": { $ne: uid } },
      {
        $push: {
          participants: {
            user: uid,
            nom: userNom(req.user),
            joinedAt: now,
            lastSeenAt: now,
          },
        },
      },
    );
  }
};

// Charge une session PARTAGÉE et vérifie l'accès (participant, créateur ou admin).
// La permission de module + l'entreprise sont déjà gérées par les middlewares.
const loadReceptionOwned = async (id, req, res) => {
  const reception = await Reception.findById(id);
  if (!reception) {
    res.status(404);
    throw new Error("Réception non trouvée");
  }
  if (req.user.role !== "admin" && !estParticipant(reception, req.user._id)) {
    res.status(403);
    throw new Error("Non autorisé");
  }
  return reception;
};

// ===========================================
// LECTURE — COMMANDES À CONTRÔLER (DBF)
// ===========================================

/**
 * @desc    Liste paginée des commandes éligibles (ETAT >= ETAT_MIN_RECEPTION).
 * @route   GET /api/receptions/a-controler/:nomDossierDBF
 * @query   page, limit, search
 * @access  Private (module reception, read)
 */
const getCommandesAControler = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const startTime = Date.now();

  const check = checkCommandeFiles(entreprise);
  if (!check.exists) {
    res.status(404);
    throw new Error(check.error);
  }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const search = safeTrim(req.query.search).toUpperCase();

  const cache = await commandeCacheService.getCmdRef(entreprise);

  // Filtre ETAT >= seuil
  let resultats = cache.records.filter((record) => {
    const etat = parseInt(record.ETAT);
    if (isNaN(etat) || etat < ETAT_MIN_RECEPTION) return false;
    if (search) {
      const numcde = safeTrim(record.NUMCDE).toUpperCase();
      const bateau = safeTrim(record.BATEAU).toUpperCase();
      if (!numcde.includes(search) && !bateau.includes(search)) return false;
    }
    return true;
  });

  // Tri par date d'arrivée croissante puis numéro de commande
  resultats.sort((a, b) => {
    const da = toDate(a.ARRIVEE);
    const db = toDate(b.ARRIVEE);
    const ta = da ? da.getTime() : Infinity;
    const tb = db ? db.getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    return safeTrim(a.NUMCDE).localeCompare(safeTrim(b.NUMCDE));
  });

  const totalRecords = resultats.length;
  const totalPages = Math.ceil(totalRecords / limit);
  const startIndex = (page - 1) * limit;
  const paginated = resultats.slice(startIndex, startIndex + limit);

  // Résolution du nom fournisseur pour la page courante uniquement
  const commandes = [];
  for (const record of paginated) {
    const fourn =
      record.FOURN !== undefined && record.FOURN !== null ? record.FOURN : null;
    const arrivee = toDate(record.ARRIVEE);
    const datcde = toDate(record.DATCDE);
    const etat = parseInt(record.ETAT);
    commandes.push({
      numcde: safeTrim(record.NUMCDE),
      fourn,
      fournisseurNom: await resolveFournisseurNom(entreprise, fourn),
      bateau: safeTrim(record.BATEAU),
      arrivee: dateToIso(arrivee),
      datcde: dateToIso(datcde),
      observ: safeTrim(record.OBSERV),
      etat: isNaN(etat) ? null : etat,
      etatLabel: etatLabel(entreprise, etat),
    });
  }

  res.json({
    entreprise: formatEntreprise(entreprise),
    etatMin: ETAT_MIN_RECEPTION,
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages,
      hasNextPage: startIndex + limit < totalRecords,
      hasPrevPage: page > 1,
    },
    _queryTime: `${Date.now() - startTime}ms`,
    commandes,
  });
});

/**
 * @desc    Détails (lignes) d'une commande (vérification avant contrôle).
 *          Commentaires (NART contient "!") en tête, puis articles triés par NL.
 *          Inclut la quantité commandée (QTE).
 * @route   GET /api/receptions/a-controler/:nomDossierDBF/:numcde/details
 * @access  Private (module reception, read)
 */
const getDetailsCommande = asyncHandler(async (req, res) => {
  const entreprise = req.entreprise;
  const { numcde } = req.params;
  const startTime = Date.now();

  const check = checkCommandeFiles(entreprise);
  if (!check.exists) {
    res.status(404);
    throw new Error(check.error);
  }

  const entete = await commandeCacheService.findByNumcde(entreprise, numcde);
  const lignesBrutes = await commandeCacheService.getDetailsByNumcde(
    entreprise,
    numcde,
  );

  const commentaires = [];
  const articles = [];

  for (const ligne of lignesBrutes) {
    const isComment = estCommentaire(ligne);
    const formatted = {
      NL: ligne.NL,
      NART: safeTrim(ligne.NART),
      DESIGN: safeTrim(ligne.DESIGN),
      REFER: safeTrim(ligne.REFER),
      QTE: parseFloat(ligne.QTE) || 0,
      isCommentaire: isComment,
    };
    if (isComment) commentaires.push(formatted);
    else articles.push(formatted);
  }

  articles.sort((a, b) => (parseFloat(a.NL) || 0) - (parseFloat(b.NL) || 0));
  const lignes = [...commentaires, ...articles];

  res.json({
    entreprise: formatEntreprise(entreprise),
    numcde: safeTrim(numcde),
    entete: entete || null,
    totalLignes: lignes.length,
    totalArticles: articles.length,
    totalCommentaires: commentaires.length,
    _queryTime: `${Date.now() - startTime}ms`,
    lignes,
  });
});

// ===========================================
// SESSIONS DE RÉCEPTION
// ===========================================

/**
 * @desc    Créer (ou reprendre) une session de réception pour une commande.
 * @route   POST /api/receptions
 * @body    { entrepriseId, numcde, mode? }
 * @access  Private (module reception, write)
 */
const createReception = asyncHandler(async (req, res) => {
  const { entrepriseId, numcde, mode } = req.body;

  if (!numcde || !numcde.trim()) {
    res.status(400);
    throw new Error("Le numéro de commande (numcde) est requis");
  }

  // Le mode "avec réappro" n'est pas encore implémenté (cahier : hors périmètre).
  if (mode && mode !== "sans_reappro") {
    res.status(400);
    throw new Error("Mode de contrôle non disponible");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  const numcdeTrim = numcde.trim();

  const checkFiles = checkCommandeFiles(entreprise);
  if (!checkFiles.exists) {
    res.status(404);
    throw new Error(checkFiles.error);
  }

  const entete = await commandeCacheService.findByNumcde(entreprise, numcdeTrim);
  if (!entete) {
    res.status(404);
    throw new Error(
      "ce numéro de commande n'existe pas, veuillez vérifier ou sélectionner une commande dans la liste",
    );
  }

  // CONTRÔLE PARTAGÉ : rejoindre la session active de CETTE commande si elle
  // existe déjà (peu importe qui l'a ouverte), sinon on en créera une.
  const active = await Reception.findOne({
    entreprise: entrepriseId,
    numcde: numcdeTrim,
    status: { $in: ["en_cours", "analyse_ecarts"] },
  });
  if (active) {
    await touchParticipant(active._id, req);
    const rejointe = await Reception.findById(active._id);
    return res.json(rejointe);
  }

  // Snapshot entête
  const fourn =
    entete.FOURN !== undefined && entete.FOURN !== null ? entete.FOURN : null;
  const commandeInfo = {
    fourn,
    fournisseurNom: await resolveFournisseurNom(entreprise, fourn),
    bateau: safeTrim(entete.BATEAU),
    arrivee: toDate(entete.ARRIVEE),
    datcde: toDate(entete.DATCDE),
    observ: safeTrim(entete.OBSERV),
    etat:
      entete.ETAT !== undefined && entete.ETAT !== null
        ? parseInt(entete.ETAT)
        : null,
  };

  // Snapshot des lignes de commande (référence "Y"), gencode résolu best-effort.
  const lignesBrutes = await commandeCacheService.getDetailsByNumcde(
    entreprise,
    numcdeTrim,
  );

  const lignesCommande = [];
  for (const ligne of lignesBrutes) {
    if (estCommentaire(ligne)) continue;
    const nart = safeTrim(ligne.NART);
    let gencod = "";
    let estNouveau = false;
    let designationArticle = "";
    let desifrnArticle = "";
    try {
      const art = await articleCacheService.findByNart(entreprise, nart);
      if (art && art.GENCOD) gencod = art.GENCOD.trim();
      // Le DESIGN de cmdetail est souvent vide : on retombe sur la base article.
      designationArticle = art ? safeTrim(art.DESIGN) : "";
      // DESIFRN complet (base article) ; le rapport n'en garde que 6 car. dans REFER.
      desifrnArticle = art ? safeTrim(art.DESIFRN) : "";
      estNouveau = estArticleNouveau(art);
    } catch {
      /* ignore */
    }
    lignesCommande.push({
      nl: parseFloat(ligne.NL) || 0,
      nart,
      designation: safeTrim(ligne.DESIGN) || designationArticle,
      refer: desifrnArticle.slice(0, 6) || safeTrim(ligne.REFER).slice(0, 6),
      desifrn: desifrnArticle,
      gencod,
      qteCommandee: parseFloat(ligne.QTE) || 0,
      estNouveau,
    });
  }
  lignesCommande.sort((a, b) => a.nl - b.nl);

  let reception;
  try {
    reception = await Reception.create({
      entreprise: entrepriseId,
      nomDossierDBF: entreprise.nomDossierDBF,
      user: req.user._id,
      numcde: numcdeTrim,
      mode: "sans_reappro",
      commandeInfo,
      lignesCommande,
      comptages: [],
      signalements: [],
      participants: [
        {
          user: req.user._id,
          nom: userNom(req.user),
          joinedAt: new Date(),
          lastSeenAt: new Date(),
        },
      ],
    });
  } catch (err) {
    // Course : un autre utilisateur vient de créer la session active de cette
    // commande (index unique partiel). On rejoint la sienne au lieu d'échouer.
    if (err && err.code === 11000) {
      const existant = await Reception.findOne({
        entreprise: entrepriseId,
        numcde: numcdeTrim,
        status: { $in: ["en_cours", "analyse_ecarts"] },
      });
      if (existant) {
        await touchParticipant(existant._id, req);
        const rejointe = await Reception.findById(existant._id);
        return res.json(rejointe);
      }
    }
    throw err;
  }

  // Précharger le cache des articles (arrière-plan)
  articleCacheService.preload(entreprise).catch((err) => {
    console.error("Erreur préchargement cache:", err);
  });

  res.status(201).json(reception);
});

/**
 * @desc    Sessions de réception EN COURS pour une entreprise (user courant).
 * @route   GET /api/receptions/en-cours/:entrepriseId
 * @access  Private (module reception, read)
 */
const getReceptionsEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;
  const receptions = await Reception.find({
    entreprise: entrepriseId,
    status: { $in: ["en_cours", "analyse_ecarts"] },
    $or: [{ user: req.user._id }, { "participants.user": req.user._id }],
  })
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .sort({ updatedAt: -1 });
  res.json(receptions);
});

/**
 * @desc    Session EN COURS pour une commande précise (user courant).
 * @route   GET /api/receptions/en-cours/:entrepriseId/:numcde
 * @access  Private (module reception, read)
 */
const getReceptionEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId, numcde } = req.params;
  // CONTRÔLE PARTAGÉ : session active de la commande (peu importe qui l'a ouverte).
  let reception = await Reception.findOne({
    entreprise: entrepriseId,
    numcde: numcde.trim(),
    status: { $in: ["en_cours", "analyse_ecarts"] },
  }).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminBase mappingEntrepots mappingEtatsCommande",
  );

  // Rejoindre (participant + heartbeat) puis recharger l'état à jour.
  if (reception) {
    await touchParticipant(reception._id, req);
    reception = await Reception.findById(reception._id).populate(
      "entreprise",
      "nomDossierDBF trigramme nomComplet cheminBase mappingEntrepots mappingEtatsCommande",
    );
  }

  if (reception?.entreprise) {
    articleCacheService.preload(reception.entreprise).catch((err) => {
      console.error("Erreur préchargement cache:", err);
    });
  }

  res.json(reception);
});

/**
 * @desc    Obtenir une session de réception par ID.
 * @route   GET /api/receptions/:id
 * @access  Private (module reception, read)
 */
const getReceptionById = asyncHandler(async (req, res) => {
  const reception = await Reception.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet mappingEntrepots mappingEtatsCommande",
  );
  if (!reception) {
    res.status(404);
    throw new Error("Réception non trouvée");
  }
  if (req.user.role !== "admin" && !estParticipant(reception, req.user._id)) {
    res.status(403);
    throw new Error("Non autorisé");
  }
  res.json(reception);
});

/**
 * @desc    Liste des articles de la commande triés alphabétiquement (liste déroulante).
 * @route   GET /api/receptions/:id/articles-commande
 * @access  Private (module reception, read)
 */
const getArticlesCommande = asyncHandler(async (req, res) => {
  const reception = await loadReceptionOwned(req.params.id, req, res);

  // Repli DESIFRN : les sessions créées avant l'ajout du champ au snapshot ne
  // l'ont pas stocké. On le complète depuis le cache article, sans réécrire le
  // document Mongo. Aucun surcoût pour les sessions récentes (champ déjà présent).
  const desifrnByNart = new Map();
  if (reception.lignesCommande.some((l) => !safeTrim(l.desifrn))) {
    try {
      const entreprise = await Entreprise.findById(reception.entreprise);
      if (entreprise) {
        for (const l of reception.lignesCommande) {
          const nart = safeTrim(l.nart);
          if (!nart || safeTrim(l.desifrn) || desifrnByNart.has(nart)) continue;
          const art = await articleCacheService.findByNart(entreprise, nart);
          if (art) desifrnByNart.set(nart, safeTrim(art.DESIFRN));
        }
      }
    } catch {
      /* repli silencieux : on renvoie le snapshot tel quel */
    }
  }

  const articles = reception.lignesCommande
    .slice()
    .sort((a, b) =>
      safeTrim(a.designation).localeCompare(safeTrim(b.designation), "fr", {
        sensitivity: "base",
      }),
    )
    .map((l) => {
      const obj = typeof l.toObject === "function" ? l.toObject() : { ...l };
      if (!safeTrim(obj.desifrn)) {
        const found = desifrnByNart.get(safeTrim(obj.nart));
        if (found) {
          obj.desifrn = found;
          if (!safeTrim(obj.refer)) obj.refer = found.slice(0, 6);
        }
      }
      return obj;
    });

  res.json({ numcde: reception.numcde, articles });
});

/**
 * @desc    Historique des réceptions de l'utilisateur.
 * @route   GET /api/receptions/historique
 * @query   entrepriseId?, numcde?
 * @access  Private (module reception, read)
 */
const getHistoriqueReceptions = asyncHandler(async (req, res) => {
  const { entrepriseId, numcde } = req.query;
  const query = {
    $or: [{ user: req.user._id }, { "participants.user": req.user._id }],
  };
  if (entrepriseId) query.entreprise = entrepriseId;
  if (numcde) query.numcde = numcde.trim();

  const receptions = await Reception.find(query)
    .populate("entreprise", "nomDossierDBF trigramme nomComplet")
    .sort({ createdAt: -1 })
    .limit(50);
  res.json(receptions);
});

// ===========================================
// SCAN & IDENTIFICATION
// ===========================================

/**
 * @desc    Scanner un article (lecture seule : aucune persistance).
 *          Renvoie l'identification + si l'article est dans la commande.
 * @route   POST /api/receptions/:id/scan
 * @body    { code }
 * @access  Private (module reception, write)
 */
const scanArticle = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const startTime = Date.now();

  const reception = await loadReceptionOwned(req.params.id, req, res);
  if (reception.status === "termine") {
    res.status(400);
    throw new Error("Cette réception est déjà terminée");
  }

  const entreprise = await Entreprise.findById(reception.entreprise);
  const codeTrim = safeTrim(code);

  let resultatRenvoi = null;
  try {
    const article = await articleCacheService.findByCode(entreprise, codeTrim);
    if (article) {
      resultatRenvoi = await suivreChaineRenvois(entreprise, article);
    }
  } catch (error) {
    console.error("Erreur recherche article:", error);
  }

  const articleInfo = buildArticleInfo(entreprise, codeTrim, resultatRenvoi);

  // Présence dans la commande (par NART)
  let dansCommande = false;
  if (!articleInfo.isUnknown && articleInfo.nart) {
    dansCommande = reception.lignesCommande.some(
      (l) => l.nart === articleInfo.nart,
    );
  }

  // statut : reconnu (dans/hors commande) ou inconnu
  const statut = articleInfo.isUnknown
    ? "inconnu"
    : dansCommande
      ? "reconnu_dans_commande"
      : "reconnu_hors_commande";

  // --- Diagnostic réservation (temporaire) ---
  const _af = resultatRenvoi?.articleFinal;
  const _reservKeys = _af
    ? Object.keys(_af).filter((k) => /reserv|resa/i.test(k))
    : [];
  const _debugReserv = {
    reserv: articleInfo.reserv,
    clesReserv: _reservKeys,
    valeursReserv: _reservKeys.map((k) => _af[k]),
    toutesLesCles: _af ? Object.keys(_af) : [],
  };
  console.log(
    `[RECEPTION scan] code=${codeTrim} nart=${articleInfo.nart} ` +
      `reserv=${articleInfo.reserv} clesReserv=${JSON.stringify(_reservKeys)} ` +
      `valeurs=${JSON.stringify(_debugReserv.valeursReserv)}`,
  );

  res.json({
    receptionId: reception._id,
    statut,
    dansCommande,
    gencodeScanne: codeTrim,
    articleInfo,
    _debugReserv,
    _queryTime: `${Date.now() - startTime}ms`,
  });
});

/**
 * @desc    Recherche par référence fournisseur (gencode inconnu).
 *          Recherche parmi TOUTES les références du fournisseur de la commande.
 * @route   POST /api/receptions/:id/recherche-ref
 * @body    { refer }
 * @access  Private (module reception, write)
 */
const rechercheParRef = asyncHandler(async (req, res) => {
  const { refer } = req.body;
  const reception = await loadReceptionOwned(req.params.id, req, res);
  const entreprise = await Entreprise.findById(reception.entreprise);

  const referTrim = safeTrim(refer);
  if (!referTrim) {
    res.status(400);
    throw new Error("La référence fournisseur est requise");
  }

  const fourn = reception.commandeInfo?.fourn;
  let trouve = null;
  try {
    const { articles } = await articleCacheService.search(
      entreprise,
      referTrim,
      { fourn: fourn ?? undefined, limit: 50 },
    );
    // Correspondance exacte de la référence fournisseur (insensible à la casse)
    trouve =
      articles.find(
        (a) => safeTrim(a.REFER).toUpperCase() === referTrim.toUpperCase(),
      ) || null;
  } catch (error) {
    console.error("Erreur recherche référence:", error);
  }

  if (!trouve) {
    res.status(404);
    throw new Error("référence inconnue");
  }

  const resultatRenvoi = await suivreChaineRenvois(entreprise, trouve);
  const articleInfo = buildArticleInfo(entreprise, referTrim, resultatRenvoi);
  const dansCommande = reception.lignesCommande.some(
    (l) => l.nart === articleInfo.nart,
  );

  res.json({ receptionId: reception._id, articleInfo, dansCommande });
});

/**
 * @desc    Recherche par code article (gencode inconnu).
 * @route   POST /api/receptions/:id/recherche-code
 * @body    { nart }
 * @access  Private (module reception, write)
 */
const rechercheParCode = asyncHandler(async (req, res) => {
  const { nart } = req.body;
  const reception = await loadReceptionOwned(req.params.id, req, res);
  const entreprise = await Entreprise.findById(reception.entreprise);

  const nartTrim = safeTrim(nart);
  if (!nartTrim) {
    res.status(400);
    throw new Error("Le code article est requis");
  }

  let article = null;
  try {
    article = await articleCacheService.findByNart(entreprise, nartTrim);
  } catch (error) {
    console.error("Erreur recherche code article:", error);
  }

  if (!article) {
    res.status(404);
    throw new Error("Code article inconnu");
  }

  const resultatRenvoi = await suivreChaineRenvois(entreprise, article);
  const articleInfo = buildArticleInfo(entreprise, nartTrim, resultatRenvoi);
  const dansCommande = reception.lignesCommande.some(
    (l) => l.nart === articleInfo.nart,
  );

  res.json({ receptionId: reception._id, articleInfo, dansCommande });
});

// ===========================================
// COMPTAGE
// ===========================================

/**
 * @desc    Ajouter un comptage (cumul si l'article a déjà été compté).
 * @route   POST /api/receptions/:id/comptages
 * @body    { nart, gencod, designation, refer, gencodeScanne, quantite,
 *            dansCommande, isInconnu, nouveauGencode, stocks, trouveEnPhaseFinale }
 * @access  Private (module reception, write)
 */
const addComptage = asyncHandler(async (req, res) => {
  const {
    nart,
    gencod,
    designation,
    refer,
    gencodeScanne,
    quantite,
    dansCommande,
    isInconnu,
    nouveauGencode,
    stocks,
    trouveEnPhaseFinale,
    enReservation,
    nbReservations,
    estNouveau,
    isRenvoi,
    renvoiGencodeBipe,
    renvoiNartOrigine,
  } = req.body;

  const reception = await loadReceptionOwned(req.params.id, req, res);
  if (reception.status === "termine") {
    res.status(400);
    throw new Error("Cette réception est déjà terminée");
  }

  const q = parseInt(quantite, 10);
  if (isNaN(q) || q < 1) {
    res.status(400);
    throw new Error("Quantité invalide");
  }

  const nartTrim = safeTrim(nart);
  const gencodeScanneTrim = safeTrim(gencodeScanne);

  // Recherche d'un comptage existant (réunification)
  let existing;
  if (isInconnu) {
    existing = reception.comptages.find(
      (c) => c.isInconnu && c.gencodeScanne === gencodeScanneTrim,
    );
  } else if (nartTrim) {
    existing = reception.comptages.find((c) => c.nart && c.nart === nartTrim);
  }

  const me = req.user._id;
  const meNom = userNom(req.user);

  let reunification = false;
  let comptage;

  if (existing) {
    const ownerId = existing.scannedBy ? existing.scannedBy.toString() : null;

    // CONFLIT (2C) : un AUTRE contributeur a déjà compté cet article.
    // On NE fusionne PAS -> on crée/complète un conflit à résoudre manuellement.
    // (Le même contributeur qui re-scanne son propre article -> cumul normal.)
    if (ownerId && ownerId !== me.toString()) {
      let conflit = (reception.conflits || []).find(
        (c) =>
          c.comptageId && c.comptageId.toString() === existing._id.toString(),
      );
      if (conflit) {
        // Conflit déjà ouvert sur cet article : on ajoute la contribution.
        conflit.contributions.push({
          user: me,
          nom: meNom,
          quantite: q,
          at: new Date(),
        });
      } else {
        reception.conflits.push({
          comptageId: existing._id,
          nart: existing.nart,
          gencod: existing.gencod,
          designation: existing.designation,
          refer: existing.refer,
          gencodeScanne: existing.gencodeScanne,
          dansCommande: existing.dansCommande,
          isInconnu: existing.isInconnu,
          stocksSnapshot: existing.stocksSnapshot,
          contributions: [
            {
              user: existing.scannedBy,
              nom: existing.scannedByNom,
              quantite: existing.qteComptee,
              at: existing.scannedAt,
            },
            { user: me, nom: meNom, quantite: q, at: new Date() },
          ],
        });
        conflit = reception.conflits[reception.conflits.length - 1];
      }
      reception.markModified("conflits");
      bumpRevision(reception);
      await reception.save();
      return res.status(409).json({
        reception,
        conflit: true,
        conflitId: conflit._id,
        message:
          "Cet article a déjà été compté par un autre contrôleur : conflit à résoudre.",
      });
    }

    // Même contributeur (ou ligne héritée sans contributeur) -> cumul habituel.
    reunification = true;
    existing.qteComptee += q;
    existing.scannedAt = new Date();
    if (!existing.scannedBy) {
      existing.scannedBy = me;
      existing.scannedByNom = meNom;
    }
    if (nouveauGencode && !existing.nouveauGencode) {
      existing.nouveauGencode = nouveauGencode;
    }
    // Renseigne l'info renvoi si elle n'était pas encore captée sur ce comptage.
    if (isRenvoi && !existing.isRenvoi) {
      existing.isRenvoi = true;
      existing.renvoiGencodeBipe = safeTrim(renvoiGencodeBipe) || gencodeScanneTrim;
      existing.renvoiNartOrigine = safeTrim(renvoiNartOrigine);
    }
    reception.markModified("comptages");
    comptage = existing;
  } else {
    reception.comptages.push({
      nart: nartTrim,
      gencod: safeTrim(gencod),
      designation: safeTrim(designation),
      refer: safeTrim(refer),
      gencodeScanne: gencodeScanneTrim,
      qteComptee: q,
      qteValidee: null,
      dansCommande: !!dansCommande,
      isInconnu: !!isInconnu,
      nouveauGencode: nouveauGencode || null,
      stocksSnapshot: stocks || { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0 },
      enReservation: !!enReservation,
      nbReservations: parseInt(nbReservations, 10) || 0,
      estNouveau: !!estNouveau,
      trouveEnPhaseFinale: !!trouveEnPhaseFinale,
      isRenvoi: !!isRenvoi,
      renvoiGencodeBipe: isRenvoi
        ? safeTrim(renvoiGencodeBipe) || gencodeScanneTrim
        : "",
      renvoiNartOrigine: isRenvoi ? safeTrim(renvoiNartOrigine) : "",
      scannedBy: me,
      scannedByNom: meNom,
    });
    comptage = reception.comptages[reception.comptages.length - 1];
  }

  reception.recalcTotaux();
  bumpRevision(reception);
  await reception.save();

  // Contrôle de quantité : cumul > quantité commandée ?
  let depassement = null;
  if (!isInconnu && nartTrim) {
    const ligne = reception.lignesCommande.find((l) => l.nart === nartTrim);
    if (ligne && comptage.qteComptee > ligne.qteCommandee) {
      depassement = {
        qteCommandee: ligne.qteCommandee,
        qteComptee: comptage.qteComptee,
      };
    }
  }

  res.json({
    reception,
    comptageId: comptage._id,
    reunification,
    depassement,
  });
});

/**
 * @desc    Modifier la quantité d'un comptage (valeur ABSOLUE).
 *          Utilisé pour les choix "Non" / "Annuler et remplacer" du dialogue
 *          de dépassement.
 * @route   PUT /api/receptions/:id/comptages/:comptageId
 * @body    { quantite }
 * @access  Private (module reception, write)
 */
const updateComptage = asyncHandler(async (req, res) => {
  const { quantite } = req.body;
  const reception = await loadReceptionOwned(req.params.id, req, res);
  if (reception.status === "termine") {
    res.status(400);
    throw new Error("Cette réception est déjà terminée");
  }

  const comptage = reception.comptages.id(req.params.comptageId);
  if (!comptage) {
    res.status(404);
    throw new Error("Comptage non trouvé");
  }

  const q = parseInt(quantite, 10);
  if (isNaN(q) || q < 0) {
    res.status(400);
    throw new Error("Quantité invalide");
  }

  comptage.qteComptee = q;
  comptage.scannedAt = new Date();
  reception.markModified("comptages");
  reception.recalcTotaux();
  bumpRevision(reception);
  await reception.save();

  let depassement = null;
  if (!comptage.isInconnu && comptage.nart) {
    const ligne = reception.lignesCommande.find((l) => l.nart === comptage.nart);
    if (ligne && comptage.qteComptee > ligne.qteCommandee) {
      depassement = {
        qteCommandee: ligne.qteCommandee,
        qteComptee: comptage.qteComptee,
      };
    }
  }

  res.json({ reception, depassement });
});

/**
 * @desc    Supprimer un comptage.
 * @route   DELETE /api/receptions/:id/comptages/:comptageId
 * @access  Private (module reception, delete)
 */
const deleteComptage = asyncHandler(async (req, res) => {
  const reception = await loadReceptionOwned(req.params.id, req, res);
  if (reception.status === "termine") {
    res.status(400);
    throw new Error("Cette réception est déjà terminée");
  }
  reception.comptages.pull(req.params.comptageId);
  reception.recalcTotaux();
  bumpRevision(reception);
  await reception.save();
  res.json(reception);
});

// ===========================================
// SIGNALEMENTS (PROBLÈMES ARTICLES + PHOTOS RCOMMUN)
// ===========================================

/**
 * @desc    Liste des types de problème (menu déroulant mobile).
 *          Renvoie { value: label } pour rester synchronisé avec le backend.
 * @route   GET /api/receptions/signalement-types
 * @access  Private
 */
const getSignalementTypes = asyncHandler(async (req, res) => {
  res.json({ types: SIGNALEMENT_TYPES });
});

/**
 * @desc    Créer / remplacer le signalement d'un article (1 max par article) et
 *          déposer la PHOTO directement sur RCOMMUN (dans le dossier de la
 *          commande). La photo est transmise en multipart/form-data (champ "photo").
 * @route   POST /api/receptions/:id/signalements
 * @body    multipart : { type, refKey?, nart?, gencod?, designation?, refer?, photo (fichier) }
 * @access  Private (module reception, write)
 */
const upsertSignalement = asyncHandler(async (req, res) => {
  const reception = await loadReceptionOwned(req.params.id, req, res);
  if (reception.status === "termine") {
    res.status(400);
    throw new Error("Cette réception est déjà terminée");
  }

  const type = safeTrim(req.body.type).toLowerCase();
  if (!SIGNALEMENT_VALUES.includes(type)) {
    res.status(400);
    throw new Error(
      `Type de problème invalide. Valeurs autorisées : ${SIGNALEMENT_VALUES.join(", ")}`,
    );
  }

  // Clé d'unicité : NART si connu, sinon gencode scanné / refKey fourni.
  const nart = safeTrim(req.body.nart);
  const refKey = safeTrim(req.body.refKey) || nart || safeTrim(req.body.gencodeScanne);
  if (!refKey) {
    res.status(400);
    throw new Error("Article non identifié (nart / refKey manquant)");
  }

  // Photo obligatoire (le dépôt de la photo est l'objet du signalement).
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    res.status(400);
    throw new Error("Photo manquante");
  }
  if (!String(req.file.mimetype || "").toLowerCase().startsWith("image/")) {
    res.status(400);
    throw new Error("Le fichier envoyé n'est pas une image");
  }

  // Entreprise (pour trigramme + base collecteur via getter)
  const entreprise = await Entreprise.findById(reception.entreprise);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  // Dossier de la commande sur RCOMMUN (créé si absent)
  let dossier;
  try {
    dossier = buildControleCmdDir(entreprise, reception);
    // [DIAGNOSTIC] Chemin exact où la photo va être déposée. À retirer une fois validé.
    console.log(
      `[RECEPTION signalement] base=${entreprise.cheminRapportReception} | trigramme=${entreprise.trigramme} | dossier=${dossier}`,
    );
    if (!fs.existsSync(dossier)) {
      fs.mkdirSync(dossier, { recursive: true });
    }
  } catch (error) {
    res.status(400);
    throw new Error(
      `Impossible d'accéder au dossier de dépôt: ${error.message}`,
    );
  }

  const ext = extFromMime(req.file.mimetype);
  const fileName = buildSignalementFileName(refKey, type, ext);
  const filePath = path.join(dossier, fileName);

  // Signalement existant pour cet article ?
  const existing = reception.signalements.find(
    (s) => safeTrim(s.refKey) === refKey,
  );

  // Si un ancien fichier photo porte un autre nom, on le supprime (best-effort).
  if (existing && existing.photoFileName && existing.photoFileName !== fileName) {
    const ancien = existing.photoPath || path.join(dossier, existing.photoFileName);
    try {
      if (ancien && fs.existsSync(ancien)) fs.unlinkSync(ancien);
    } catch (e) {
      console.warn("Suppression ancienne photo signalement impossible:", e.message);
    }
  }

  // Écriture directe de la photo sur RCOMMUN
  try {
    fs.writeFileSync(filePath, req.file.buffer);
    console.log(`[RECEPTION signalement] photo écrite: ${filePath} (${req.file.size || req.file.buffer.length} octets)`);
  } catch (error) {
    res.status(400);
    throw new Error(`Écriture de la photo impossible: ${error.message}`);
  }

  const now = new Date();
  const payload = {
    refKey,
    nart,
    gencod: safeTrim(req.body.gencod),
    designation: safeTrim(req.body.designation),
    refer: safeTrim(req.body.refer),
    type,
    photoFileName: fileName,
    photoPath: filePath,
    mimeType: safeTrim(req.file.mimetype),
    taille: req.file.size || req.file.buffer.length || 0,
    user: req.user._id,
    updatedAt: now,
  };

  let signalement;
  if (existing) {
    Object.assign(existing, payload);
    reception.markModified("signalements");
    signalement = existing;
  } else {
    reception.signalements.push({ ...payload, createdAt: now });
    signalement = reception.signalements[reception.signalements.length - 1];
  }

  bumpRevision(reception);
  await reception.save();

  res.status(201).json({ reception, signalement });
});

/**
 * @desc    Supprimer un signalement (et sa photo sur RCOMMUN).
 * @route   DELETE /api/receptions/:id/signalements/:signalementId
 * @access  Private (module reception, delete)
 */
const deleteSignalement = asyncHandler(async (req, res) => {
  const reception = await loadReceptionOwned(req.params.id, req, res);
  if (reception.status === "termine") {
    res.status(400);
    throw new Error("Cette réception est déjà terminée");
  }

  const signalement = reception.signalements.id(req.params.signalementId);
  if (!signalement) {
    res.status(404);
    throw new Error("Signalement non trouvé");
  }

  // Suppression du fichier photo (best-effort)
  const photo = signalement.photoPath || "";
  if (photo) {
    try {
      if (fs.existsSync(photo)) fs.unlinkSync(photo);
    } catch (e) {
      console.warn("Suppression photo signalement impossible:", e.message);
    }
  }

  reception.signalements.pull(req.params.signalementId);
  bumpRevision(reception);
  await reception.save();

  res.json({ reception });
});

// ===========================================
// PHASE FINALE (ANALYSE DES ÉCARTS)
// ===========================================

/**
 * @desc    Terminer le scan -> passe en phase d'analyse des écarts.
 * @route   POST /api/receptions/:id/terminer-scan
 * @access  Private (module reception, write)
 */
const terminerScan = asyncHandler(async (req, res) => {
  const reception = await loadReceptionOwned(req.params.id, req, res);
  if (reception.status === "termine") {
    res.status(400);
    throw new Error("Cette réception est déjà terminée");
  }
  if ((reception.conflits || []).length > 0) {
    res.status(409);
    throw new Error(
      "Des conflits de comptage sont en attente : résolvez-les avant de terminer.",
    );
  }
  reception.status = "analyse_ecarts";
  bumpRevision(reception);
  await reception.save();
  const analyse = computeAnalyse(reception);
  res.json({ reception, analyse });
});

/**
 * @desc    Obtenir l'analyse des écarts (recalcul à la volée).
 * @route   GET /api/receptions/:id/analyse
 * @access  Private (module reception, read)
 */
const getAnalyse = asyncHandler(async (req, res) => {
  const reception = await loadReceptionOwned(req.params.id, req, res);
  const analyse = computeAnalyse(reception);
  res.json({ receptionId: reception._id, ...analyse });
});

/**
 * @desc    Valider la quantité retenue d'un comptage en écart.
 * @route   POST /api/receptions/:id/valider-ecart
 * @body    { comptageId, qteValidee }
 * @access  Private (module reception, write)
 */
const validerEcart = asyncHandler(async (req, res) => {
  const { comptageId, qteValidee } = req.body;
  const reception = await loadReceptionOwned(req.params.id, req, res);

  const comptage = reception.comptages.id(comptageId);
  if (!comptage) {
    res.status(404);
    throw new Error("Comptage non trouvé");
  }

  const q = parseInt(qteValidee, 10);
  if (isNaN(q) || q < 0) {
    res.status(400);
    throw new Error("Quantité validée invalide");
  }

  comptage.qteValidee = q;
  comptage.validatedAt = new Date();
  reception.markModified("comptages");
  bumpRevision(reception);
  await reception.save();

  res.json(reception);
});

/**
 * @desc    Enregistrer / mettre à jour le commentaire libre de fin de contrôle.
 * @route   PUT /api/receptions/:id/commentaire
 * @body    { commentaire }
 * @access  Private (module reception, write)
 */
const updateCommentaire = asyncHandler(async (req, res) => {
  const { commentaire } = req.body;
  const reception = await loadReceptionOwned(req.params.id, req, res);
  reception.commentaire = safeTrim(commentaire);
  bumpRevision(reception);
  await reception.save();
  res.json(reception);
});

// ===========================================
// GÉNÉRATION DU RAPPORT (PDF + dépôt RCOMMUN + email)
// ===========================================

/**
 * @desc    Générer le rapport PDF, le déposer sur RCOMMUN et l'envoyer par email.
 *          Clôture la réception (status = "termine").
 * @route   POST /api/receptions/:id/generer-rapport
 * @access  Private (module reception, write)
 */
const genererRapport = asyncHandler(async (req, res) => {
  const reception = await loadReceptionOwned(req.params.id, req, res);

  // Un seul document/rapport partagé : bloquer tant que des conflits subsistent.
  if ((reception.conflits || []).length > 0) {
    res.status(409);
    throw new Error(
      "Des conflits de comptage sont en attente : résolvez-les avant de générer le rapport.",
    );
  }
  if (reception.status === "termine") {
    res.status(400);
    throw new Error("Cette réception est déjà terminée");
  }

  // Entreprise avec getters (cheminRapportReception) + emails destinataires
  const entreprise = await Entreprise.findById(reception.entreprise);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  if (
    reception.comptages.length === 0 &&
    reception.lignesCommande.length === 0
  ) {
    res.status(400);
    throw new Error("Réception vide : rien à rapporter");
  }

  // Opérateur = utilisateur de la session
  let operateur = null;
  try {
    operateur = await User.findById(reception.user).select("nom prenom");
  } catch {
    /* ignore */
  }

  // Date de fin de contrôle
  if (!reception.controleFinAt) reception.controleFinAt = new Date();

  let resultat;
  try {
    resultat = await receptionReportService.genererEtEnvoyerRapport(
      reception,
      entreprise,
      operateur,
    );
  } catch (error) {
    res.status(400);
    throw new Error(`Génération du rapport impossible: ${error.message}`);
  }

  // Fichiers CSV Stock XL (régul d'inventaire + switch renvoi) déposés dans
  // collect_sec. Ne bloque jamais la clôture de la réception si l'écriture échoue.
  let fichiersStockXL = null;
  try {
    fichiersStockXL = receptionExportService.genererFichiersStockXL(
      reception,
      entreprise,
    );
  } catch (error) {
    console.error("[RECEPTION] génération fichiers Stock XL:", error.message);
    fichiersStockXL = { error: error.message };
  }

  reception.status = "termine";
  reception.rapport = {
    fileName: resultat.fileName,
    filePath: resultat.filePath,
    generatedAt: new Date(),
    generatedBy: req.user._id,
    emailTo: resultat.emailTo,
    emailSentAt: resultat.emailSentAt,
    emailError: resultat.emailError,
  };
  bumpRevision(reception);
  await reception.save();

  res.json({
    message: resultat.emailSentAt
      ? "Rapport généré et envoyé"
      : "Rapport généré (email non envoyé)",
    reception,
    rapport: resultat,
    fichiersStockXL,
  });
});

// ===========================================
// CONTRÔLE PARTAGÉ : ÉTAT (POLLING) + CONFLITS
// ===========================================

/**
 * @desc    État léger d'une session partagée pour le polling (toutes les 5 s).
 *          Rafraîchit aussi le "heartbeat" du participant courant.
 *          Si le client passe ?knownRevision=N et que rien n'a changé, on renvoie
 *          un payload minimal (changed:false) ; sinon la réception complète.
 * @route   GET /api/receptions/:id/state
 * @query   knownRevision?
 * @access  Private (module reception, read)
 */
const getReceptionState = asyncHandler(async (req, res) => {
  const reception = await loadReceptionOwned(req.params.id, req, res);

  // Présence : met à jour lastSeenAt (ou ajoute le participant).
  await touchParticipant(reception._id, req);

  const knownRevision = parseInt(req.query.knownRevision, 10);
  const participants = (reception.participants || []).map((p) => ({
    user: p.user,
    nom: p.nom,
    lastSeenAt: p.lastSeenAt,
  }));

  // Rien de nouveau -> payload minimal (mais on renvoie toujours participants +
  // conflits, qui pilotent l'affichage temps réel).
  if (!isNaN(knownRevision) && knownRevision === (reception.revision || 0)) {
    return res.json({
      changed: false,
      receptionId: reception._id,
      revision: reception.revision || 0,
      status: reception.status,
      totalComptes: reception.totalComptes,
      totalQuantiteComptee: reception.totalQuantiteComptee,
      conflitsCount: (reception.conflits || []).length,
      conflits: reception.conflits || [],
      participants,
    });
  }

  // Changement détecté -> on renvoie la réception complète pour re-render.
  return res.json({
    changed: true,
    revision: reception.revision || 0,
    reception,
  });
});

/**
 * @desc    Résoudre un conflit de doublon (choix manuel).
 *          action : "existant" (garder l'existant) | "nouveau" (garder le dernier
 *          scan) | "addition" (somme des contributions) | "valeur" (quantité saisie).
 * @route   POST /api/receptions/:id/conflits/:conflitId/resolve
 * @body    { action, valeur? }
 * @access  Private (module reception, write)
 */
const resolveConflit = asyncHandler(async (req, res) => {
  const { action, valeur } = req.body;
  const reception = await loadReceptionOwned(req.params.id, req, res);
  if (reception.status === "termine") {
    res.status(400);
    throw new Error("Cette réception est déjà terminée");
  }

  const conflit = reception.conflits.id(req.params.conflitId);
  if (!conflit) {
    // Déjà résolu par un autre contributeur.
    res.status(409);
    throw new Error("Ce conflit a déjà été résolu");
  }

  const contributions = conflit.contributions || [];
  const premiere = contributions[0]?.quantite || 0; // existant
  const derniere = contributions[contributions.length - 1]?.quantite || 0; // nouveau
  const somme = contributions.reduce((s, c) => s + (Number(c.quantite) || 0), 0);

  let nouvelleQte;
  switch (action) {
    case "existant":
      nouvelleQte = premiere;
      break;
    case "nouveau":
      nouvelleQte = derniere;
      break;
    case "addition":
      nouvelleQte = somme;
      break;
    case "valeur": {
      const v = parseInt(valeur, 10);
      if (isNaN(v) || v < 0) {
        res.status(400);
        throw new Error("Valeur invalide");
      }
      nouvelleQte = v;
      break;
    }
    default:
      res.status(400);
      throw new Error(
        "Action invalide (existant | nouveau | addition | valeur)",
      );
  }

  // Applique la quantité retenue sur le comptage concerné.
  const comptage = conflit.comptageId
    ? reception.comptages.id(conflit.comptageId)
    : null;
  if (comptage) {
    comptage.qteComptee = nouvelleQte;
    comptage.scannedAt = new Date();
    reception.markModified("comptages");
  }

  // Retire le conflit résolu.
  reception.conflits.pull(req.params.conflitId);
  reception.recalcTotaux();
  bumpRevision(reception);
  await reception.save();

  res.json({ reception, comptageId: comptage ? comptage._id : null });
});

/**
 * @desc    Supprimer / annuler une session de réception.
 * @route   DELETE /api/receptions/:id
 * @access  Private (module reception, delete)
 */
const deleteReception = asyncHandler(async (req, res) => {
  const reception = await loadReceptionOwned(req.params.id, req, res);
  await Reception.deleteOne({ _id: reception._id });
  res.json({ message: "Réception supprimée" });
});

export {
  // Lecture (commandes à contrôler — DBF)
  getCommandesAControler,
  getDetailsCommande,
  // Sessions
  createReception,
  getReceptionsEnCours,
  getReceptionEnCours,
  getReceptionById,
  getArticlesCommande,
  getHistoriqueReceptions,
  // Scan & identification
  scanArticle,
  rechercheParRef,
  rechercheParCode,
  // Comptage
  addComptage,
  updateComptage,
  deleteComptage,
  // Signalements (problèmes + photos)
  getSignalementTypes,
  upsertSignalement,
  deleteSignalement,
  // Phase finale
  terminerScan,
  getAnalyse,
  validerEcart,
  updateCommentaire,
  // Contrôle partagé (polling + conflits)
  getReceptionState,
  resolveConflit,
  // Rapport
  genererRapport,
  // Suppression
  deleteReception,
};