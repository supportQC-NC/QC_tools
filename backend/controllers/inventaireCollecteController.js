// // backend/controllers/inventaireCollecteController.js
// import asyncHandler from "../middleware/asyncHandler.js";
// import InventaireCollecte from "../models/InventaireCollecteModel.js";
// import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
// import Entreprise from "../models/EntrepriseModel.js";
// import Zone from "../models/ZoneModel.js";
// import articleCacheService from "../services/articleService.js";
// import {
//   construireLignes,
//   ecrirePDF,
// } from "../services/ficheControleService.js";
// import path from "path";
// import fs from "fs";
// import os from "os";

// const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// // ===========================================
// // GÉNÉRATION DU FICHIER .DAT
// // ===========================================
// // Format IDENTIQUE à celui des réappros / inventaires :
// //   CODE(13, justifié à gauche, complété par des espaces) | QTE(8, zéros à gauche) | 000
// //   fin de ligne CRLF (\r\n)
// // Le CODE écrit est le GENCOD (code-barres) si l'article en a un, sinon le NART.
// // Un NART de 6 caractères (ex. "550460") est donc bien suivi de 7 espaces.
// const genererContenuFichier = (lignes) => {
//   let contenu = "";
//   lignes.forEach((ligne) => {
//     let code = "";
//     if (ligne.gencod && ligne.gencod.trim()) {
//       code = ligne.gencod.trim().padEnd(13, " ");
//     } else {
//       code = ligne.nart.trim().padEnd(13, " ");
//     }
//     const quantiteFormatee = ligne.quantite.toString().padStart(8, "0");
//     const suffixe = "000";
//     contenu += `${code}|${quantiteFormatee}|${suffixe}\r\n`;
//   });
//   return contenu;
// };

// // Nom de fichier déposé : "stock.dat <codeZone>" (reconnu par le watcher).
// const nomFichierZone = (zoneCode) =>
//   `stock.dat ${String(zoneCode).trim().replace(/[\\/:*?"<>|]/g, "_")}`;

// /**
//  * Détermine le dossier de dépôt du .DAT :
//  *  - en prod (RCOMMON_STOCK_ROOT défini) : on dépose dans le dossier d'export
//  *    PROPRE À L'ENTREPRISE (cheminExportInventaire, déjà traduit par le getter
//  *    du modèle vers le montage Linux : collect_sec, collect_sec_aw, ...). On
//  *    ignore alors un dossierDat de session stocké en chemin Windows (\\...),
//  *    car les "\" cassent l'écriture sous Linux.
//  *  - en dev (env non défini) : si une session est active → son dossierDat,
//  *    sinon repli sur le cheminExportInventaire de l'entreprise.
//  * Crée le dossier si nécessaire.
//  */
// const resoudreDossierDepot = async (entreprise) => {
//   const session = await InventaireZoneSession.findOne({
//     entreprise: entreprise._id,
//     statut: "actif",
//   });

//   const enProd = !!process.env.RCOMMON_STOCK_ROOT;

//   // En dev uniquement : le dossier de session (chemin Windows) reste prioritaire.
//   if (
//     !enProd &&
//     session &&
//     session.dossierDat &&
//     session.dossierDat.trim()
//   ) {
//     return {
//       dossier: session.dossierDat.trim(),
//       mode: "session",
//       session,
//     };
//   }

//   // Réappro ET inventaire déposent dans le MÊME dossier collect_xxx de l'entité.
//   const dossier =
//     entreprise.cheminExportInventaire || "/mnt/rcommun/STOCK/collect_sec";

//   return { dossier, mode: enProd ? "entite" : "annee", session: session || null };
// };

// /**
//  * Suit la chaîne de renvois GENDOUBL via le cache (recherches O(1)).
//  * Identique à la logique réappro / inventaire.
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

//     const nextArticle = await articleCacheService.findByNart(
//       entreprise,
//       gendoubl,
//     );
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

// // Résumé léger d'une collecte (pour les listes de reprise)
// const collecteResume = (c) => ({
//   _id: c._id,
//   zoneCode: c.zoneCode,
//   zoneLibelle: c.zoneLibelle,
//   zoneType: c.zoneType,
//   status: c.status,
//   totalArticles: c.totalArticles,
//   totalQuantite: c.totalQuantite,
//   updatedAt: c.updatedAt,
// });

// // ===========================================
// // RÉSOLUTION D'UNE ZONE PAR EAN PRINCIPAL
// // ===========================================
// /**
//  * @desc    Identifier une zone à partir d'un code-barres bipé (EAN principal)
//  * @route   POST /api/inventaires-collecte/resoudre-zone
//  * @access  Private
//  * @body    { entrepriseId, code }
//  */
// const resoudreZone = asyncHandler(async (req, res) => {
//   const { entrepriseId, code } = req.body;

//   const c = String(code || "").trim();
//   if (!c) {
//     res.status(400);
//     throw new Error("Code-barres requis");
//   }

//   const entreprise = await Entreprise.findById(entrepriseId);
//   if (!entreprise) {
//     res.status(404);
//     throw new Error("Entreprise non trouvée");
//   }

//   // Recherche prioritaire par EAN principal, puis repli sur les autres EAN
//   // (bipage / papillonnage / contrôle) pour rester tolérant à un mauvais bip.
//   const rx = new RegExp(`^${escapeRegex(c)}$`);
//   let zone = await Zone.findOne({
//     entreprise: entreprise._id,
//     eanPrincipal: rx,
//   });

//   let viaEan = "principal";
//   if (!zone) {
//     zone = await Zone.findOne({
//       entreprise: entreprise._id,
//       $or: [
//         { eanBipage: rx },
//         { eanPapillonnage: rx },
//         { eanControle: rx },
//       ],
//     });
//     if (zone) {
//       viaEan =
//         zone.eanBipage?.trim() === c
//           ? "bipage"
//           : zone.eanPapillonnage?.trim() === c
//             ? "papillonnage"
//             : "controle";
//     }
//   }

//   if (!zone) {
//     return res.json({
//       found: false,
//       message: "Aucune zone ne correspond à ce code",
//     });
//   }

//   // Une collecte est-elle déjà en cours pour cette zone et cet agent ?
//   const enCours = await InventaireCollecte.findOne({
//     entreprise: entreprise._id,
//     user: req.user._id,
//     zoneCode: zone.code,
//     status: "en_cours",
//   });

//   res.json({
//     found: true,
//     viaEan,
//     zone: {
//       code: zone.code,
//       libelle: zone.libelle,
//       type: zone.type,
//       eanPrincipal: zone.eanPrincipal,
//     },
//     enCours: enCours ? collecteResume(enCours) : null,
//   });
// });

// // ===========================================
// // CRÉER / REPRENDRE UNE COLLECTE
// // ===========================================
// /**
//  * @desc    Démarrer (ou reprendre) la collecte d'une zone
//  * @route   POST /api/inventaires-collecte
//  * @access  Private
//  * @body    { entrepriseId, zoneCode }
//  */
// const createCollecte = asyncHandler(async (req, res) => {
//   const { entrepriseId, zoneCode } = req.body;

//   if (!zoneCode || !String(zoneCode).trim()) {
//     res.status(400);
//     throw new Error("Code zone requis");
//   }

//   const entreprise = await Entreprise.findById(entrepriseId);
//   if (!entreprise) {
//     res.status(404);
//     throw new Error("Entreprise non trouvée");
//   }

//   const zone = await Zone.findOne({
//     entreprise: entreprise._id,
//     code: String(zoneCode).trim(),
//   });
//   if (!zone) {
//     res.status(404);
//     throw new Error("Zone non trouvée");
//   }

//   // Reprise si une collecte est déjà en cours pour cette zone
//   const enCours = await InventaireCollecte.findOne({
//     entreprise: entreprise._id,
//     user: req.user._id,
//     zoneCode: zone.code,
//     status: "en_cours",
//   });
//   if (enCours) {
//     articleCacheService.preload(entreprise).catch(() => {});
//     return res.json(enCours);
//   }

//   // Session active éventuelle (pour mémoriser le dossier de dépôt)
//   const session = await InventaireZoneSession.findOne({
//     entreprise: entreprise._id,
//     statut: "actif",
//   });

//   const collecte = await InventaireCollecte.create({
//     entreprise: entreprise._id,
//     nomDossierDBF: entreprise.nomDossierDBF,
//     user: req.user._id,
//     session: session ? session._id : null,
//     sessionNom: session ? session.nom : "",
//     zoneCode: zone.code,
//     zoneLibelle: zone.libelle,
//     zoneType: zone.type,
//     eanPrincipal: zone.eanPrincipal,
//     lignes: [],
//   });

//   // Préchargement du cache article en arrière-plan
//   articleCacheService.preload(entreprise).catch((err) => {
//     console.error("Erreur préchargement cache:", err);
//   });

//   res.status(201).json(collecte);
// });

// // ===========================================
// // LISTE DES COLLECTES EN COURS (reprise)
// // ===========================================
// /**
//  * @desc    Zones en cours de collecte pour l'agent (pour reprise)
//  * @route   GET /api/inventaires-collecte/en-cours/:entrepriseId
//  * @access  Private
//  */
// const getCollectesEnCours = asyncHandler(async (req, res) => {
//   const { entrepriseId } = req.params;

//   const collectes = await InventaireCollecte.find({
//     entreprise: entrepriseId,
//     user: req.user._id,
//     status: "en_cours",
//   }).sort({ updatedAt: -1 });

//   res.json(collectes.map(collecteResume));
// });

// /**
//  * @desc    Obtenir une collecte par ID
//  * @route   GET /api/inventaires-collecte/:id
//  * @access  Private
//  */
// const getCollecteById = asyncHandler(async (req, res) => {
//   const collecte = await InventaireCollecte.findById(req.params.id).populate(
//     "entreprise",
//     "nomDossierDBF trigramme nomComplet cheminExportInventaire cheminBase",
//   );

//   if (!collecte) {
//     res.status(404);
//     throw new Error("Collecte non trouvée");
//   }
//   if (
//     collecte.user.toString() !== req.user._id.toString() &&
//     req.user.role !== "admin"
//   ) {
//     res.status(403);
//     throw new Error("Non autorisé");
//   }

//   res.json(collecte);
// });

// // ===========================================
// // SCAN D'UN ARTICLE
// // ===========================================
// /**
//  * @desc    Scanner un article (résout l'article + chaîne de renvois)
//  * @route   POST /api/inventaires-collecte/:id/scan
//  * @access  Private
//  * @body    { code }
//  */
// const scanArticleCollecte = asyncHandler(async (req, res) => {
//   const { code } = req.body;
//   const startTime = Date.now();

//   const collecte = await InventaireCollecte.findById(req.params.id);
//   if (!collecte) {
//     res.status(404);
//     throw new Error("Collecte non trouvée");
//   }
//   if (collecte.status !== "en_cours") {
//     res.status(400);
//     throw new Error("Cette zone est déjà déposée");
//   }

//   const entreprise = await Entreprise.findById(collecte.entreprise);
//   const dbfPath = path.join(
//     entreprise.cheminBase,
//     entreprise.nomDossierDBF,
//     "article.dbf",
//   );

//   let articleInfo = {
//     nart: code,
//     gencod: "",
//     designation: "Article inconnu",
//     isUnknown: true,
//     isRenvoi: false,
//     articleOriginal: null,
//     chaineRenvois: null,
//     nombreRenvois: 0,
//   };

//   if (fs.existsSync(dbfPath)) {
//     try {
//       const article = await articleCacheService.findByCode(
//         entreprise,
//         code.trim(),
//       );

//       if (article) {
//         const resultatRenvoi = await suivreChaineRenvois(entreprise, article);
//         const articleFinal = resultatRenvoi.articleFinal;

//         articleInfo = {
//           nart: articleFinal.NART ? articleFinal.NART.trim() : code,
//           gencod: articleFinal.GENCOD ? articleFinal.GENCOD.trim() : "",
//           designation: articleFinal.DESIGN ? articleFinal.DESIGN.trim() : "",
//           isUnknown: false,
//           isRenvoi: resultatRenvoi.isRenvoi,
//           articleOriginal: resultatRenvoi.articleOriginal,
//           chaineRenvois: resultatRenvoi.chaineRenvois,
//           nombreRenvois: resultatRenvoi.nombreRenvois,
//         };
//       }
//     } catch (error) {
//       console.error("Erreur recherche article:", error);
//     }
//   }

//   res.json({
//     collecteId: collecte._id,
//     articleInfo,
//     _queryTime: `${Date.now() - startTime}ms`,
//   });
// });

// // ===========================================
// // LIGNES
// // ===========================================
// /**
//  * @desc    Ajouter une ligne (après saisie de la quantité)
//  * @route   POST /api/inventaires-collecte/:id/lignes
//  * @access  Private
//  */
// const addLigneCollecte = asyncHandler(async (req, res) => {
//   const {
//     nart,
//     gencod,
//     designation,
//     quantite,
//     isUnknown,
//     isRenvoi,
//     articleOriginal,
//   } = req.body;

//   const collecte = await InventaireCollecte.findById(req.params.id);
//   if (!collecte) {
//     res.status(404);
//     throw new Error("Collecte non trouvée");
//   }
//   if (collecte.status !== "en_cours") {
//     res.status(400);
//     throw new Error("Cette zone est déjà déposée");
//   }

//   // Cumul si l'article est déjà présent dans la zone
//   const ligneExistante = collecte.lignes.find(
//     (l) => l.nart === nart || (gencod && l.gencod === gencod),
//   );

//   if (ligneExistante) {
//     ligneExistante.quantite += parseInt(quantite, 10);
//     ligneExistante.scannedAt = new Date();
//   } else {
//     collecte.lignes.push({
//       nart,
//       gencod: gencod || "",
//       designation: designation || "",
//       quantite: parseInt(quantite, 10),
//       isUnknown: isUnknown || false,
//       isRenvoi: isRenvoi || false,
//       articleOriginal: articleOriginal || null,
//     });
//   }

//   collecte.calculerTotaux();
//   await collecte.save();

//   res.json(collecte);
// });

// /**
//  * @desc    Modifier la quantité d'une ligne
//  * @route   PUT /api/inventaires-collecte/:id/lignes/:ligneId
//  * @access  Private
//  */
// const updateLigneCollecte = asyncHandler(async (req, res) => {
//   const { quantite } = req.body;
//   const { id, ligneId } = req.params;

//   const collecte = await InventaireCollecte.findById(id);
//   if (!collecte) {
//     res.status(404);
//     throw new Error("Collecte non trouvée");
//   }
//   if (collecte.status !== "en_cours") {
//     res.status(400);
//     throw new Error("Cette zone est déjà déposée");
//   }

//   const ligne = collecte.lignes.id(ligneId);
//   if (!ligne) {
//     res.status(404);
//     throw new Error("Ligne non trouvée");
//   }

//   ligne.quantite = parseInt(quantite, 10);
//   collecte.calculerTotaux();
//   await collecte.save();

//   res.json(collecte);
// });

// /**
//  * @desc    Supprimer une ligne
//  * @route   DELETE /api/inventaires-collecte/:id/lignes/:ligneId
//  * @access  Private
//  */
// const deleteLigneCollecte = asyncHandler(async (req, res) => {
//   const { id, ligneId } = req.params;

//   const collecte = await InventaireCollecte.findById(id);
//   if (!collecte) {
//     res.status(404);
//     throw new Error("Collecte non trouvée");
//   }
//   if (collecte.status !== "en_cours") {
//     res.status(400);
//     throw new Error("Cette zone est déjà déposée");
//   }

//   collecte.lignes.pull(ligneId);
//   collecte.calculerTotaux();
//   await collecte.save();

//   res.json(collecte);
// });

// // ===========================================
// // DÉPÔT DU FICHIER .DAT
// // ===========================================
// /**
//  * @desc    Valider la zone : écrire "stock.dat <codeZone>" dans le dossier de dépôt
//  * @route   POST /api/inventaires-collecte/:id/export
//  * @access  Private
//  */
// const exportCollecte = asyncHandler(async (req, res) => {
//   const collecte = await InventaireCollecte.findById(req.params.id).populate(
//     "entreprise",
//     "nomDossierDBF trigramme nomComplet cheminExportInventaire",
//   );

//   if (!collecte) {
//     res.status(404);
//     throw new Error("Collecte non trouvée");
//   }
//   if (collecte.status !== "en_cours") {
//     res.status(400);
//     throw new Error("Cette zone est déjà déposée");
//   }
//   if (collecte.lignes.length === 0) {
//     res.status(400);
//     throw new Error("La zone est vide");
//   }

//   const contenu = genererContenuFichier(collecte.lignes);
//   const nomFichier = nomFichierZone(collecte.zoneCode);

//   // Dossier de dépôt (en prod : montage ; en dev : session active sinon repli)
//   const { dossier, mode, session } = await resoudreDossierDepot(
//     collecte.entreprise,
//   );

//   try {
//     if (!fs.existsSync(dossier)) {
//       fs.mkdirSync(dossier, { recursive: true });
//     }
//   } catch (error) {
//     res.status(400);
//     throw new Error(
//       `Impossible d'accéder au dossier de dépôt : ${dossier}. Vérifiez les droits d'accès. (${error.message})`,
//     );
//   }

//   const cheminFichier = path.join(dossier, nomFichier);

//   try {
//     fs.writeFileSync(cheminFichier, contenu, "utf8");
//   } catch (error) {
//     res.status(400);
//     throw new Error(`Impossible d'écrire le fichier : ${error.message}`);
//   }

//   collecte.status = "exporte";
//   collecte.fichierExport = nomFichier;
//   collecte.cheminExport = cheminFichier;
//   collecte.modeExport = mode;
//   collecte.exportedAt = new Date();
//   if (session) {
//     collecte.session = session._id;
//     collecte.sessionNom = session.nom;
//   }
//   await collecte.save();

//   res.json({
//     message: "Zone déposée avec succès",
//     collecte: collecteResume(collecte),
//     fichier: {
//       nom: nomFichier,
//       chemin: cheminFichier,
//       dossier,
//       mode, // "session" (impression auto) ou "annee" (repli)
//       sessionNom: session ? session.nom : "",
//       lignes: collecte.lignes.length,
//       totalQuantite: collecte.totalQuantite,
//     },
//   });
// });

// // ===========================================
// // RÉCAP PAR ZONE (session active) + ÉCARTS
// // ===========================================
// /**
//  * @desc    Récapitulatif de la session d'inventaire ACTIVE, regroupé par zone.
//  *          Pour chaque article bipé : écart = quantité bipée − stock théorique
//  *          (stock théorique = S1+S2+S3+S4+S5 lu dans le DBF via le cache).
//  *          Un même article bipé dans plusieurs zones est compté par zone.
//  * @route   GET /api/inventaires-collecte/recap-zones/:entrepriseId
//  * @access  Private/Admin
//  */
// const getRecapZones = asyncHandler(async (req, res) => {
//   const { entrepriseId } = req.params;

//   const entreprise = await Entreprise.findById(entrepriseId);
//   if (!entreprise) {
//     res.status(404);
//     throw new Error("Entreprise non trouvée");
//   }

//   // Session d'inventaire active (peut ne pas exister : on renvoie alors une
//   // structure vide mais valide).
//   const session = await InventaireZoneSession.findOne({
//     entreprise: entreprise._id,
//     statut: "actif",
//   });

//   // Collectes de la session active. Si aucune session, on prend les collectes
//   // non rattachées à une session archivée (sécurité : on borne par session si
//   // elle existe).
//   const filtreCollecte = { entreprise: entreprise._id };
//   if (session) {
//     filtreCollecte.session = session._id;
//   } else {
//     filtreCollecte.session = null;
//   }

//   const collectes = await InventaireCollecte.find(filtreCollecte).sort({
//     zoneCode: 1,
//     updatedAt: 1,
//   });

//   // Pré-charge le cache article (lecture O(1) ensuite). Tolérant aux erreurs.
//   try {
//     await articleCacheService.preload(entreprise);
//   } catch (e) {
//     // on continue : findByNart rechargera au besoin
//   }

//   // Infos article (stock S1..S5, prix d'achat PACHAT, fournisseur FOURN)
//   // via NART puis repli GENCOD.
//   const getInfosArticle = async (nart, gencod) => {
//     let record = null;
//     if (nart && String(nart).trim()) {
//       record = await articleCacheService.findByNart(
//         entreprise,
//         String(nart).trim(),
//       );
//     }
//     if (!record && gencod && String(gencod).trim()) {
//       record = await articleCacheService.findByCode(
//         entreprise,
//         String(gencod).trim(),
//       );
//     }
//     if (!record) {
//       return { stock: 0, prixAchat: 0, fourn: "", trouve: false };
//     }
//     return {
//       stock: articleCacheService.calculateStockTotal(record),
//       prixAchat: parseFloat(record.PACHAT) || 0,
//       fourn: (record.FOURN ? String(record.FOURN) : "").trim(),
//       trouve: true,
//     };
//   };

//   // Regroupement par zone
//   const zonesMap = new Map();

//   for (const collecte of collectes) {
//     const code = collecte.zoneCode || "(sans zone)";
//     if (!zonesMap.has(code)) {
//       zonesMap.set(code, {
//         zoneCode: code,
//         zoneLibelle: collecte.zoneLibelle || "",
//         zoneType: collecte.zoneType || "",
//         lignes: [],
//       });
//     }
//     const zoneEntry = zonesMap.get(code);

//     for (const ligne of collecte.lignes) {
//       const { stock, prixAchat, fourn, trouve } = await getInfosArticle(
//         ligne.nart,
//         ligne.gencod,
//       );
//       const qteBipee = parseFloat(ligne.quantite) || 0;
//       const ecart = qteBipee - stock;
//       const ecartXpf = ecart * prixAchat;

//       // Cumul si le même article (nart) revient dans la même zone
//       const existante = zoneEntry.lignes.find(
//         (l) => l.nart === ligne.nart && l.gencod === (ligne.gencod || ""),
//       );
//       if (existante) {
//         existante.qteBipee += qteBipee;
//         existante.ecart = existante.qteBipee - existante.stockTheorique;
//         existante.ecartXpf = existante.ecart * existante.prixAchat;
//       } else {
//         zoneEntry.lignes.push({
//           nart: ligne.nart,
//           gencod: ligne.gencod || "",
//           designation: ligne.designation || "",
//           qteBipee,
//           stockTheorique: stock,
//           ecart,
//           prixAchat,
//           ecartXpf,
//           fourn,
//           articleTrouve: trouve,
//           isRenvoi: !!ligne.isRenvoi,
//           isUnknown: !!ligne.isUnknown,
//         });
//       }
//     }
//   }

//   // Mise en forme + totaux par zone
//   const zones = Array.from(zonesMap.values()).map((z) => {
//     const totalQteBipee = z.lignes.reduce((s, l) => s + l.qteBipee, 0);
//     const totalStockTheorique = z.lignes.reduce(
//       (s, l) => s + l.stockTheorique,
//       0,
//     );
//     const totalEcart = z.lignes.reduce((s, l) => s + l.ecart, 0);
//     const totalEcartXpf = z.lignes.reduce((s, l) => s + l.ecartXpf, 0);
//     const nbEcarts = z.lignes.filter((l) => l.ecart !== 0).length;
//     return {
//       ...z,
//       totalArticles: z.lignes.length,
//       totalQteBipee,
//       totalStockTheorique,
//       totalEcart,
//       totalEcartXpf,
//       nbEcarts,
//     };
//   });

//   // Regroupement alternatif PAR FOURNISSEUR (toutes zones confondues).
//   // Chaque ligne garde une référence à sa zone d'origine.
//   const fournMap = new Map();
//   zones.forEach((z) => {
//     z.lignes.forEach((l) => {
//       const code = l.fourn || "(sans fournisseur)";
//       if (!fournMap.has(code)) {
//         fournMap.set(code, { fourn: code, lignes: [] });
//       }
//       fournMap.get(code).lignes.push({ ...l, zoneCode: z.zoneCode });
//     });
//   });
//   const fournisseurs = Array.from(fournMap.values())
//     .map((f) => {
//       const totalQteBipee = f.lignes.reduce((s, l) => s + l.qteBipee, 0);
//       const totalStockTheorique = f.lignes.reduce(
//         (s, l) => s + l.stockTheorique,
//         0,
//       );
//       const totalEcart = f.lignes.reduce((s, l) => s + l.ecart, 0);
//       const totalEcartXpf = f.lignes.reduce((s, l) => s + l.ecartXpf, 0);
//       const nbEcarts = f.lignes.filter((l) => l.ecart !== 0).length;
//       return {
//         ...f,
//         totalArticles: f.lignes.length,
//         totalQteBipee,
//         totalStockTheorique,
//         totalEcart,
//         totalEcartXpf,
//         nbEcarts,
//       };
//     })
//     .sort((a, b) => a.fourn.localeCompare(b.fourn));

//   // Totaux globaux
//   const totaux = zones.reduce(
//     (acc, z) => {
//       acc.totalArticles += z.totalArticles;
//       acc.totalQteBipee += z.totalQteBipee;
//       acc.totalStockTheorique += z.totalStockTheorique;
//       acc.totalEcart += z.totalEcart;
//       acc.totalEcartXpf += z.totalEcartXpf;
//       acc.nbEcarts += z.nbEcarts;
//       return acc;
//     },
//     {
//       totalZones: zones.length,
//       totalFournisseurs: fournisseurs.length,
//       totalArticles: 0,
//       totalQteBipee: 0,
//       totalStockTheorique: 0,
//       totalEcart: 0,
//       totalEcartXpf: 0,
//       nbEcarts: 0,
//     },
//   );

//   res.json({
//     entreprise: {
//       _id: entreprise._id,
//       trigramme: entreprise.trigramme,
//       nomComplet: entreprise.nomComplet,
//       nomDossierDBF: entreprise.nomDossierDBF,
//     },
//     session: session
//       ? { _id: session._id, nom: session.nom, statut: session.statut }
//       : null,
//     zones,
//     fournisseurs,
//     totaux,
//   });
// });

// // Nettoie un code zone pour en faire un nom de fichier valide.
// const sanitizeFileName = (s) =>
//   String(s || "zone").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);

// // ===========================================
// // PDF RÉCAP D'UNE ZONE (même moteur que la feuille de contrôle)
// // ===========================================
// /**
//  * @desc    Génère le PDF "fiche de contrôle" d'UNE zone de la session active.
//  *          Réutilise ficheControleService (construireLignes + ecrirePDF) pour
//  *          un rendu IDENTIQUE aux fiches de contrôle. Une zone à la fois.
//  * @route   GET /api/inventaires-collecte/recap-zones/:entrepriseId/pdf
//  * @query   zoneCode (obligatoire)
//  * @access  Private/Admin
//  */
// const getRecapZonePdf = asyncHandler(async (req, res) => {
//   const { entrepriseId } = req.params;
//   const { zoneCode } = req.query;

//   if (!zoneCode) {
//     res.status(400);
//     throw new Error("Paramètre zoneCode obligatoire.");
//   }

//   const entreprise = await Entreprise.findById(entrepriseId);
//   if (!entreprise) {
//     res.status(404);
//     throw new Error("Entreprise non trouvée");
//   }

//   const session = await InventaireZoneSession.findOne({
//     entreprise: entreprise._id,
//     statut: "actif",
//   });

//   const filtreCollecte = {
//     entreprise: entreprise._id,
//     session: session ? session._id : null,
//     zoneCode,
//   };

//   const collectes = await InventaireCollecte.find(filtreCollecte).sort({
//     updatedAt: 1,
//   });

//   if (!collectes.length) {
//     res.status(404);
//     throw new Error("Aucune collecte pour cette zone.");
//   }

//   try {
//     await articleCacheService.preload(entreprise);
//   } catch (e) {
//     // tolérant
//   }

//   // Lignes au format attendu par construireLignes ({ code, quantite }).
//   const lignesDat = [];
//   let zoneLibelle = "";
//   let zoneType = "";
//   for (const collecte of collectes) {
//     zoneLibelle = zoneLibelle || collecte.zoneLibelle || "";
//     zoneType = zoneType || collecte.zoneType || "";
//     for (const ligne of collecte.lignes) {
//       lignesDat.push({
//         code: ligne.gencod || ligne.nart || "",
//         quantite: parseFloat(ligne.quantite) || 0,
//       });
//     }
//   }

//   const { rows } = await construireLignes(entreprise, lignesDat);

//   const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recap-zone-"));
//   const outPath = path.join(
//     tmpDir,
//     `fiche_${sanitizeFileName(zoneCode)}.pdf`,
//   );

//   await ecrirePDF({
//     header: {
//       zoneCode,
//       zoneType,
//       zoneLibelle,
//       date: new Date(),
//     },
//     rows,
//     outPath,
//   });

//   res.setHeader("Content-Type", "application/pdf");
//   res.setHeader(
//     "Content-Disposition",
//     `inline; filename="fiche_zone_${sanitizeFileName(zoneCode)}.pdf"`,
//   );
//   const stream = fs.createReadStream(outPath);
//   stream.pipe(res);
//   stream.on("close", () => {
//     fs.rm(tmpDir, { recursive: true, force: true }, () => {});
//   });
// });

// // ===========================================
// // ANNULER UNE COLLECTE
// // ===========================================
// /**
//  * @desc    Annuler/Supprimer une collecte en cours
//  * @route   DELETE /api/inventaires-collecte/:id
//  * @access  Private
//  */
// const deleteCollecte = asyncHandler(async (req, res) => {
//   const collecte = await InventaireCollecte.findById(req.params.id);
//   if (!collecte) {
//     res.status(404);
//     throw new Error("Collecte non trouvée");
//   }
//   if (collecte.user.toString() !== req.user._id.toString()) {
//     res.status(403);
//     throw new Error("Non autorisé");
//   }

//   await InventaireCollecte.deleteOne({ _id: collecte._id });
//   res.json({ message: "Collecte supprimée" });
// });

// export {
//   resoudreZone,
//   createCollecte,
//   getCollectesEnCours,
//   getCollecteById,
//   scanArticleCollecte,
//   addLigneCollecte,
//   updateLigneCollecte,
//   deleteLigneCollecte,
//   exportCollecte,
//   getRecapZones,
//   getRecapZonePdf,
//   deleteCollecte,
// };

// backend/controllers/inventaireCollecteController.js
import asyncHandler from "../middleware/asyncHandler.js";
import InventaireCollecte from "../models/InventaireCollecteModel.js";
import InventaireZoneSession from "../models/InventaireZoneSessionModel.js";
import Entreprise from "../models/EntrepriseModel.js";
import Zone from "../models/ZoneModel.js";
import articleCacheService from "../services/articleService.js";
import {
  construireLignes,
  ecrirePDF,
  getInventaireDirs,
  emplacementDir,
} from "../services/ficheControleService.js";
import path from "path";
import fs from "fs";
import os from "os";

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ===========================================
// GÉNÉRATION DU FICHIER .DAT
// ===========================================
// Format IDENTIQUE à celui des réappros / inventaires :
//   CODE(13, justifié à gauche, complété par des espaces) | QTE(8, zéros à gauche) | 000
//   fin de ligne CRLF (\r\n)
// Le CODE écrit est le NART en PRIORITÉ, et seulement à défaut le GENCOD.
// Un NART de 6 caractères (ex. "550460") est donc bien suivi de 7 espaces.
const genererContenuFichier = (lignes) => {
  let contenu = "";
  lignes.forEach((ligne) => {
    // Le CODE écrit est le NART de l'article en priorité (référence interne ERP),
    // et uniquement à défaut le GENCOD (code-barres) en repli — cas d'un article
    // sans NART (scan inconnu). Complété par des espaces à droite jusqu'à 13
    // caractères (NART de 6 -> 6 + 7 espaces).
    // La résolution article aval (findByCode) reste GENCOD-d'abord puis NART :
    // un NART de 13 chiffres ne collisionne pas avec un GENCOD en pratique.
    const brut =
      ligne.nart && ligne.nart.trim()
        ? ligne.nart.trim()
        : (ligne.gencod || "").trim();
    const code = brut.padEnd(13, " ");
    const quantiteFormatee = ligne.quantite.toString().padStart(8, "0");
    const suffixe = "000";
    contenu += `${code}|${quantiteFormatee}|${suffixe}\r\n`;
  });
  return contenu;
};

// Nom de fichier déposé : "stock.dat <codeZone>" (reconnu par le watcher).
// On N'AJOUTE PLUS de suffixe d'emplacement : le fichier ne doit porter QUE le
// code de zone, sinon il n'est pas reconnu et part dans zone_non_trouvee.
// Le code de zone est censé être unique (il encode déjà l'emplacement au besoin,
// ex. "B_5d") ; deux collectes du même code dans une session écriraient le même
// fichier (la dernière prime).
// Nom du .DAT déposé. `suffixeEmplacement` n'est utilisé QUE pour départager
// deux zones qui portent le même code à deux emplacements (cf. exportCollecte) :
// dans tous les autres cas le nom reste "stock.dat <code>", tel quel.
const nomFichierZone = (zoneCode, suffixeEmplacement = "") => {
  const nettoyer = (v) => String(v).trim().replace(/[\\/:*?"<>|]/g, "_");
  const code = nettoyer(zoneCode);
  const suffixe = suffixeEmplacement ? `_${nettoyer(suffixeEmplacement)}` : "";
  return `stock.dat ${code}${suffixe}`;
};

/**
 * Détermine le dossier de dépôt du .DAT.
 *
 * RÈGLE CLÉ : le .DAT doit atterrir dans le dossier que SURVEILLE le watcher,
 * sinon il n'est jamais imprimé. Le watcher surveille le dossier de la session
 * = `getInventaireDirs(nom).base` = `config.sharePath` + <nom d'inventaire>.
 *
 * On recalcule ce dossier pour l'ENVIRONNEMENT COURANT à chaque dépôt :
 *  - en dev : config.sharePath = partage Windows UNC (\\...\STOCK) ;
 *  - en prod : config.sharePath = STOCK_SHARE_PATH (montage Linux).
 * Ainsi dépôt et surveillance pointent TOUJOURS le même dossier, quel que soit
 * l'OS — même si `session.dossierDat` avait été figé en chemin Windows lors
 * d'une création depuis un poste dev (Mongo partagé).
 *
 * Repli (aucune session active) : dossier d'export de l'entité (collect_xxx).
 * ⚠ Ce repli n'est PAS surveillé → pas d'impression auto (cas anormal, la porte
 * d'entrée mobile exige une session active).
 * Crée le dossier si nécessaire (fait par l'appelant).
 */
const resoudreDossierDepot = async (entreprise) => {
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  const slug = session && (session.dossierSlug || session.nom);
  if (slug) {
    // Dossier surveillé, recalculé pour l'environnement courant (slug unique
    // horodaté si présent, sinon nom pour les anciennes sessions).
    const dossier = getInventaireDirs(slug).base;
    return { dossier, mode: "session", session };
  }

  // Aucune session active : repli sur le dossier d'export de l'entité.
  const dossier =
    entreprise.cheminExportInventaire || "/mnt/rcommun/STOCK/collect_sec";
  return {
    dossier,
    mode: process.env.RCOMMON_STOCK_ROOT ? "entite" : "annee",
    session: null,
  };
};

/**
 * Suit la chaîne de renvois GENDOUBL via le cache (recherches O(1)).
 * Identique à la logique réappro / inventaire.
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

    const nextArticle = await articleCacheService.findByNart(
      entreprise,
      gendoubl,
    );
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

// Résumé léger d'une collecte (pour les listes de reprise)
const collecteResume = (c) => ({
  _id: c._id,
  zoneCode: c.zoneCode,
  zoneLibelle: c.zoneLibelle,
  zoneType: c.zoneType,
  status: c.status,
  totalArticles: c.totalArticles,
  totalQuantite: c.totalQuantite,
  updatedAt: c.updatedAt,
});

// ===========================================
// RÉSOLUTION D'UNE ZONE PAR EAN PRINCIPAL
// ===========================================
/**
 * @desc    Identifier une zone à partir d'un code-barres bipé (EAN principal)
 * @route   POST /api/inventaires-collecte/resoudre-zone
 * @access  Private
 * @body    { entrepriseId, code }
 */
const resoudreZone = asyncHandler(async (req, res) => {
  const { entrepriseId, code } = req.body;

  const c = String(code || "").trim();
  if (!c) {
    res.status(400);
    throw new Error("Code-barres requis");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  // Recherche prioritaire par EAN principal, puis repli sur les autres EAN
  // (bipage / papillonnage / contrôle) pour rester tolérant à un mauvais bip.
  const rx = new RegExp(`^${escapeRegex(c)}$`);
  // 1) EAN principal (le QR du rayon encode « code|emplacement ») — match exact.
  let zonesFound = await Zone.find({ entreprise: entreprise._id, eanPrincipal: rx });
  let viaEan = "principal";
  // 2) Repli sur les EAN de phase (tolérance à un mauvais bip).
  if (zonesFound.length === 0) {
    const z2 = await Zone.find({
      entreprise: entreprise._id,
      $or: [{ eanBipage: rx }, { eanPapillonnage: rx }, { eanControle: rx }],
    });
    if (z2.length) { zonesFound = z2; viaEan = "phase"; }
  }
  // 3) Code brut : renvoie TOUS les emplacements du code (ambigu MAGASIN/DOCK).
  if (zonesFound.length === 0) {
    zonesFound = await Zone.find({ entreprise: entreprise._id, code: c });
    if (zonesFound.length) viaEan = "code";
  }

  if (zonesFound.length === 0) {
    return res.json({ found: false, message: "Aucune zone ne correspond à ce code" });
  }

  // Pour chaque zone (emplacement) : collecte en cours éventuelle de l'agent,
  // clé par (code + type) pour ne pas confondre MAGASIN et DOCK.
  const zones = [];
  for (const z of zonesFound) {
    // eslint-disable-next-line no-await-in-loop
    const enCours = await InventaireCollecte.findOne({
      entreprise: entreprise._id,
      user: req.user._id,
      zoneCode: z.code,
      zoneType: z.type,
      status: "en_cours",
    });
    zones.push({
      code: z.code,
      libelle: z.libelle,
      type: z.type,
      eanPrincipal: z.eanPrincipal,
      enCours: enCours ? collecteResume(enCours) : null,
    });
  }

  // `zones` = toutes les correspondances (l'app demande MAGASIN/DOCK si > 1).
  // `zone`/`enCours` = 1re correspondance (compat rétro).
  res.json({ found: true, viaEan, zones, zone: zones[0], enCours: zones[0].enCours });
});

// ===========================================
// CRÉER / REPRENDRE UNE COLLECTE
// ===========================================
/**
 * @desc    Démarrer (ou reprendre) la collecte d'une zone
 * @route   POST /api/inventaires-collecte
 * @access  Private
 * @body    { entrepriseId, zoneCode, type? }
 *          `type` (MAGASIN/DOCK) désambiguïse un même code présent aux deux
 *          emplacements → on ouvre la BONNE zone.
 */
const createCollecte = asyncHandler(async (req, res) => {
  const { entrepriseId, zoneCode, type } = req.body;

  if (!zoneCode || !String(zoneCode).trim()) {
    res.status(400);
    throw new Error("Code zone requis");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  const emplacement = type && String(type).trim() ? String(type).trim() : null;
  const zoneQuery = { entreprise: entreprise._id, code: String(zoneCode).trim() };
  if (emplacement) zoneQuery.type = emplacement; // MAGASIN ou DOCK
  const zone = await Zone.findOne(zoneQuery);
  if (!zone) {
    res.status(404);
    throw new Error("Zone non trouvée");
  }

  // Reprise si une collecte est déjà en cours pour cette zone (code + emplacement)
  const enCoursQuery = {
    entreprise: entreprise._id,
    user: req.user._id,
    zoneCode: zone.code,
    status: "en_cours",
  };
  if (emplacement) enCoursQuery.zoneType = zone.type;
  const enCours = await InventaireCollecte.findOne(enCoursQuery);
  if (enCours) {
    articleCacheService.preload(entreprise).catch(() => {});
    return res.json(enCours);
  }

  // Session active éventuelle (pour mémoriser le dossier de dépôt)
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  const collecte = await InventaireCollecte.create({
    entreprise: entreprise._id,
    nomDossierDBF: entreprise.nomDossierDBF,
    user: req.user._id,
    session: session ? session._id : null,
    sessionNom: session ? session.nom : "",
    zoneCode: zone.code,
    zoneLibelle: zone.libelle,
    zoneType: zone.type,
    eanPrincipal: zone.eanPrincipal,
    lignes: [],
  });

  // Préchargement du cache article en arrière-plan
  articleCacheService.preload(entreprise).catch((err) => {
    console.error("Erreur préchargement cache:", err);
  });

  res.status(201).json(collecte);
});

// ===========================================
// LISTE DES COLLECTES EN COURS (reprise)
// ===========================================
/**
 * @desc    Zones en cours de collecte pour l'agent (pour reprise)
 * @route   GET /api/inventaires-collecte/en-cours/:entrepriseId
 * @access  Private
 */
const getCollectesEnCours = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;

  const collectes = await InventaireCollecte.find({
    entreprise: entrepriseId,
    user: req.user._id,
    status: "en_cours",
  }).sort({ updatedAt: -1 });

  res.json(collectes.map(collecteResume));
});

/**
 * @desc    Obtenir une collecte par ID
 * @route   GET /api/inventaires-collecte/:id
 * @access  Private
 */
const getCollecteById = asyncHandler(async (req, res) => {
  const collecte = await InventaireCollecte.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire cheminBase",
  );

  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (
    collecte.user.toString() !== req.user._id.toString() &&
    req.user.role !== "admin"
  ) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  res.json(collecte);
});

// ===========================================
// SCAN D'UN ARTICLE
// ===========================================
/**
 * @desc    Scanner un article (résout l'article + chaîne de renvois)
 * @route   POST /api/inventaires-collecte/:id/scan
 * @access  Private
 * @body    { code }
 */
const scanArticleCollecte = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const startTime = Date.now();

  const collecte = await InventaireCollecte.findById(req.params.id);
  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.status !== "en_cours") {
    res.status(400);
    throw new Error("Cette zone est déjà déposée");
  }

  const entreprise = await Entreprise.findById(collecte.entreprise);
  const dbfPath = path.join(
    entreprise.cheminBase,
    entreprise.nomDossierDBF,
    "article.dbf",
  );

  let articleInfo = {
    nart: code,
    gencod: "",
    designation: "Article inconnu",
    isUnknown: true,
    isRenvoi: false,
    articleOriginal: null,
    chaineRenvois: null,
    nombreRenvois: 0,
  };

  if (fs.existsSync(dbfPath)) {
    try {
      const article = await articleCacheService.findByCode(
        entreprise,
        code.trim(),
      );

      if (article) {
        const resultatRenvoi = await suivreChaineRenvois(entreprise, article);
        const articleFinal = resultatRenvoi.articleFinal;

        articleInfo = {
          nart: articleFinal.NART ? articleFinal.NART.trim() : code,
          gencod: articleFinal.GENCOD ? articleFinal.GENCOD.trim() : "",
          designation: articleFinal.DESIGN ? articleFinal.DESIGN.trim() : "",
          isUnknown: false,
          isRenvoi: resultatRenvoi.isRenvoi,
          articleOriginal: resultatRenvoi.articleOriginal,
          chaineRenvois: resultatRenvoi.chaineRenvois,
          nombreRenvois: resultatRenvoi.nombreRenvois,
        };
      }
    } catch (error) {
      console.error("Erreur recherche article:", error);
    }
  }

  res.json({
    collecteId: collecte._id,
    articleInfo,
    _queryTime: `${Date.now() - startTime}ms`,
  });
});

// ===========================================
// LIGNES
// ===========================================
/**
 * @desc    Ajouter une ligne (après saisie de la quantité)
 * @route   POST /api/inventaires-collecte/:id/lignes
 * @access  Private
 */
const addLigneCollecte = asyncHandler(async (req, res) => {
  const {
    nart,
    gencod,
    designation,
    quantite,
    isUnknown,
    isRenvoi,
    articleOriginal,
  } = req.body;

  const collecte = await InventaireCollecte.findById(req.params.id);
  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.status !== "en_cours") {
    res.status(400);
    throw new Error("Cette zone est déjà déposée");
  }

  // Cumul si l'article est déjà présent dans la zone
  const ligneExistante = collecte.lignes.find(
    (l) => l.nart === nart || (gencod && l.gencod === gencod),
  );

  if (ligneExistante) {
    ligneExistante.quantite += parseInt(quantite, 10);
    ligneExistante.scannedAt = new Date();
  } else {
    collecte.lignes.push({
      nart,
      gencod: gencod || "",
      designation: designation || "",
      quantite: parseInt(quantite, 10),
      isUnknown: isUnknown || false,
      isRenvoi: isRenvoi || false,
      articleOriginal: articleOriginal || null,
    });
  }

  collecte.calculerTotaux();
  await collecte.save();

  res.json(collecte);
});

/**
 * @desc    Modifier la quantité d'une ligne
 * @route   PUT /api/inventaires-collecte/:id/lignes/:ligneId
 * @access  Private
 */
const updateLigneCollecte = asyncHandler(async (req, res) => {
  const { quantite } = req.body;
  const { id, ligneId } = req.params;

  const collecte = await InventaireCollecte.findById(id);
  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.status !== "en_cours") {
    res.status(400);
    throw new Error("Cette zone est déjà déposée");
  }

  const ligne = collecte.lignes.id(ligneId);
  if (!ligne) {
    res.status(404);
    throw new Error("Ligne non trouvée");
  }

  ligne.quantite = parseInt(quantite, 10);
  collecte.calculerTotaux();
  await collecte.save();

  res.json(collecte);
});

/**
 * @desc    Supprimer une ligne
 * @route   DELETE /api/inventaires-collecte/:id/lignes/:ligneId
 * @access  Private
 */
const deleteLigneCollecte = asyncHandler(async (req, res) => {
  const { id, ligneId } = req.params;

  const collecte = await InventaireCollecte.findById(id);
  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.status !== "en_cours") {
    res.status(400);
    throw new Error("Cette zone est déjà déposée");
  }

  collecte.lignes.pull(ligneId);
  collecte.calculerTotaux();
  await collecte.save();

  res.json(collecte);
});

// ===========================================
// DÉPÔT DU FICHIER .DAT
// ===========================================
/**
 * @desc    Valider la zone : écrire "stock.dat <codeZone>" dans le dossier de dépôt
 * @route   POST /api/inventaires-collecte/:id/export
 * @access  Private
 */
const exportCollecte = asyncHandler(async (req, res) => {
  const collecte = await InventaireCollecte.findById(req.params.id).populate(
    "entreprise",
    "nomDossierDBF trigramme nomComplet cheminExportInventaire",
  );

  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.status !== "en_cours") {
    res.status(400);
    throw new Error("Cette zone est déjà déposée");
  }
  if (collecte.lignes.length === 0) {
    res.status(400);
    throw new Error("La zone est vide");
  }

  const contenu = genererContenuFichier(collecte.lignes);

  // Dossier de dépôt (en prod : montage ; en dev : session active sinon repli)
  const { dossier: dossierBase, mode, session } = await resoudreDossierDepot(
    collecte.entreprise,
  );

  // Dépôt À LA RACINE du dossier de l'inventaire : c'est là que l'équipe ouvre
  // le dossier et s'attend à voir ses .DAT. (Le dépôt dans un sous-dossier par
  // emplacement, en place du 03/08 au 21/08/2026, rendait les fichiers
  // invisibles pour qui regardait la racine.)
  //
  // ⚠️ Un même code de zone peut exister à DEUX emplacements (chez QC, A_1 est
  // à la fois "Ventilateurs muraux / MAGASIN" et "EPI GANTS / DOCK") : à la
  // racine, deux fichiers de même nom s'écraseraient et le watcher ne pourrait
  // pas savoir de quelle zone il s'agit. DANS CE CAS SEULEMENT, on suffixe le
  // nom par l'emplacement (stock.dat A_1_DOCK) — le watcher sait le relire.
  const dossier = dossierBase;
  const nbZonesMemeCode = await Zone.countDocuments({
    entreprise: collecte.entreprise._id,
    code: collecte.zoneCode,
  });
  const nomFichier = nomFichierZone(
    collecte.zoneCode,
    nbZonesMemeCode > 1 ? emplacementDir(collecte.zoneType) : "",
  );

  try {
    if (!fs.existsSync(dossier)) {
      fs.mkdirSync(dossier, { recursive: true });
    }
  } catch (error) {
    res.status(400);
    throw new Error(
      `Impossible d'accéder au dossier de dépôt : ${dossier}. Vérifiez les droits d'accès. (${error.message})`,
    );
  }

  const cheminFichier = path.join(dossier, nomFichier);

  try {
    fs.writeFileSync(cheminFichier, contenu, "utf8");
  } catch (error) {
    res.status(400);
    throw new Error(`Impossible d'écrire le fichier : ${error.message}`);
  }

  collecte.status = "exporte";
  collecte.fichierExport = nomFichier;
  collecte.cheminExport = cheminFichier;
  collecte.modeExport = mode;
  collecte.exportedAt = new Date();
  // Observation facultative saisie par l'agent dans la modale de dépôt du
  // collecteur ; elle remonte telle quelle dans l'écran « Suivi bipage ».
  if (req.body && req.body.observation !== undefined) {
    collecte.observationAgent = String(req.body.observation || "").trim();
  }
  if (session) {
    collecte.session = session._id;
    collecte.sessionNom = session.nom;
  }
  await collecte.save();

  res.json({
    message: "Zone déposée avec succès",
    collecte: collecteResume(collecte),
    fichier: {
      nom: nomFichier,
      chemin: cheminFichier,
      dossier,
      mode, // "session" (impression auto) ou "annee" (repli)
      sessionNom: session ? session.nom : "",
      lignes: collecte.lignes.length,
      totalQuantite: collecte.totalQuantite,
    },
  });
});

// ===========================================
// RÉCAP PAR ZONE (session active) + ÉCARTS
// ===========================================
/**
 * @desc    Récapitulatif de la session d'inventaire ACTIVE, regroupé par zone.
 *          Pour chaque article bipé : écart = quantité bipée − stock théorique
 *          (stock théorique = S1+S2+S3+S4+S5 lu dans le DBF via le cache).
 *          Un même article bipé dans plusieurs zones est compté par zone.
 * @route   GET /api/inventaires-collecte/recap-zones/:entrepriseId
 * @access  Private/Admin
 */
const getRecapZones = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  // Session d'inventaire active (peut ne pas exister : on renvoie alors une
  // structure vide mais valide).
  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  // Collectes de la session active. Si aucune session, on prend les collectes
  // non rattachées à une session archivée (sécurité : on borne par session si
  // elle existe).
  const filtreCollecte = { entreprise: entreprise._id };
  if (session) {
    filtreCollecte.session = session._id;
  } else {
    filtreCollecte.session = null;
  }

  const collectes = await InventaireCollecte.find(filtreCollecte).sort({
    zoneCode: 1,
    updatedAt: 1,
  });

  // Pré-charge le cache article (lecture O(1) ensuite). Tolérant aux erreurs.
  try {
    await articleCacheService.preload(entreprise);
  } catch (e) {
    // on continue : findByNart rechargera au besoin
  }

  // Infos article (stock S1..S5, prix d'achat PACHAT, fournisseur FOURN)
  // via NART puis repli GENCOD.
  const getInfosArticle = async (nart, gencod) => {
    let record = null;
    if (nart && String(nart).trim()) {
      record = await articleCacheService.findByNart(
        entreprise,
        String(nart).trim(),
      );
    }
    if (!record && gencod && String(gencod).trim()) {
      record = await articleCacheService.findByCode(
        entreprise,
        String(gencod).trim(),
      );
    }
    if (!record) {
      return { stock: 0, prixAchat: 0, fourn: "", trouve: false };
    }
    return {
      stock: articleCacheService.calculateStockTotal(record),
      prixAchat: parseFloat(record.PACHAT) || 0,
      fourn: (record.FOURN ? String(record.FOURN) : "").trim(),
      trouve: true,
    };
  };

  // Regroupement par zone
  const zonesMap = new Map();

  for (const collecte of collectes) {
    const code = collecte.zoneCode || "(sans zone)";
    if (!zonesMap.has(code)) {
      zonesMap.set(code, {
        zoneCode: code,
        zoneLibelle: collecte.zoneLibelle || "",
        zoneType: collecte.zoneType || "",
        lignes: [],
      });
    }
    const zoneEntry = zonesMap.get(code);

    for (const ligne of collecte.lignes) {
      const { stock, prixAchat, fourn, trouve } = await getInfosArticle(
        ligne.nart,
        ligne.gencod,
      );
      const qteBipee = parseFloat(ligne.quantite) || 0;
      const ecart = qteBipee - stock;
      const ecartXpf = ecart * prixAchat;

      // Cumul si le même article (nart) revient dans la même zone
      const existante = zoneEntry.lignes.find(
        (l) => l.nart === ligne.nart && l.gencod === (ligne.gencod || ""),
      );
      if (existante) {
        existante.qteBipee += qteBipee;
        existante.ecart = existante.qteBipee - existante.stockTheorique;
        existante.ecartXpf = existante.ecart * existante.prixAchat;
      } else {
        zoneEntry.lignes.push({
          nart: ligne.nart,
          gencod: ligne.gencod || "",
          designation: ligne.designation || "",
          qteBipee,
          stockTheorique: stock,
          ecart,
          prixAchat,
          ecartXpf,
          fourn,
          articleTrouve: trouve,
          isRenvoi: !!ligne.isRenvoi,
          isUnknown: !!ligne.isUnknown,
        });
      }
    }
  }

  // Mise en forme + totaux par zone
  const zones = Array.from(zonesMap.values()).map((z) => {
    const totalQteBipee = z.lignes.reduce((s, l) => s + l.qteBipee, 0);
    const totalStockTheorique = z.lignes.reduce(
      (s, l) => s + l.stockTheorique,
      0,
    );
    const totalEcart = z.lignes.reduce((s, l) => s + l.ecart, 0);
    const totalEcartXpf = z.lignes.reduce((s, l) => s + l.ecartXpf, 0);
    const nbEcarts = z.lignes.filter((l) => l.ecart !== 0).length;
    return {
      ...z,
      totalArticles: z.lignes.length,
      totalQteBipee,
      totalStockTheorique,
      totalEcart,
      totalEcartXpf,
      nbEcarts,
    };
  });

  // Regroupement alternatif PAR FOURNISSEUR (toutes zones confondues).
  // Chaque ligne garde une référence à sa zone d'origine.
  const fournMap = new Map();
  zones.forEach((z) => {
    z.lignes.forEach((l) => {
      const code = l.fourn || "(sans fournisseur)";
      if (!fournMap.has(code)) {
        fournMap.set(code, { fourn: code, lignes: [] });
      }
      fournMap.get(code).lignes.push({ ...l, zoneCode: z.zoneCode });
    });
  });
  const fournisseurs = Array.from(fournMap.values())
    .map((f) => {
      const totalQteBipee = f.lignes.reduce((s, l) => s + l.qteBipee, 0);
      const totalStockTheorique = f.lignes.reduce(
        (s, l) => s + l.stockTheorique,
        0,
      );
      const totalEcart = f.lignes.reduce((s, l) => s + l.ecart, 0);
      const totalEcartXpf = f.lignes.reduce((s, l) => s + l.ecartXpf, 0);
      const nbEcarts = f.lignes.filter((l) => l.ecart !== 0).length;
      return {
        ...f,
        totalArticles: f.lignes.length,
        totalQteBipee,
        totalStockTheorique,
        totalEcart,
        totalEcartXpf,
        nbEcarts,
      };
    })
    .sort((a, b) => a.fourn.localeCompare(b.fourn));

  // Totaux globaux
  const totaux = zones.reduce(
    (acc, z) => {
      acc.totalArticles += z.totalArticles;
      acc.totalQteBipee += z.totalQteBipee;
      acc.totalStockTheorique += z.totalStockTheorique;
      acc.totalEcart += z.totalEcart;
      acc.totalEcartXpf += z.totalEcartXpf;
      acc.nbEcarts += z.nbEcarts;
      return acc;
    },
    {
      totalZones: zones.length,
      totalFournisseurs: fournisseurs.length,
      totalArticles: 0,
      totalQteBipee: 0,
      totalStockTheorique: 0,
      totalEcart: 0,
      totalEcartXpf: 0,
      nbEcarts: 0,
    },
  );

  res.json({
    entreprise: {
      _id: entreprise._id,
      trigramme: entreprise.trigramme,
      nomComplet: entreprise.nomComplet,
      nomDossierDBF: entreprise.nomDossierDBF,
    },
    session: session
      ? { _id: session._id, nom: session.nom, statut: session.statut }
      : null,
    zones,
    fournisseurs,
    totaux,
  });
});

// Nettoie un code zone pour en faire un nom de fichier valide.
const sanitizeFileName = (s) =>
  String(s || "zone").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);

// ===========================================
// PDF RÉCAP D'UNE ZONE (même moteur que la feuille de contrôle)
// ===========================================
/**
 * @desc    Génère le PDF "fiche de contrôle" d'UNE zone de la session active.
 *          Réutilise ficheControleService (construireLignes + ecrirePDF) pour
 *          un rendu IDENTIQUE aux fiches de contrôle. Une zone à la fois.
 * @route   GET /api/inventaires-collecte/recap-zones/:entrepriseId/pdf
 * @query   zoneCode (obligatoire)
 * @access  Private/Admin
 */
const getRecapZonePdf = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;
  const { zoneCode } = req.query;

  if (!zoneCode) {
    res.status(400);
    throw new Error("Paramètre zoneCode obligatoire.");
  }

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  const session = await InventaireZoneSession.findOne({
    entreprise: entreprise._id,
    statut: "actif",
  });

  const filtreCollecte = {
    entreprise: entreprise._id,
    session: session ? session._id : null,
    zoneCode,
  };

  const collectes = await InventaireCollecte.find(filtreCollecte).sort({
    updatedAt: 1,
  });

  if (!collectes.length) {
    res.status(404);
    throw new Error("Aucune collecte pour cette zone.");
  }

  try {
    await articleCacheService.preload(entreprise);
  } catch (e) {
    // tolérant
  }

  // Lignes au format attendu par construireLignes ({ code, quantite }).
  const lignesDat = [];
  let zoneLibelle = "";
  let zoneType = "";
  for (const collecte of collectes) {
    zoneLibelle = zoneLibelle || collecte.zoneLibelle || "";
    zoneType = zoneType || collecte.zoneType || "";
    for (const ligne of collecte.lignes) {
      lignesDat.push({
        code: ligne.gencod || ligne.nart || "",
        quantite: parseFloat(ligne.quantite) || 0,
      });
    }
  }

  const { rows } = await construireLignes(entreprise, lignesDat);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "recap-zone-"));
  const outPath = path.join(
    tmpDir,
    `fiche_${sanitizeFileName(zoneCode)}.pdf`,
  );

  await ecrirePDF({
    header: {
      zoneCode,
      zoneType,
      zoneLibelle,
      date: new Date(),
    },
    rows,
    outPath,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="fiche_zone_${sanitizeFileName(zoneCode)}.pdf"`,
  );
  const stream = fs.createReadStream(outPath);
  stream.pipe(res);
  stream.on("close", () => {
    fs.rm(tmpDir, { recursive: true, force: true }, () => {});
  });
});

// ===========================================
// ANNULER UNE COLLECTE
// ===========================================
/**
 * @desc    Annuler/Supprimer une collecte en cours
 * @route   DELETE /api/inventaires-collecte/:id
 * @access  Private
 */
const deleteCollecte = asyncHandler(async (req, res) => {
  const collecte = await InventaireCollecte.findById(req.params.id);
  if (!collecte) {
    res.status(404);
    throw new Error("Collecte non trouvée");
  }
  if (collecte.user.toString() !== req.user._id.toString()) {
    res.status(403);
    throw new Error("Non autorisé");
  }

  await InventaireCollecte.deleteOne({ _id: collecte._id });
  res.json({ message: "Collecte supprimée" });
});

// @desc    Indique si un inventaire (session ZONE) est EN COURS pour l'entreprise.
//          Sert de porte d'entrée à l'app mobile : on n'entre dans l'inventaire
//          que s'il y a une session active (sinon le dépôt .dat ne serait pas
//          surveillé/imprimé).
// @route   GET /api/inventaires-collecte/session-active/:entrepriseId
// @access  Private
const getSessionActive = asyncHandler(async (req, res) => {
  const session = await InventaireZoneSession.findOne({
    entreprise: req.params.entrepriseId,
    statut: "actif",
  }).select("nom totalZones createdAt");
  res.json({
    active: !!session,
    session: session
      ? {
          _id: session._id,
          nom: session.nom,
          totalZones: session.totalZones,
          createdAt: session.createdAt,
        }
      : null,
  });
});

// ===========================================
// SUIVI BIPAGE (écran web « Suivi bipage »)
// ===========================================

// Au-delà de ce silence entre deux scans, on considère que l'agent a fait autre
// chose (pause, appel, réappro) : l'intervalle n'entre pas dans le temps de
// bipage EFFECTIF. Même seuil et même raisonnement que le module réappro.
const PAUSE_BIPAGE_MS = 5 * 60 * 1000;

/**
 * Temps d'un bipage, reconstitué a posteriori depuis les horodatages.
 *
 * - `brut`   : entrée dans la zone (createdAt) → dépôt (exportedAt). Il inclut
 *              les pauses et les reprises : une zone ouverte le matin et
 *              déposée le soir affiche 8 h de brut pour 20 min de travail.
 * - `actif`  : somme des intervalles entre événements consécutifs, ceux de plus
 *              de PAUSE_BIPAGE_MS exclus. La chaîne part de l'entrée dans la
 *              zone et va jusqu'au dépôt : un bipage d'un seul article n'est
 *              donc pas compté 0.
 *
 * ⚠️ `lignes[].scannedAt` porte la date du DERNIER scan de la ligne (rescanner
 * un article déjà compté cumule la quantité et rafraîchit la date) : le nombre
 * d'événements est donc un minorant du nombre réel de scans.
 */
const calculerTempsBipage = (collecte) => {
  const scans = (collecte.lignes || [])
    .map((l) => (l.scannedAt ? new Date(l.scannedAt).getTime() : null))
    .filter((t) => t && !isNaN(t))
    .sort((a, b) => a - b);

  const debut = collecte.createdAt ? new Date(collecte.createdAt).getTime() : null;
  const fin = collecte.exportedAt ? new Date(collecte.exportedAt).getTime() : null;

  // Chaîne complète des événements : entrée → scans → dépôt. Le tri est une
  // sécurité : les horloges du serveur et du collecteur peuvent diverger, et un
  // jalon dans le désordre produirait un intervalle négatif silencieux.
  const jalons = [debut, ...scans, fin]
    .filter((t) => t && !isNaN(t))
    .sort((a, b) => a - b);
  let actifMs = 0;
  for (let i = 1; i < jalons.length; i += 1) {
    const delta = jalons[i] - jalons[i - 1];
    if (delta > 0 && delta <= PAUSE_BIPAGE_MS) actifMs += delta;
  }

  const dernierEvenement = fin || (scans.length ? scans[scans.length - 1] : null);
  const brutMs = debut && dernierEvenement ? Math.max(0, dernierEvenement - debut) : 0;

  return {
    premierScanAt: scans.length ? new Date(scans[0]) : null,
    dernierScanAt: scans.length ? new Date(scans[scans.length - 1]) : null,
    nbScans: scans.length,
    tempsActifMs: actifMs,
    tempsBrutMs: brutMs,
  };
};

const nomUtilisateur = (u) => {
  if (!u) return "";
  const complet = `${u.prenom || ""} ${u.nom || ""}`.trim();
  return complet || u.email || "";
};

/**
 * @desc    Suivi des bipages : qui a bipé quelle zone, quand, combien de temps,
 *          et l'observation laissée par l'agent ou par le suivi.
 * @route   GET /api/inventaires-collecte/suivi-bipage/:entrepriseId
 * @query   session=active|toutes|<id> · statut=en_cours|exporte · search=
 * @access  Private (module inventaire, read)
 */
const getSuiviBipage = asyncHandler(async (req, res) => {
  const { entrepriseId } = req.params;
  const { session: sessionFiltre = "active", statut = "", search = "" } = req.query;

  const entreprise = await Entreprise.findById(entrepriseId);
  if (!entreprise) {
    res.status(404);
    throw new Error("Entreprise non trouvée");
  }

  // Sessions connues (sélecteur de l'écran). ⚠️ Réinitialiser un inventaire
  // purge les collectes : en pratique seule la session courante a des bipages.
  const sessions = await InventaireZoneSession.find({ entreprise: entreprise._id })
    .select("nom statut createdAt archivedAt")
    .sort({ createdAt: -1 })
    .lean();
  const sessionActive = sessions.find((s) => s.statut === "actif") || null;

  const filtre = { entreprise: entreprise._id };
  if (sessionFiltre === "active") {
    // Même convention que le récap par zone : borné à la session active, ou
    // aux collectes hors session s'il n'y en a pas.
    filtre.session = sessionActive ? sessionActive._id : null;
  } else if (sessionFiltre && sessionFiltre !== "toutes") {
    filtre.session = sessionFiltre;
  }
  if (statut === "en_cours" || statut === "exporte") filtre.status = statut;

  const collectes = await InventaireCollecte.find(filtre)
    .populate("user", "nom prenom email")
    .populate("observationPar", "nom prenom email")
    .sort({ createdAt: -1 })
    .lean();

  let bipages = collectes.map((c) => {
    const temps = calculerTempsBipage(c);
    return {
      _id: c._id,
      zoneCode: c.zoneCode,
      zoneLibelle: c.zoneLibelle,
      zoneType: c.zoneType,
      sessionNom: c.sessionNom,
      status: c.status,
      agent: c.user
        ? { _id: c.user._id, nom: nomUtilisateur(c.user), email: c.user.email }
        : null,
      debutAt: c.createdAt,
      finAt: c.exportedAt,
      ...temps,
      totalArticles: c.totalArticles || 0,
      totalQuantite: c.totalQuantite || 0,
      fichierExport: c.fichierExport || "",
      observationAgent: c.observationAgent || "",
      observation: c.observation || "",
      observationPar: c.observationPar ? nomUtilisateur(c.observationPar) : "",
      observationAt: c.observationAt || null,
    };
  });

  if (search) {
    const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    bipages = bipages.filter(
      (b) =>
        rx.test(b.zoneCode || "") ||
        rx.test(b.zoneLibelle || "") ||
        rx.test(b.agent?.nom || "") ||
        rx.test(b.observationAgent || "") ||
        rx.test(b.observation || ""),
    );
  }

  // Synthèse par agent : c'est la lecture la plus utile de l'écran (qui a bipé
  // combien de zones, en combien de temps).
  const parAgent = new Map();
  for (const b of bipages) {
    const cle = b.agent?._id ? String(b.agent._id) : "?";
    if (!parAgent.has(cle)) {
      parAgent.set(cle, {
        user: b.agent?._id || null,
        nom: b.agent?.nom || "(inconnu)",
        nbBipages: 0,
        nbTermines: 0,
        totalArticles: 0,
        totalQuantite: 0,
        tempsActifMs: 0,
      });
    }
    const a = parAgent.get(cle);
    a.nbBipages += 1;
    if (b.status === "exporte") a.nbTermines += 1;
    a.totalArticles += b.totalArticles;
    a.totalQuantite += b.totalQuantite;
    a.tempsActifMs += b.tempsActifMs;
  }
  const agents = [...parAgent.values()].sort((x, y) => y.nbBipages - x.nbBipages);

  res.json({
    session: sessionActive
      ? { _id: sessionActive._id, nom: sessionActive.nom, createdAt: sessionActive.createdAt }
      : null,
    sessions: sessions.map((s) => ({
      _id: s._id,
      nom: s.nom,
      statut: s.statut,
      createdAt: s.createdAt,
    })),
    seuilPauseMs: PAUSE_BIPAGE_MS,
    totaux: {
      nbBipages: bipages.length,
      nbTermines: bipages.filter((b) => b.status === "exporte").length,
      nbEnCours: bipages.filter((b) => b.status === "en_cours").length,
      totalArticles: bipages.reduce((s, b) => s + b.totalArticles, 0),
      totalQuantite: bipages.reduce((s, b) => s + b.totalQuantite, 0),
      tempsActifMs: bipages.reduce((s, b) => s + b.tempsActifMs, 0),
    },
    agents,
    bipages,
  });
});

/**
 * @desc    Écrire l'observation « suivi » d'un bipage (depuis le web).
 *          N'écrase JAMAIS l'observation laissée par l'agent sur le collecteur.
 * @route   PATCH /api/inventaires-collecte/suivi-bipage/:entrepriseId/:id/observation
 * @access  Private (module inventaire, write)
 */
const updateObservationCollecte = asyncHandler(async (req, res) => {
  const collecte = await InventaireCollecte.findById(req.params.id);
  if (!collecte) {
    res.status(404);
    throw new Error("Bipage non trouvé");
  }
  // L'id du bipage vient du client : on vérifie qu'il appartient bien à la
  // société dont l'accès a été validé par checkEntrepriseAccess.
  if (String(collecte.entreprise) !== String(req.params.entrepriseId)) {
    res.status(403);
    throw new Error("Ce bipage n'appartient pas à cette société.");
  }

  collecte.observation = String(req.body.observation || "").trim();
  collecte.observationPar = req.user._id;
  collecte.observationAt = new Date();
  await collecte.save();

  res.json({
    _id: collecte._id,
    observation: collecte.observation,
    observationPar: nomUtilisateur(req.user),
    observationAt: collecte.observationAt,
  });
});

export {
  resoudreZone,
  getSessionActive,
  createCollecte,
  getSuiviBipage,
  updateObservationCollecte,
  getCollectesEnCours,
  getCollecteById,
  scanArticleCollecte,
  addLigneCollecte,
  updateLigneCollecte,
  deleteLigneCollecte,
  exportCollecte,
  getRecapZones,
  getRecapZonePdf,
  deleteCollecte,
};